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
  ChevronsDownUp, ChevronsUpDown, Pencil,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/shared/PageHeader';
import { Link, useSearchParams } from 'react-router-dom';
import TaskList from '@/components/programme/TaskList';
import GanttChart from '@/components/programme/GanttChart';
import TaskProgressPanel from '@/components/programme/TaskProgressPanel';
import ProgrammeHealth from '@/components/programme/ProgrammeHealth';
import LookAhead from '@/components/programme/LookAhead';
import ProgressModal from '@/components/programme/ProgressModal';
import { parseXML, parseMPX, parseExcelCSV } from '@/lib/scheduleImportParsers';
import { runScheduleEngine } from '@/lib/scheduling/scheduleEngine';
import { getVisibleTasks } from '@/lib/programme/visibleTasks';
import { bulkOperationState } from '@/lib/bulkOperationState';
import { retry429 } from '@/lib/retry429';
import TaskInlineEditor from '@/components/programme/TaskInlineEditor';
import { useIsMobile } from '@/hooks/use-mobile';

const ZOOM_LEVELS = ['year', 'quarter', 'month', 'week', 'day'];
const DELETE_CHUNK = 150;
const IMPORT_STAGES = ['Reading file', 'Parsing schedule', 'Creating tasks', 'Linking dependencies', 'Building hierarchy', 'Finalising'];

