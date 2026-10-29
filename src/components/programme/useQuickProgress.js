/**
 * useQuickProgress — shared save/update logic for quick field progress updates.
 *
 * Extracted from the old FieldProgress page so both the (now-removed) Field
 * page and the Look Ahead tab can drive QuickProgressSheet through the same
 * mutation: insert a TaskProgressLog row (with optional photo), then cascade
 * the CPM reschedule for the task's own project and invalidate ['tasks'].
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
import { updateTaskProgress, extendTask, previewFieldUpdate } from '@/lib/scheduleUpdateService';
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
      },
    };
  };

  // A locked (published) programme's dates are frozen for everyone but admins —
  // progress can still be logged, but days can't be added.
  const isLocked = (task) => {
    if (!task || user?.role === 'admin') return false;
    return programmesByProject?.get(task.project_id)?.status === 'published';
  };

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
        if (photo) await removeFile(photo.bucket, photo.path);
        throw err;
      }

      const { patches, scheduledMap } = extending
        ? await extendTask(task.id, { percent_complete: percent, extraDays }, projectTasks, options)
        : await updateTaskProgress(task.id, percent, projectTasks, options);

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
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
