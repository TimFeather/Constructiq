/**
 * exportProgrammePdf — multi-page vector PDF export of the programme (task
 * table + Gantt), replacing window.print(). Draws directly with jsPDF's
 * vector primitives (rect/line/text/polygon) rather than rasterising the DOM,
 * so every page — table cells, bars, milestones, dependency arrows, ruler —
 * stays crisp at any zoom in the PDF viewer.
 *
 * MS-Project-style tiling: the schedule is a grid of tiles, one per
 * (row band x date band). Every tile repeats the task-table columns on the
 * left (so a reader can identify a row on any page) and shows the timeline
 * slice for that date band on the right. Dependency arrows can only be drawn
 * when both the predecessor and successor bars land on the same tile — an
 * arrow whose endpoints fall on different pages is not connected, the same
 * physical limitation a paginated printout has on paper.
 */
import { jsPDF } from 'jspdf';
import { differenceInDays, addDays, format } from 'date-fns';
import { getVisibleTasks } from './visibleTasks';
import { predecessorLabel, wbsLabelMap } from '@/lib/scheduleExport';
import { DEP_COLORS } from '@/components/programme/GanttChart';

const PAGE_W = 297, PAGE_H = 210, MARGIN = 8;
const USABLE_W = PAGE_W - MARGIN * 2;
const USABLE_H = PAGE_H - MARGIN * 2;

const COLS = [
  { key: 'row', label: '#', width: 7, align: 'center' },
  { key: 'wbs', label: 'WBS', width: 13, align: 'center' },
  { key: 'name', label: 'Task Name', width: 46, align: 'left' },
  { key: 'dur', label: 'Dur', width: 10, align: 'center' },
  { key: 'start', label: 'Start', width: 14, align: 'center' },
  { key: 'finish', label: 'Finish', width: 14, align: 'center' },
  { key: 'pct', label: '%', width: 8, align: 'center' },
  { key: 'preds', label: 'Preds', width: 24, align: 'left' },
  { key: 'float', label: 'Float', width: 9, align: 'center' },
];
const TABLE_W = COLS.reduce((s, c) => s + c.width, 0);
const CHART_X = MARGIN + TABLE_W;
const CHART_W = USABLE_W - TABLE_W;

const HEADER_BLOCK_H = 17; // title + meta + legend lines
const RULER_H = 8; // timeline top+bottom strips
const GRID_TOP = MARGIN + HEADER_BLOCK_H + RULER_H;
const ROW_H = 5;
const ROWS_PER_PAGE = Math.max(1, Math.floor((USABLE_H - HEADER_BLOCK_H - RULER_H) / ROW_H));

const RGB = {
  critical: [220, 38, 38],
  normal: [107, 114, 128],
  summary: [31, 41, 55],
  milestone: [79, 70, 229],
  baseline: [148, 163, 184],
  dataDate: [217, 119, 6],
  today: [37, 99, 235],
  grid: [221, 221, 221],
  summaryBg: [243, 244, 246],
  meta: [85, 85, 85],
  black: [0, 0, 0],
};
const depRgb = (type) => hexToRgb(DEP_COLORS[type] || DEP_COLORS.FS);
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function monthsOverlapping(start, end) {
  const months = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    months.push(cur);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return months;
}
const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
function yearsOverlapping(start, end) {
  const years = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) years.push(new Date(y, 0, 1));
  return years;
}
const yearEnd = (d) => new Date(d.getFullYear(), 11, 31);
function weeksOverlapping(start, end) {
  const weeks = [];
  let cur = addDays(start, -((start.getDay() + 6) % 7)); // back to Monday
  while (cur <= end) {
    weeks.push(cur);
    cur = addDays(cur, 7);
  }
  return weeks;
}

