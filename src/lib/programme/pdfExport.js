/**
 * exportProgrammePdf — multi-page vector PDF export of the programme (task
 * table + Gantt), laid out the way Microsoft Project prints a Gantt Chart
 * view with "Fit to 1 page wide":
 *
 *  - WYSIWYG rows: the caller passes the on-screen task list, so collapsed
 *    groups print collapsed. Same columns, in the same order, as the screen.
 *  - The whole timescale is scaled to the page width, so pages only break
 *    downwards and no task is ever printed twice. Column headings and the
 *    two-tier timescale repeat at the top of every page.
 *  - MS Project bar styles: blue task bars with a dark progress bar through
 *    the middle, black summary bars with end caps, black milestone diamonds
 *    labelled with their date, grey baseline bars, and solid link lines with
 *    arrowheads. Critical tasks go red only when the critical path is
 *    highlighted (MS Project's "Critical Tasks" format option).
 *  - A legend box (project, dates, bar key) and "Page N of M" on every page.
 *
 * Draws with jsPDF's vector primitives rather than rasterising the DOM, so
 * every page stays crisp at any zoom. Links are drawn when both ends land on
 * the same page.
 */
import { jsPDF } from 'jspdf';
import {
  differenceInDays, addDays, addWeeks, addMonths, addQuarters, addYears, format, isValid,
  startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear,
} from 'date-fns';
import { getVisibleTasks } from './visibleTasks';
import { predecessorLabel, wbsLabelMap } from '@/lib/scheduleExport';

// Landscape sheet sizes in mm.
const PAPER = { a4: [297, 210], a3: [420, 297] };
const MARGIN = 8;

// Same columns, in the same order, as the on-screen task list.
const COLS = [
  { key: 'wbs', label: 'WBS', width: 13, align: 'center' },
  { key: 'name', label: 'Task Name', width: 52, align: 'left' },
  { key: 'dur', label: 'Dur', width: 10, align: 'center' },
  { key: 'start', label: 'Start', width: 14, align: 'center' },
  { key: 'finish', label: 'Finish', width: 14, align: 'center' },
  { key: 'pct', label: '%', width: 8, align: 'center' },
  { key: 'preds', label: 'Preds', width: 22, align: 'left' },
  { key: 'float', label: 'Float', width: 9, align: 'center' },
];
// A3's extra width goes first to the columns that truncate: long task names
// and multi-link predecessor lists.
const A3_EXTRA = { name: 38, preds: 10 };
const columnsFor = (paper) => COLS.map(c => ({ ...c, width: c.width + (paper === 'a3' ? (A3_EXTRA[c.key] || 0) : 0) }));
const INDENT_MM = 2.5, MAX_INDENT_LEVELS = 6;

const HEADER_H = 8; // title line
const RULER_H = 8; // column headings / two timescale tiers
const LEGEND_H = 14;
const FOOTER_H = 5;
const ROW_H = 5;
const GRID_TOP = MARGIN + HEADER_H + RULER_H;

// Bar geometry within a 5mm row.
const BAR_TOP = 0.9, BAR_H = 2.6; // task bar
const PROGRESS_H = 0.9; // centred in the task bar
const BASELINE_TOP = 3.7, BASELINE_H = 0.9; // under the task bar
const SUMMARY_TOP = 1.0, SUMMARY_H = 1.2, CAP = 1.3; // summary bar + end caps
const MILESTONE_R = 1.4;
const ELBOW = 1.5; // link stub length
const HEAD_L = 1.1, HEAD_W = 0.6; // arrowhead length / half-width

const RGB = {
  task: [91, 155, 213],
  taskBorder: [65, 113, 156],
  progress: [31, 56, 100],
  critical: [230, 70, 70],
  criticalBorder: [170, 30, 30],
  criticalProgress: [110, 15, 15],
  summary: [0, 0, 0],
  milestone: [0, 0, 0],
  baseline: [166, 166, 166],
  link: [68, 114, 196],
  dataDate: [217, 119, 6],
  today: [37, 99, 235],
  grid: [200, 200, 200],
  gridLight: [235, 235, 235],
  headerBg: [242, 242, 242],
  meta: [85, 85, 85],
  black: [0, 0, 0],
};

