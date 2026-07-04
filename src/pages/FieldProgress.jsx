import React, { useMemo, useState } from 'react';
import { Project, TaskProgressLog } from '@/api/entities';
import { fetchProgrammeTasks, fetchProgrammesByProject } from '@/api/programmeData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/shared/PageHeader';
import { ClipboardCheck } from 'lucide-react';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import FieldTaskCard from '@/components/programme/FieldTaskCard';
import QuickProgressSheet from '@/components/programme/QuickProgressSheet';
import { runScheduleEngineByProject, calendarForProgramme } from '@/lib/scheduling/scheduleEngine';
import { updateTaskProgress } from '@/lib/scheduleUpdateService';
import { uploadFile, removeFile } from '@/api/supabaseClient';

export default function FieldProgress() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [tab, setTab] = useState('mine');
  const [activeTask, setActiveTask] = useState(null);
  const [saving, setSaving] = useState(false);

  const { data: allProjectsRaw = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => Project.list('-created_at', 100),
  });
  const projects = isAdmin
    ? allProjectsRaw
    : allProjectsRaw.filter(p => p.team?.some(m => m.user_email === user?.email));
  const projectIds = useMemo(() => new Set(projects.map(p => p.id)), [projects]);

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', selectedProjectId],
    queryFn: () => fetchProgrammeTasks(selectedProjectId),
    staleTime: 30000,
  });

  const { data: programmesByProject } = useQuery({
    queryKey: ['programmes'],
    queryFn: fetchProgrammesByProject,
  });

  const tasks = useMemo(() => {
    const accessible = allTasks.filter(t => projectIds.has(t.project_id));
    return selectedProjectId === 'all'
      ? accessible
      : accessible.filter(t => t.project_id === selectedProjectId);
  }, [allTasks, projectIds, selectedProjectId]);

  const scheduledMap = useMemo(
    () => runScheduleEngineByProject(tasks, programmesByProject || new Map()),
    [tasks, programmesByProject]
  );

  // Field crews update leaf tasks only — summary rows roll up from children
  const leafTasks = useMemo(() => {
    const parentIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
    return tasks.filter(t => !parentIds.has(t.id));
  }, [tasks]);

  const plannedFor = (t) => {
    const r = scheduledMap.get(t.id);
    return {
      startStr: r?.startStr || t.start_date || null,
      finishStr: r?.finishStr || t.end_date || null,
      isCritical: r?.isCritical || false,
    };
  };

  const byPlannedStart = (a, b) => {
    const doneA = (a.percent_complete || 0) >= 100 ? 1 : 0;
    const doneB = (b.percent_complete || 0) >= 100 ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return (plannedFor(a).startStr || '9999').localeCompare(plannedFor(b).startStr || '9999');
  };

  const myEmail = (user?.email || '').toLowerCase();
  const myTasks = leafTasks
    .filter(t => (t.assignee_email || '').toLowerCase() === myEmail)
    .sort(byPlannedStart);

  const weekTasks = useMemo(() => {
    const from = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const to = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    return leafTasks
      .filter(t => {
        const p = plannedFor(t);
        if (!p.startStr || !p.finishStr) return false;
        return p.startStr <= to && p.finishStr >= from;
      })
      .sort(byPlannedStart);
  }, [leafTasks, scheduledMap]);

  const byAssignee = useMemo(() => {
    const groups = new Map();
    for (const t of leafTasks) {
      const key = t.assignee_email || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b))
      .map(([key, list]) => [key, list.sort(byPlannedStart)]);
  }, [leafTasks, scheduledMap]);

  const projectName = (id) => projects.find(p => p.id === id)?.name;

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

  const renderList = (list, { showAssignee = false } = {}) => (
    list.length === 0 ? (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <ClipboardCheck className="w-8 h-8" />
        <p className="text-sm">No tasks here.</p>
      </div>
    ) : (
      <div className="space-y-2">
        {list.map(t => (
          <FieldTaskCard
            key={t.id}
            task={t}
            planned={plannedFor(t)}
            showAssignee={showAssignee}
            onClick={() => setActiveTask(t)}
          />
        ))}
      </div>
    )
  );

  return (
    <div className="max-w-lg mx-auto pb-6">
      <PageHeader
        title="Field Progress"
        description="Quick progress updates from site"
        actions={
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-2">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="mine">My tasks</TabsTrigger>
          <TabsTrigger value="week">This week</TabsTrigger>
          <TabsTrigger value="assignee">By assignee</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-3">
        {tab === 'mine' && renderList(myTasks)}
        {tab === 'week' && renderList(weekTasks, { showAssignee: true })}
        {tab === 'assignee' && (
          byAssignee.length === 0 ? renderList([]) : (
            <div className="space-y-5">
              {byAssignee.map(([email, list]) => (
                <div key={email}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {email}
                  </p>
                  {renderList(list)}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <QuickProgressSheet
        task={activeTask}
        planned={activeTask ? plannedFor(activeTask) : null}
        projectName={activeTask ? projectName(activeTask.project_id) : null}
        open={!!activeTask}
        onOpenChange={open => { if (!open && !saving) setActiveTask(null); }}
        saving={saving}
        onSave={handleSave}
      />
    </div>
  );
}
