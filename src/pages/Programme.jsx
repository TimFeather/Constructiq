import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLeftClose, PanelLeftOpen, Plus, Printer, ZoomIn, ZoomOut } from 'lucide-react';
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
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ name: '', project_id: '', level: 2, start_date: '', end_date: '', duration: 5, parent_id: '', predecessors: [] });
  const queryClient = useQueryClient();

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

  const accessibleTasks = allTasks.filter(t => projectIds.has(t.project_id));
  const tasks = selectedProjectId === 'all'
    ? accessibleTasks
    : accessibleTasks.filter(t => t.project_id === selectedProjectId);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const siblings = allTasks.filter(t => t.project_id === data.project_id && !t.parent_id);
      const wbsNum = siblings.length + 1;
      return base44.entities.Task.create({
        ...data,
        wbs: String(wbsNum),
        sort_order: wbsNum,
        percent_complete: 0,
        predecessors: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowAddTask(false);
      setNewTask({ name: '', project_id: '', level: 2, start_date: '', end_date: '', duration: 5 });
    }
  });

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
            <Button onClick={() => {
              const today = new Date().toISOString().split('T')[0];
              const endDate = new Date(); endDate.setDate(endDate.getDate() + 4);
              setNewTask({
                name: '',
                project_id: selectedProjectId !== 'all' ? selectedProjectId : (projects[0]?.id || ''),
                level: 2,
                start_date: today,
                end_date: endDate.toISOString().split('T')[0],
                duration: 5,
              });
              setShowAddTask(true);
            }} className="gap-2">
              <Plus className="w-4 h-4" /> Add Task
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
              onAddTask={() => {
                const today = new Date().toISOString().split('T')[0];
                const endDate = new Date(); endDate.setDate(endDate.getDate() + 4);
                setNewTask({
                  name: '',
                  project_id: selectedProjectId !== 'all' ? selectedProjectId : (projects[0]?.id || ''),
                  level: 2,
                  start_date: today,
                  end_date: endDate.toISOString().split('T')[0],
                  duration: 5,
                });
                setShowAddTask(true);
              }}
              collapsed={false}
              canEdit={isAdmin || user?.role === 'internal'}
            />
          </div>
        )}

        {/* Gantt chart */}
        <GanttChart tasks={tasks} zoom={zoom} />
      </div>

      {/* Task edit panel */}
      <TaskEditPanel
        task={selectedTask}
        tasks={accessibleTasks}
        open={!!selectedTask}
        onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
      />

      {/* Add task dialog */}
      <Dialog open={showAddTask} onOpenChange={setShowAddTask}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Task Name *</Label>
              <Input value={newTask.name} onChange={e => setNewTask({...newTask, name: e.target.value})} placeholder="Task name" />
            </div>
            <div>
              <Label>Project *</Label>
              <Select value={newTask.project_id} onValueChange={v => setNewTask({...newTask, project_id: v})}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Level</Label>
                <Select value={String(newTask.level)} onValueChange={v => setNewTask({...newTask, level: parseInt(v)})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Phase</SelectItem>
                    <SelectItem value="1">Summary Task</SelectItem>
                    <SelectItem value="2">Task</SelectItem>
                    <SelectItem value="3">Subtask</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Parent Task</Label>
                <Select value={newTask.parent_id || '__none__'} onValueChange={v => setNewTask({...newTask, parent_id: v === '__none__' ? '' : v})}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {tasks.filter(t => t.project_id === newTask.project_id && t.level < newTask.level).map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.wbs ? `${t.wbs} ` : ''}{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={newTask.start_date} onChange={e => {
                  const start = e.target.value;
                  const dur = newTask.duration || 1;
                  const end = new Date(start);
                  end.setDate(end.getDate() + dur - 1);
                  setNewTask({...newTask, start_date: start, end_date: end.toISOString().split('T')[0]});
                }} />
              </div>
              <div>
                <Label>Duration (days)</Label>
                <Input type="number" min="1" value={newTask.duration} onChange={e => {
                  const dur = parseInt(e.target.value) || 1;
                  const start = newTask.start_date;
                  let end_date = newTask.end_date;
                  if (start) {
                    const end = new Date(start);
                    end.setDate(end.getDate() + dur - 1);
                    end_date = end.toISOString().split('T')[0];
                  }
                  setNewTask({...newTask, duration: dur, end_date});
                }} />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={newTask.end_date} onChange={e => {
                  const end = e.target.value;
                  const start = newTask.start_date;
                  let duration = newTask.duration;
                  if (start && end) {
                    duration = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
                  }
                  setNewTask({...newTask, end_date: end, duration});
                }} />
              </div>
            </div>

            {/* Predecessors */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Predecessors</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setNewTask({...newTask, predecessors: [...(newTask.predecessors || []), { task_id: '', lag_days: 0 }]})}
                >+ Add predecessor</button>
              </div>
              {(newTask.predecessors || []).length === 0 && (
                <p className="text-xs text-muted-foreground">No predecessors</p>
              )}
              {(newTask.predecessors || []).map((pred, idx) => (
                <div key={idx} className="flex items-center gap-2 mt-1">
                  <Select value={pred.task_id} onValueChange={v => {
                    const preds = [...newTask.predecessors];
                    preds[idx] = {...preds[idx], task_id: v};
                    setNewTask({...newTask, predecessors: preds});
                  }}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Select task" /></SelectTrigger>
                    <SelectContent>
                      {tasks.filter(t => t.project_id === newTask.project_id).map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.wbs ? `${t.wbs} ` : ''}{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">Lag</span>
                    <Input
                      type="number"
                      className="w-16 h-8 text-xs text-center"
                      value={pred.lag_days}
                      onChange={e => {
                        const preds = [...newTask.predecessors];
                        preds[idx] = {...preds[idx], lag_days: parseInt(e.target.value) || 0};
                        setNewTask({...newTask, predecessors: preds});
                      }}
                    />
                    <span className="text-xs text-muted-foreground">d</span>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline flex-shrink-0"
                    onClick={() => {
                      const preds = newTask.predecessors.filter((_, i) => i !== idx);
                      setNewTask({...newTask, predecessors: preds});
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTask(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newTask)} disabled={!newTask.name || !newTask.project_id || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}