const UNITS = {
  day: { first: startOfDay, next: d => addDays(d, 1) },
  week: { first: d => startOfWeek(d, { weekStartsOn: 1 }), next: d => addWeeks(d, 1) },
  month: { first: startOfMonth, next: d => addMonths(d, 1) },
  quarter: { first: startOfQuarter, next: d => addQuarters(d, 1) },
  year: { first: startOfYear, next: d => addYears(d, 1) },
};

/** Calendar periods of `unit` overlapping [minDate, maxDate], clipped to that range. */
function unitTicks(unit, minDate, maxDate, label, short) {
  const { first, next } = UNITS[unit];
  const ticks = [];
  for (let s = first(minDate); s <= maxDate; s = next(s)) {
    const e = addDays(next(s), -1);
    ticks.push({
      start: s < minDate ? minDate : s,
      end: e > maxDate ? maxDate : e,
      label: label(s),
      short: short ? short(s) : '',
    });
  }
  return ticks;
}

const quarterOf = d => Math.floor(d.getMonth() / 3) + 1;

/** MS Project-style timescale tiers: the finest bottom unit whose labels still fit. */
function buildTicks(minDate, maxDate, mmPerDay) {
  if (mmPerDay >= 4) {
    return {
      top: unitTicks('week', minDate, maxDate, d => format(d, "dd MMM ''yy"), d => format(d, 'dd MMM')),
      bottom: unitTicks('day', minDate, maxDate, d => format(d, 'EEEEE')),
    };
  }
  if (mmPerDay >= 1.1) {
    return {
      top: unitTicks('month', minDate, maxDate, d => format(d, "MMM ''yy"), d => format(d, 'MMM')),
      bottom: unitTicks('week', minDate, maxDate, d => format(d, 'dd/MM')),
    };
  }
  if (mmPerDay >= 0.2) {
    return {
      top: unitTicks('quarter', minDate, maxDate, d => `Qtr ${quarterOf(d)}, ${format(d, 'yyyy')}`, d => `Q${quarterOf(d)} ${format(d, 'yy')}`),
      bottom: unitTicks('month', minDate, maxDate, d => format(d, 'MMM'), d => format(d, 'MMMMM')),
    };
  }
  return {
    top: unitTicks('year', minDate, maxDate, d => format(d, 'yyyy')),
    bottom: unitTicks('quarter', minDate, maxDate, d => `Qtr ${quarterOf(d)}`, d => `Q${quarterOf(d)}`),
  };
}

/**
 * The tick's label, or its short form, or nothing — whichever fits. Never
 * pass maxWidth to doc.text for these: jsPDF wraps an over-long word one
 * character per line, stacking it down over the task rows.
 */
function tickLabel(doc, label, short, width) {
  for (const s of [label, short]) {
    if (s && doc.getTextWidth(s) + 1 <= width) return s;
  }
  return '';
}

/** Project name reduced to filename-safe characters. Shared by both export paths. */
function safeProjectFileName(projectName) {
  return (projectName || 'Programme').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'Programme';
}

/**
 * ArrayBuffer → base64. Chunked because String.fromCharCode(...bytes) on a
 * multi-hundred-KB PDF exceeds the maximum argument count and throws.
 */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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

/** Black summary bar with MS Project's downward end caps. */
function drawSummaryBar(doc, x, w, y0) {
  const top = y0 + SUMMARY_TOP, bottom = top + SUMMARY_H;
  doc.setFillColor(...RGB.summary);
  doc.rect(x, top, w, SUMMARY_H, 'F');
  doc.triangle(x, top, x + CAP, bottom, x, bottom + CAP, 'F');
  doc.triangle(x + w, top, x + w - CAP, bottom, x + w, bottom + CAP, 'F');
}

/** Task bar with the dark progress bar through its middle. */
function drawTaskBar(doc, x, w, y0, pct, critical) {
  doc.setFillColor(...(critical ? RGB.critical : RGB.task));
  doc.setDrawColor(...(critical ? RGB.criticalBorder : RGB.taskBorder));
  doc.setLineWidth(0.15);
  doc.roundedRect(x, y0 + BAR_TOP, w, BAR_H, 0.3, 0.3, 'FD');
  if (pct > 0) {
    doc.setFillColor(...(critical ? RGB.criticalProgress : RGB.progress));
    doc.rect(x, y0 + BAR_TOP + (BAR_H - PROGRESS_H) / 2, w * Math.min(100, pct) / 100, PROGRESS_H, 'F');
  }
}