/** Full-range tick spans (absolute dates), tier chosen once for the whole export. */
function buildFullTicks(minDate, maxDate, totalDays) {
  const tier = totalDays <= 45 ? 'week' : totalDays <= 400 ? 'month' : 'year';
  let top, bottom;
  if (tier === 'week') {
    top = monthsOverlapping(minDate, maxDate).map(m => ({
      start: m < minDate ? minDate : m,
      end: monthEnd(m) > maxDate ? maxDate : monthEnd(m),
      label: `${format(m, 'MMM')} ${format(m, 'yyyy')}`,
    }));
    bottom = weeksOverlapping(minDate, maxDate).map(w => ({
      start: w < minDate ? minDate : w,
      end: addDays(w, 6) > maxDate ? maxDate : addDays(w, 6),
      label: format(w, 'dd/MM'),
    }));
  } else if (tier === 'month') {
    const years = yearsOverlapping(minDate, maxDate);
    top = years.length > 1 ? years.map(y => ({
      start: y < minDate ? minDate : y,
      end: yearEnd(y) > maxDate ? maxDate : yearEnd(y),
      label: String(y.getFullYear()),
    })) : [];
    bottom = monthsOverlapping(minDate, maxDate).map(m => ({
      start: m < minDate ? minDate : m,
      end: monthEnd(m) > maxDate ? maxDate : monthEnd(m),
      label: format(m, 'MMM'),
    }));
  } else {
    top = yearsOverlapping(minDate, maxDate).map(y => ({
      start: y < minDate ? minDate : y,
      end: yearEnd(y) > maxDate ? maxDate : yearEnd(y),
      label: String(y.getFullYear()),
    }));
    bottom = monthsOverlapping(minDate, maxDate).map(m => ({
      start: m < minDate ? minDate : m,
      end: monthEnd(m) > maxDate ? maxDate : monthEnd(m),
      label: format(m, 'MMM'),
    }));
  }
  return { tier, top, bottom };
}

/** Clip full-range ticks to one date band, in mm relative to the band's chart column. */
function clipTicks(ticks, bandStart, bandEnd, mmPerDay, sparse) {
  return ticks
    .map(t => {
      const s = t.start < bandStart ? bandStart : t.start;
      const e = t.end > bandEnd ? bandEnd : t.end;
      if (e < s) return null;
      const left = differenceInDays(s, bandStart) * mmPerDay;
      const width = Math.max(1, (differenceInDays(e, s) + 1) * mmPerDay);
      return { label: sparse && width < 6 ? '' : t.label, left, width };
    })
    .filter(Boolean);
}

