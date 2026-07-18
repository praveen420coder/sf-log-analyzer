// API Activity console — a collapsible footer panel that shows, live, every
// Salesforce API call the extension makes (queries, Apex, REST, session
// lookups) for transparency, plus this-session call counts by type. The
// background service worker is the source of truth; we subscribe over a runtime
// port and render what it streams. See lib/apiLog.ts for the shared shapes.

import type { ApiLogEntry, ApiKind } from '../lib/apiLog';

// Inlined runtime constants (see lib/apiLog.ts — kept out of a shared module so
// the content-script bundle stays self-contained with no Rollup chunks).
const API_LOG_PORT = 'api-log';
const API_KINDS: ApiKind[] = ['query', 'apex', 'rest', 'session', 'other'];
const emptyCounts = (): Record<ApiKind, number> => ({ query: 0, apex: 0, rest: 0, session: 0, other: 0 });
const KIND_META: Record<ApiKind, { label: string; color: string }> = {
  query:   { label: 'Query',   color: '#3b82f6' },
  apex:    { label: 'Apex',    color: '#8b5cf6' },
  rest:    { label: 'REST',    color: '#0ea5e9' },
  session: { label: 'Session', color: '#f59e0b' },
  other:   { label: 'Other',   color: '#64748b' },
};

export interface ApiConsoleDeps { isDark: boolean; }
export interface ApiConsoleHandle { destroy: () => void; }

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtTime = (ts: number) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const fmtDur = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

