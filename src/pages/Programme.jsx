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
import PageHeader from '@/components/shared/PageHeader';
import { Link } from 'react-router-dom';
import TaskList from '@/components/programme/TaskList';
import GanttChart from '@/components/programme/GanttChart';
import TaskProgressPanel from '@/components/programme/TaskProgressPanel';
import ProgrammeHealth from '@/components/programme/ProgrammeHealth';
import LookAhead from '@/components/programme/LookAhead';
import NetworkDiagram from '@/components/programme/NetworkDiagram';
import { parseXML, parseMPX, parseExcelCSV } from '@/lib/scheduleImportParsers';
import { runScheduleEngine } from '@/lib/scheduling/scheduleEngine';

const ZOOM_LEVELS = ['year', 'quarter', 'month', 'week', 'day'];

export default function Programme() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

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
    const unsubscribe = base44.entities.Task.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    return unsubscribe;
  }, [queryClient]);

  const accessibleTasks = allTasks.filter(t => projectIds.has(t.project_id));
  const tasks = selectedProjectId === 'all'
    ? accessibleTasks
    : accessibleTasks.filter(t => t.project_id === selectedProjectId);

  // ─── Schedule Engine — display only, not used to write back ─────────────────
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

  const criticalTaskCount = useMemo(() => {
    let count = 0;
    scheduledMap.forEach(r => { if (r.isCritical) count++; });
    return count;
  }, [scheduledMap]);

  // ─── Import handler ──────────────────────────────────────────────────────────
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
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>

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
          <TabsTrigger value="lookahead" className="gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" /> Look Ahead
          </TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5" /> Health
          </TabsTrigger>
        </TabsList>

        {/* Gantt + Task List */}
        <TabsContent value="gantt" className="flex-1 flex border rounded-lg overflow-hidden bg-card mt-2">
          <button
            onClick={() => setTaskListCollapsed(!taskListCollapsed)}
            className="flex items-center justify-center w-8 bg-muted/30 hover:bg-muted transition-colors border-r flex-shrink-0"
            title={taskListCollapsed ? 'Show task list' : 'Hide task list'}
          >
            {taskListCollapsed
              ? <PanelLeftOpen className="w-4 h-4 text-muted-foreground" />
              : <PanelLeftClose className="w-4 h-4 text-muted-foreground" />}
          </button>

          {!taskListCollapsed && (
            <div className="w-[640px] xl:w-[720px] flex-shrink-0 overflow-hidden">
              <TaskList
                tasks={tasks}
                scheduledMap={scheduledMap}
                onTaskClick={setSelectedTask}
                scrollRef={taskScrollRef}
                onScroll={() => ganttScrollRef.current && syncScroll(taskScrollRef.current, ganttScrollRef.current)}
              />
            </div>
          )}

          <GanttChart
            tasks={tasks}
            scheduledMap={scheduledMap}
            zoom={zoom}
            scrollRef={ganttScrollRef}
            onScroll={() => taskScrollRef.current && syncScroll(ganttScrollRef.current, taskScrollRef.current)}
            baselineMap={null}
            onTaskClick={setSelectedTask}
          />
        </TabsContent>

        {/* Look Ahead */}
        <TabsContent value="lookahead" className="flex-1 overflow-hidden border rounded-lg bg-card mt-2">
          <LookAhead tasks={tasks} scheduledMap={scheduledMap} />
        </TabsContent>

        {/* Health dashboard */}
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
        onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
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
            <p className="text-sm text-muted-foreground">
              Import your schedule from MS Project or Excel. The imported schedule becomes the master plan — dates are not editable in ConstructIQ.
            </p>
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
              {uploading ? 'Importing...' : 'Import Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}