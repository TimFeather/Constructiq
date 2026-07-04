/**
 * useQuickProgress — shared save/update logic for quick field progress updates.
 *
 * Extracted from the old FieldProgress page so both the (now-removed) Field
 * page and the Look Ahead tab can drive QuickProgressSheet through the same
 * mutation: insert a TaskProgressLog row (with optional photo), then cascade
 * the CPM reschedule for the task's own project and invalidate ['tasks'].
 *
 * Usage:
 *   const { activeTask, setActiveTask, saving, handleSave } =
 *     useQuickProgress({ allTasks, programmesByProject });
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TaskProgressLog } from '@/api/entities';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { calendarForProgramme } from '@/lib/scheduling/scheduleEngine';
import { updateTaskProgress } from '@/lib/scheduleUpdateService';
import { uploadFile, removeFile } from '@/api/supabaseClient';

export default function useQuickProgress({ allTasks, programmesByProject }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTask, setActiveTask] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async ({ percent, note, delayReason, photoFile }) => {
    const task = activeTask;
    if (!task || saving) return;
    setSaving(true);
    let photo = null;
    try {
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
          note,
          delay_reason: delayReason,
          photo_path: photo?.path || null,
        });
      } catch (err) {
        if (photo) await removeFile(photo.bucket, photo.path);
        throw err;
      }

      // Cascade through the task's own project only — the engine needs that
      // project's calendar/data date, and slips must not leak across projects.
      const projectTasks = allTasks.filter(t => t.project_id === task.project_id);
      const programme = programmesByProject?.get(task.project_id) || null;
      const projectStart = projectTasks.reduce((min, t) => {
        if (!t.start_date) return min;
        return !min || t.start_date < min ? t.start_date : min;
      }, null);
      const { patches } = await updateTaskProgress(task.id, percent, projectTasks, {
        userId: user?.id || null,
        projectStart,
        calendar: calendarForProgramme(programme, projectTasks),
        dataDate: programme?.data_date || null,
      });

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({
        title: 'Progress saved',
        description: patches.length > 1
          ? `${task.name} at ${percent}% — ${patches.length - 1} downstream task${patches.length === 2 ? '' : 's'} rescheduled.`
          : `${task.name} at ${percent}%.`,
        duration: 3000,
      });
      setActiveTask(null);
    } catch (e) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return { activeTask, setActiveTask, saving, handleSave };
}