export default function Programme() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const urlParams = new URLSearchParams(window.location.search);
  const projectFromUrl = urlParams.get('project') || 'all';

  const [selectedProjectId, setSelectedProjectId] = useState(projectFromUrl);
  const [taskListCollapsed, setTaskListCollapsed] = useState(false);
  const [zoom, setZoom] = useState('week');
  const [selectedTask, setSelectedTask] = useState(null);

  // Expand/collapse state — shared source of truth for TaskList + GanttChart
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [editingTask, setEditingTask] = useState(null);

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
    if (!source || !target || isSyncing.current) return;
    isSyncing.current = true;
    target.scrollTop = source.scrollTop;
    requestAnimationFrame(() => { isSyncing.current = false; });
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
      ? base44.entities.Task.list('sort_order', 2000)
      : base44.entities.Task.filter({ project_id: selectedProjectId }, 'sort_order', 2000),
    staleTime: 30000,
  });

  useEffect(() => {
    const unsub = base44.entities.Task.subscribe(() => {
      if (bulkOperationState.active) return;
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    return unsub;
  }, [queryClient]);

  const accessibleTasks = allTasks.filter(t => projectIds.has(t.project_id));
  const tasks = selectedProjectId === 'all'
    ? accessibleTasks
    : accessibleTasks.filter(t => t.project_id === selectedProjectId);

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(tasks.map(t => t.id)));
  }, [tasks]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // Seed expandedIds when tasks first load (expand root tasks)
  useEffect(() => {
    if (tasks.length > 0) {
      setExpandedIds(new Set(tasks.filter(t => !t.parent_id).map(t => t.id)));
    }
  }, [selectedProjectId]);

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
    // Import started
    bulkOperationState.active = true;

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

      // Stage 3: chunked create with exponential backoff
      setStage(2, 30, `Creating ${parsedTasks.length} tasks`);
      const tasksToCreate = parsedTasks.map(({ _mspUid, _predecessorLinks, _parentUid, ...t }) => t);

      const CREATE_BATCH = 100;
      const created = [];
      for (let i = 0; i < tasksToCreate.length; i += CREATE_BATCH) {
        const chunk = tasksToCreate.slice(i, i + CREATE_BATCH);
        const result = await retry429(() => base44.entities.Task.bulkCreate(chunk));
        created.push(...result);
        const pct = 30 + Math.round(((i + chunk.length) / tasksToCreate.length) * 25);
        setStage(2, pct, `${created.length} / ${tasksToCreate.length} tasks created`);
      }
      setStage(2, 55, `${created.length} tasks created`);


      const uidToDbId = new Map();
      parsedTasks.forEach((pt, i) => {
        if (pt._mspUid != null && created[i]?.id) uidToDbId.set(pt._mspUid, created[i].id);
      });

      // Stage 4: link dependencies sequentially
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

      const DEP_BATCH = 15;
      let done = 0;
      for (let i = 0; i < updates.length; i += DEP_BATCH) {
        const batch = updates.slice(i, i + DEP_BATCH);
        await Promise.all(batch.map(({ id, ...payload }) =>
          retry429(() => base44.entities.Task.update(id, payload)).then(() => {
            done++;
            setStage(3, 60 + Math.round((done / updates.length) * 25), `${done} / ${updates.length} dependencies`);
          })
        ));
      }

      // Stage 5/6: finalise
      setStage(4, 88, 'Building WBS structure');
      setStage(5, 95, 'Finalising');

      setImportProgress(p => ({ ...p, pct: 100, statusText: 'Import complete!' }));


      setTimeout(async () => {
        setImportProgress(null);
        setMppFile(null);
        await queryClient.refetchQueries({ queryKey: ['tasks'] });
        toast({ title: `Schedule imported`, description: `${parsedTasks.length} tasks loaded successfully.`, duration: 4000 });
      }, 1200);

    } catch (error) {
      setImportProgress(p => ({ ...p, error: error.message || 'Import failed. Please check the file and try again.' }));
    } finally {
      bulkOperationState.active = false;
    }
  };

  // ─── Sequential delete with exponential backoff ──────────────────────────────
  const handleDeleteAllTasks = async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    if (importProgress) return;
    setShowDeleteConfirm(false);

    setDeleteProgress({ pct: 0, statusText: 'Fetching task list…', done: false, error: null });

    bulkOperationState.active = true;
    try {
      const freshTasks = await base44.entities.Task.filter(
        { project_id: selectedProjectId }, 'sort_order', 5000
      );
      const allIds = freshTasks.map(t => t.id);
      const total = allIds.length;

      if (total === 0) {
        setDeleteProgress(null);
        toast({ title: 'Nothing to delete', description: 'No tasks found for this project.' });
        return;
      }

      setDeleteProgress({ pct: 0, statusText: `0 / ${total} tasks deleted`, done: false, error: null });

      let deleted = 0;
      let failedIds = [];
      const DELETE_CONCURRENT = 30;

      // Pass 1: concurrent batches with retry429
      for (let i = 0; i < allIds.length; i += DELETE_CONCURRENT) {
        const batch = allIds.slice(i, i + DELETE_CONCURRENT);
        const results = await Promise.allSettled(batch.map(id => retry429(() => base44.entities.Task.delete(id))));
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') deleted++;
          else failedIds.push(batch[idx]);
        });
        const pct = Math.round((deleted / total) * 80);
        setDeleteProgress({ pct, statusText: `${deleted} / ${total} deleted`, done: false, error: null });
      }

      // Pass 2: retry remaining failures sequentially
      for (let attempt = 0; attempt < 2 && failedIds.length > 0; attempt++) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        setDeleteProgress(p => ({ ...p, pct: 82, statusText: `Retrying ${failedIds.length} failed…` }));
        const retrying = [...failedIds];
        failedIds = [];
        for (const id of retrying) {
          try {
            await retry429(() => base44.entities.Task.delete(id));
            deleted++;
          } catch {
            failedIds.push(id);
          }
        }
      }

      // Verify
      setDeleteProgress(p => ({ ...p, pct: 88, statusText: 'Verifying…' }));
      await new Promise(r => setTimeout(r, 400));
      const remaining = await base44.entities.Task.filter({ project_id: selectedProjectId }, 'sort_order', 1);

      if (remaining.length > 0 || failedIds.length > 0) {
        const msg = failedIds.length > 0
          ? `${failedIds.length} of ${total} tasks could not be deleted. Please try again.`
          : `Deletion incomplete — tasks still remain. Please try again.`;
        setDeleteProgress(p => ({ ...p, pct: 88, error: msg }));
        await queryClient.refetchQueries({ queryKey: ['tasks'] });
        return;
      }

      // Wait for API quota recovery before allowing next operation
      setDeleteProgress(p => ({ ...p, pct: 95, statusText: 'Waiting for API recovery…' }));
      await new Promise(r => setTimeout(r, 15000));

      await queryClient.refetchQueries({ queryKey: ['tasks'] });
      setDeleteProgress(p => ({ ...p, pct: 100, statusText: `${total} tasks deleted`, done: true }));
      setTimeout(() => {
        setDeleteProgress(null);
        toast({ title: 'Programme deleted', description: `${total} tasks removed successfully.`, duration: 4000 });
      }, 1200);

    } catch (error) {
      setDeleteProgress(p => ({ ...p, error: error.message || 'Delete failed. Please try again.' }));
    } finally {
      bulkOperationState.active = false;
    }
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

            <Button variant="outline" size="sm" onClick={expandAll} title="Expand all" className="gap-1.5 text-xs h-9"><ChevronsUpDown className="w-3.5 h-3.5" />Expand All</Button>
            <Button variant="outline" size="sm" onClick={collapseAll} title="Collapse all" className="gap-1.5 text-xs h-9"><ChevronsDownUp className="w-3.5 h-3.5" />Collapse</Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('out')} title={`Zoom out (${zoom})`}><ZoomOut className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('in')} title={`Zoom in (${zoom})`}><ZoomIn className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => window.print()} title="Print"><Printer className="w-4 h-4" /></Button>
            <Button onClick={() => setShowImportDialog(true)} disabled={!!deleteProgress} className="gap-2"><Upload className="w-4 h-4" /> Import</Button>
            <Button variant="destructive" size="icon"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!selectedProjectId || selectedProjectId === 'all' || tasks.length === 0 || !!importProgress}
              title="Delete all tasks">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="gantt" className="flex-1 flex flex-col overflow-hidden">
        {isMobile && (
          <div className="flex items-center gap-2 py-2 border-b bg-muted/20 overflow-x-auto flex-shrink-0">
            <Button size="sm" variant="outline" onClick={expandAll} className="flex-shrink-0 h-8 text-xs gap-1"><ChevronsUpDown className="w-3 h-3" /> Expand All</Button>
            <Button size="sm" variant="outline" onClick={collapseAll} className="flex-shrink-0 h-8 text-xs gap-1"><ChevronsDownUp className="w-3 h-3" /> Collapse</Button>
            <Button size="sm" variant="outline" onClick={() => cycleZoom('out')} className="flex-shrink-0 h-8"><ZoomOut className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => cycleZoom('in')} className="flex-shrink-0 h-8"><ZoomIn className="w-3.5 h-3.5" /></Button>
          </div>
        )}
        <div className="overflow-x-auto flex-shrink-0"><TabsList className="flex w-max">
          <TabsTrigger value="gantt">Gantt Chart</TabsTrigger>
          <TabsTrigger value="lookahead" className="gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Look Ahead</TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5"><LayoutDashboard className="w-3.5 h-3.5" /> Health</TabsTrigger>
        </TabsList></div>

        {/* ── Gantt ── */}
        <TabsContent value="gantt" className="flex-1 flex border rounded-lg overflow-hidden bg-card">
          {isMobile ? (
            <div className="flex-1 overflow-hidden">
              <TaskList
                tasks={tasks}
                visibleTasks={visibleTasks}
                scheduledMap={scheduledMap}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
                onTaskClick={setSelectedTask}
                onEditTask={setEditingTask}
                scrollRef={taskScrollRef}
                onScroll={() => {}}
              />
            </div>
          ) : (
            <>
              <button onClick={() => setTaskListCollapsed(!taskListCollapsed)}
                className="flex items-center justify-center w-8 bg-muted/30 hover:bg-muted transition-colors border-r flex-shrink-0"
                title={taskListCollapsed ? 'Show task list' : 'Hide task list'}>
                {taskListCollapsed ? <PanelLeftOpen className="w-4 h-4 text-muted-foreground" /> : <PanelLeftClose className="w-4 h-4 text-muted-foreground" />}
              </button>

              {!taskListCollapsed && (
                <div className="w-[520px] xl:w-[620px] flex-shrink-0 overflow-hidden">
                  <TaskList
                    tasks={tasks}
                    visibleTasks={visibleTasks}
                    scheduledMap={scheduledMap}
                    expandedIds={expandedIds}
                    onToggleExpand={onToggleExpand}
                    onTaskClick={setSelectedTask}
                    onEditTask={setEditingTask}
                    scrollRef={taskScrollRef}
                    onScroll={() => {
                      if (taskScrollRef.current && ganttScrollRef.current) {
                        syncScroll(taskScrollRef.current, ganttScrollRef.current);
                      }
                    }}
                  />
                </div>
              )}

              <GanttChart
                tasks={tasks}
                visibleTasks={visibleTasks}
                scheduledMap={scheduledMap}
                zoom={zoom}
                scrollRef={ganttScrollRef}
                onScroll={() => {
                  if (taskScrollRef.current && ganttScrollRef.current) {
                    syncScroll(ganttScrollRef.current, taskScrollRef.current);
                  }
                }}
                baselineMap={null}
                onTaskClick={setSelectedTask}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="lookahead" className="flex-1 overflow-hidden border rounded-lg bg-card">
          <LookAhead tasks={tasks} scheduledMap={scheduledMap} />
        </TabsContent>

        <TabsContent value="health" className="flex-1 overflow-hidden border rounded-lg bg-card">
          <ProgrammeHealth tasks={tasks} scheduledMap={scheduledMap} />
        </TabsContent>
      </Tabs>

      {/* Inline task editor */}
      <TaskInlineEditor
        task={editingTask}
        open={!!editingTask}
        onOpenChange={open => { if (!open) setEditingTask(null); }}
      />

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