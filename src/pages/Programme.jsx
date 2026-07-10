import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Project, Task } from '@/api/entities';
import { fetchProgrammeTasks, fetchProgramme, bulkUpdateTaskWbs, publishProgramme, unpublishProgramme } from '@/api/programmeData';
import { invokeFunction } from '@/api/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  ChevronsDownUp, ChevronsUpDown, Download, Plus, Lock, Unlock,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { computeImportDiff, isUpdateImport } from '@/lib/scheduleImportDiff';
import { executeFreshImport, executeUpdateImport } from '@/lib/scheduleImportService';
import { downloadMspdi, downloadProgrammeExcel } from '@/lib/scheduleExport';
import ImportDiffDialog from '@/components/programme/ImportDiffDialog';
import AddTaskDialog from '@/components/programme/AddTaskDialog';
import ScheduleSettingsPopover from '@/components/programme/ScheduleSettingsPopover';
import BaselineManager from '@/components/programme/BaselineManager';
import { buildBaselineMap } from '@/lib/scheduling/baselineEngine';
import { TaskBaselineItem } from '@/api/entities';
import { runScheduleEngine, runScheduleEngineByProject, calendarForProgramme } from '@/lib/scheduling/scheduleEngine';
import { countWorkingDays } from '@/lib/scheduling/calendarEngine';
import { updateTaskStartDate, updateTaskDuration, updateTaskDependency, updateTaskFull, updateTaskProgress } from '@/lib/scheduleUpdateService';
import { createTaskInline } from '@/lib/programme/createTask';
import { indentTask, outdentTask } from '@/lib/wbsUtils';
import { fetchProgrammesByProject } from '@/api/programmeData';
import { canEdit, canImport, canExport } from '@/lib/permissions';
import { getVisibleTasks } from '@/lib/programme/visibleTasks';
import { bulkOperationState } from '@/lib/bulkOperationState';
import { retry429 } from '@/lib/retry429';
import TaskInlineEditor from '@/components/programme/TaskInlineEditor';
import { exportProgrammePdf } from '@/lib/programme/pdfExport';
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
  const [activeTab, setActiveTab] = useState('gantt');
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
  // Update-import review: { diff, fileName } — shown before committing a re-import
  const [pendingImport, setPendingImport] = useState(null);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null); // { pct, statusText, done, error }

  const [showCriticalPath, setShowCriticalPath] = useState(false); // critical-only filter
  const [showAddTask, setShowAddTask] = useState(false);
  const [selectedBaselineId, setSelectedBaselineId] = useState(null); // baseline overlay
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const queryClient = useQueryClient();
  const taskScrollRef = useRef(null);
  const ganttScrollRef = useRef(null);
  const isSyncing = useRef(false);
  const [hoveredTaskId, setHoveredTaskId] = useState(null);

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
    queryFn: () => Project.list('-created_at', 100),
  });

  const projects = isAdmin
    ? allProjectsRaw
    : allProjectsRaw.filter(p => p.team?.some(m => m.user_email === user?.email));

  const projectIds = new Set(projects.map(p => p.id));

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', selectedProjectId],
    queryFn: () => fetchProgrammeTasks(selectedProjectId),
    staleTime: 30000,
  });

  // Programme row: data date + working calendar for the selected project
  const { data: programme = null } = useQuery({
    queryKey: ['programme', selectedProjectId],
    queryFn: () => fetchProgramme(selectedProjectId),
    enabled: selectedProjectId !== 'all',
  });

  // All programmes (calendar/data date per project) — used for the cross-project
  // view and by Look Ahead's quick-progress cascade (which needs each task's
  // own-project calendar regardless of the current project filter).
  const { data: programmesByProject } = useQuery({
    queryKey: ['programmes'],
    queryFn: fetchProgrammesByProject,
  });

  // Baseline overlay: items for the selected baseline
  const { data: baselineItems = [] } = useQuery({
    queryKey: ['baselineItems', selectedBaselineId],
    queryFn: () => TaskBaselineItem.filter({ baseline_id: selectedBaselineId }),
    enabled: !!selectedBaselineId,
  });
  const baselineMap = useMemo(
    () => (selectedBaselineId && baselineItems.length ? buildBaselineMap(baselineItems) : null),
    [selectedBaselineId, baselineItems]
  );

  // Baseline selection is per-project — clear it when switching
  useEffect(() => { setSelectedBaselineId(null); }, [selectedProjectId]);

  // Realtime task refresh every 30s (replaces Base44 subscribe)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!bulkOperationState.active) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }
    }, 30000);
    return () => clearInterval(interval);
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
  const projectStart = useMemo(() => tasks.reduce((min, t) => {
    if (!t.start_date) return min;
    return !min || t.start_date < min ? t.start_date : min;
  }, null), [tasks]);

  const scheduledMap = useMemo(() => {
    if (!tasks.length) return new Map();
    if (selectedProjectId === 'all') {
      return runScheduleEngineByProject(tasks, programmesByProject || new Map());
    }
    const calendar = calendarForProgramme(programme, tasks);
    return runScheduleEngine(tasks, projectStart, calendar, { dataDate: programme?.data_date || null });
  }, [tasks, projectStart, programme, programmesByProject, selectedProjectId]);

  // Context every schedule mutation needs (audit user, calendar, data date)
  const scheduleOptions = useMemo(() => ({
    userId: user?.id || null,
    projectStart,
    calendar: selectedProjectId !== 'all' ? calendarForProgramme(programme, tasks) : undefined,
    dataDate: selectedProjectId !== 'all' ? (programme?.data_date || null) : null,
  }), [user?.id, projectStart, programme, tasks, selectedProjectId]);

  // Publish freezes the schedule for non-admins; admin can always edit/unpublish.
  const programmeLocked = programme?.status === 'published';
  const lockedForMe = programmeLocked && !isAdmin;
  const programmeEditable = canEdit(user, 'programme') && selectedProjectId !== 'all' && !lockedForMe;
  const canDeleteTasks = ['admin', 'pricing', 'internal'].includes(user?.role) && !lockedForMe;
  const taskEditable = canEdit(user, 'programme') && !lockedForMe;
  const canImportExport = canImport(user, 'programme') && canExport(user, 'programme');
  const canPublish = ['admin', 'internal', 'pricing'].includes(user?.role) && selectedProjectId !== 'all';

  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = useCallback(async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    setIsPublishing(true);
    try {
      await publishProgramme(selectedProjectId);
      queryClient.invalidateQueries({ queryKey: ['programme', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['programmes'] });
      toast({ title: 'Programme published', description: 'The schedule is now locked for editing.', duration: 3500 });
      invokeFunction('notifyProgrammePublished', { projectId: selectedProjectId }).catch(() => {});
    } catch (e) {
      toast({ title: 'Publish failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsPublishing(false);
    }
  }, [selectedProjectId, queryClient, toast]);

  const handleUnpublish = useCallback(async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    setIsPublishing(true);
    try {
      await unpublishProgramme(selectedProjectId);
      queryClient.invalidateQueries({ queryKey: ['programme', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['programmes'] });
      toast({ title: 'Programme unpublished', description: 'The schedule is unlocked for editing.', duration: 3500 });
    } catch (e) {
      toast({ title: 'Unpublish failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsPublishing(false);
    }
  }, [selectedProjectId, queryClient, toast]);

  // ─── Authoring handlers (Gantt drag + editors → scheduling service) ──────────
  const afterScheduleChange = useCallback((patchCount) => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    if (patchCount > 1) {
      toast({ title: 'Schedule updated', description: `${patchCount - 1} downstream task${patchCount === 2 ? '' : 's'} rescheduled.`, duration: 3500 });
    }
  }, [queryClient, toast]);

  const handleMoveTask = useCallback(async (taskId, newStartDate) => {
    try {
      const { patches } = await updateTaskStartDate(taskId, newStartDate, tasks, scheduleOptions);
      afterScheduleChange(patches.length);
    } catch (e) {
      toast({ title: 'Reschedule failed', description: e.message, variant: 'destructive' });
    }
  }, [tasks, scheduleOptions, afterScheduleChange, toast]);

  const handleResizeTask = useCallback(async (taskId, newDuration) => {
    try {
      const { patches } = await updateTaskDuration(taskId, newDuration, tasks, scheduleOptions);
      afterScheduleChange(patches.length);
    } catch (e) {
      toast({ title: 'Duration change failed', description: e.message, variant: 'destructive' });
    }
  }, [tasks, scheduleOptions, afterScheduleChange, toast]);

  const handleCreateDependency = useCallback(async ({ predecessorId, successorId, type, lagDays }) => {
    const successor = tasks.find(t => t.id === successorId);
    if (!successor) return;
    const existing = (successor.predecessors || []).filter(p => (p.predecessor_id || p.task_id) !== predecessorId);
    const preds = [...existing, {
      predecessor_id: predecessorId,
      type,
      lag_days: lagDays || 0,
      lag_hours: (lagDays || 0) * 8,
      is_elapsed: false,
    }];
    try {
      const { patches } = await updateTaskDependency(successorId, preds, tasks, scheduleOptions);
      afterScheduleChange(patches.length);
    } catch (e) {
      toast({ title: 'Link rejected', description: e.message, variant: 'destructive' });
    }
  }, [tasks, scheduleOptions, afterScheduleChange, toast]);

  // Predecessors cell in the table — replaces the whole predecessor set for a task.
  const handlePredecessorsCommit = useCallback(async (taskId, preds) => {
    try {
      const { patches } = await updateTaskDependency(taskId, preds, tasks, scheduleOptions);
      afterScheduleChange(patches.length);
    } catch (e) {
      toast({ title: 'Link rejected', description: e.message, variant: 'destructive' });
    }
  }, [tasks, scheduleOptions, afterScheduleChange, toast]);

  // Name cell in the table — non-scheduling field, fast path (no cascade).
  const handleNameCommit = useCallback(async (taskId, name) => {
    try {
      const { patches } = await updateTaskFull(taskId, { name }, tasks, scheduleOptions);
      afterScheduleChange(patches.length);
    } catch (e) {
      toast({ title: 'Rename failed', description: e.message, variant: 'destructive' });
    }
  }, [tasks, scheduleOptions, afterScheduleChange, toast]);

  // % cell in the table.
  const handleProgressCommit = useCallback(async (taskId, pct) => {
    try {
      const { patches } = await updateTaskProgress(taskId, pct, tasks, scheduleOptions);
      afterScheduleChange(patches.length);
    } catch (e) {
      toast({ title: 'Progress update failed', description: e.message, variant: 'destructive' });
    }
  }, [tasks, scheduleOptions, afterScheduleChange, toast]);

  // "Add task…" ghost row at the bottom of the table — root-level, appended last.
  const handleCreateInline = useCallback(async (name) => {
    try {
      await createTaskInline({ projectId: selectedProjectId, name, tasks, scheduleOptions });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      toast({ title: 'Could not add task', description: e.message, variant: 'destructive' });
    }
  }, [selectedProjectId, tasks, scheduleOptions, queryClient, toast]);

  // Persist indent/outdent patches ({ id, parent_id?, level?, sort_order?, wbs? }).
  // Hierarchy fields go through chunked Task.update; wbs renumbers go through the
  // bulk RPC. No engine run needed — rollups recompute client-side after refetch.
  const handleHierarchyChange = useCallback(async (patches) => {
    if (!patches?.length) return;
    const wbsPatches = patches.filter(p => p.wbs !== undefined).map(p => ({ id: p.id, wbs: p.wbs }));
    const hierarchyPatches = patches
      .map(({ id, parent_id, level, sort_order }) => {
        const fields = {};
        if (parent_id !== undefined) fields.parent_id = parent_id;
        if (level !== undefined) fields.level = level;
        if (sort_order !== undefined) fields.sort_order = sort_order;
        return Object.keys(fields).length ? { id, ...fields } : null;
      })
      .filter(Boolean);

    bulkOperationState.active = true;
    try {
      const CHUNK = 20;
      for (let i = 0; i < hierarchyPatches.length; i += CHUNK) {
        await Promise.all(
          hierarchyPatches.slice(i, i + CHUNK).map(({ id, ...fields }) => Task.update(id, fields))
        );
      }
      if (wbsPatches.length) await bulkUpdateTaskWbs(wbsPatches);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } finally {
      bulkOperationState.active = false;
    }
  }, [queryClient]);

  // Right-click / keyboard row actions: indent, outdent, insert beside a row,
  // convert to milestone. Delete is handled locally in TaskList (existing
  // leaf-only mutation).
  const handleTaskAction = useCallback(async (action, task) => {
    if (!task) return;
    try {
      if (action === 'indent') {
        const patches = indentTask(task.id, tasks);
        if (!patches.length) { toast({ title: "Can't indent further", duration: 2000 }); return; }
        await handleHierarchyChange(patches);
      } else if (action === 'outdent') {
        const patches = outdentTask(task.id, tasks);
        if (!patches.length) { toast({ title: "Can't outdent further", duration: 2000 }); return; }
        await handleHierarchyChange(patches);
        setExpandedIds(prev => new Set(prev).add(task.id));
      } else if (action === 'insert-above' || action === 'insert-below') {
        await createTaskInline({
          projectId: selectedProjectId, name: 'New Task', tasks, scheduleOptions,
          anchor: { task, position: action === 'insert-above' ? 'above' : 'below' },
        });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      } else if (action === 'convert-milestone') {
        const { patches } = await updateTaskFull(task.id, { is_milestone: true, duration: 0 }, tasks, scheduleOptions);
        afterScheduleChange(patches.length);
      }
    } catch (e) {
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' });
    }
  }, [tasks, scheduleOptions, handleHierarchyChange, selectedProjectId, queryClient, toast, afterScheduleChange]);

  // Overall project span in working days (first start → last finish), for the
  // TaskList title bar — matches MS Project's summary-duration convention.
  const totalWorkingDays = useMemo(() => {
    if (selectedProjectId === 'all' || !scheduledMap.size) return null;
    let minStart = null, maxFinish = null;
    scheduledMap.forEach(r => {
      if (r.earlyStart && (!minStart || r.earlyStart < minStart)) minStart = r.earlyStart;
      if (r.earlyFinish && (!maxFinish || r.earlyFinish > maxFinish)) maxFinish = r.earlyFinish;
    });
    if (!minStart || !maxFinish) return null;
    const calendar = calendarForProgramme(programme, tasks);
    const dayAfterFinish = new Date(maxFinish);
    dayAfterFinish.setDate(dayAfterFinish.getDate() + 1);
    return countWorkingDays(minStart, dayAfterFinish, calendar);
  }, [scheduledMap, programme, tasks, selectedProjectId]);

  const projectsById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);

  const criticalTaskCount = useMemo(() => {
    let count = 0;
    scheduledMap.forEach(r => { if (r.isCritical) count++; });
    return count;
  }, [scheduledMap]);

  // ─── Import with progress ────────────────────────────────────────────────────
  const handleMPPUpload = async () => {
    if (!canImport(user, 'programme')) return;
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

      // Update-vs-append: an XML re-import into a programme that already has
      // MS Project UIDs goes through a diff + confirmation screen instead of
      // blindly appending duplicates.
      if (ext === 'xml' && isUpdateImport(tasks)) {
        const diff = computeImportDiff(parsedTasks, tasks);
        setImportProgress(null);
        setPendingImport({ diff, fileName: mppFile.name });
        return;
      }

      const createdCount = await executeFreshImport(parsedTasks, selectedProjectId, setStage);

      setImportProgress(p => ({ ...p, pct: 100, statusText: 'Import complete!' }));

      setTimeout(async () => {
        setImportProgress(null);
        setMppFile(null);
        await queryClient.refetchQueries({ queryKey: ['tasks'] });
        toast({ title: `Schedule imported`, description: `${createdCount} tasks loaded successfully.`, duration: 4000 });
      }, 1200);

    } catch (error) {
      setImportProgress(p => ({ ...p, error: error.message || 'Import failed. Please check the file and try again.' }));
    } finally {
      bulkOperationState.active = false;
    }
  };

  // Commit a reviewed update-import (from the diff dialog)
  const handleConfirmUpdateImport = async () => {
    const pending = pendingImport;
    setPendingImport(null);
    if (!pending) return;

    const setStage = (stageIdx, pct, detail = '') => {
      setImportProgress({
        stage: stageIdx + 1,
        stageOf: IMPORT_STAGES.length,
        pct,
        statusText: `${IMPORT_STAGES[stageIdx]}${detail ? ` — ${detail}` : ''}`,
        error: null,
      });
    };

    bulkOperationState.active = true;
    try {
      const { createdCount, updatedCount } = await executeUpdateImport(
        pending.diff, selectedProjectId, tasks, user?.id, setStage
      );
      setImportProgress(p => ({ ...p, pct: 100, statusText: 'Update complete!' }));
      setTimeout(async () => {
        setImportProgress(null);
        setMppFile(null);
        await queryClient.refetchQueries({ queryKey: ['tasks'] });
        toast({
          title: 'Programme updated',
          description: `${createdCount} tasks added, ${updatedCount} updated. ${pending.diff.missing.length ? `${pending.diff.missing.length} tasks missing from the file were kept.` : ''}`,
          duration: 5000,
        });
      }, 800);
    } catch (error) {
      setImportProgress(p => ({ ...(p || {}), error: error.message || 'Update import failed.' }));
    } finally {
      bulkOperationState.active = false;
    }
  };

  // ─── Export ──────────────────────────────────────────────────────────────────
  const selectedProjectName = projects.find(p => p.id === selectedProjectId)?.name || 'programme';

  const handleExportMspdi = () => {
    const calendar = calendarForProgramme(programme, tasks);
    downloadMspdi(tasks, programme, {
      projectName: selectedProjectName,
      holidays: calendar.holidays,
    });
    toast({ title: 'Exported', description: 'MS Project XML downloaded — opens via File → Open in Microsoft Project.', duration: 4000 });
  };

  // ─── Print (multi-page vector PDF, MS-Project-style tiling) ────────────────
  const handlePrint = useCallback(() => {
    setIsExportingPdf(true);
    // Defer to next tick so the disabled/spinner state paints before the
    // synchronous (and, for large schedules, non-trivial) PDF draw loop runs.
    setTimeout(() => {
      try {
        exportProgrammePdf({
          tasks,
          scheduledMap,
          programme,
          projectName: selectedProjectName,
          baselineMap,
          criticalOnly: showCriticalPath,
        });
      } catch (err) {
        toast({ title: 'PDF export failed', description: err.message, variant: 'destructive' });
      } finally {
        setIsExportingPdf(false);
      }
    }, 0);
  }, [tasks, scheduledMap, programme, selectedProjectName, baselineMap, showCriticalPath, toast]);

  const handleExportExcel = () => {
    downloadProgrammeExcel(tasks, scheduledMap, selectedProjectName);
    toast({ title: 'Exported', description: 'Excel programme downloaded.', duration: 3000 });
  };

  // ─── Sequential delete with exponential backoff ──────────────────────────────
  const handleDeleteAllTasks = async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    if (importProgress) return;
    setShowDeleteConfirm(false);

    setDeleteProgress({ pct: 0, statusText: 'Fetching task list…', done: false, error: null });

    bulkOperationState.active = true;
    try {
      const freshTasks = await Task.filter(
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
        const results = await Promise.allSettled(batch.map(id => retry429(() => Task.delete(id))));
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
            await retry429(() => Task.delete(id));
            deleted++;
          } catch {
            failedIds.push(id);
          }
        }
      }

      // Verify
      setDeleteProgress(p => ({ ...p, pct: 88, statusText: 'Verifying…' }));
      await new Promise(r => setTimeout(r, 400));
      const remaining = await Task.filter({ project_id: selectedProjectId }, 'sort_order', 1);

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

            {selectedProjectId !== 'all' && programmeLocked && (
              <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700 bg-amber-50">
                <Lock className="w-3 h-3" /> Published
              </Badge>
            )}

            {canPublish && !programmeLocked && (
              <Button variant="outline" size="sm" onClick={handlePublish} disabled={isPublishing || tasks.length === 0}
                className="gap-1.5 text-xs h-9" title="Lock the schedule and notify the team">
                <Lock className="w-3.5 h-3.5" /> Publish
              </Button>
            )}
            {isAdmin && programmeLocked && selectedProjectId !== 'all' && (
              <Button variant="outline" size="sm" onClick={handleUnpublish} disabled={isPublishing}
                className="gap-1.5 text-xs h-9" title="Unlock the schedule for editing">
                <Unlock className="w-3.5 h-3.5" /> Unpublish
              </Button>
            )}

            {programmeEditable && (
              <Button variant="outline" size="sm" onClick={() => setShowAddTask(true)} className="gap-1.5 text-xs h-9">
                <Plus className="w-3.5 h-3.5" /> Add Task
              </Button>
            )}
            <Button
              variant={showCriticalPath ? 'default' : 'outline'} size="sm"
              onClick={() => setShowCriticalPath(v => !v)}
              title="Show critical path only"
              className="gap-1.5 text-xs h-9">
              <Target className="w-3.5 h-3.5" /> Critical
            </Button>
            {programmeEditable && (
              <ScheduleSettingsPopover
                projectId={selectedProjectId}
                programme={programme}
                tasks={tasks}
              />
            )}
            {programmeEditable && (
              <BaselineManager
                projectId={selectedProjectId}
                tasks={tasks}
                scheduledMap={scheduledMap}
                selectedBaselineId={selectedBaselineId}
                onSelectBaseline={setSelectedBaselineId}
                canDelete={['admin', 'pricing'].includes(user?.role)}
              />
            )}
            <Button variant="outline" size="sm" onClick={expandAll} title="Expand all" className="gap-1.5 text-xs h-9"><ChevronsUpDown className="w-3.5 h-3.5" />Expand All</Button>
            <Button variant="outline" size="sm" onClick={collapseAll} title="Collapse all" className="gap-1.5 text-xs h-9"><ChevronsDownUp className="w-3.5 h-3.5" />Collapse</Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('out')} title={`Zoom out (${zoom})`}><ZoomOut className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => cycleZoom('in')} title={`Zoom in (${zoom})`}><ZoomIn className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" onClick={handlePrint} disabled={isExportingPdf || selectedProjectId === 'all' || tasks.length === 0} title="Export PDF"><Printer className={`w-4 h-4 ${isExportingPdf ? 'animate-pulse' : ''}`} /></Button>
            {canImportExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs h-9"
                    disabled={selectedProjectId === 'all' || tasks.length === 0}
                    title={selectedProjectId === 'all' ? 'Select a project to export' : 'Export programme'}>
                    <Download className="w-3.5 h-3.5" /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportMspdi}>MS Project XML (.xml)</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportExcel}>Excel (.xlsx)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canImportExport && (
              <Button onClick={() => { if (selectedProjectId === 'all' && projects[0]?.id) setSelectedProjectId(projects[0].id); setShowImportDialog(true); }} disabled={!!deleteProgress} className="gap-2"><Upload className="w-4 h-4" /> Import</Button>
            )}
            {canDeleteTasks && (
              <Button variant="destructive" size="icon"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={!selectedProjectId || selectedProjectId === 'all' || tasks.length === 0 || !!importProgress}
                title="Delete all tasks">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        {isMobile && activeTab === 'gantt' && (
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
                onEditTask={taskEditable ? setEditingTask : undefined}
                canDeleteTasks={canDeleteTasks}
                onNameCommit={handleNameCommit}
                onDurationCommit={handleResizeTask}
                onStartCommit={handleMoveTask}
                onPredecessorsCommit={handlePredecessorsCommit}
                onProgressCommit={handleProgressCommit}
                onCreateTask={handleCreateInline}
                onTaskAction={handleTaskAction}
                editable={programmeEditable}
                totalWorkingDays={totalWorkingDays}
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
                <div className="w-[560px] xl:w-[660px] flex-shrink-0 overflow-hidden">
                  <TaskList
                    tasks={tasks}
                    visibleTasks={visibleTasks}
                    scheduledMap={scheduledMap}
                    expandedIds={expandedIds}
                    onToggleExpand={onToggleExpand}
                    onTaskClick={setSelectedTask}
                    onEditTask={taskEditable ? setEditingTask : undefined}
                    canDeleteTasks={canDeleteTasks}
                    baselineMap={baselineMap}
                    hoveredTaskId={hoveredTaskId}
                    onHoverTask={setHoveredTaskId}
                    onNameCommit={handleNameCommit}
                    onDurationCommit={handleResizeTask}
                    onStartCommit={handleMoveTask}
                    onPredecessorsCommit={handlePredecessorsCommit}
                    onProgressCommit={handleProgressCommit}
                    onCreateTask={handleCreateInline}
                    onTaskAction={handleTaskAction}
                    editable={programmeEditable}
                    totalWorkingDays={totalWorkingDays}
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
                baselineMap={baselineMap}
                onTaskClick={setSelectedTask}
                editable={programmeEditable && !isMobile}
                dataDate={selectedProjectId !== 'all' ? (programme?.data_date || null) : null}
                criticalOnly={showCriticalPath}
                onMoveTask={handleMoveTask}
                onResizeTask={handleResizeTask}
                onCreateDependency={handleCreateDependency}
                hoveredTaskId={hoveredTaskId}
                onHoverTask={setHoveredTaskId}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="lookahead" className="flex-1 overflow-hidden border rounded-lg bg-card">
          <LookAhead
            tasks={tasks}
            scheduledMap={scheduledMap}
            allTasks={allTasks}
            programmesByProject={programmesByProject}
            canUpdateProgress={canEdit(user, 'programme')}
            projectsById={projectsById}
            showProject={selectedProjectId === 'all'}
          />
        </TabsContent>

        <TabsContent value="health" className="flex-1 overflow-hidden border rounded-lg bg-card">
          <ProgrammeHealth tasks={tasks} scheduledMap={scheduledMap} baselineMap={baselineMap} />
        </TabsContent>
      </Tabs>

      {/* Inline task editor */}
      <TaskInlineEditor
        task={editingTask}
        tasks={tasks}
        scheduleOptions={scheduleOptions}
        editable={programmeEditable}
        open={!!editingTask}
        onOpenChange={open => { if (!open) setEditingTask(null); }}
      />

      {/* Progress tracking panel */}
      <TaskProgressPanel
        task={selectedTask}
        tasks={tasks}
        scheduledMap={scheduledMap}
        scheduleOptions={scheduleOptions}
        editable={taskEditable}
        open={!!selectedTask}
        onOpenChange={open => { if (!open) setSelectedTask(null); }}
      />

      {/* Add task */}
      <AddTaskDialog
        open={showAddTask}
        onOpenChange={setShowAddTask}
        projectId={selectedProjectId}
        tasks={tasks}
        scheduleOptions={scheduleOptions}
      />

      {/* Update-import review (diff before commit) */}
      <ImportDiffDialog
        open={!!pendingImport}
        onOpenChange={open => { if (!open) setPendingImport(null); }}
        diff={pendingImport?.diff || null}
        fileName={pendingImport?.fileName || ''}
        onConfirm={handleConfirmUpdateImport}
        onCancel={() => { setPendingImport(null); setMppFile(null); }}
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
              Import from MS Project or Excel. Re-importing an updated XML file into an existing
              programme shows a review screen — existing tasks are updated by their MS Project ID,
              new ones added, and nothing is deleted.
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