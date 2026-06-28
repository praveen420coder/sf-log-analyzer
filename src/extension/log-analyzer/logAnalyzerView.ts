/*
 * Log Analyzer view for SF Spotlight.
 *
 * Built on the BSD-3-Clause "apex-log-parser" by Certinia Inc.
 * (Copyright (c) 2020 Certinia Inc. All rights reserved.) The parser sources
 * are vendored under ../apex-log-parser with their original copyright headers.
 * The views below (Call Tree / Analysis / Database / Timeline) are an
 * independent re-implementation styled for this extension.
 */

import { parse, SOQLExecuteBeginLine, DMLBeginLine } from '../apex-log-parser/index';
import type { ApexLog, LogEvent } from '../apex-log-parser/index';
import { initTimeline } from './timelineRenderer';
import { toAggregatedCallTree, toBottomUpTree } from './agg/Aggregation';
import type { AggregatedRow, BottomUpRow } from './agg/Aggregation';
import { LogAnalyzer } from '../../utils/logAnalyzer';
import type { PerformanceInsight, LogMetrics } from '../../utils/logAnalyzer';

export interface AnalyzerOptions {
  isDark: boolean;
  logName?: string;
  onBack: () => void;
}

type Palette = ReturnType<typeof makePalette>;

function makePalette(isDark: boolean) {
  return {
    bg: isDark ? '#0e1626' : '#ffffff',
    panel: isDark ? '#111c30' : '#ffffff',
    headerBg: isDark ? '#16223b' : '#eef2f7',
    zebra: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
    hover: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? '#94a3b8' : '#64748b',
    faint: isDark ? 'rgba(148,163,184,0.55)' : 'rgba(31,41,55,0.45)',
    border: isDark ? 'rgba(148,163,184,0.20)' : 'rgba(0,0,0,0.10)',
    divider: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)',
    accent: '#3b82f6',
    accentSoft: isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.12)',
    chipBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    bar: 'rgba(212,168,67,0.30)',
    barText: isDark ? '#e8c977' : '#92702a',
  };
}

// Timeline category colours (from the reference renderer).
const CATEGORY_COLORS: Record<string, string> = {
  Apex: '#26A69A',
  'Code Unit': '#9CCC65',
  System: '#A1887F',
  Automation: '#66BB6A',
  DML: '#E57373',
  SOQL: '#BA68C8',
  Callout: '#FFB74D',
  Validation: '#5BA4CF',
};
function catColor(cat: string): string {
  return CATEGORY_COLORS[cat] || '#64748b';
}

// Event types that count as "details" even with zero duration (always shown by default).
const EXCLUDED_DETAIL_TYPES = new Set<string>(['CUMULATIVE_LIMIT_USAGE', 'LIMIT_USAGE_FOR_NS', 'CUMULATIVE_PROFILING', 'CUMULATIVE_PROFILING_BEGIN']);
// Event types treated as user-debug (for the Debug Only filter).
const DEBUG_VALUE_TYPES = new Set<string>(['USER_DEBUG', 'DATAWEAVE_USER_DEBUG', 'USER_DEBUG_FINER', 'USER_DEBUG_FINEST', 'USER_DEBUG_FINE', 'USER_DEBUG_DEBUG', 'USER_DEBUG_INFO', 'USER_DEBUG_WARN', 'USER_DEBUG_ERROR']);

const ns = (n: string) => n || 'default';
const ms = (n: number) => (n / 1_000_000).toFixed(2);
const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctStr = (part: number, whole: number) => `(${pctOf(part, whole).toFixed(2)}%)`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style?: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (text != null) node.textContent = text;
  return node;
}

// ── Public entry ──────────────────────────────────────────────────────────
export function renderLogAnalyzerInto(host: HTMLElement, logText: string, opts: AnalyzerOptions): void {
  const C = makePalette(opts.isDark);
  host.innerHTML = '';

  let apexLog: ApexLog;
  try {
    apexLog = parse(logText);
  } catch (e) {
    const err = el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'Failed to parse log: ' + (e as Error).message);
    host.appendChild(err);
    return;
  }

  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  root.appendChild(buildHeader(apexLog, C, opts));

  // Tab bar
  const tabBar = el('div', { display: 'flex', gap: '4px', padding: '0 14px', borderBottom: `1px solid ${C.divider}`, flexShrink: '0' });
  root.appendChild(tabBar);

  const content = el('div', { flex: '1', minHeight: '0', overflow: 'auto', position: 'relative' });
  root.appendChild(content);

  let tabCleanup: (() => void) | null = null;
  const tabs: { id: string; label: string; icon: string; render: () => void }[] = [
    { id: 'timeline', label: 'Timeline', icon: '📊', render: () => { tabCleanup = renderTimeline(content, apexLog, C, opts.isDark, () => select('calltree')); } },
    { id: 'calltree', label: 'Call Tree', icon: '☰', render: () => renderCallTree(content, apexLog, C) },
    { id: 'analysis', label: 'Analysis', icon: '</>', render: () => renderAnalysis(content, apexLog, C) },
    { id: 'database', label: 'Database', icon: '🗄', render: () => renderDatabase(content, apexLog, C) },
    { id: 'insights', label: 'Insights', icon: '💡', render: () => renderInsights(content, logText, C) },
    { id: 'rawlog', label: 'Raw Log', icon: '📄', render: () => renderRawLog(content, logText, C) },
  ];
  let active = 'timeline';
  const tabBtns = new Map<string, HTMLButtonElement>();
  const paint = () => {
    tabBtns.forEach((b, id) => {
      const on = id === active;
      Object.assign(b.style, {
        color: on ? C.text : C.muted,
        borderBottom: on ? `2px solid ${C.accent}` : '2px solid transparent',
        fontWeight: on ? '700' : '500',
      });
    });
  };
  const select = (id: string) => {
    active = id;
    paint();
    if (tabCleanup) { tabCleanup(); tabCleanup = null; }
    const t = tabs.find((x) => x.id === id);
    content.innerHTML = '';
    t?.render();
  };
  tabs.forEach((t) => {
    const b = el('button', {
      display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none',
      padding: '12px 14px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', color: C.muted,
      borderBottom: '2px solid transparent',
    });
    b.innerHTML = `<span style="opacity:.8">${t.icon}</span> ${t.label}`;
    b.addEventListener('click', () => select(t.id));
    tabBtns.set(t.id, b);
    tabBar.appendChild(b);
  });

  select('timeline');
}

