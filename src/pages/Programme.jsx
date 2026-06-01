import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
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
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [taskListCollapsed, setTaskListCollapsed] = useState(false);
  const [zoom, setZoom] = useState('week');
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ name: '', project_id: '', level: 2, start_date: '', end_date: '', duration: 5 });
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100),
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 500),
  });

  const tasks = selectedProjectId === 'all'
    ? allTasks
    : allTasks.filter(t => t.project_id === selectedProjectId);

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
            <Button onClick={() => setShowAddTask(true)} className="gap-2">
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
          <div className="w-[320px] lg:w-[400px] flex-shrink-0 overflow-hidden">
            <TaskList
              tasks={tasks}
              onTaskClick={setSelectedTask}
              onAddTask={() => setShowAddTask(true)}
              collapsed={false}
            />
          </div>
        )}

        {/* Gantt chart */}
        <GanttChart tasks={tasks} zoom={zoom} />
      </div>

      {/* Task edit panel */}
      <TaskEditPanel
        task={selectedTask}
        tasks={allTasks}
        open={!!selectedTask}
        onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
      />

      {/* Add task dialog */}
      <Dialog open={showAddTask} onOpenChange={setShowAddTask}>
        <DialogContent className="sm:max-w-md">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={newTask.start_date} onChange={e => setNewTask({...newTask, start_date: e.target.value})} />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={newTask.end_date} onChange={e => setNewTask({...newTask, end_date: e.target.value})} />
              </div>
            </div>
            <div>
              <Label>Duration (days)</Label>
              <Input type="number" min="1" value={newTask.duration} onChange={e => setNewTask({...newTask, duration: parseInt(e.target.value) || 1})} />
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