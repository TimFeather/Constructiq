import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PanelLeftClose, PanelLeftOpen, Upload, Printer, ZoomIn, ZoomOut, Trash2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import TaskList from '@/components/programme/TaskList';
import GanttChart from '@/components/programme/GanttChart';
import TaskEditPanel from '@/components/programme/TaskEditPanel';
import { parseXML, parseMPX, parseExcelCSV } from '@/lib/scheduleImportParsers';
import { runScheduleEngine } from '@/lib/schedulingEngine';

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

  const { data: allProjectsRaw = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100),
  });

  const projects = isAdmin
    ? allProjectsRaw
    : allProjectsRaw.filter(p => p.team?.some(m => m.user_email === user?.email));

  const projectIds = new Set(projects.map(p => p.id));

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 500),
  });

  // Real-time subscription: invalidate tasks query whenever any task is created/updated/deleted
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

      if (parsedTasks.length === 0) {
        setShowUploadMPP(false);
        setMppFile(null);
        return;
      }

      // ── Pass 1: create tasks without predecessor links ──────────────────────
      // Strip temp fields before saving
      const tasksToCreate = parsedTasks.map(({ _mspUid, _predecessorLinks, ...t }) => t);
      const created = await base44.entities.Task.bulkCreate(tasksToCreate);

      // ── Pass 2: resolve UID → DB ID and write predecessor links ────────────
      // Build map: mspUid → created DB id
      // bulkCreate returns an array in the same order as input
      const uidToDbId = new Map();
      parsedTasks.forEach((pt, i) => {
        if (pt._mspUid != null && created[i]?.id) {
          uidToDbId.set(pt._mspUid, created[i].id);
        }
      });

      // Find tasks that have predecessor links to write
      const updates = [];
      parsedTasks.forEach((pt, i) => {
        if (!pt._predecessorLinks?.length) return;
        const dbId = created[i]?.id;
        if (!dbId) return;

        const predecessors = pt._predecessorLinks
          .map(link => {
            const predDbId = uidToDbId.get(link._predUid);
            if (!predDbId) return null;
            return {
              predecessor_id: predDbId,
              task_id: predDbId,
              type: link.type,
              lag_hours: link.lag_hours,
              lag_days: Math.round(link.lag_hours / 8),
              is_elapsed: link.is_elapsed,
            };
          })
          .filter(Boolean);

        if (predecessors.length > 0) {
          updates.push({ id: dbId, predecessors });
        }
      });

      // Apply predecessor updates sequentially
      for (const update of updates) {
        await base44.entities.Task.update(update.id, { predecessors: update.predecessors });
      }

      // ── Pass 3: re-schedule all tasks using the engine so dates follow dependencies ──
      // Build in-memory task list with predecessors applied
      const taskListForEngine = created.map((createdTask, i) => {
        const pt = parsedTasks[i];
        const predecessors = updates.find(u => u.id === createdTask.id)?.predecessors || [];
        return { ...createdTask, predecessors };
      });

      // Find earliest start date as project anchor
      const projectStart = taskListForEngine.reduce((min, t) => {
        if (!t.start_date) return min;
        return !min || t.start_date < min ? t.start_date : min;
      }, null) || new Date().toISOString().split('T')[0];

      const scheduled = runScheduleEngine(taskListForEngine, projectStart);

      // Only update tasks whose dates differ from what the engine resolved
      for (const task of taskListForEngine) {
        const resolved = scheduled.get(task.id);
        if (!resolved) continue;
        const newStart = resolved.startStr;
        const newEnd = resolved.finishStr;
        const newDur = resolved.durationDays;
        if (newStart !== task.start_date || newEnd !== task.end_date || newDur !== task.duration) {
          await base44.entities.Task.update(task.id, {
            start_date: newStart,
            end_date: newEnd,
            duration: newDur,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowUploadMPP(false);
      setMppFile(null);
    } catch (error) {
      console.error('Error importing schedule file:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAllTasks = async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    setDeleting(true);
    
    try {
      const projectTasks = tasks;
      for (const task of projectTasks) {
        await base44.entities.Task.delete(task.id);
      }
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Error deleting tasks:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handlePrint = () => window.print();

  const cycleZoom = (direction) => {
    const levels = ['month', 'week', 'day'];
    const idx = levels.indexOf(zoom);
    const newIdx = direction === 'in' ? Math.min(idx + 1, 2) : Math.max(idx - 1, 0);
    setZoom(levels[newIdx]);
  };

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
            <Button variant="outline" size="icon" onClick={() => cycleZoom('out')} title="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('in')} title="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={handlePrint} title="Print">
              <Printer className="w-4 h-4" />
            </Button>
            <Button onClick={() => setShowUploadMPP(true)} className="gap-2">
              <Upload className="w-4 h-4" /> Import Schedule
            </Button>
            <Button 
              variant="destructive" 
              size="icon"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!selectedProjectId || selectedProjectId === 'all' || tasks.length === 0}
              title="Delete all tasks in this project"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      {/* Main area */}
      <div className="flex-1 flex border rounded-lg overflow-hidden bg-card">
        {/* Toggle button */}
        <button
          onClick={() => setTaskListCollapsed(!taskListCollapsed)}
          className="flex items-center justify-center w-8 bg-muted/30 hover:bg-muted transition-colors border-r flex-shrink-0"
          title={taskListCollapsed ? 'Show task list' : 'Hide task list'}
        >
          {taskListCollapsed ? <PanelLeftOpen className="w-4 h-4 text-muted-foreground" /> : <PanelLeftClose className="w-4 h-4 text-muted-foreground" />}
        </button>

        {/* Task list pane */}
        {!taskListCollapsed && (
          <div className="w-[520px] xl:w-[600px] flex-shrink-0 overflow-hidden">
            <TaskList
              tasks={tasks}
              onTaskClick={setSelectedTask}
              collapsed={false}
              canEdit={isAdmin || user?.role === 'internal'}
              scrollRef={taskScrollRef}
              onScroll={() => ganttScrollRef.current && syncScroll(taskScrollRef.current, ganttScrollRef.current)}
            />
          </div>
        )}

        {/* Gantt chart */}
        <GanttChart
          tasks={tasks}
          zoom={zoom}
          scrollRef={ganttScrollRef}
          onScroll={() => taskScrollRef.current && syncScroll(ganttScrollRef.current, taskScrollRef.current)}
        />
      </div>

      {/* Task edit panel */}
      <TaskEditPanel
        task={selectedTask}
        tasks={accessibleTasks}
        open={!!selectedTask}
        onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
      />

      {/* Delete all tasks confirmation */}
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

      {/* Upload schedule file dialog */}
      <Dialog open={showUploadMPP} onOpenChange={setShowUploadMPP}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Import Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Format cards */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border p-2.5 space-y-1">
                <p className="font-semibold text-foreground">XML (recommended)</p>
                <p className="text-muted-foreground">File → Save As → XML Format (*.xml)</p>
              </div>
              <div className="rounded-md border p-2.5 space-y-1">
                <p className="font-semibold text-foreground">Excel / CSV</p>
                <p className="text-muted-foreground">Columns: Name, Start, End, Duration, WBS, % Complete</p>
              </div>
              <div className="rounded-md border p-2.5 space-y-1">
                <p className="font-semibold text-foreground">MPX</p>
                <p className="text-muted-foreground">File → Save As → MPX (legacy text format)</p>
              </div>
            </div>

            <div>
              <Label>Select Project *</Label>
              <Select value={selectedProjectId !== 'all' ? selectedProjectId : (projects[0]?.id || '')} onValueChange={setSelectedProjectId}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Schedule File *</Label>
              <Input
                type="file"
                accept=".xml,.mpx,.xlsx,.xls,.csv"
                onChange={e => setMppFile(e.target.files?.[0] || null)}
              />
              {mppFile && <p className="text-xs text-muted-foreground mt-1">Selected: {mppFile.name}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUploadMPP(false); setMppFile(null); }}>Cancel</Button>
            <Button onClick={handleMPPUpload} disabled={!mppFile || uploading || !selectedProjectId || selectedProjectId === 'all'}>
              {uploading ? 'Importing & linking...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}