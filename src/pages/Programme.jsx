import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { canEdit } from '@/lib/permissions';
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
  Trash2, Undo2, Redo2, Network, Flag, Target, Calendar,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/shared/PageHeader';
import { Link } from 'react-router-dom';
import TaskList from '@/components/programme/TaskList';
import GanttChart from '@/components/programme/GanttChart';
import TaskEditPanel from '@/components/programme/TaskEditPanel';
import NetworkDiagram from '@/components/programme/NetworkDiagram';
import { parseXML, parseMPX, parseExcelCSV } from '@/lib/scheduleImportParsers';
import { runScheduleEngine } from '@/lib/scheduling/scheduleEngine';
import { buildBaselineMap } from '@/lib/scheduling/baselineEngine.js';

const ZOOM_LEVELS = ['year', 'quarter', 'month', 'week', 'day'];

export default function Programme() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isAllowed = canEdit(user, 'programme');

  const urlParams = new URLSearchParams(window.location.search);
  const projectFromUrl = urlParams.get('project') || 'all';

  const [selectedProjectId, setSelectedProjectId] = useState(projectFromUrl);
  const [taskListCollapsed, setTaskListCollapsed] = useState(false);
  const [zoom, setZoom] = useState('week');
  const [selectedTask, setSelectedTask] = useState(null);
  const [showUploadMPP, setShowUploadMPP] = useState(false);
  const [mppFile, setMppFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [showBaseline, setShowBaseline] = useState(false);
  const [showBaselineCapture, setShowBaselineCapture] = useState(false);

  // Undo/redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  const queryClient = useQueryClient();
  const taskScrollRef = useRef(null);
  const ganttScrollRef = useRef(null);
  const isSyncing = useRef(false);

  const pushHistory = useCallback((undoOps, redoOps) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, { undo: undoOps, redo: redoOps }];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const handleUndo = async () => {
    if (!canUndo) return;
    const entry = history[historyIndex];
    for (const op of entry.undo) {
      await base44.entities.Task.update(op.id, op.data);
    }
    setHistoryIndex(prev => prev - 1);
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const handleRedo = async () => {
    if (!canRedo) return;
    const entry = history[historyIndex + 1];
    for (const op of entry.redo) {
      await base44.entities.Task.update(op.id, op.data);
    }
    setHistoryIndex(prev => prev + 1);
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const syncScroll = useCallback((source, target) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    target.scrollTop = source.scrollTop;
    isSyncing.current = false;
  }, []);

  // ─── Data fetching ──────────────────────────────────────────────────────────
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

  // Real-time subscription
  useEffect(() => {
    const unsubscribe = base44.entities.Task.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    return unsubscribe;
  }, [queryClient]);

  const accessibleTasks = allTasks.filter(t => projectIds.has(t.project_id));
  const tasks = selectedProjectId === 'all'
    ? accessibleTasks
    : accessibleTasks.filter(t => t.project_id === selectedProjectId);

  // ─── Schedule Engine — run ONCE here, pass results to children ─────────────
  const { scheduledMap, projectStart } = useMemo(() => {
    if (!tasks.length) return { scheduledMap: new Map(), projectStart: null };

    const pStart = tasks.reduce((min, t) => {
      if (!t.start_date) return min;
      return !min || t.start_date < min ? t.start_date : min;
    }, null) || new Date().toISOString().split('T')[0];

    return {
      scheduledMap: runScheduleEngine(tasks, pStart),
      projectStart: pStart,
    };
  }, [tasks]);

  // ─── Critical path stats ────────────────────────────────────────────────────
  const criticalTaskCount = useMemo(() => {
    let count = 0;
    scheduledMap.forEach(r => { if (r.isCritical) count++; });
    return count;
  }, [scheduledMap]);

  // ─── Baseline ───────────────────────────────────────────────────────────────
  const [baselineRecords, setBaselineRecords] = useState([]);
  const baselineMap = useMemo(() => buildBaselineMap(baselineRecords), [baselineRecords]);

  const handleCaptureBaseline = () => {
    const records = tasks.map(task => {
      const resolved = scheduledMap.get(task.id);
      return {
        task_id: task.id,
        baseline_start: resolved?.startStr || task.start_date,
        baseline_finish: resolved?.finishStr || task.end_date,
        baseline_duration: resolved?.durationDays || task.duration,
      };
    });
    setBaselineRecords(records);
    setShowBaseline(true);
    setShowBaselineCapture(false);
  };

  // ─── Import handler ─────────────────────────────────────────────────────────
  const handleMPPUpload = async () => {
    if (!mppFile || !selectedProjectId || selectedProjectId === 'all') return;
    setUploading(true);
    try {
      const ext = mppFile.name.split('.').pop().toLowerCase();
      let parsedTasks = [];

      if (ext === 'xml') {
        const text = await mppFile.text();
        parsedTasks = parseXML(text, selectedProjectId);
      } else if (ext === 'mpx') {
        const text = await mppFile.text();
        parsedTasks = parseMPX(text, selectedProjectId);
      } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        parsedTasks = await parseExcelCSV(mppFile, selectedProjectId);
      }

      if (!parsedTasks.length) { setShowUploadMPP(false); setMppFile(null); return; }

      const tasksToCreate = parsedTasks.map(({ _mspUid, _predecessorLinks, _parentUid, ...t }) => t);
      const created = await base44.entities.Task.bulkCreate(tasksToCreate);

      const uidToDbId = new Map();
      parsedTasks.forEach((pt, i) => {
        if (pt._mspUid != null && created[i]?.id) uidToDbId.set(pt._mspUid, created[i].id);
      });

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

      for (const { id, ...payload } of updates) {
        await base44.entities.Task.update(id, payload);
      }

      // Re-schedule after import
      const taskListForEngine = created.map((ct, i) => {
        const u = updates.find(u => u.id === ct.id);
        return { ...ct, predecessors: u?.predecessors || ct.predecessors || [], parent_id: u?.parent_id || ct.parent_id || null };
      });

      const pStart = taskListForEngine.reduce((min, t) => {
        if (!t.start_date) return min;
        return !min || t.start_date < min ? t.start_date : min;
      }, null) || new Date().toISOString().split('T')[0];

      const scheduled = runScheduleEngine(taskListForEngine, pStart);

      for (const task of taskListForEngine) {
        const resolved = scheduled.get(task.id);
        if (!resolved) continue;
        if (resolved.startStr !== task.start_date || resolved.finishStr !== task.end_date || resolved.durationDays !== task.duration) {
          await base44.entities.Task.update(task.id, {
            start_date: resolved.startStr,
            end_date: resolved.finishStr,
            duration: resolved.durationDays,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowUploadMPP(false);
      setMppFile(null);
    } catch (error) {
      console.error('Import error:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAllTasks = async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    setDeleting(true);
    await Promise.all(tasks.map(t => base44.entities.Task.delete(t.id).catch(() => {})));
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setShowDeleteConfirm(false);
    setDeleting(false);
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
          <p className="text-muted-foreground text-sm max-w-sm">
            You need to be part of a project before you can view its programme schedule.
          </p>
        </div>
        <Button asChild>
          <Link to="/projects">Go to Projects</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <PageHeader
        title="Programme"
        description="Task schedule and Gantt chart"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Critical path indicator */}
            {criticalTaskCount > 0 && (
              <Badge
                variant={showCriticalPath ? 'destructive' : 'outline'}
                className="cursor-pointer gap-1"
                onClick={() => setShowCriticalPath(v => !v)}
              >
                <Target className="w-3 h-3" />
                {criticalTaskCount} critical
              </Badge>
            )}

            {/* Baseline */}
            <Button
              variant={showBaseline && baselineRecords.length > 0 ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => baselineRecords.length > 0 ? setShowBaseline(v => !v) : setShowBaselineCapture(true)}
              title={baselineRecords.length > 0 ? 'Toggle baseline display' : 'Capture baseline'}
            >
              <Flag className="w-3.5 h-3.5" />
              {baselineRecords.length > 0 ? 'Baseline' : 'Set Baseline'}
            </Button>

            <Button variant="outline" size="icon" onClick={handleUndo} disabled={!canUndo} title="Undo">
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleRedo} disabled={!canRedo} title="Redo">
              <Redo2 className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('out')} title={`Zoom out (${zoom})`}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('in')} title={`Zoom in (${zoom})`}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => window.print()} title="Print">
              <Printer className="w-4 h-4" />
            </Button>
            <Button onClick={() => setShowUploadMPP(true)} className="gap-2">
              <Upload className="w-4 h-4" /> Import
            </Button>
            <Button
              variant="destructive"
              size="icon"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!selectedProjectId || selectedProjectId === 'all' || tasks.length === 0}
              title="Delete all tasks"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="gantt" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 w-fit">
          <TabsTrigger value="gantt">Gantt Chart</TabsTrigger>
          <TabsTrigger value="network" className="gap-1.5">
            <Network className="w-3.5 h-3.5" /> Network Diagram
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gantt" className="flex-1 flex border rounded-lg overflow-hidden bg-card mt-2">
          {/* Collapse toggle */}
          <button
            onClick={() => setTaskListCollapsed(!taskListCollapsed)}
            className="flex items-center justify-center w-8 bg-muted/30 hover:bg-muted transition-colors border-r flex-shrink-0"
            title={taskListCollapsed ? 'Show task list' : 'Hide task list'}
          >
            {taskListCollapsed
              ? <PanelLeftOpen className="w-4 h-4 text-muted-foreground" />
              : <PanelLeftClose className="w-4 h-4 text-muted-foreground" />}
          </button>

          {/* Task list pane */}
          {!taskListCollapsed && (
            <div className="w-[520px] xl:w-[600px] flex-shrink-0 overflow-hidden">
              <TaskList
                tasks={tasks}
                allTasks={accessibleTasks}
                scheduledMap={scheduledMap}
                onTaskClick={setSelectedTask}
                collapsed={false}
                canEdit={isAllowed}
                scrollRef={taskScrollRef}
                onScroll={() => ganttScrollRef.current && syncScroll(taskScrollRef.current, ganttScrollRef.current)}
                onPushHistory={pushHistory}
                projectStart={projectStart}
              />
            </div>
          )}

          {/* Gantt — receives pre-computed schedule, does no calculations */}
          <GanttChart
            tasks={tasks}
            scheduledMap={scheduledMap}
            zoom={zoom}
            scrollRef={ganttScrollRef}
            onScroll={() => taskScrollRef.current && syncScroll(ganttScrollRef.current, taskScrollRef.current)}
            baselineMap={showBaseline && baselineRecords.length > 0 ? baselineMap : null}
            onTaskClick={setSelectedTask}
          />
        </TabsContent>

        <TabsContent value="network" className="flex-1 overflow-auto mt-2 p-1">
          <NetworkDiagram tasks={tasks} />
        </TabsContent>
      </Tabs>

      {/* Task edit panel */}
      <TaskEditPanel
        task={selectedTask}
        tasks={accessibleTasks}
        open={!!selectedTask}
        onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
        onPushHistory={pushHistory}
        projectStart={projectStart}
      />

      {/* Baseline capture confirm */}
      <AlertDialog open={showBaselineCapture} onOpenChange={setShowBaselineCapture}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Capture Baseline?</AlertDialogTitle>
            <AlertDialogDescription>
              This will snapshot the current schedule for {tasks.length} task{tasks.length !== 1 ? 's' : ''} as the baseline. Any existing baseline will be replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction onClick={handleCaptureBaseline}>Capture Baseline</AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {tasks.length} task{tasks.length !== 1 ? 's' : ''} in this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction
            onClick={handleDeleteAllTasks}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? 'Deleting...' : 'Delete All'}
          </AlertDialogAction>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import dialog */}
      <Dialog open={showUploadMPP} onOpenChange={setShowUploadMPP}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Import Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border p-2.5 space-y-1">
                <p className="font-semibold">XML (recommended)</p>
                <p className="text-muted-foreground">File → Save As → XML Format</p>
              </div>
              <div className="rounded-md border p-2.5 space-y-1">
                <p className="font-semibold">Excel / CSV</p>
                <p className="text-muted-foreground">Name, Start, End, Duration, WBS, %</p>
              </div>
              <div className="rounded-md border p-2.5 space-y-1">
                <p className="font-semibold">MPX</p>
                <p className="text-muted-foreground">File → Save As → MPX</p>
              </div>
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
            <Button variant="outline" onClick={() => { setShowUploadMPP(false); setMppFile(null); }}>Cancel</Button>
            <Button onClick={handleMPPUpload} disabled={!mppFile || uploading || !selectedProjectId || selectedProjectId === 'all'}>
              {uploading ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}