function drawArrowHead(doc, x, y, dir) {
  if (dir === 'right') doc.triangle(x, y, x - HEAD_L, y - HEAD_W, x - HEAD_L, y + HEAD_W, 'F');
  else if (dir === 'left') doc.triangle(x, y, x + HEAD_L, y - HEAD_W, x + HEAD_L, y + HEAD_W, 'F');
  else if (dir === 'down') doc.triangle(x, y, x - HEAD_W, y - HEAD_L, x + HEAD_W, y - HEAD_L, 'F');
  else doc.triangle(x, y, x - HEAD_W, y + HEAD_L, x + HEAD_W, y + HEAD_L, 'F');
}

function drawPolyline(doc, pts) {
  for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
}

/**
 * MS Project link routing. `pred`/`succ` are bar geometries with left/right
 * edges, row centre and top/bottom. An FS link with room runs out of the
 * predecessor's finish and drops onto the successor's start; otherwise links
 * route round the bars with short stubs and arrive at the bar's end.
 */
function linkPath(type, pred, succ) {
  const pY = pred.yMid, sY = succ.yMid;
  if (pY === sY) {
    const ox = type === 'SS' || type === 'SF' ? pred.left : pred.right;
    const tx = type === 'FF' || type === 'SF' ? succ.right : succ.left;
    return { pts: [[ox, pY], [tx, sY]], head: tx >= ox ? 'right' : 'left' };
  }
  const down = sY > pY;
  const lane = pY + (down ? ROW_H : -ROW_H) / 2; // row boundary beside the predecessor
  switch (type) {
    case 'SS': {
      const lx = Math.min(pred.left, succ.left) - ELBOW;
      return { pts: [[pred.left, pY], [lx, pY], [lx, sY], [succ.left, sY]], head: 'right' };
    }
    case 'FF': {
      const rx = Math.max(pred.right, succ.right) + ELBOW;
      return { pts: [[pred.right, pY], [rx, pY], [rx, sY], [succ.right, sY]], head: 'left' };
    }
    case 'SF': {
      const ox = pred.left - ELBOW, tx = succ.right + ELBOW;
      return { pts: [[pred.left, pY], [ox, pY], [ox, lane], [tx, lane], [tx, sY], [succ.right, sY]], head: 'left' };
    }
    default: {
      if (succ.left >= pred.right + 0.8) {
        const dropX = succ.isMilestone ? succ.x : succ.left + Math.min(1, (succ.right - succ.left) / 2);
        return { pts: [[pred.right, pY], [dropX, pY], [dropX, down ? succ.top : succ.bottom]], head: down ? 'down' : 'up' };
      }
      const ox = pred.right + ELBOW, tx = succ.left - ELBOW;
      return { pts: [[pred.right, pY], [ox, pY], [ox, lane], [tx, lane], [tx, sY], [succ.left, sY]], head: 'right' };
    }
  }
}

/** Outline depth from the parent chain (task.level is capped and can be stale). */
function outlineDepth(task, byId) {
  let d = 0;
  const seen = new Set([task.id]);
  for (let p = byId.get(task.parent_id); p && !seen.has(p.id); p = byId.get(p.parent_id)) {
    seen.add(p.id);
    d++;
  }
  return d;
}

const isMilestoneTask = (task) => task.is_milestone || task.duration === 0;

/**
 * @param {Array}   tasks - engine-shape tasks (full list: summaries, WBS labels, outline depth)
 * @param {Array}   [visibleTasks] - rows to print, in order — pass the on-screen
 *                  list so collapsed groups print collapsed. Omitted: every task, expanded.
 * @param {Map}     scheduledMap - engine output: id -> { start, finish, isCritical, totalFloat, rolledProgress, durationDays }
 * @param {Object}  programme - { data_date }
 * @param {string}  projectName
 * @param {Map}     baselineMap - id -> { baseline_start, baseline_finish }
 * @param {boolean} highlightCritical - paint critical tasks and links red (the
 *                  on-screen Critical toggle). Never removes rows.
 * @param {'a4'|'a3'} paper - landscape sheet size
 */