// ── Header ────────────────────────────────────────────────────────────────
function buildHeader(apexLog: ApexLog, C: Palette, opts: AnalyzerOptions): HTMLElement {
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', flexShrink: '0', borderBottom: `1px solid ${C.divider}`, flexWrap: 'wrap' });

  const back = el('button', {
    display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: `1px solid ${C.border}`,
    color: C.text, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit', flexShrink: '0',
  });
  back.innerHTML = '← Back';
  back.addEventListener('click', opts.onBack);
  head.appendChild(back);

  const title = el('div', { fontSize: '15px', fontWeight: '800', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '320px' }, opts.logName || 'Apex Log');
  head.appendChild(title);

  const sizeMb = (apexLog.size / 1_000_000).toFixed(2);
  const dur = ms(apexLog.duration.total || (apexLog.exitStamp || 0) - apexLog.timestamp);
  const meta = el('div', { fontSize: '12px', color: C.muted, display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' });
  meta.appendChild(el('span', {}, `${sizeMb} MB`));
  meta.appendChild(el('span', { color: C.faint }, '·'));
  meta.appendChild(el('span', {}, `${dur} ms`));
  head.appendChild(meta);

  if (apexLog.logIssues?.length) {
    const warn = el('span', { fontSize: '13px', color: '#f59e0b', cursor: 'help' }, '⚠');
    warn.title = apexLog.logIssues.map((i) => i.summary).join('\n');
    head.appendChild(warn);
  }

  // debug-level chips
  const chips = el('div', { display: 'flex', gap: '6px', flexWrap: 'wrap', marginLeft: 'auto' });
  (apexLog.debugLevels || []).forEach((d) => {
    const chip = el('span', {
      fontSize: '10px', fontWeight: '700', letterSpacing: '0.3px', padding: '3px 7px', borderRadius: '5px',
      background: C.chipBg, color: C.muted, whiteSpace: 'nowrap',
    });
    chip.innerHTML = `${d.logCategory.toUpperCase().replace(/ /g, '_')}: <span style="color:${C.text}">${d.logLevel}</span>`;
    chips.appendChild(chip);
  });
  head.appendChild(chips);
  return head;
}

// ── shared table helpers ───────────────────────────────────────────────────
function thStyle(C: Palette): Partial<CSSStyleDeclaration> {
  return { position: 'sticky', top: '0', textAlign: 'left', padding: '8px 12px', background: C.headerBg, color: C.text, fontWeight: '700', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`, fontSize: '12px', zIndex: '1' };
}
function tdStyle(C: Palette): Partial<CSSStyleDeclaration> {
  return { padding: '5px 12px', color: C.text, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.divider}`, fontSize: '12.5px', verticalAlign: 'top' };
}

// Display name with the reference's type-prefix rule (skip SOQL/DML which carry their own text).
function displayName(n: LogEvent): string {
  let text = n.text;
  if (n.type && n.type !== text && n.type !== 'SOQL_EXECUTE_BEGIN' && n.type !== 'DML_BEGIN') {
    text = n.type + ': ' + text;
  }
  return text + (n.suffix ?? '');
}
function timeCell(C: Palette, valueMs: string, pct: string, pctVal: number): HTMLTableCellElement {
  const td = el('td', { ...tdStyle(C), textAlign: 'right', fontVariantNumeric: 'tabular-nums' });
  const clamped = Math.max(0, Math.min(100, pctVal));
  td.style.background = `linear-gradient(90deg, ${C.bar} ${clamped}%, transparent ${clamped}%)`;
  td.innerHTML = `${valueMs} <span style="color:${C.barText};font-size:11px">${pct}</span>`;
  return td;
}
function numCell(C: Palette, v: number): HTMLTableCellElement {
  return el('td', { ...tdStyle(C), textAlign: 'right', color: v ? C.text : C.faint, fontVariantNumeric: 'tabular-nums' }, String(v));
}

// ── Call Tree ───────────────────────────────────────────────────────────────
function renderCallTree(host: HTMLElement, apexLog: ApexLog, C: Palette): void {
  const rootTotal = apexLog.duration.total || apexLog.children.reduce((a, c) => Math.max(a, c.duration.total), 0) || 1;
  let mode: 'time' | 'agg' | 'bottom' = 'time';
  let showDetails = false;
  let debugOnly = false;
  let typeFilter = 'None';
  const expanded = new Set<number>();
  const aggExpanded = new Set<number>();
  const aggFilter = emptyAggFilter();
  const debugCache = new Map<number, boolean>();
  const typeCache = new Map<number, boolean>();
  let sortField: string | null = null; // tristate column sort (null = log order)
  let sortDir: 'asc' | 'desc' = 'asc';
  // default-expand first two levels
  const seed = (node: LogEvent, depth: number) => {
    if (depth < 2 && node.children.length) {
      expanded.add(node.eventIndex);
      node.children.forEach((c) => seed(c, depth + 1));
    }
  };
  apexLog.children.forEach((c) => seed(c, 0));

  const wrap = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
  host.appendChild(wrap);

  // toolbar
  const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', flexWrap: 'wrap', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  wrap.appendChild(bar);

  const seg = el('div', { display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' });
  const segBtns: Record<string, HTMLButtonElement> = {};
  ([['time', 'Time Order'], ['agg', 'Aggregated'], ['bottom', 'Bottom-Up']] as const).forEach(([id, label]) => {
    const b = el('button', { background: 'transparent', border: 'none', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit', color: C.muted });
    b.textContent = label;
    b.addEventListener('click', () => { mode = id; paintSeg(); render(); });
    segBtns[id] = b;
    seg.appendChild(b);
  });
  const paintSeg = () => Object.entries(segBtns).forEach(([id, b]) => Object.assign(b.style, { background: mode === id ? C.accent : 'transparent', color: mode === id ? '#fff' : C.muted, fontWeight: mode === id ? '700' : '500' }));
  bar.appendChild(seg);

  const mkBtn = (label: string, onClick: () => void) => {
    const b = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit' }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  const expandBtn = mkBtn('Expand', () => { setAll(true); render(); });
  const collapseBtn = mkBtn('Collapse', () => { setAll(false); render(); });
  bar.appendChild(expandBtn);
  bar.appendChild(collapseBtn);

  const mkChk = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const w = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: C.muted, cursor: 'pointer' });
    const c = el('input'); c.type = 'checkbox'; c.checked = get(); c.style.cursor = 'pointer';
    c.addEventListener('change', () => { set(c.checked); render(); });
    w.appendChild(c); w.appendChild(document.createTextNode(label));
    return w;
  };
  bar.appendChild(mkChk('Details', () => showDetails, (v) => (showDetails = v)));
  bar.appendChild(mkChk('Debug Only', () => debugOnly, (v) => (debugOnly = v)));

  const typeWrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: C.muted });
  typeWrap.appendChild(document.createTextNode('Type:'));
  const sel = el('select', { background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '12.5px', fontFamily: 'inherit' });
  const allTypes = new Set<string>();
  const collectTypes = (n: LogEvent) => { if (n.type) allTypes.add(n.type); n.children.forEach(collectTypes); };
  apexLog.children.forEach(collectTypes);
  ['None', ...Array.from(allTypes).sort()].forEach((t) => {
    const o = el('option'); o.value = t; o.textContent = t; sel.appendChild(o);
  });
  sel.addEventListener('change', () => { typeFilter = sel.value; render(); });
  typeWrap.appendChild(sel);
  bar.appendChild(typeWrap);

  const setAll = (on: boolean) => {
    if (mode === 'time') {
      expanded.clear();
      if (on) {
        const walk = (n: LogEvent) => { if (n.children.length) { expanded.add(n.eventIndex); n.children.forEach(walk); } };
        apexLog.children.forEach(walk);
      }
    } else {
      aggExpanded.clear();
      if (on) {
        const rows = mode === 'bottom' ? toBottomUpTree(apexLog.children) : toAggregatedCallTree(apexLog.children);
        const walk = (r: AggLike) => { const k = r._children; if (k && k.length) { aggExpanded.add(r.id); k.forEach(walk); } };
        rows.forEach(walk);
      }
    }
  };

  // scroll container
  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto' });
  wrap.appendChild(scroll);

  // Precompute _hasDetailsDeep (self-or-descendant is a "detail") — matches the reference.
  const detailsDeep = new Map<number, boolean>();
  const computeDetails = (n: LogEvent): boolean => {
    const selfIsDetail = n.isParent || n.duration.total > 0 || n.discontinuity || (!!n.type && EXCLUDED_DETAIL_TYPES.has(n.type));
    let deep = selfIsDetail;
    for (const c of n.children) if (computeDetails(c)) deep = true;
    detailsDeep.set(n.eventIndex, deep);
    return deep;
  };
  apexLog.children.forEach(computeDetails);

  // deep predicate with per-render memo: true if node or any descendant matches.
  const deepMatch = (n: LogEvent, pred: (e: LogEvent) => boolean, cache: Map<number, boolean>): boolean => {
    const hit = cache.get(n.eventIndex);
    if (hit !== undefined) return hit;
    let m = pred(n);
    for (const c of n.children) if (deepMatch(c, pred, cache)) m = true;
    cache.set(n.eventIndex, m);
    return m;
  };

  const isVisibleRow = (n: LogEvent) => {
    if (debugOnly) return deepMatch(n, (e) => !!e.type && DEBUG_VALUE_TYPES.has(e.type), debugCache);
    if (typeFilter !== 'None' && !deepMatch(n, (e) => e.type === typeFilter, typeCache)) return false;
    if (!showDetails && !detailsDeep.get(n.eventIndex)) return false;
    return true;
  };

  const render = () => {
    paintSeg();
    debugCache.clear();
    typeCache.clear();
    scroll.innerHTML = '';
    if (mode === 'time') scroll.appendChild(buildTimeOrder());
    else scroll.appendChild(buildAggregated(mode === 'bottom'));
  };

  // column meta: field key + value getter (used for sorting)
  const TIME_COLS: { label: string; field: string; num: boolean; get: (n: LogEvent) => number | string }[] = [
    { label: 'Name', field: 'name', num: false, get: (n) => displayName(n).toLowerCase() },
    { label: 'Namespace', field: 'namespace', num: false, get: (n) => ns(n.namespace).toLowerCase() },
    { label: 'DML Count', field: 'dml', num: true, get: (n) => n.dmlCount.total },
    { label: 'SOQL Count', field: 'soql', num: true, get: (n) => n.soqlCount.total },
    { label: 'Throws Count', field: 'throws', num: true, get: (n) => n.totalThrownCount },
    { label: 'DML Rows', field: 'dmlrows', num: true, get: (n) => n.dmlRowCount.total },
    { label: 'SOQL Rows', field: 'soqlrows', num: true, get: (n) => n.soqlRowCount.total },
    { label: 'Total Time (ms)', field: 'total', num: true, get: (n) => n.duration.total },
    { label: 'Self Time (ms)', field: 'self', num: true, get: (n) => n.duration.self },
  ];
  const sortKids = (kids: LogEvent[]): LogEvent[] => {
    if (!sortField) return kids;
    const col = TIME_COLS.find((c) => c.field === sortField);
    if (!col) return kids;
    const arr = [...kids];
    arr.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? c : -c;
    });
    return arr;
  };

  const buildTimeOrder = () => {
    const table = el('table', { borderCollapse: 'collapse', width: '100%', fontFamily: 'inherit' });
    const thead = el('thead'); const htr = el('tr');
    TIME_COLS.forEach((col, i) => {
      const th = el('th', { ...thStyle(C), textAlign: i >= 2 ? 'right' : 'left', cursor: 'pointer' });
      const active = sortField === col.field;
      th.innerHTML = `${col.label} <span style="color:${active ? C.accent : C.faint};font-size:11px">${active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>`;
      th.addEventListener('click', () => {
        // tristate: asc → desc → none
        if (sortField !== col.field) { sortField = col.field; sortDir = col.num ? 'desc' : 'asc'; }
        else if ((col.num && sortDir === 'desc') || (!col.num && sortDir === 'asc')) { sortDir = col.num ? 'asc' : 'desc'; }
        else { sortField = null; }
        render();
      });
      htr.appendChild(th);
    });
    thead.appendChild(htr); table.appendChild(thead);
    const tbody = el('tbody');

    const addRow = (n: LogEvent, depth: number) => {
      if (!isVisibleRow(n)) return;
      const tr = el('tr');
      tr.addEventListener('mouseover', () => (tr.style.background = C.hover));
      tr.addEventListener('mouseout', () => (tr.style.background = ''));

      // Name cell w/ indent + toggle + colour bar (wraps long text)
      const nameTd = el('td', { ...tdStyle(C), paddingLeft: `${8 + depth * 16}px`, whiteSpace: 'normal', maxWidth: '640px' });
      const inner = el('div', { display: 'flex', alignItems: 'flex-start', gap: '6px' });
      const hasKids = n.children.length > 0;
      const toggle = el('span', { width: '12px', cursor: hasKids ? 'pointer' : 'default', color: C.muted, fontSize: '10px', flexShrink: '0', userSelect: 'none', marginTop: '2px' }, hasKids ? (expanded.has(n.eventIndex) ? '▼' : '▶') : '');
      if (hasKids) toggle.addEventListener('click', (e) => { e.stopPropagation(); if (expanded.has(n.eventIndex)) expanded.delete(n.eventIndex); else expanded.add(n.eventIndex); render(); });
      const bar2 = el('span', { width: '3px', height: '13px', borderRadius: '2px', background: catColor(n.category), flexShrink: '0', opacity: n.category ? '1' : '0.25', marginTop: '2px' });
      const label = el('span', { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.45' }, displayName(n));
      inner.appendChild(toggle); inner.appendChild(bar2); inner.appendChild(label);
      nameTd.appendChild(inner);
      tr.appendChild(nameTd);

      tr.appendChild(el('td', { ...tdStyle(C), color: C.muted }, ns(n.namespace)));
      tr.appendChild(numCell(C, n.dmlCount.total));
      tr.appendChild(numCell(C, n.soqlCount.total));
      tr.appendChild(numCell(C, n.totalThrownCount));
      tr.appendChild(numCell(C, n.dmlRowCount.total));
      tr.appendChild(numCell(C, n.soqlRowCount.total));
      tr.appendChild(timeCell(C, ms(n.duration.total), pctStr(n.duration.total, rootTotal), pctOf(n.duration.total, rootTotal)));
      tr.appendChild(timeCell(C, ms(n.duration.self), pctStr(n.duration.self, rootTotal), pctOf(n.duration.self, rootTotal)));
      tbody.appendChild(tr);

      if (hasKids && expanded.has(n.eventIndex)) sortKids(n.children).forEach((c) => addRow(c, depth + 1));
    };
    sortKids(apexLog.children).forEach((c) => addRow(c, 0));
    table.appendChild(tbody);
    return table;
  };

  const buildAggregated = (bottomUp: boolean) => {
    const rows = bottomUp ? toBottomUpTree(apexLog.children) : toAggregatedCallTree(apexLog.children);
    return aggTreeTable(C, rows, rootTotal, aggExpanded, showDetails, render, aggFilter);
  };

  render();
}

// ── Aggregated / Bottom-Up tree table (shared by Call Tree & Analysis) ───────
type AggLike = AggregatedRow | BottomUpRow;
export interface AggFilter { ns: string; totalMin: number | null; totalMax: number | null; selfMin: number | null; selfMax: number | null; }
export function emptyAggFilter(): AggFilter { return { ns: '', totalMin: null, totalMax: null, selfMin: null, selfMax: null }; }

function aggTreeTable(
  C: Palette,
  rows: AggLike[],
  rootTotal: number,
  expanded: Set<number>,
  showDetails: boolean,
  rerender: () => void,
  filter: AggFilter = emptyAggFilter(),
): HTMLTableElement {
  const table = el('table', { borderCollapse: 'collapse', width: '100%', fontFamily: 'inherit' });
  const cols = ['Name', 'Namespace', 'Type', 'Count', 'Total Time (ms)', 'Self Time (ms)'];
  const thead = el('thead'); const htr = el('tr');

  const numInput = (val: number | null, ph: string, on: (v: number | null) => void) => {
    const i = el('input', { width: '46px', padding: '2px 4px', fontSize: '11px', borderRadius: '4px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', marginTop: '4px' }) as HTMLInputElement;
    i.type = 'number'; i.placeholder = ph; if (val != null) i.value = String(val);
    i.addEventListener('change', () => { const v = i.value.trim(); on(v === '' ? null : Number(v)); rerender(); });
    i.addEventListener('click', (e) => e.stopPropagation());
    return i;
  };
  cols.forEach((label, i) => {
    const th = el('th', { ...thStyle(C), textAlign: i >= 3 ? 'right' : 'left' });
    th.appendChild(el('div', {}, label));
    if (label === 'Namespace') {
      const inp = el('input', { width: '90px', padding: '2px 6px', fontSize: '11px', borderRadius: '4px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', marginTop: '4px' }) as HTMLInputElement;
      inp.placeholder = 'filter'; inp.value = filter.ns;
      inp.addEventListener('change', () => { filter.ns = inp.value.trim(); rerender(); });
      th.appendChild(inp);
    } else if (label.startsWith('Total Time') || label.startsWith('Self Time')) {
      const isTotal = label.startsWith('Total Time');
      const box = el('div', { display: 'flex', gap: '4px', justifyContent: 'flex-end' });
      box.appendChild(numInput(isTotal ? filter.totalMin : filter.selfMin, 'Min', (v) => (isTotal ? (filter.totalMin = v) : (filter.selfMin = v))));
      box.appendChild(numInput(isTotal ? filter.totalMax : filter.selfMax, 'Max', (v) => (isTotal ? (filter.totalMax = v) : (filter.selfMax = v))));
      th.appendChild(box);
    }
    htr.appendChild(th);
  });
  thead.appendChild(htr); table.appendChild(thead);
  const tbody = el('tbody');

  // range/namespace predicate (deep: keep a row if it or any descendant matches)
  const inRange = (r: AggLike): boolean => {
    const tt = r.totalTime / 1e6, st = r.totalSelfTime / 1e6;
    if (filter.ns && !ns(r.namespace).toLowerCase().includes(filter.ns.toLowerCase())) return false;
    if (filter.totalMin != null && tt < filter.totalMin) return false;
    if (filter.totalMax != null && tt > filter.totalMax) return false;
    if (filter.selfMin != null && st < filter.selfMin) return false;
    if (filter.selfMax != null && st > filter.selfMax) return false;
    return true;
  };
  const hasFilter = !!(filter.ns || filter.totalMin != null || filter.totalMax != null || filter.selfMin != null || filter.selfMax != null);
  const deepPass = (r: AggLike): boolean => inRange(r) || (r._children ?? []).some(deepPass);

  const addRow = (r: AggLike, depth: number) => {
    if (!showDetails && !r._hasDetailsDeep) return;
    if (hasFilter && !deepPass(r)) return;
    const od = r.originalData;
    const tr = el('tr');
    tr.addEventListener('mouseover', () => (tr.style.background = C.hover));
    tr.addEventListener('mouseout', () => (tr.style.background = ''));

    const nameTd = el('td', { ...tdStyle(C), paddingLeft: `${8 + depth * 16}px`, whiteSpace: 'normal', maxWidth: '620px' });
    const inner = el('div', { display: 'flex', alignItems: 'flex-start', gap: '6px' });
    const kids = r._children ?? null;
    const hasKids = !!(kids && kids.length);
    const open = expanded.has(r.id);
    const toggle = el('span', { width: '12px', cursor: hasKids ? 'pointer' : 'default', color: C.muted, fontSize: '10px', flexShrink: '0', userSelect: 'none', marginTop: '2px' }, hasKids ? (open ? '▼' : '▶') : '');
    if (hasKids) toggle.addEventListener('click', (e) => { e.stopPropagation(); if (open) expanded.delete(r.id); else expanded.add(r.id); rerender(); });
    const bar = el('span', { width: '3px', height: '13px', borderRadius: '2px', background: catColor(od?.category || ''), flexShrink: '0', opacity: od?.category ? '1' : '0.25', marginTop: '2px' });
    const label = el('span', { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.45' }, od ? displayName(od) : r.text);
    inner.appendChild(toggle); inner.appendChild(bar); inner.appendChild(label);
    nameTd.appendChild(inner);
    tr.appendChild(nameTd);

    tr.appendChild(el('td', { ...tdStyle(C), color: C.muted }, ns(r.namespace)));
    const type = ('type' in r ? r.type : od?.type) || '';
    tr.appendChild(el('td', { ...tdStyle(C), color: C.faint, fontSize: '11px' }, type));
    tr.appendChild(numCell(C, r.callCount));
    tr.appendChild(timeCell(C, ms(r.totalTime), pctStr(r.totalTime, rootTotal), pctOf(r.totalTime, rootTotal)));
    tr.appendChild(timeCell(C, ms(r.totalSelfTime), pctStr(r.totalSelfTime, rootTotal), pctOf(r.totalSelfTime, rootTotal)));
    tbody.appendChild(tr);

    if (hasKids && open) kids!.forEach((c) => addRow(c, depth + 1));
  };
  rows.forEach((r) => addRow(r, 0));
  table.appendChild(tbody);
  return table;
}

// ── Analysis (bottom-up aggregated tree) ─────────────────────────────────────
function renderAnalysis(host: HTMLElement, apexLog: ApexLog, C: Palette): void {
  const rootTotal = apexLog.duration.total || 1;
  const baseRows = toBottomUpTree(apexLog.children);
  let groupBy: 'none' | 'namespace' | 'type' = 'none';
  let showDetails = false;
  const expanded = new Set<number>();
  const filter = emptyAggFilter();

  const wrap = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
  host.appendChild(wrap);

  // toolbar
  const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', flexWrap: 'wrap', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  wrap.appendChild(bar);
  const mkBtn = (label: string, onClick: () => void) => {
    const b = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit' }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  const groupWrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: C.muted });
  groupWrap.appendChild(document.createTextNode('Group by:'));
  const gsel = el('select', { background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '12.5px', fontFamily: 'inherit' });
  [['none', 'None'], ['namespace', 'Namespace'], ['type', 'Type']].forEach(([v, l]) => { const o = el('option'); o.value = v; o.textContent = l; gsel.appendChild(o); });
  gsel.addEventListener('change', () => { groupBy = gsel.value as typeof groupBy; render(); });
  groupWrap.appendChild(gsel);
  bar.appendChild(groupWrap);
  bar.appendChild(mkBtn('Expand', () => { setAll(true); render(); }));
  bar.appendChild(mkBtn('Collapse', () => { expanded.clear(); render(); }));
  const detLbl = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: C.muted, cursor: 'pointer' });
  const detChk = el('input'); detChk.type = 'checkbox'; detChk.style.cursor = 'pointer';
  detChk.addEventListener('change', () => { showDetails = detChk.checked; render(); });
  detLbl.appendChild(detChk); detLbl.appendChild(document.createTextNode('Details'));
  bar.appendChild(detLbl);
  const summary = el('span', { marginLeft: 'auto', fontSize: '12px', color: C.muted }, `${baseRows.length} top-level entries`);
  bar.appendChild(summary);

  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto' });
  wrap.appendChild(scroll);

  // Build (optionally grouped) row set. Grouping wraps top rows under synthetic parents.
  let synthId = -1;
  const buildRows = (): AggLike[] => {
    if (groupBy === 'none') return baseRows;
    const groups = new Map<string, AggLike[]>();
    for (const r of baseRows) {
      const key = groupBy === 'namespace' ? ns(r.namespace) : (('type' in r ? r.type : '') || '—');
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    const out: AggLike[] = [];
    for (const [key, rows] of groups) {
      const totalTime = rows.reduce((a, r) => a + r.totalTime, 0);
      const totalSelfTime = rows.reduce((a, r) => a + r.totalSelfTime, 0);
      const callCount = rows.reduce((a, r) => a + r.callCount, 0);
      out.push({ id: synthId--, text: key, namespace: groupBy === 'namespace' ? key : '', type: groupBy === 'type' ? key : '', callCount, totalTime, totalSelfTime, _children: rows, _hasDetailsDeep: true, originalData: undefined } as unknown as AggLike);
    }
    return out.sort((a, b) => b.totalSelfTime - a.totalSelfTime);
  };
  const setAll = (on: boolean) => {
    expanded.clear();
    if (!on) return;
    const walk = (r: AggLike) => { const k = r._children; if (k && k.length) { expanded.add(r.id); k.forEach(walk); } };
    buildRows().forEach(walk);
  };

  const render = () => {
    scroll.innerHTML = '';
    scroll.appendChild(aggTreeTable(C, buildRows(), rootTotal, expanded, showDetails, render, filter));
  };
  render();
}

// ── Database ──────────────────────────────────────────────────────────────
function collect<T extends LogEvent>(node: LogEvent, pred: (n: LogEvent) => boolean): T[] {
  const out: T[] = [];
  const walk = (n: LogEvent) => {
    for (const c of n.children) {
      if (pred(c)) out.push(c as T);
      if (c.isParent) walk(c);
    }
  };
  walk(node);
  return out;
}

function renderDatabase(host: HTMLElement, apexLog: ApexLog, C: Palette): void {
  const soql = collect<SOQLExecuteBeginLine>(apexLog, (n) => n instanceof SOQLExecuteBeginLine);
  const dml = collect<DMLBeginLine>(apexLog, (n) => n instanceof DMLBeginLine);

  const scroll = el('div', { height: '100%', overflow: 'auto', padding: '4px 0' });
  host.appendChild(scroll);

  // SOQL section
  const soqlRows = soql.reduce((a, s) => a + s.soqlRowCount.self, 0);
  scroll.appendChild(sectionTitle(C, `SOQL`, `${soql.length} queries · ${soqlRows} rows`));
  const soqlTable = el('table', { borderCollapse: 'collapse', width: '100%' });
  const sCols = ['SOQL', 'Selective', 'Namespace', 'Row Count', 'Time Taken (ms)', 'Aggregations'];
  const sHead = el('thead'); const sTr = el('tr');
  sCols.forEach((c, i) => sTr.appendChild(el('th', { ...thStyle(C), textAlign: i >= 3 ? 'right' : 'left' }, c)));
  sHead.appendChild(sTr); soqlTable.appendChild(sHead);
  const sBody = el('tbody');
  [...soql].sort((a, b) => b.duration.total - a.duration.total).forEach((s) => {
    const explain = s.children[0] as { relativeCost?: number | null } | undefined;
    const selective = explain?.relativeCost != null ? explain.relativeCost <= 1 : null;
    const tr = el('tr');
    tr.addEventListener('mouseover', () => (tr.style.background = C.hover));
    tr.addEventListener('mouseout', () => (tr.style.background = ''));
    tr.appendChild(el('td', { ...tdStyle(C), maxWidth: '620px', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace', fontSize: '12px' }, s.text));
    const selTd = el('td', { ...tdStyle(C), textAlign: 'left' });
    selTd.innerHTML = selective == null ? `<span style="color:${C.faint}">—</span>` : selective ? '<span style="color:#22c55e">✓</span>' : '<span style="color:#ef4444">✕</span>';
    if (explain?.relativeCost != null) selTd.title = `Relative cost: ${explain.relativeCost}`;
    tr.appendChild(selTd);
    tr.appendChild(el('td', { ...tdStyle(C), color: C.muted }, ns(s.namespace)));
    tr.appendChild(numCell(C, s.soqlRowCount.self));
    tr.appendChild(el('td', { ...tdStyle(C), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, ms(s.duration.total)));
    tr.appendChild(numCell(C, s.aggregations));
    sBody.appendChild(tr);
  });
  if (!soql.length) sBody.appendChild(emptyRow(C, sCols.length, 'No SOQL queries in this log.'));
  soqlTable.appendChild(sBody);
  scroll.appendChild(soqlTable);

  // DML section
  const dmlRows = dml.reduce((a, d) => a + d.dmlRowCount.self, 0);
  scroll.appendChild(sectionTitle(C, `DML`, `${dml.length} operations · ${dmlRows} rows`));
  const dmlTable = el('table', { borderCollapse: 'collapse', width: '100%' });
  const dCols = ['DML', 'Namespace', 'Row Count', 'Time Taken (ms)'];
  const dHead = el('thead'); const dTr = el('tr');
  dCols.forEach((c, i) => dTr.appendChild(el('th', { ...thStyle(C), textAlign: i >= 2 ? 'right' : 'left' }, c)));
  dHead.appendChild(dTr); dmlTable.appendChild(dHead);
  const dBody = el('tbody');
  [...dml].sort((a, b) => b.duration.total - a.duration.total).forEach((d) => {
    const tr = el('tr');
    tr.addEventListener('mouseover', () => (tr.style.background = C.hover));
    tr.addEventListener('mouseout', () => (tr.style.background = ''));
    tr.appendChild(el('td', { ...tdStyle(C), maxWidth: '620px', overflow: 'hidden', textOverflow: 'ellipsis' }, d.text));
    tr.appendChild(el('td', { ...tdStyle(C), color: C.muted }, ns(d.namespace)));
    tr.appendChild(numCell(C, d.dmlRowCount.self));
    tr.appendChild(el('td', { ...tdStyle(C), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, ms(d.duration.total)));
    dBody.appendChild(tr);
  });
  if (!dml.length) dBody.appendChild(emptyRow(C, dCols.length, 'No DML operations in this log.'));
  dmlTable.appendChild(dBody);
  scroll.appendChild(dmlTable);
}

function sectionTitle(C: Palette, title: string, sub: string): HTMLElement {
  const d = el('div', { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '14px 14px 8px' });
  d.appendChild(el('span', { fontSize: '14px', fontWeight: '800' }, title));
  d.appendChild(el('span', { fontSize: '12px', color: C.muted }, sub));
  return d;
}
function emptyRow(C: Palette, span: number, text: string): HTMLTableRowElement {
  const tr = el('tr'); const td = el('td', { ...tdStyle(C), color: C.muted, textAlign: 'center', padding: '18px' }, text);
  td.colSpan = span; tr.appendChild(td); return tr;
}

// ── Insights (cloned from the old DetailView Insights tab) ───────────────────
function renderInsights(host: HTMLElement, logText: string, C: Palette): void {
  const scroll = el('div', { height: '100%', overflow: 'auto', padding: '16px' });
  host.appendChild(scroll);
  const loading = el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'Analyzing log…');
  scroll.appendChild(loading);

  new LogAnalyzer({} as never).analyzeLog(logText).then(({ insights, metrics }) => {
    scroll.innerHTML = '';
    scroll.appendChild(buildInsights(insights, metrics, C));
  }).catch((e: Error) => {
    scroll.innerHTML = '';
    scroll.appendChild(el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'Could not analyze log: ' + e.message));
  });
}

function fmtDur(ns: number): string {
  if (!ns) return '0 ms';
  const m = ns / 1e6;
  return m < 1000 ? `${m.toFixed(m < 10 ? 2 : 1)} ms` : `${(m / 1000).toFixed(2)} s`;
}

function buildInsights(insights: PerformanceInsight[], metrics: LogMetrics, C: Palette): HTMLElement {
  const wrap = el('div', { display: 'flex', flexDirection: 'column', gap: '24px' });

  // Governor limit cards
  const limSection = el('div');
  limSection.appendChild(el('div', { fontSize: '15px', fontWeight: '800', marginBottom: '12px', color: C.text }, 'Governor Limits'));
  const grid = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' });
  const limitCard = (label: string, lim: { used: number; total: number; percentage: number } | undefined, fmt: (v: number) => string) => {
    if (!lim) return;
    const pct = Math.min(lim.percentage, 100);
    const color = lim.percentage > 80 ? '#ef4444' : lim.percentage > 50 ? '#f59e0b' : '#22c55e';
    const card = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px', background: C.panel });
    card.appendChild(el('div', { fontSize: '10px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: '6px' }, label));
    card.appendChild(el('div', { fontSize: '22px', fontWeight: '800', color: C.text }, fmt(lim.used)));
    const meta = el('div', { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: C.muted, margin: '8px 0 4px' });
    meta.appendChild(el('span', { color }, `${lim.percentage.toFixed(0)}%`));
    meta.appendChild(el('span', {}, `${fmt(lim.total)} limit`));
    card.appendChild(meta);
    const track = el('div', { width: '100%', height: '8px', borderRadius: '999px', background: C.zebra, overflow: 'hidden' });
    track.appendChild(el('div', { width: `${pct}%`, height: '8px', borderRadius: '999px', background: color }));
    card.appendChild(track);
    grid.appendChild(card);
  };
  limitCard('CPU Time', metrics.cpuTime, (v) => `${(v / 1000).toFixed(0)} ms`);
  limitCard('Heap Size', metrics.heapSize, (v) => `${(v / 1024).toFixed(0)} KB`);
  limitCard('SOQL Queries', metrics.soqlQueries, (v) => String(v));
  limitCard('Query Rows', metrics.queryRows, (v) => String(v));
  limitCard('DML Statements', metrics.dmlStatements, (v) => String(v));
  limitCard('DML Rows', metrics.dmlRows, (v) => String(v));
  if (metrics.slowestSoql) {
    const card = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px', background: C.panel, gridColumn: 'span 2' });
    card.appendChild(el('div', { fontSize: '10px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: '6px' }, 'Slowest SOQL'));
    card.appendChild(el('div', { fontSize: '20px', fontWeight: '800', color: '#fb923c' }, fmtDur(metrics.slowestSoql.duration)));
    card.appendChild(el('div', { fontSize: '11px', color: C.muted, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }, metrics.slowestSoql.query));
    grid.appendChild(card);
  }
  if (metrics.slowestMethod) {
    const card = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px', background: C.panel });
    card.appendChild(el('div', { fontSize: '10px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: '6px' }, 'Slowest Method'));
    card.appendChild(el('div', { fontSize: '20px', fontWeight: '800', color: '#c084fc' }, fmtDur(metrics.slowestMethod.duration)));
    card.appendChild(el('div', { fontSize: '11px', color: C.muted, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, metrics.slowestMethod.name));
    grid.appendChild(card);
  }
  if (!grid.children.length) grid.appendChild(el('div', { color: C.muted, fontSize: '13px' }, 'No governor-limit data captured in this log.'));
  limSection.appendChild(grid);
  wrap.appendChild(limSection);

  // Insights & recommendations
  const insSection = el('div');
  insSection.appendChild(el('div', { fontSize: '15px', fontWeight: '800', marginBottom: '12px', color: C.text }, 'Insights & Recommendations'));
  const tint: Record<string, { bg: string; border: string; icon: string; col: string }> = {
    error: { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.35)', icon: '⛔', col: '#ef4444' },
    warning: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: '⚠️', col: '#f59e0b' },
    success: { bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.35)', icon: '✅', col: '#22c55e' },
    info: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.35)', icon: 'ℹ️', col: '#3b82f6' },
  };
  const sevBg: Record<string, string> = { high: '#dc2626', medium: '#d97706', low: '#9ca3af' };
  const list = el('div', { display: 'flex', flexDirection: 'column', gap: '10px' });
  insights.forEach((ins) => {
    const t = tint[ins.type] || tint.info;
    const card = el('div', { display: 'flex', gap: '10px', alignItems: 'flex-start', border: `1px solid ${t.border}`, background: t.bg, borderRadius: '12px', padding: '14px' });
    card.appendChild(el('span', { fontSize: '16px', lineHeight: '1.2' }, t.icon));
    const body = el('div', { flex: '1', minWidth: '0' });
    const headRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' });
    headRow.appendChild(el('span', { fontSize: '13px', fontWeight: '800', color: C.text }, ins.title));
    headRow.appendChild(el('span', { fontSize: '9px', fontWeight: '800', textTransform: 'uppercase', color: '#fff', background: sevBg[ins.severity] || '#9ca3af', padding: '2px 7px', borderRadius: '999px' }, ins.severity));
    body.appendChild(headRow);
    body.appendChild(el('div', { fontSize: '12px', color: C.muted, lineHeight: '1.5' }, ins.description));
    card.appendChild(body);
    list.appendChild(card);
  });
  if (!insights.length) list.appendChild(el('div', { color: C.muted, fontSize: '13px' }, 'No issues detected.'));
  insSection.appendChild(list);
  wrap.appendChild(insSection);
  return wrap;
}

// ── Raw Log ──────────────────────────────────────────────────────────────────
function renderRawLog(host: HTMLElement, logText: string, C: Palette): void {
  const wrap = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
  host.appendChild(wrap);

  const lines = logText.split('\n');
  const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  wrap.appendChild(bar);

  const search = el('input', { flex: '1', maxWidth: '320px', padding: '6px 10px', fontSize: '12.5px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
  search.placeholder = 'Filter lines…';
  bar.appendChild(search);
  const count = el('span', { fontSize: '12px', color: C.muted }, `${lines.length.toLocaleString()} lines`);
  bar.appendChild(count);

  const mkBtn = (label: string, onClick: () => void) => {
    const b = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  const copyBtn = mkBtn('Copy', () => navigator.clipboard?.writeText(logText).then(() => { copyBtn.textContent = 'Copied'; setTimeout(() => (copyBtn.textContent = 'Copy'), 1200); }).catch(() => {}));
  const dlBtn = mkBtn('Download', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([logText], { type: 'text/plain' })); a.download = 'apex.log'; document.body.appendChild(a); a.click(); a.remove(); });
  const right = el('div', { marginLeft: 'auto', display: 'flex', gap: '8px' });
  right.appendChild(copyBtn); right.appendChild(dlBtn);
  bar.appendChild(right);

  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '8px 0' });
  wrap.appendChild(scroll);
  const pre = el('pre', { margin: '0', padding: '0 14px', fontFamily: 'Fira Code, Menlo, Consolas, monospace', fontSize: '12px', lineHeight: '1.5', color: C.text, whiteSpace: 'pre', tabSize: '4' as unknown as string });
  scroll.appendChild(pre);

  const renderText = (q: string) => {
    if (!q) { pre.textContent = logText; count.textContent = `${lines.length.toLocaleString()} lines`; return; }
    const lower = q.toLowerCase();
    const matched = lines.filter((l) => l.toLowerCase().includes(lower));
    pre.textContent = matched.join('\n');
    count.textContent = `${matched.length.toLocaleString()} / ${lines.length.toLocaleString()} lines`;
  };
  renderText('');
  let t: number | undefined;
  search.addEventListener('input', () => { window.clearTimeout(t); t = window.setTimeout(() => renderText(search.value.trim()), 120); });
}

// ── Timeline (canvas flame chart) ────────────────────────────────────────────
function renderTimeline(host: HTMLElement, apexLog: ApexLog, C: Palette, isDark: boolean, onSelect: () => void): () => void {
  const wrap = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
  host.appendChild(wrap);

  const canvasHost = el('div', { flex: '1', minHeight: '0', position: 'relative' });
  wrap.appendChild(canvasHost);

  // legend strip
  const legend = el('div', { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 14px', flexShrink: '0', borderTop: `1px solid ${C.divider}` });
  (['Apex', 'Code Unit', 'System', 'Automation', 'DML', 'SOQL', 'Callout'] as const).forEach((cat) => {
    const chip = el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontWeight: '700', color: '#1f2937', background: catColor(cat), padding: '3px 9px', borderRadius: '5px' });
    chip.textContent = cat;
    legend.appendChild(chip);
  });
  const hint = el('span', { marginLeft: 'auto', fontSize: '11px', color: C.muted, alignSelf: 'center' }, 'Scroll to zoom · drag to pan · click to jump to Call Tree');
  legend.appendChild(hint);
  wrap.appendChild(legend);

  let cleanup = () => {};
  // defer one frame so the flex layout has a measured size before canvas init
  requestAnimationFrame(() => {
    cleanup = initTimeline(canvasHost, apexLog, { colors: CATEGORY_COLORS, isDark, onSelect });
  });
  return () => cleanup();
}