function fitText(doc, text, maxW) {
  const s = String(text ?? '');
  if (!s) return '';
  if (doc.getTextWidth(s) <= maxW) return s;
  let t = s;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function drawDiamond(doc, cx, cy, r, rgb) {
  doc.setFillColor(...rgb);
  doc.lines([[r, -r], [r, r], [-r, r]], cx - r, cy, [1, 1], 'F', true);
}

/**
 * @param {Array}  tasks - engine-shape tasks (full list, for isSummary lookups)
 * @param {Map}    scheduledMap - engine output: id -> { start, finish, isCritical, totalFloat, rolledProgress }
 * @param {Object} programme - { data_date }
 * @param {string} projectName
 * @param {Map}    baselineMap - id -> { baseline_start, baseline_finish }
 * @param {boolean} criticalOnly
 */
export function exportProgrammePdf({ tasks = [], scheduledMap, programme, projectName, baselineMap, criticalOnly = false }) {
  const printTasks = getVisibleTasks(tasks, new Set(tasks.map(t => t.id)));
  const visibleTasks = criticalOnly
    ? printTasks.filter(t => scheduledMap?.get(t.id)?.isCritical)
    : printTasks;
  if (visibleTasks.length === 0) return false;

  const wbsMap = wbsLabelMap(visibleTasks);

  const dates = [];
  scheduledMap?.forEach(r => { if (r.start) dates.push(r.start); if (r.finish) dates.push(r.finish); });
  const today = new Date();
  const rangeMin = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : today;
  const rangeMax = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : today;
  const minDate = addDays(rangeMin, -3);
  const maxDate = addDays(rangeMax, 3);
  const totalDays = Math.max(1, differenceInDays(maxDate, minDate) + 1);

  const mmPerDay = totalDays <= 45 ? 4.5 : totalDays <= 400 ? 1.0 : 0.28;
  const bandDays = Math.max(1, Math.floor(CHART_W / mmPerDay));
  const numDateBands = Math.max(1, Math.ceil(totalDays / bandDays));
  const numRowBands = Math.max(1, Math.ceil(visibleTasks.length / ROWS_PER_PAGE));
  const { tier, top: fullTop, bottom: fullBottom } = buildFullTicks(minDate, maxDate, totalDays);

  const getBarSpan = (task) => {
    const resolved = scheduledMap?.get(task.id);
    if (!resolved?.start || !resolved?.finish) return null;
    const isMilestone = task.is_milestone || task.duration === 0;
    return { start: resolved.start, finish: resolved.finish, isMilestone };
  };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const totalPages = numRowBands * numDateBands;
  let pageNum = 0;

  for (let r = 0; r < numRowBands; r++) {
    const rowStart = r * ROWS_PER_PAGE;
    const bandTasks = visibleTasks.slice(rowStart, rowStart + ROWS_PER_PAGE);
    // Scoped per row-band: a predecessor id from a different tile must miss
    // this lookup (cross-tile arrows aren't drawn), not resolve to a stale
    // index from whichever band last touched it.
    const rowIndexInBand = new Map();
    bandTasks.forEach((t, i) => rowIndexInBand.set(t.id, i));

    for (let c = 0; c < numDateBands; c++) {
      pageNum++;
      if (pageNum > 1) doc.addPage();

      const bandStartDate = addDays(minDate, c * bandDays);
      const bandDayCount = Math.min(bandDays, totalDays - c * bandDays);
      const bandEndDate = addDays(bandStartDate, bandDayCount - 1);

      // ── Header block ──────────────────────────────────────────────
      doc.setFont(undefined, 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...RGB.black);
      doc.text(fitText(doc, projectName || 'Programme', USABLE_W - 30), MARGIN, MARGIN + 4);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.text(`Page ${pageNum} of ${totalPages}`, MARGIN + USABLE_W, MARGIN + 4, { align: 'right' });

      doc.setFontSize(7);
      doc.setTextColor(...RGB.meta);
      const dataDateStr = programme?.data_date ? format(new Date(`${programme.data_date}T00:00:00`), 'dd MMM yyyy') : '—';
      const metaLine = [
        `Data date: ${dataDateStr}`,
        `Printed: ${format(new Date(), 'dd MMM yyyy HH:mm')}`,
        criticalOnly ? 'Filter: Critical path only' : null,
        `Rows ${rowStart + 1}–${rowStart + bandTasks.length}`,
        `${format(bandStartDate, 'dd/MM/yy')}–${format(bandEndDate, 'dd/MM/yy')}`,
      ].filter(Boolean).join('    ');
      doc.text(metaLine, MARGIN, MARGIN + 8);

      // legend
      doc.setFontSize(6);
      let lx = MARGIN;
      const ly = MARGIN + 12.5;
      const legendItem = (rgb, label, shape = 'rect') => {
        doc.setFillColor(...rgb);
        if (shape === 'rect') doc.rect(lx, ly - 1.6, 3, 2, 'F');
        else if (shape === 'diamond') drawDiamond(doc, lx + 1.5, ly - 0.6, 1.1, rgb);
        else { doc.setDrawColor(...rgb); doc.setLineDashPattern([0.6, 0.4], 0); doc.line(lx + 1.5, ly - 1.6, lx + 1.5, ly + 0.4); doc.setLineDashPattern([], 0); }
        doc.setTextColor(...RGB.black);
        doc.text(label, lx + 4, ly);
        lx += doc.getTextWidth(label) + 8;
      };
      legendItem(RGB.normal, 'Task');
      legendItem(RGB.critical, 'Critical');
      legendItem(RGB.summary, 'Summary');
      legendItem(RGB.milestone, 'Milestone', 'diamond');
      legendItem(RGB.baseline, 'Baseline', 'line');
      legendItem(RGB.dataDate, 'Data date', 'line');
      legendItem(RGB.today, 'Today', 'line');
      Object.entries(DEP_COLORS).forEach(([type, hex]) => legendItem(hexToRgb(hex), type, 'line'));

      doc.setDrawColor(...RGB.grid);
      doc.setLineWidth(0.15);
      doc.line(MARGIN, MARGIN + HEADER_BLOCK_H, MARGIN + USABLE_W, MARGIN + HEADER_BLOCK_H);

      // ── Column headers + timeline ruler ───────────────────────────
      const rulerY = MARGIN + HEADER_BLOCK_H;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(7);
      let cx = MARGIN;
      for (const col of COLS) {
        const tx = col.align === 'left' ? cx + 1 : col.align === 'right' ? cx + col.width - 1 : cx + col.width / 2;
        doc.text(col.label, tx, rulerY + RULER_H / 2 + 1.2, { align: col.align });
        cx += col.width;
      }
      const topTicks = clipTicks(fullTop, bandStartDate, bandEndDate, mmPerDay, false);
      const bottomTicks = clipTicks(fullBottom, bandStartDate, bandEndDate, mmPerDay, tier === 'year');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...RGB.black);
      for (const t of topTicks) {
        doc.text(t.label, CHART_X + t.left + 0.6, rulerY + 3.2, { maxWidth: t.width });
        doc.setDrawColor(...RGB.grid);
        doc.line(CHART_X + t.left, rulerY, CHART_X + t.left, rulerY + RULER_H / 2);
      }
      for (const t of bottomTicks) {
        doc.text(t.label, CHART_X + t.left + 0.6, rulerY + RULER_H / 2 + 3.2, { maxWidth: t.width });
        doc.setDrawColor(...RGB.grid);
        doc.line(CHART_X + t.left, rulerY + RULER_H / 2, CHART_X + t.left, rulerY + RULER_H);
      }
      doc.line(MARGIN, rulerY + RULER_H / 2, MARGIN + USABLE_W, rulerY + RULER_H / 2);
      doc.line(MARGIN, rulerY + RULER_H, MARGIN + USABLE_W, rulerY + RULER_H);

      // vertical column separators spanning header + rows
      const gridBottom = GRID_TOP + bandTasks.length * ROW_H;
      doc.setDrawColor(...RGB.grid);
      cx = MARGIN;
      for (const col of COLS) { doc.line(cx, MARGIN + HEADER_BLOCK_H, cx, gridBottom); cx += col.width; }
      doc.line(CHART_X, MARGIN + HEADER_BLOCK_H, CHART_X, gridBottom);
      doc.line(MARGIN + USABLE_W, MARGIN + HEADER_BLOCK_H, MARGIN + USABLE_W, gridBottom);

      // ── Rows ───────────────────────────────────────────────────────
      const dayToX = (d) => CHART_X + differenceInDays(d, bandStartDate) * mmPerDay;

      bandTasks.forEach((task, i) => {
        const y0 = GRID_TOP + i * ROW_H;
        const yMid = y0 + ROW_H / 2;
        const resolved = scheduledMap?.get(task.id);
        const isSummary = tasks.some(t => t.parent_id === task.id);
        const isCritical = resolved?.isCritical || false;
        const percentComplete = isSummary
          ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
          : (task.percent_complete || 0);
        const totalFloatDays = resolved?.totalFloat != null ? Math.round(resolved.totalFloat / 8) : null;

        if (isSummary) { doc.setFillColor(...RGB.summaryBg); doc.rect(MARGIN, y0, USABLE_W, ROW_H, 'F'); }
        doc.setDrawColor(...RGB.grid);
        doc.line(MARGIN, y0 + ROW_H, MARGIN + USABLE_W, y0 + ROW_H);

        doc.setFont(undefined, isSummary ? 'bold' : 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...RGB.black);
        const cellText = {
          row: String(rowStart + i + 1),
          wbs: task.wbs || '',
          name: fitText(doc, task.name, COLS[2].width - 2),
          dur: (task.is_milestone || task.duration === 0) ? '—' : `${task.duration || 0}d`,
          start: resolved?.start ? format(resolved.start, 'dd/MM/yy') : '—',
          finish: resolved?.finish ? format(resolved.finish, 'dd/MM/yy') : '—',
          pct: `${percentComplete}%`,
          preds: fitText(doc, predecessorLabel(task.predecessors, wbsMap), COLS[7].width - 2),
          float: totalFloatDays === null ? '—' : `${totalFloatDays}d`,
        };
        cx = MARGIN;
        for (const col of COLS) {
          const tx = col.align === 'left' ? cx + 1 : col.align === 'right' ? cx + col.width - 1 : cx + col.width / 2;
          doc.text(cellText[col.key], tx, yMid + 1.3, { align: col.align });
          cx += col.width;
        }

        // data date / today lines
        if (programme?.data_date) {
          const dd = new Date(`${programme.data_date}T00:00:00`);
          if (dd >= bandStartDate && dd <= bandEndDate) {
            doc.setDrawColor(...RGB.dataDate); doc.setLineDashPattern([0.6, 0.4], 0);
            doc.line(dayToX(dd), y0, dayToX(dd), y0 + ROW_H); doc.setLineDashPattern([], 0);
          }
        }
        if (today >= bandStartDate && today <= bandEndDate) {
          doc.setDrawColor(...RGB.today); doc.setLineDashPattern([0.6, 0.4], 0);
          doc.line(dayToX(today), y0, dayToX(today), y0 + ROW_H); doc.setLineDashPattern([], 0);
        }

        // baseline bar
        const baseline = baselineMap?.get(task.id);
        if (baseline?.baseline_start && baseline?.baseline_finish) {
          const bs = new Date(baseline.baseline_start), bf = new Date(baseline.baseline_finish);
          if (bf >= bandStartDate && bs <= bandEndDate) {
            const cs = bs < bandStartDate ? bandStartDate : bs;
            const ce = bf > bandEndDate ? bandEndDate : bf;
            doc.setDrawColor(...RGB.baseline); doc.setLineWidth(0.5); doc.setLineDashPattern([0.8, 0.5], 0);
            doc.line(dayToX(cs), y0 + ROW_H - 0.6, dayToX(ce), y0 + ROW_H - 0.6);
            doc.setLineDashPattern([], 0); doc.setLineWidth(0.15);
          }
        }

        // bar / milestone
        const span = getBarSpan(task);
        if (span) {
          if (span.isMilestone) {
            if (span.start >= bandStartDate && span.start <= bandEndDate) {
              drawDiamond(doc, dayToX(span.start), yMid, 1.5, isCritical ? RGB.critical : RGB.milestone);
            }
          } else if (span.finish >= bandStartDate && span.start <= bandEndDate) {
            const cs = span.start < bandStartDate ? bandStartDate : span.start;
            const ce = span.finish > bandEndDate ? bandEndDate : span.finish;
            const bx = dayToX(cs);
            const bw = Math.max(0.6, dayToX(ce) - bx + mmPerDay * 0.001 + (differenceInDays(ce, cs) === 0 ? mmPerDay * 0.6 : mmPerDay));
            const barRgb = isSummary ? RGB.summary : (isCritical ? RGB.critical : RGB.normal);
            doc.setFillColor(...barRgb);
            doc.roundedRect(bx, y0 + 1, bw, ROW_H - 2, 0.3, 0.3, 'F');
            if (percentComplete > 0) {
              doc.setGState(new doc.GState({ opacity: 0.45 }));
              doc.setFillColor(255, 255, 255);
              doc.rect(bx, y0 + 1, bw * Math.min(100, percentComplete) / 100, ROW_H - 2, 'F');
              doc.setGState(new doc.GState({ opacity: 1 }));
            }
          }
        }
      });

      // ── Dependency arrows (same tile only) ─────────────────────────
      const ELBOW = 1.5;
      doc.setLineWidth(0.15);
      bandTasks.forEach((task, i) => {
        const taskSpan = getBarSpan(task);
        if (!taskSpan) return;
        const taskY = GRID_TOP + i * ROW_H + ROW_H / 2;
        for (const dep of (task.predecessors || [])) {
          const pid = dep.predecessor_id || dep.task_id;
          const predIdx = rowIndexInBand.get(pid);
          if (predIdx == null) continue; // predecessor not on this row-band tile
          const predTask = bandTasks[predIdx];
          const predSpan = getBarSpan(predTask);
          if (!predSpan) continue;
          const predY = GRID_TOP + predIdx * ROW_H + ROW_H / 2;
          const type = dep.type || 'FS';

          const xOf = (span, edge) => {
            if (span.isMilestone) return dayToX(span.start);
            return edge === 'start' ? dayToX(span.start) : dayToX(span.finish) + mmPerDay;
          };
          let ox, tx;
          switch (type) {
            case 'SS': ox = xOf(predSpan, 'start'); tx = xOf(taskSpan, 'start'); break;
            case 'FF': ox = xOf(predSpan, 'finish'); tx = xOf(taskSpan, 'finish'); break;
            case 'SF': ox = xOf(predSpan, 'start'); tx = xOf(taskSpan, 'finish'); break;
            default: ox = xOf(predSpan, 'finish'); tx = xOf(taskSpan, 'start');
          }
          if (ox < CHART_X || ox > CHART_X + CHART_W || tx < CHART_X || tx > CHART_X + CHART_W) continue;

          const rgb = (isCriticalPair(scheduledMap, pid, task.id)) ? RGB.critical : depRgb(type);
          doc.setDrawColor(...rgb);
          doc.setLineDashPattern([0.8, 0.6], 0);
          if (predY === taskY) {
            doc.line(ox, predY, tx, taskY);
          } else {
            const goRight = type === 'FS' || type === 'FF';
            const stubOx = goRight ? ox + ELBOW : ox - ELBOW;
            const arriveRight = type === 'FF' || type === 'SF';
            const stubTx = arriveRight ? tx + ELBOW : tx - ELBOW;
            const midY = (predY + taskY) / 2;
            doc.lines(
              [[stubOx - ox, 0], [0, midY - predY], [stubTx - stubOx, 0], [0, taskY - midY], [tx - stubTx, 0]],
              ox, predY, [1, 1], 'S', false,
            );
          }
          doc.setLineDashPattern([], 0);
        }
      });
    }
  }

  const safeName = (projectName || 'Programme').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'Programme';
  doc.save(`${safeName} - Programme.pdf`);
  return true;
}

function isCriticalPair(scheduledMap, predId, taskId) {
  return (scheduledMap?.get(predId)?.isCritical || false) && (scheduledMap?.get(taskId)?.isCritical || false);
}
