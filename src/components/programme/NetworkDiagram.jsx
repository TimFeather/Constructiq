import React, { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NODE_W = 160;
const NODE_H = 56;
const COL_GAP = 80;
const ROW_GAP = 28;

function buildGraph(tasks) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // Determine columns via longest-path (critical path columns)
  const col = new Map();
  const visited = new Set();

  const getCol = (id) => {
    if (col.has(id)) return col.get(id);
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const task = taskMap.get(id);
    if (!task) return 0;
    const preds = (task.predecessors || []).map(p => p.predecessor_id || p.task_id).filter(Boolean);
    const maxPredCol = preds.length ? Math.max(...preds.map(pid => getCol(pid))) : -1;
    const c = maxPredCol + 1;
    col.set(id, c);
    return c;
  };

  tasks.forEach(t => getCol(t.id));

  // Group by column
  const columns = new Map();
  tasks.forEach(t => {
    const c = col.get(t.id) ?? 0;
    if (!columns.has(c)) columns.set(c, []);
    columns.get(c).push(t);
  });

  // Assign (x, y) positions
  const positions = new Map();
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);
  sortedCols.forEach(c => {
    const colTasks = columns.get(c);
    colTasks.forEach((t, i) => {
      positions.set(t.id, {
        x: c * (NODE_W + COL_GAP),
        y: i * (NODE_H + ROW_GAP),
      });
    });
  });

  return { positions, col };
}

function getStatusColor(task) {
  const pct = task.percent_complete || 0;
  if (pct >= 100) return { bg: 'bg-green-100 border-green-400', text: 'text-green-800', bar: 'bg-green-500' };
  if (pct > 0) return { bg: 'bg-blue-50 border-blue-400', text: 'text-blue-800', bar: 'bg-blue-500' };
  return { bg: 'bg-card border-border', text: 'text-foreground', bar: 'bg-muted' };
}

export default function NetworkDiagram({ tasks }) {
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  const { positions, col } = useMemo(() => buildGraph(tasks), [tasks]);

  const maxX = Math.max(...[...positions.values()].map(p => p.x), 0);
  const maxY = Math.max(...[...positions.values()].map(p => p.y), 0);
  const svgW = maxX + NODE_W + 40;
  const svgH = maxY + NODE_H + 40;

  // Build edges
  const edges = [];
  tasks.forEach(task => {
    (task.predecessors || []).forEach(dep => {
      const pid = dep.predecessor_id || dep.task_id;
      const fromPos = positions.get(pid);
      const toPos = positions.get(task.id);
      if (!fromPos || !toPos) return;

      const x1 = fromPos.x + NODE_W;
      const y1 = fromPos.y + NODE_H / 2;
      const x2 = toPos.x;
      const y2 = toPos.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;

      const type = dep.type || 'FS';
      const isSelected = selectedId === pid || selectedId === task.id;

      edges.push(
        <g key={`${pid}-${task.id}`}>
          <path
            d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={isSelected ? '#2563eb' : '#94a3b8'}
            strokeWidth={isSelected ? 2 : 1.5}
            strokeDasharray={type !== 'FS' ? '5,3' : undefined}
            markerEnd="url(#arrowhead)"
          />
          {type !== 'FS' && (
            <text x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle" fontSize="9" fill="#64748b">{type}</text>
          )}
        </g>
      );
    });
  });

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border rounded-lg">
        No tasks to display in network diagram
      </div>
    );
  }

  return (
    <div className="relative border rounded-lg bg-muted/20 overflow-hidden">
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-card border rounded-lg shadow-sm p-1">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}>
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>
        <span className="text-xs font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom(1)} title="Reset">
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="overflow-auto" style={{ maxHeight: '600px' }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: svgW * zoom, height: svgH * zoom }}>
          <svg width={svgW} height={svgH} style={{ display: 'block' }}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
              </marker>
            </defs>

            {/* Edges */}
            {edges}

            {/* Nodes */}
            {tasks.map(task => {
              const pos = positions.get(task.id);
              if (!pos) return null;
              const colors = getStatusColor(task);
              const pct = task.percent_complete || 0;
              const isSelected = selectedId === task.id;

              return (
                <g key={task.id} transform={`translate(${pos.x + 20}, ${pos.y + 20})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(id => id === task.id ? null : task.id)}>
                  {/* Shadow */}
                  {isSelected && <rect width={NODE_W} height={NODE_H} rx="6" fill="none" stroke="#2563eb" strokeWidth="2" />}
                  {/* Card */}
                  <foreignObject width={NODE_W} height={NODE_H}>
                    <div xmlns="http://www.w3.org/1999/xhtml"
                      className={cn(
                        "w-full h-full rounded-md border-2 bg-card px-2 py-1.5 flex flex-col justify-between overflow-hidden",
                        colors.bg,
                        isSelected && "ring-2 ring-primary ring-offset-1"
                      )}>
                      <div>
                        <div className={cn("text-[10px] font-mono", colors.text)}>{task.wbs}</div>
                        <div className="text-[11px] font-semibold leading-tight truncate">{task.name}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full", colors.bar)} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[9px] text-muted-foreground flex-shrink-0">{pct}%</span>
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[10px] text-muted-foreground bg-card/80 backdrop-blur-sm px-2 py-1 rounded border">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400 inline-block" /> FS</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t border-dashed border-slate-400 inline-block" /> SS/FF/SF</span>
      </div>
    </div>
  );
}