export function buildProgrammePdfDoc({
  tasks = [], visibleTasks, scheduledMap, programme, projectName, baselineMap,
  highlightCritical = false, paper = 'a4',
}) {
  const rows = visibleTasks ?? getVisibleTasks(tasks, new Set(tasks.map(t => t.id)));
  if (rows.length === 0) return null;

  const [pageW, pageH] = PAPER[paper] || PAPER.a4;
  const usableW = pageW - MARGIN * 2;
  const rightX = MARGIN + usableW;
  const cols = columnsFor(paper);
  const colW = Object.fromEntries(cols.map(c => [c.key, c.width]));
  const tableW = cols.reduce((s, c) => s + c.width, 0);
  const chartX = MARGIN + tableW;
  const chartW = usableW - tableW;
  const legendTop = pageH - MARGIN - FOOTER_H - LEGEND_H;
  const rowsPerPage = Math.max(1, Math.floor((legendTop - 2 - GRID_TOP) / ROW_H));

  const byId = new Map(tasks.map(t => [t.id, t]));
  const summaryIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
  // Built from the full list, as the task list does, so a predecessor in a
  // collapsed group still gets its label.
  const wbsMap = wbsLabelMap(tasks);

  // ── Timescale fitted to the chart width ───────────────────────────────
  const times = [];
  scheduledMap?.forEach(r => {
    if (r.start) times.push(r.start.getTime());
    if (r.finish) times.push(r.finish.getTime());
  });
  for (const t of rows) {
    const b = baselineMap?.get(t.id);
    if (b?.baseline_start) times.push(new Date(b.baseline_start).getTime());
    if (b?.baseline_finish) times.push(new Date(b.baseline_finish).getTime());
  }
  const validTimes = times.filter(Number.isFinite);
  const today = new Date();
  const rangeMin = validTimes.length ? new Date(Math.min(...validTimes)) : today;
  const rangeMax = validTimes.length ? new Date(Math.max(...validTimes)) : today;
  const minDate = startOfDay(addDays(rangeMin, -3));
  const maxDate = startOfDay(addDays(rangeMax, 3));
  const totalDays = differenceInDays(maxDate, minDate) + 1;
  const mmPerDay = chartW / totalDays;
  const { top: topTicks, bottom: bottomTicks } = buildTicks(minDate, maxDate, mmPerDay);
  const dayToX = (d) => chartX + differenceInDays(d, minDate) * mmPerDay;
  const inRange = (d) => d >= minDate && d < addDays(maxDate, 1);

  // Same span rule as GanttChart's getBar: bars run to the end of the finish day.
  const getBar = (task, rowIdx) => {
    const resolved = scheduledMap?.get(task.id);
    if (!resolved?.start || !resolved?.finish) return null;
    const x = dayToX(resolved.start);
    const y0 = GRID_TOP + rowIdx * ROW_H;
    const yMid = y0 + ROW_H / 2;
    if (isMilestoneTask(task)) {
      return { x, w: 0, isMilestone: true, left: x - MILESTONE_R, right: x + MILESTONE_R, yMid, top: yMid - MILESTONE_R, bottom: yMid + MILESTONE_R };
    }
    const days = Math.max(1, differenceInDays(resolved.finish, resolved.start) + 1);
    const w = Math.max(0.4, days * mmPerDay);
    const summary = summaryIds.has(task.id);
    return {
      x, w, isMilestone: false, left: x, right: x + w, yMid,
      top: y0 + (summary ? SUMMARY_TOP : BAR_TOP),
      bottom: y0 + (summary ? SUMMARY_TOP + SUMMARY_H : BAR_TOP + BAR_H),
    };
  };

  const dataDate = programme?.data_date ? new Date(`${programme.data_date}T00:00:00`) : null;
  const hasDataDate = dataDate && isValid(dataDate);
  const printedStr = format(today, 'dd/MM/yy HH:mm');

  // compress: deflate the page streams on output — keeps the publish email
  // attachment small. doc.internal.pages (what the tests read) stays plain.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper === 'a3' ? 'a3' : 'a4', compress: true });
  const totalPages = Math.ceil(rows.length / rowsPerPage);

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage();
    const rowStart = page * rowsPerPage;
    const pageRows = rows.slice(rowStart, rowStart + rowsPerPage);
    const gridBottom = GRID_TOP + pageRows.length * ROW_H;
    const bars = pageRows.map((t, i) => getBar(t, i));
    // Scoped per page: a predecessor on another page must miss this lookup
    // (cross-page links aren't drawn).
    const rowIndexOnPage = new Map(pageRows.map((t, i) => [t.id, i]));

    // ── Title ──────────────────────────────────────────────────────
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...RGB.black);
    doc.text(fitText(doc, projectName || 'Programme', usableW), MARGIN, MARGIN + 5);

    // ── Column headings + timescale ────────────────────────────────
    const rulerY = MARGIN + HEADER_H;
    doc.setFillColor(...RGB.headerBg);
    doc.rect(MARGIN, rulerY, usableW, RULER_H, 'F');
    doc.setFontSize(7);
    let cx = MARGIN;
    for (const col of cols) {
      const tx = col.align === 'left' ? cx + 1 : col.align === 'right' ? cx + col.width - 1 : cx + col.width / 2;
      doc.text(col.label, tx, rulerY + RULER_H / 2 + 1.2, { align: col.align });
      cx += col.width;
    }
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setLineWidth(0.15);
    doc.setDrawColor(...RGB.grid);
    const drawTier = (ticks, y0) => {
      for (const t of ticks) {
        const left = chartX + differenceInDays(t.start, minDate) * mmPerDay;
        const width = (differenceInDays(t.end, t.start) + 1) * mmPerDay;
        const label = tickLabel(doc, t.label, t.short, width);
        if (label) doc.text(label, left + width / 2, y0 + 2.9, { align: 'center' });
        doc.line(left, y0, left, y0 + RULER_H / 2);
      }
    };
    drawTier(topTicks, rulerY);
    drawTier(bottomTicks, rulerY + RULER_H / 2);
    // Tier divider runs across the timescale only — across the table it would
    // strike through the column headings.
    doc.line(chartX, rulerY + RULER_H / 2, rightX, rulerY + RULER_H / 2);
    doc.line(MARGIN, GRID_TOP, rightX, GRID_TOP);

    // ── Grid ───────────────────────────────────────────────────────
    pageRows.forEach((_, i) => {
      const y = GRID_TOP + (i + 1) * ROW_H;
      doc.setDrawColor(...RGB.grid);
      doc.line(MARGIN, y, chartX, y);
      doc.setDrawColor(...RGB.gridLight);
      doc.line(chartX, y, rightX, y);
    });
    doc.setDrawColor(...RGB.gridLight);
    for (const t of topTicks) {
      const x = chartX + differenceInDays(t.start, minDate) * mmPerDay;
      if (x > chartX + 0.1) doc.line(x, GRID_TOP, x, gridBottom);
    }
    doc.setDrawColor(...RGB.grid);
    cx = MARGIN;
    for (const col of cols) { if (cx > MARGIN) doc.line(cx, rulerY, cx, gridBottom); cx += col.width; }
    doc.line(chartX, rulerY, chartX, gridBottom);
    doc.rect(MARGIN, rulerY, usableW, gridBottom - rulerY, 'S');

    // status (data) date and current date lines
    doc.setLineDashPattern([0.6, 0.4], 0);
    if (hasDataDate && inRange(dataDate)) {
      doc.setDrawColor(...RGB.dataDate);
      doc.line(dayToX(dataDate), GRID_TOP, dayToX(dataDate), gridBottom);
    }
    if (inRange(today)) {
      doc.setDrawColor(...RGB.today);
      doc.line(dayToX(today), GRID_TOP, dayToX(today), gridBottom);
    }
    doc.setLineDashPattern([], 0);

    // ── Rows ───────────────────────────────────────────────────────
    pageRows.forEach((task, i) => {
      const y0 = GRID_TOP + i * ROW_H;
      const yMid = y0 + ROW_H / 2;
      const resolved = scheduledMap?.get(task.id);
      const isSummary = summaryIds.has(task.id);
      const isCritical = highlightCritical && (resolved?.isCritical || false);
      const percentComplete = isSummary
        ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
        : (task.percent_complete || 0);
      const duration = resolved?.durationDays ?? task.duration ?? 1;
      const totalFloatDays = resolved?.totalFloat != null ? Math.round(resolved.totalFloat / 8) : null;
      const indent = Math.min(outlineDepth(task, byId), MAX_INDENT_LEVELS) * INDENT_MM;

      doc.setFont(undefined, isSummary ? 'bold' : 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...RGB.black);
      const cellText = {
        wbs: task.wbs || '',
        name: fitText(doc, task.name, colW.name - 2 - indent),
        dur: isMilestoneTask(task) ? '—' : `${duration}d`,
        start: resolved?.start ? format(resolved.start, 'dd/MM/yy') : '—',
        finish: resolved?.finish ? format(resolved.finish, 'dd/MM/yy') : '—',
        pct: `${percentComplete}%`,
        preds: fitText(doc, predecessorLabel(task.predecessors, wbsMap), colW.preds - 2),
        float: totalFloatDays === null ? '—' : `${totalFloatDays}d`,
      };
      cx = MARGIN;
      for (const col of cols) {
        const pad = col.key === 'name' ? 1 + indent : 1;
        const tx = col.align === 'left' ? cx + pad : col.align === 'right' ? cx + col.width - 1 : cx + col.width / 2;
        doc.text(cellText[col.key], tx, yMid + 1.3, { align: col.align });
        cx += col.width;
      }

      // baseline bar under the task bar, to the end of its finish day
      const baseline = baselineMap?.get(task.id);
      if (baseline?.baseline_start && baseline?.baseline_finish) {
        const bs = new Date(baseline.baseline_start), bf = new Date(baseline.baseline_finish);
        if (isValid(bs) && isValid(bf) && bf >= bs) {
          doc.setFillColor(...RGB.baseline);
          doc.rect(dayToX(bs), y0 + BASELINE_TOP, (differenceInDays(bf, bs) + 1) * mmPerDay, BASELINE_H, 'F');
        }
      }

      const bar = bars[i];
      if (!bar) return;
      if (bar.isMilestone) {
        drawDiamond(doc, bar.x, yMid, MILESTONE_R, RGB.milestone);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(5.5);
        doc.text(format(resolved.start, 'd/MM'), bar.right + 0.8, yMid + 0.9);
      } else if (isSummary) {
        drawSummaryBar(doc, bar.x, bar.w, y0);
      } else {
        drawTaskBar(doc, bar.x, bar.w, y0, percentComplete, isCritical);
      }
    });

    // ── Links (same page only) ─────────────────────────────────────
    doc.setLineWidth(0.2);
    pageRows.forEach((task, i) => {
      const succ = bars[i];
      if (!succ) return;
      for (const dep of (task.predecessors || [])) {
        const pid = dep.predecessor_id || dep.task_id;
        const predIdx = rowIndexOnPage.get(pid);
        if (predIdx == null) continue; // predecessor not on this page
        const pred = bars[predIdx];
        if (!pred) continue;
        const rgb = highlightCritical && isCriticalPair(scheduledMap, pid, task.id) ? RGB.critical : RGB.link;
        doc.setDrawColor(...rgb);
        doc.setFillColor(...rgb);
        const { pts, head } = linkPath(dep.type || 'FS', pred, succ);
        drawPolyline(doc, pts);
        const [hx, hy] = pts[pts.length - 1];
        drawArrowHead(doc, hx, hy, head);
      }
    });

    // ── Legend box + page number ───────────────────────────────────
    drawLegend(doc, {
      top: legendTop, width: usableW, projectName, printedStr,
      dataDateStr: hasDataDate ? format(dataDate, 'dd/MM/yy') : '—',
      highlightCritical, rowsLabel: `Rows ${rowStart + 1}–${rowStart + pageRows.length} of ${rows.length}`,
    });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...RGB.black);
    doc.text(`Page ${page + 1} of ${totalPages}`, pageW / 2, pageH - MARGIN - 1, { align: 'center' });
  }

  return doc;
}

