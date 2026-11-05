/**
 * useQuickProgress — shared save/update logic for quick field progress updates.
 *
 * Extracted from the old FieldProgress page so both the (now-removed) Field
 * page and the Look Ahead tab can drive QuickProgressSheet through the same
 * mutation: save the task (cascading the CPM reschedule for its own project,
 * unless that programme is locked for this user), then record the
 * TaskProgressLog row (with optional photo) and invalidate ['tasks'].
 *
 * The sheet can also add working days when a task needs more time: the
 * extension and the % update are saved through one engine run.
 *
 * Usage:
 *   const { activeTask, setActiveTask, saving, handleSave, canExtend, isLocked,
 *           previewExtension, extraDaysForFinish } =
 *     useQuickProgress({ allTasks, programmesByProject });
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { TaskProgressLog } from '@/api/entities';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { calendarForProgramme } from '@/lib/scheduling/scheduleEngine';
import { countWorkingDays, parseDate } from '@/lib/scheduling/calendarEngine';
import { updateTaskProgress, extendTask, previewFieldUpdate, lockedProjectIdsFor } from '@/lib/scheduleUpdateService';
import { uploadFile, removeFile } from '@/api/supabaseClient';

const dayAfter = (dateStr) => {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + 1);
  return d;
};

const daysLabel = (n) => `${n} day${n === 1 ? '' : 's'}`;

export default function useQuickProgress({ allTasks, programmesByProject }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTask, setActiveTask] = useState(null);
  const [saving, setSaving] = useState(false);

  // Cascade through the task's own project only — the engine needs that
  // project's calendar/data date, and slips must not leak across projects.
  const scheduleContext = (task) => {
    const projectTasks = allTasks.filter(t => t.project_id === task.project_id);
    const programme = programmesByProject?.get(task.project_id) || null;
    const projectStart = projectTasks.reduce((min, t) => {
      if (!t.start_date) return min;
      return !min || t.start_date < min ? t.start_date : min;
    }, null);
    return {
      programme,
      projectTasks,
      options: {
        userId: user?.id || null,
        projectStart,
        calendar: calendarForProgramme(programme, projectTasks),
        dataDate: programme?.data_date || null,
        // Locked: progress saves without the date cascade the lock would reject
        lockedProjectIds: lockedProjectIdsFor(programmesByProject, user?.role === 'admin'),
      },
    };
  };

  // A locked (published) programme's dates are frozen for everyone but admins —
  // progress can still be logged, but days can't be added.
  const isLocked = (task) =>
    !!task && lockedProjectIdsFor(programmesByProject, user?.role === 'admin').has(task.project_id);

  const canExtend = (task) => !!task && !(task.is_milestone || task.duration === 0) && !isLocked(task);

  /** New duration + finish if the active task gets `extraDays` more, at `percent`. */
  const previewExtension = (percent, extraDays) => {
    if (!activeTask || !(extraDays > 0)) return null;
    const { projectTasks, options } = scheduleContext(activeTask);
    return previewFieldUpdate(activeTask.id, { percent_complete: percent, extraDays }, projectTasks, options);
  };

  /** Working days between the active task's current finish and a new finish date. */
  const extraDaysForFinish = (currentFinishStr, newFinishStr) => {
    if (!activeTask || !currentFinishStr || !newFinishStr || newFinishStr <= currentFinishStr) return 0;
    const { options } = scheduleContext(activeTask);
    return countWorkingDays(dayAfter(currentFinishStr), dayAfter(newFinishStr), options.calendar);
  };

  const handleSave = async ({ percent, note, delayReason, photoFile, extraDays = 0 }) => {
    const task = activeTask;
    if (!task || saving) return;
    const extending = extraDays > 0 && canExtend(task);
    setSaving(true);
    let photo = null;
    try {
      const { projectTasks, options } = scheduleContext(task);
      const preview = extending
        ? previewFieldUpdate(task.id, { percent_complete: percent, extraDays }, projectTasks, options)
        : null;
      // The extension goes in the progress log too, so the task history shows why it grew
      const logNote = extending
        ? [`Added ${daysLabel(extraDays)} (${daysLabel(task.duration ?? 1)} → ${daysLabel(preview.duration)}).`, note]
          .filter(Boolean).join('\n')
        : note;

      if (photoFile) {
        photo = await uploadFile(photoFile, 'project-files');
      }
      const discardPhoto = () => (photo ? removeFile(photo.bucket, photo.path).catch(() => {}) : null);

      // Task first: a history row must never claim progress the task didn't get.
      let result;
      try {
        result = extending
          ? await extendTask(task.id, { percent_complete: percent, extraDays }, projectTasks, options)
          : await updateTaskProgress(task.id, percent, projectTasks, options);
      } catch (err) {
        await discardPhoto();
        throw err;
      }
      const { patches, scheduledMap } = result;

      let historySaved = true;
      try {
        await TaskProgressLog.create({
          task_id: task.id,
          project_id: task.project_id,
          updated_by: user?.id,
          previous_percent: task.percent_complete || 0,
          new_percent: percent,
          note: logNote,
          delay_reason: delayReason,
          photo_path: photo?.path || null,
        });
      } catch (err) {
        historySaved = false;
        await discardPhoto();
        console.warn('task_progress_log write failed (progress itself saved):', err.message);
      }

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (!historySaved) {
        toast({
          title: 'Progress saved, history entry failed',
          description: `${task.name} is at ${percent}%, but its history entry${photo ? ' and photo' : ''} didn’t save.`,
          variant: 'destructive',
          duration: 6000,
        });
        setActiveTask(null);
        return;
      }
      const downstream = patches.length > 1
        ? ` — ${patches.length - 1} downstream task${patches.length === 2 ? '' : 's'} rescheduled`
        : '';
      const finishStr = scheduledMap?.get(task.id)?.finishStr;
      toast({
        title: extending ? 'Programme updated' : 'Progress saved',
        description: extending
          ? `${task.name}: ${daysLabel(extraDays)} added${finishStr ? `, now finishing ${format(parseDate(finishStr), 'EEE d MMM')}` : ''}${downstream}.`
          : `${task.name} at ${percent}%${downstream}.`,
        duration: extending ? 5000 : 3000,
      });
      setActiveTask(null);
    } catch (e) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return { activeTask, setActiveTask, saving, handleSave, canExtend, isLocked, previewExtension, extraDaysForFinish };
}
