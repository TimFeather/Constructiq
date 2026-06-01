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
      // Use LLM to extract task data from MPP file
      const { file_url } = await base44.integrations.Core.UploadFile({ file: mppFile });
      
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Extract task information from this Microsoft Project (.mpp) file. Return a JSON array of tasks with: name, level (0-3), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), duration (days), wbs (string).`,
        file_urls: [file_url],
        response_json_schema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  level: { type: 'number' },
                  start_date: { type: 'string' },
                  end_date: { type: 'string' },
                  duration: { type: 'number' },
                  wbs: { type: 'string' }
                }
              }
            }
          }
        }
      });
      
      if (result?.tasks?.length > 0) {
        const projectId = selectedProjectId;
        
        for (const task of result.tasks) {
          await base44.entities.Task.create({
            name: task.name || 'Task',
            project_id: projectId,
            wbs: task.wbs || '',
            level: task.level ?? 2,
            start_date: task.start_date,
            end_date: task.end_date,
            duration: task.duration || 1,
            percent_complete: 0,
            predecessors: [],
          });
        }
        
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }
      
      setShowUploadMPP(false);
      setMppFile(null);
    } catch (error) {
      console.error('Error uploading MPP file:', error);
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
              <Upload className="w-4 h-4" /> Upload MPP File
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

      {/* Upload MPP file dialog */}
      <Dialog open={showUploadMPP} onOpenChange={setShowUploadMPP}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Upload Microsoft Project File</DialogTitle></DialogHeader>
          <div className="space-y-4">
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
              <Label>.MPP File *</Label>
              <Input
                type="file"
                accept=".mpp"
                onChange={e => setMppFile(e.target.files?.[0] || null)}
              />
              {mppFile && <p className="text-xs text-muted-foreground mt-1">Selected: {mppFile.name}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUploadMPP(false); setMppFile(null); }}>Cancel</Button>
            <Button onClick={handleMPPUpload} disabled={!mppFile || uploading}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}