/** MS Project's page legend: project details on the left, bar key on the right. */
function drawLegend(doc, { top, width, projectName, printedStr, dataDateStr, highlightCritical, rowsLabel }) {
  const INFO_W = 75;
  doc.setLineWidth(0.15);
  doc.setDrawColor(...RGB.grid);
  doc.rect(MARGIN, top, width, LEGEND_H, 'S');
  doc.line(MARGIN + INFO_W, top, MARGIN + INFO_W, top + LEGEND_H);

  doc.setTextColor(...RGB.black);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  doc.text(fitText(doc, `Project: ${projectName || 'Programme'}`, INFO_W - 4), MARGIN + 2, top + 4);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...RGB.meta);
  doc.text(`Printed: ${printedStr}    Data date: ${dataDateStr}`, MARGIN + 2, top + 8);
  doc.text([highlightCritical ? 'Critical path highlighted' : null, rowsLabel].filter(Boolean).join('    '), MARGIN + 2, top + 12);

  const items = [
    ['Task', (x, y) => drawTaskBar(doc, x, 9, y - ROW_H / 2, 0, false)],
    ['Progress', (x, y) => drawTaskBar(doc, x, 9, y - ROW_H / 2, 60, false)],
    ['Summary', (x, y) => drawSummaryBar(doc, x, 9, y - ROW_H / 2)],
    ['Milestone', (x, y) => drawDiamond(doc, x + 4.5, y, MILESTONE_R, RGB.milestone)],
    ['Baseline', (x, y) => { doc.setFillColor(...RGB.baseline); doc.rect(x, y - BASELINE_H / 2, 9, BASELINE_H, 'F'); }],
    ['Link', (x, y) => {
      doc.setLineWidth(0.2); doc.setDrawColor(...RGB.link); doc.setFillColor(...RGB.link);
      doc.line(x, y, x + 9, y); drawArrowHead(doc, x + 9, y, 'right');
    }],
    highlightCritical ? ['Critical', (x, y) => drawTaskBar(doc, x, 9, y - ROW_H / 2, 0, true)] : null,
    ['Data date', (x, y) => dashedTick(doc, x + 4.5, y, RGB.dataDate)],
    ['Today', (x, y) => dashedTick(doc, x + 4.5, y, RGB.today)],
  ].filter(Boolean);

  const COL_STEP = 30, ROW_STEP = 4;
  items.forEach(([label, sample], idx) => {
    const x = MARGIN + INFO_W + 3 + Math.floor(idx / 3) * COL_STEP;
    const y = top + 3 + (idx % 3) * ROW_STEP;
    sample(x, y);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...RGB.black);
    doc.text(label, x + 11, y + 0.9);
  });
}