export function renderApiConsoleInto(host: HTMLElement, deps: ApiConsoleDeps): ApiConsoleHandle {
  const isDark = deps.isDark;
  const C = {
    bar: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    body: isDark ? 'rgba(2,6,23,0.35)' : 'rgba(0,0,0,0.02)',
    border: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(31,41,55,0.1)',
    divider: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(31,41,55,0.07)',
    text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? 'rgba(203,213,225,0.65)' : 'rgba(31,41,55,0.55)',
    faint: isDark ? 'rgba(148,163,184,0.5)' : 'rgba(31,41,55,0.4)',
    rowHover: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    chipBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    pass: '#22c55e',
    fail: '#ef4444',
  };

  host.innerHTML = '';
  let destroyed = false;
  let expanded = false;
  let entries: ApiLogEntry[] = [];
  let counts: Record<ApiKind, number> = emptyCounts();
  let total = 0;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    if (style) Object.assign(n.style, style);
    if (text != null) n.textContent = text;
    return n;
  };

  const wrap = el('div', { borderTop: `1px solid ${C.border}`, background: C.bar, fontFamily: 'inherit' });
  host.appendChild(wrap);

  // ── header bar (always visible, click to expand) ──
  const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px', cursor: 'pointer', userSelect: 'none' });
  wrap.appendChild(bar);

  const chevron = el('span', { fontSize: '10px', color: C.muted, transition: 'transform .15s', width: '10px', display: 'inline-block' }, '▶');
  const title = el('span', { fontSize: '12.5px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap' }, '⚡ API Activity');
  const totalBadge = el('span', { fontSize: '11px', fontWeight: '700', color: C.text, background: C.chipBg, borderRadius: '999px', padding: '1px 8px' }, '0');
  bar.appendChild(chevron);
  bar.appendChild(title);
  bar.appendChild(totalBadge);

  // per-kind count chips
  const chipEls: Partial<Record<ApiKind, { chip: HTMLElement; count: HTMLElement }>> = {};
  const chipsWrap = el('div', { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginLeft: '4px' });
  API_KINDS.forEach((k) => {
    const meta = KIND_META[k];
    const chip = el('span', { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '600', color: C.muted, background: C.chipBg, borderRadius: '6px', padding: '2px 7px', opacity: '0.5' });
    const dot = el('span', { width: '7px', height: '7px', borderRadius: '50%', background: meta.color, flexShrink: '0' });
    const lbl = el('span', {}, meta.label);
    const cnt = el('span', { fontWeight: '800', color: C.text }, '0');
    chip.appendChild(dot); chip.appendChild(lbl); chip.appendChild(cnt);
    chipsWrap.appendChild(chip);
    chipEls[k] = { chip, count: cnt };
  });
  bar.appendChild(chipsWrap);

  const spacer = el('div', { flex: '1', minWidth: '8px' });
  bar.appendChild(spacer);

  const live = el('span', { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: '700', color: C.faint });
  const liveDot = el('span', { width: '7px', height: '7px', borderRadius: '50%', background: C.faint, display: 'inline-block' });
  live.appendChild(liveDot); live.appendChild(document.createTextNode('LIVE'));
  bar.appendChild(live);

  const clearBtn = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: '6px', padding: '3px 9px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', fontFamily: 'inherit' }, 'Clear');
  clearBtn.title = 'Clear the session activity log';
  bar.appendChild(clearBtn);

  // ── body (collapsible list) ──
  const body = el('div', { maxHeight: '0', overflow: 'hidden', transition: 'max-height .18s ease', background: C.body });
  wrap.appendChild(body);

  const listScroll = el('div', { maxHeight: '240px', overflow: 'auto', padding: '4px 0' });
  body.appendChild(listScroll);

  const emptyMsg = el('div', { padding: '18px 16px', textAlign: 'center', color: C.muted, fontSize: '12px' }, 'No API calls yet. Actions you take will appear here in real time.');

  // column widths shared by rows
  const colTime: Partial<CSSStyleDeclaration> = { width: '64px', flexShrink: '0', color: C.faint, fontVariantNumeric: 'tabular-nums' };
  const colKind: Partial<CSSStyleDeclaration> = { width: '58px', flexShrink: '0' };
  const colStatus: Partial<CSSStyleDeclaration> = { width: '46px', flexShrink: '0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const colDur: Partial<CSSStyleDeclaration> = { width: '54px', flexShrink: '0', textAlign: 'right', color: C.faint, fontVariantNumeric: 'tabular-nums' };

  const buildRow = (e: ApiLogEntry): HTMLElement => {
    const meta = KIND_META[e.kind];
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 16px', fontSize: '11.5px', color: C.text, borderBottom: `1px solid ${C.divider}` });
    row.addEventListener('mouseover', () => { row.style.background = C.rowHover; });
    row.addEventListener('mouseout', () => { row.style.background = ''; });

    row.appendChild(el('span', colTime, fmtTime(e.ts)));

    const kindBadge = el('span', { ...colKind, display: 'inline-flex', alignItems: 'center', gap: '5px' });
    kindBadge.appendChild(el('span', { width: '7px', height: '7px', borderRadius: '50%', background: meta.color, flexShrink: '0' }));
    kindBadge.appendChild(el('span', { color: C.muted, fontWeight: '600' }, meta.label));
    row.appendChild(kindBadge);

    const label = el('span', { flex: '1', minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: e.kind === 'query' ? 'monospace' : 'inherit' }, e.label);
    label.title = `${e.method} · ${e.label}${e.error ? `\n${e.error}` : ''}`;
    row.appendChild(label);

    const statusText = e.status ? String(e.status) : (e.ok ? 'ok' : 'err');
    row.appendChild(el('span', { ...colStatus, color: e.ok ? C.pass : C.fail, fontWeight: '700' }, statusText));
    row.appendChild(el('span', colDur, fmtDur(e.durationMs)));
    return row;
  };

  const updateCounts = () => {
    totalBadge.textContent = String(total);
    API_KINDS.forEach((k) => {
      const ref = chipEls[k]; if (!ref) return;
      const c = counts[k] || 0;
      ref.count.textContent = String(c);
      ref.chip.style.opacity = c ? '1' : '0.5';
    });
    const activeLive = total > 0;
    liveDot.style.background = activeLive ? C.pass : C.faint;
    live.style.color = activeLive ? C.pass : C.faint;
  };

  const renderList = () => {
    listScroll.innerHTML = '';
    if (!entries.length) { listScroll.appendChild(emptyMsg); return; }
    const frag = document.createDocumentFragment();
    entries.forEach((e) => frag.appendChild(buildRow(e)));
    listScroll.appendChild(frag);
  };

  const onAppend = (e: ApiLogEntry) => {
    updateCounts();
    if (!expanded) return;
    if (entries.length === 1) { renderList(); return; } // was empty
    listScroll.insertBefore(buildRow(e), listScroll.firstChild);
    // Trim DOM to keep it light.
    while (listScroll.childElementCount > 200 && listScroll.lastElementChild) listScroll.removeChild(listScroll.lastElementChild);
  };

  const setExpanded = (v: boolean) => {
    expanded = v;
    chevron.style.transform = v ? 'rotate(90deg)' : 'rotate(0deg)';
    body.style.maxHeight = v ? '244px' : '0';
    if (v) renderList();
  };

  bar.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('button')) return;
    setExpanded(!expanded);
  });

  // ── live subscription over the background port ──
  const runtime = (globalThis as any).chrome?.runtime;
  let port: any = null;

  const connect = () => {
    if (destroyed || !runtime?.connect) return;
    try { port = runtime.connect({ name: API_LOG_PORT }); } catch { port = null; return; }
    port.onMessage.addListener((m: any) => {
      if (!m) return;
      if (m.type === 'snapshot') {
        entries = Array.isArray(m.entries) ? m.entries : [];
        counts = { ...emptyCounts(), ...(m.counts || {}) };
        total = m.total || 0;
        updateCounts();
        if (expanded) renderList();
      } else if (m.type === 'append' && m.entry) {
        entries.unshift(m.entry);
        if (entries.length > 200) entries.length = 200;
        counts = { ...emptyCounts(), ...(m.counts || {}) };
        total = m.total || total + 1;
        onAppend(m.entry);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      // The service worker may have been evicted — reconnect shortly.
      if (!destroyed) setTimeout(connect, 1200);
    });
  };

  clearBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (port) { try { port.postMessage({ type: 'clear' }); } catch { /* ignore */ } }
    else runtime?.sendMessage?.({ type: 'CLEAR_API_LOG' });
    entries = []; counts = emptyCounts(); total = 0;
    updateCounts(); renderList();
  });

  updateCounts();
  connect();

  return {
    destroy() {
      destroyed = true;
      try { port?.disconnect?.(); } catch { /* ignore */ }
      port = null;
    },
  };
}
