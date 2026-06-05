import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  PanelLeftClose, PanelLeftOpen, Upload, Printer, ZoomIn, ZoomOut,
  Trash2, Target, Calendar, LayoutDashboard, CalendarDays,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/shared/PageHeader';
import { Link } from 'react-router-dom';
import TaskList from '@/components/programme/TaskList';
import GanttChart from '@/components/programme/GanttChart';
import TaskProgressPanel from '@/components/programme/TaskProgressPanel';
import ProgrammeHealth from '@/components/programme/ProgrammeHealth';
import LookAhead from '@/components/programme/LookAhead';
import ProgressModal from '@/components/programme/ProgressModal';
import { parseXML, parseMPX, parseExcelCSV } from '@/lib/scheduleImportParsers';
import { runScheduleEngine } from '@/lib/scheduling/scheduleEngine';
import { getVisibleTasks } from '@/lib/programme/visibleTasks';

const ZOOM_LEVELS = ['year', 'quarter', 'month', 'week', 'day'];
const DELETE_CHUNK = 150;
const IMPORT_STAGES = ['Reading file', 'Parsing schedule', 'Creating tasks', 'Linking dependencies', 'Building hierarchy', 'Finalising'];

export default function Programme() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { toast } = useToast();

  const urlParams = new URLSearchParams(window.location.search);
  const projectFromUrl = urlParams.get('project') || 'all';

  const [selectedProjectId, setSelectedProjectId] = useState(projectFromUrl);
  const [taskListCollapsed, setTaskListCollapsed] = useState(false);
  const [zoom, setZoom] = useState('week');
  const [selectedTask, setSelectedTask] = useState(null);

  // Expand/collapse state — shared source of truth for TaskList + GanttChart
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Import state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [mppFile, setMppFile] = useState(null);
  const [importProgress, setImportProgress] = useState(null); // { stage, pct, statusText, error }

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null); // { pct, statusText, done, error }

  const [showCriticalPath, setShowCriticalPath] = useState(true);

  const queryClient = useQueryClient();
  const taskScrollRef = useRef(null);
  const ganttScrollRef = useRef(null);
  const isSyncing = useRef(false);

  const syncScroll = useCallback((source, target) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    target.scrollTop = source.scrollTop;
    isSyncing.current = false;
  }, []);

  const onToggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ─── Data fetching ───────────────────────────────────────────────────────────
  const { data: allProjectsRaw = [], isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100),
  });

  const projects = isAdmin
    ? allProjectsRaw
    : allProjectsRaw.filter(p => p.team?.some(m => m.user_email === user?.email));

  const projectIds = new Set(projects.map(p => p.id));

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', selectedProjectId],
    queryFn: () => selectedProjectId === 'all'
      ? base44.entities.Task.list('sort_order', 500)
      : base44.entities.Task.filter({ project_id: selectedProjectId }, 'sort_order', 500),
    staleTime: 30000,
  });

  useEffect(() => {
    const unsub = base44.entities.Task.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    return unsub;
  }, [queryClient]);

  const accessibleTasks = allTasks.filter(t => projectIds.has(t.project_id));
  const tasks = selectedProjectId === 'all'
    ? accessibleTasks
    : accessibleTasks.filter(t => t.project_id === selectedProjectId);

  // Seed expandedIds when tasks first load (expand root tasks)
  useEffect(() => {
    if (tasks.length > 0) {
      setExpandedIds(new Set(tasks.filter(t => !t.parent_id).map(t => t.id)));
    }
  }, [tasks.length > 0 && selectedProjectId]);

  // ─── Single visible task list — shared by TaskList + GanttChart ─────────────
  const visibleTasks = useMemo(() => getVisibleTasks(tasks, expandedIds), [tasks, expandedIds]);

  // ─── Schedule engine ─────────────────────────────────────────────────────────
  const scheduledMap = useMemo(() => {
    if (!tasks.length) return new Map();
    const pStart = tasks.reduce((min, t) => {
      if (!t.start_date) return min;
      return !min || t.start_date < min ? t.start_date : min;
    }, null) || new Date().toISOString().split('T')[0];
    return runScheduleEngine(tasks, pStart);
  }, [tasks]);

  const criticalTaskCount = useMemo(() => {
    let count = 0;
    scheduledMap.forEach(r => { if (r.isCritical) count++; });
    return count;
  }, [scheduledMap]);

  // ─── Import with progress ────────────────────────────────────────────────────
  const handleMPPUpload = async () => {
    if (!mppFile || !selectedProjectId || selectedProjectId === 'all') return;
    setShowImportDialog(false);

    const setStage = (stageIdx, pct, detail = '') => {
      setImportProgress({
        stage: stageIdx + 1,
        stageOf: IMPORT_STAGES.length,
        pct,
        statusText: `${IMPORT_STAGES[stageIdx]}${detail ? ` — ${detail}` : ''}`,
        error: null,
      });
    };

    setImportProgress({ stage: 1, stageOf: 6, pct: 2, statusText: 'Reading file…', error: null });

    try {
      // Stage 1: read file
      const ext = mppFile.name.split('.').pop().toLowerCase();
      let text;
      if (ext === 'xml' || ext === 'mpx') text = await mppFile.text();
      setStage(0, 10);

      // Stage 2: parse
      setStage(1, 18);
      let parsedTasks = [];
      if (ext === 'xml') parsedTasks = parseXML(text, selectedProjectId);
      else if (ext === 'mpx') parsedTasks = parseMPX(text, selectedProjectId);
      else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') parsedTasks = await parseExcelCSV(mppFile, selectedProjectId);
      setStage(1, 25, `${parsedTasks.length} tasks found`);

      if (!parsedTasks.length) {
        setImportProgress(null);
        setMppFile(null);
        return;
      }

      // Stage 3: bulk create tasks
      setStage(2, 30, `Creating ${parsedTasks.length} tasks`);
      const tasksToCreate = parsedTasks.map(({ _mspUid, _predecessorLinks, _parentUid, ...t }) => t);
      const created = await base44.entities.Task.bulkCreate(tasksToCreate);
      setStage(2, 55, `${created.length} tasks created`);

      const uidToDbId = new Map();
      parsedTasks.forEach((pt, i) => {
        if (pt._mspUid != null && created[i]?.id) uidToDbId.set(pt._mspUid, created[i].id);
      });

      // Stage 4: link dependencies
      setStage(3, 60);
      const updates = [];
      parsedTasks.forEach((pt, i) => {
        const dbId = created[i]?.id;
        if (!dbId) return;
        const payload = {};
        if (pt._predecessorLinks?.length) {
          const predecessors = pt._predecessorLinks
            .map(link => {
              const predDbId = uidToDbId.get(link._predUid);
              if (!predDbId) return null;
              return { predecessor_id: predDbId, task_id: predDbId, type: link.type, lag_hours: link.lag_hours, lag_days: Math.round(link.lag_hours / 8), is_elapsed: link.is_elapsed };
            }).filter(Boolean);
          if (predecessors.length) payload.predecessors = predecessors;
        }
        if (pt._parentUid != null) {
          const parentDbId = uidToDbId.get(pt._parentUid);
          if (parentDbId) payload.parent_id = parentDbId;
        }
        if (Object.keys(payload).length) updates.push({ id: dbId, ...payload });
      });

      const DEP_BATCH = 10;
      let done = 0;
      for (let i = 0; i < updates.length; i += DEP_BATCH) {
        const batch = updates.slice(i, i + DEP_BATCH);
        await Promise.all(batch.map(({ id, ...payload }) => base44.entities.Task.update(id, payload)));
        done += batch.length;
        setStage(3, 60 + Math.round((done / updates.length) * 25), `${done} / ${updates.length} dependencies`);
        await new Promise(r => setTimeout(r, 150));
      }

      // Stage 5/6: finalise
      setStage(4, 88, 'Building WBS structure');
      setStage(5, 95, 'Finalising');

      queryClient.invalidateQueries({ queryKey: ['tasks'] });

      setImportProgress(p => ({ ...p, pct: 100, statusText: 'Import complete!' }));
      setTimeout(() => {
        setImportProgress(null);
        setMppFile(null);
        toast({ title: `Schedule imported`, description: `${parsedTasks.length} tasks loaded successfully.`, duration: 4000 });
      }, 1200);

    } catch (error) {
      setImportProgress(p => ({ ...p, error: error.message || 'Import failed. Please check the file and try again.' }));
    }
  };

  // ─── Chunked delete with progress ────────────────────────────────────────────
  const handleDeleteAllTasks = async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    setShowDeleteConfirm(false);

    const total = tasks.length;
    setDeleteProgress({ pct: 0, statusText: `0 / ${total} tasks deleted`, done: false, error: null });

    let deleted = 0;
    const ids = tasks.map(t => t.id);

    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK);
      await Promise.all(chunk.map(id => base44.entities.Task.delete(id).catch(() => {})));
      deleted += chunk.length;
      const pct = Math.round((deleted / total) * 100);
      setDeleteProgress({ pct, statusText: `${deleted} / ${total} tasks deleted`, done: false, error: null });
      // yield to browser between chunks
      await new Promise(r => setTimeout(r, 40));
    }

    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setDeleteProgress(p => ({ ...p, pct: 100, statusText: `${total} tasks deleted`, done: true }));
    setTimeout(() => {
      setDeleteProgress(null);
      toast({ title: 'Programme deleted', description: `${total} tasks removed.`, duration: 4000 });
    }, 1200);
  };

  const cycleZoom = (direction) => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    const newIdx = direction === 'in' ? Math.min(idx + 1, ZOOM_LEVELS.length - 1) : Math.max(idx - 1, 0);
    setZoom(ZOOM_LEVELS[newIdx]);
  };

  if (!isLoadingProjects && projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Calendar className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-semibold text-lg mb-1">No projects yet</h3>
          <p className="text-muted-foreground text-sm max-w-sm">You need to be part of a project before you can view its programme.</p>
        </div>
        <Button asChild><Link to="/projects">Go to Projects</Link></Button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <PageHeader
        title="Programme"
        description="View schedule, track progress and monitor health"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All Projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {criticalTaskCount > 0 && (
              <Badge variant={showCriticalPath ? 'destructive' : 'outline'} className="cursor-pointer gap-1"
                onClick={() => setShowCriticalPath(v => !v)}>
                <Target className="w-3 h-3" />{criticalTaskCount} critical
              </Badge>
            )}

            <Button variant="outline" size="icon" onClick={() => cycleZoom('out')} title={`Zoom out (${zoom})`}><ZoomOut className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('in')} title={`Zoom in (${zoom})`}><ZoomIn className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => window.print()} title="Print"><Printer className="w-4 h-4" /></Button>
            <Button onClick={() => setShowImportDialog(true)} className="gap-2"><Upload className="w-4 h-4" /> Import</Button>
            <Button variant="destructive" size="icon"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!selectedProjectId || selectedProjectId === 'all' || tasks.length === 0}
              title="Delete all tasks">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="gantt" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 w-fit">
          <TabsTrigger value="gantt">Gantt Chart</TabsTrigger>
          <TabsTrigger value="lookahead" className="gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Look Ahead</TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5"><LayoutDashboard className="w-3.5 h-3.5" /> Health</TabsTrigger>
        </TabsList>

        {/* ── Gantt ── */}
        <TabsContent value="gantt" className="flex-1 flex border rounded-lg overflow-hidden bg-card mt-2">
          <button onClick={() => setTaskListCollapsed(!taskListCollapsed)}
            className="flex items-center justify-center w-8 bg-muted/30 hover:bg-muted transition-colors border-r flex-shrink-0"
            title={taskListCollapsed ? 'Show task list' : 'Hide task list'}>
            {taskListCollapsed ? <PanelLeftOpen className="w-4 h-4 text-muted-foreground" /> : <PanelLeftClose className="w-4 h-4 text-muted-foreground" />}
          </button>

          {!taskListCollapsed && (
            <div className="w-[640px] xl:w-[720px] flex-shrink-0 overflow-hidden">
              <TaskList
                tasks={tasks}
                visibleTasks={visibleTasks}
                scheduledMap={scheduledMap}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
                onTaskClick={setSelectedTask}
                scrollRef={taskScrollRef}
                onScroll={() => ganttScrollRef.current && syncScroll(taskScrollRef.current, ganttScrollRef.current)}
              />
            </div>
          )}

          <GanttChart
            tasks={tasks}
            visibleTasks={visibleTasks}
            scheduledMap={scheduledMap}
            zoom={zoom}
            scrollRef={ganttScrollRef}
            onScroll={() => taskScrollRef.current && syncScroll(ganttScrollRef.current, taskScrollRef.current)}
            baselineMap={null}
            onTaskClick={setSelectedTask}
          />
        </TabsContent>

        <TabsContent value="lookahead" className="flex-1 overflow-hidden border rounded-lg bg-card mt-2">
          <LookAhead tasks={tasks} scheduledMap={scheduledMap} />
        </TabsContent>

        <TabsContent value="health" className="flex-1 overflow-hidden border rounded-lg bg-card mt-2">
          <ProgrammeHealth tasks={tasks} scheduledMap={scheduledMap} />
        </TabsContent>
      </Tabs>

      {/* Progress tracking panel */}
      <TaskProgressPanel
        task={selectedTask}
        tasks={tasks}
        scheduledMap={scheduledMap}
        open={!!selectedTask}
        onOpenChange={open => { if (!open) setSelectedTask(null); }}
      />

      {/* Import progress modal */}
      <ProgressModal
        open={!!importProgress}
        title="Importing Programme"
        stage={importProgress?.stage}
        stageOf={importProgress?.stageOf}
        pct={importProgress?.pct || 0}
        statusText={importProgress?.statusText}
        error={importProgress?.error}
        onRetry={() => { setImportProgress(null); setShowImportDialog(true); }}
        onClose={() => { setImportProgress(null); setMppFile(null); }}
      />

      {/* Delete progress modal */}
      <ProgressModal
        open={!!deleteProgress}
        title="Deleting Programme"
        pct={deleteProgress?.pct || 0}
        statusText={deleteProgress?.statusText}
        error={deleteProgress?.error}
        onClose={() => setDeleteProgress(null)}
      />

      {/* Delete confirm */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {tasks.length} task{tasks.length !== 1 ? 's' : ''} in this project. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction onClick={handleDeleteAllTasks} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete All
          </AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Import Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Import from MS Project or Excel. The imported schedule becomes the master plan — dates are read-only in ConstructIQ.
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border p-2.5 space-y-1"><p className="font-semibold">XML (recommended)</p><p className="text-muted-foreground">File → Save As → XML Format</p></div>
              <div className="rounded-md border p-2.5 space-y-1"><p className="font-semibold">Excel / CSV</p><p className="text-muted-foreground">Name, Start, End, Duration, WBS, %</p></div>
              <div className="rounded-md border p-2.5 space-y-1"><p className="font-semibold">MPX</p><p className="text-muted-foreground">File → Save As → MPX</p></div>
            </div>
            <div>
              <Label>Select Project *</Label>
              <Select value={selectedProjectId !== 'all' ? selectedProjectId : (projects[0]?.id || '')} onValueChange={setSelectedProjectId}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Schedule File *</Label>
              <Input type="file" accept=".xml,.mpx,.xlsx,.xls,.csv" onChange={e => setMppFile(e.target.files?.[0] || null)} />
              {mppFile && <p className="text-xs text-muted-foreground mt-1">Selected: {mppFile.name}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowImportDialog(false); setMppFile(null); }}>Cancel</Button>
            <Button onClick={handleMPPUpload} disabled={!mppFile || !selectedProjectId || selectedProjectId === 'all'}>
              Import Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}