function dashedTick(doc, x, y, rgb) {
  doc.setLineWidth(0.2);
  doc.setDrawColor(...rgb);
  doc.setLineDashPattern([0.6, 0.4], 0);
  doc.line(x, y - 1.5, x, y + 1.5);
  doc.setLineDashPattern([], 0);
}

/**
 * Build + download. Unchanged public contract: true when a PDF was produced,
 * false when there was nothing to draw.
 */
export function exportProgrammePdf(args = {}) {
  const doc = buildProgrammePdfDoc(args);
  if (!doc) return false;
  doc.save(`${safeProjectFileName(args.projectName)} - Programme.pdf`);
  return true;
}

/**
 * Build + return the bytes as base64, for emailing as an attachment.
 * Returns null when there is nothing to draw.
 *
 * Uses output('arraybuffer') — NOT 'datauristring', which prefixes
 * `data:application/pdf;…;base64,` and breaks both Resend and the
 * server-side atob(). Needs neither `document` nor file-saver, unlike save().
 */
export function programmePdfBase64(args = {}) {
  const doc = buildProgrammePdfDoc(args);
  if (!doc) return null;
  const buf = doc.output('arraybuffer');
  return {
    base64: arrayBufferToBase64(buf),
    // Dated, unlike the manual export, so repeat publishes don't collide in an inbox.
    filename: `${safeProjectFileName(args.projectName)} - Programme ${format(new Date(), 'yyyy-MM-dd')}.pdf`,
    bytes: buf.byteLength,
  };
}

function isCriticalPair(scheduledMap, predId, taskId) {
  return (scheduledMap?.get(predId)?.isCritical || false) && (scheduledMap?.get(taskId)?.isCritical || false);
}
