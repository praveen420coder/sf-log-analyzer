// Flow Manager — a single place to see every flow in the org, its active and
// latest version, drill into all versions, and activate / deactivate / open a
// flow without leaving the panel.
//
// Data sources (all read/write through the background bridge, never chrome-*).
// Just TWO reads per load — no per-row / per-expand fetching:
//   · listFlows()        → FlowDefinitionView (one row per flow)   [GET_ALL_FLOWS]
//   · listAllVersions()  → every Flow version in one paged query   [GET_ALL_FLOW_VERSIONS]
//   · setActiveVersion() → PATCH Tooling FlowDefinition metadata   [FLOW_SET_ACTIVE_VERSION]
//
// Versions are joined to flows in memory (indexVersions): unmanaged flows match
// DurableId === DefinitionId; managed flows match via ActiveVersionId /
// LatestVersionId → Flow.Id → DefinitionId.
//
// Kept content-script-only (imports ../lib/theme) so it stays inside the
// content-ui bundle — see the note in lib/theme.ts.

import { getTheme } from '../lib/theme';
import { showToast, setToastTheme } from '../lib/toast';
import { bumpUsage } from '../lib/settingsStore';

// One flow, as returned by FlowDefinitionView.
export interface FlowRow {
  DurableId: string;          // FlowDefinition Id (300…) — the activation target
  ApiName: string;
  Label?: string;
  ProcessType?: string;
  IsActive?: boolean;
  VersionNumber?: number;     // active version number (0/blank when inactive)
  ManageableState?: string;
  NamespacePrefix?: string;
  ActiveVersionId?: string;
  LatestVersionId?: string;
}

// One version, as returned by the Tooling Flow object.
export interface FlowVersion {
  Id: string;
  DefinitionId?: string;      // real FlowDefinition Id (300…) — activation target
  VersionNumber?: number;
  Status?: string;            // Active | Draft | Obsolete | InvalidDraft
  MasterLabel?: string;
  Description?: string;
  ApiVersion?: number;
  LastModifiedDate?: string;
  LastModifiedBy?: { Name?: string };
}

export interface FlowManagerDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (m: string) => void;
  lightningOrigin: string;
  // scope narrows by manageability so managed (installed-package) flows are only
  // fetched when the user opts in.
  listFlows: (scope: 'unmanaged' | 'managed') => Promise<{ data?: FlowRow[]; error?: string }>;
  // Bulk query for every version of the scoped flows (paged server-side).
  listAllVersions: (scope: 'unmanaged' | 'managed') => Promise<{ data?: FlowVersion[]; error?: string }>;
  setActiveVersion: (definitionId: string, versionNumber: number) => Promise<{ success: boolean; error?: string }>;
  openUrl: (url: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

// Friendlier labels for the raw ProcessType enum values.
const PROCESS_LABEL: Record<string, string> = {
  Flow: 'Screen Flow',
  AutoLaunchedFlow: 'Autolaunched',
  Workflow: 'Process Builder',
  CustomEvent: 'Platform Event',
  InvocableProcess: 'Invocable',
  ActionCadenceFlow: 'Action Cadence',
  ContactRequestFlow: 'Contact Request',
  LoginFlow: 'Login Flow',
  Survey: 'Survey',
  Journey: 'Journey',
  Orchestrator: 'Orchestration',
};
const processLabel = (t?: string) => PROCESS_LABEL[t || ''] || t || 'Flow';

export function renderFlowManagerInto(host: HTMLElement, deps: FlowManagerDeps): void {
  const C = getTheme(deps.isDark);

  // ── local state ────────────────────────────────────────────────────────────
  let flows: FlowRow[] = [];
  let filterText = '';
  let statusFilter: 'all' | 'active' | 'inactive' = 'all';
  let typeFilter = 'all';
  let showManaged = false;   // managed/installed flows are hidden AND unfetched by default
  let managedLoaded = false; // becomes true once managed flows have been fetched
  const expanded = new Set<string>();                 // DurableIds with versions panel open
  // Accumulated version records (unmanaged first, managed appended on demand);
  // versionCache/realDefIdByDurable are derived from it by indexVersions().
  let loadedVersions: FlowVersion[] = [];
  const versionCache = new Map<string, FlowVersion[]>();
  const realDefIdByDurable = new Map<string, string>();  // DurableId → real FlowDefinition Id

  host.innerHTML = '';
  const root = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', background: C.bg, color: C.text });
  host.appendChild(root);

  // ── header ─────────────────────────────────────────────────────────────────
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '← Tools');
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
  titleWrap.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '⚡ Flow Manager'));
  titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, 'See, activate, deactivate and open every flow in the org'));
  head.appendChild(titleWrap);
  const countChip = el('div', { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' });
  head.appendChild(countChip);
  const refreshBtn = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '↻ Refresh');
  refreshBtn.addEventListener('click', () => load(true));
  head.appendChild(refreshBtn);
  root.appendChild(head);

  // ── toolbar (search + filters) ───────────────────────────────────────────────
  const bar = el('div', { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '14px 24px 8px', flexShrink: '0' });
  const input = el('input', { flex: '1', minWidth: '220px', boxSizing: 'border-box', padding: '9px 13px', fontSize: '13px', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
  input.placeholder = 'Filter flows by name or API name…';
  input.addEventListener('input', () => { filterText = input.value.trim().toLowerCase(); renderTable(); });
  bar.appendChild(input);

  // status segmented control
  const seg = el('div', { display: 'flex', border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden' });
  const segBtns: Record<string, HTMLElement> = {};
  (['all', 'active', 'inactive'] as const).forEach((s) => {
    const b = el('button', { background: 'transparent', border: 'none', color: C.muted, padding: '8px 14px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '700', fontFamily: 'inherit', textTransform: 'capitalize' }, s);
    b.addEventListener('click', () => { statusFilter = s; syncSeg(); renderTable(); });
    segBtns[s] = b; seg.appendChild(b);
  });
  const syncSeg = () => Object.entries(segBtns).forEach(([s, b]) => {
    const on = s === statusFilter;
    b.style.background = on ? C.accent : 'transparent';
    b.style.color = on ? '#fff' : C.muted;
  });
  bar.appendChild(seg);

  // type filter
  const typeSel = el('select', { padding: '8px 12px', fontSize: '12.5px', fontWeight: '600', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }) as HTMLSelectElement;
  typeSel.addEventListener('change', () => { typeFilter = typeSel.value; renderTable(); });
  bar.appendChild(typeSel);

  // Managed flows (from installed packages) are hidden by default and aren't even
  // fetched until the user ticks this box — the first tick lazily loads them.
  const mgLabel = el('label', { display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', color: C.muted, userSelect: 'none', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '10px' });
  const mgChk = el('input', { cursor: 'pointer', accentColor: C.accent, margin: '0' }) as HTMLInputElement;
  mgChk.type = 'checkbox';
  mgChk.checked = showManaged;
  const mgCount = el('span', { fontSize: '11px', fontWeight: '700', color: C.faint });
  mgChk.addEventListener('change', async () => {
    showManaged = mgChk.checked;
    if (showManaged && !managedLoaded) { await loadManaged(); }
    renderTable();
  });
  mgLabel.appendChild(mgChk);
  mgLabel.appendChild(el('span', undefined, 'Show managed'));
  mgLabel.appendChild(mgCount);
  bar.appendChild(mgLabel);
  root.appendChild(bar);
  // The "(N)" hint reflects managed flows once they've been fetched.
  const syncManagedCount = () => { const n = managedLoaded ? flows.filter((f) => isManaged(f)).length : 0; mgCount.textContent = n ? `(${n})` : ''; };

  // ── scroll area ──────────────────────────────────────────────────────────────
  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '6px 24px 24px' });
  root.appendChild(scroll);

  const centerMsg = (t: string, color = C.muted) => {
    scroll.innerHTML = '';
    scroll.appendChild(el('div', { padding: '40px 6px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color }, t));
  };

  // ── URL builders ─────────────────────────────────────────────────────────────
  const isManaged = (f: FlowRow) => !!f.ManageableState && f.ManageableState !== 'unmanaged';
  const fullApiName = (f: FlowRow) => {
    const ns = f.NamespacePrefix;
    return ns && f.ApiName && !f.ApiName.startsWith(`${ns}__`) ? `${ns}__${f.ApiName}` : f.ApiName;
  };
  // Open a specific version (or the flow's active/latest) in Flow Builder.
  const builderUrl = (f: FlowRow, versionId?: string, versionNumber?: number): string => {
    const origin = deps.lightningOrigin;
    if (isManaged(f) && versionNumber) return `${origin}/builder_platform_interaction/flowBuilder.app?flowId=${fullApiName(f)}-${versionNumber}`;
    const vid = versionId || f.ActiveVersionId || f.LatestVersionId;
    if (vid) return `${origin}/builder_platform_interaction/flowBuilder.app?flowId=${vid}`;
    return `${origin}/lightning/setup/Flows/home`;
  };

  const looksLikeId = (s: string) => /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(s) && !s.includes('__');

  // ── data load ────────────────────────────────────────────────────────────────
  // Rebuild the type dropdown from the process types currently loaded.
  function rebuildTypeOptions() {
    const types = Array.from(new Set(flows.map((f) => f.ProcessType || 'Flow'))).sort();
    typeSel.innerHTML = '';
    const optAll = el('option', undefined, 'All types'); optAll.value = 'all'; typeSel.appendChild(optAll);
    types.forEach((t) => { const o = el('option', undefined, processLabel(t)); o.value = t; typeSel.appendChild(o); });
    typeSel.value = typeFilter;
  }

  // Initial load fetches UNMANAGED flows only (list + bulk versions). Managed
  // flows are fetched separately by loadManaged() on demand.
  async function load(force = false) {
    if (force) { versionCache.clear(); realDefIdByDurable.clear(); if (!showManaged) managedLoaded = false; }
    centerMsg('Loading flows…');
    setToastTheme(deps.isDark);
    const tid = showToast('Fetching flows…', { type: 'loading' });
    const [flowsRes, versRes] = await Promise.all([deps.listFlows('unmanaged'), deps.listAllVersions('unmanaged')]);
    if (flowsRes.error) { showToast(flowsRes.error, { id: tid, type: 'error' }); centerMsg(flowsRes.error, C.danger); return; }
    flows = (flowsRes.data || []).slice();
    loadedVersions = (versRes.data || []).slice();
    // On a forced refresh while managed flows are showing, re-fetch them too.
    if (force && showManaged && managedLoaded) {
      const mg = await Promise.all([deps.listFlows('managed'), deps.listAllVersions('managed')]);
      flows = flows.concat(mg[0].data || []);
      loadedVersions = loadedVersions.concat(mg[1].data || []);
    }
    indexVersions(loadedVersions);
    showToast(`${flows.filter((f) => !isManaged(f)).length} flows fetched${loadedVersions.length ? ` · ${loadedVersions.length} versions` : ''}`, { id: tid, type: 'success' });
    rebuildTypeOptions();
    renderTable();
  }

  // Fetch managed (installed-package) flows + their versions, appending to what's
  // already loaded. Runs at most once (guarded by managedLoaded).
  async function loadManaged() {
    setToastTheme(deps.isDark);
    const tid = showToast('Fetching managed flows…', { type: 'loading' });
    mgChk.disabled = true; mgLabel.style.opacity = '0.6';
    const [flowsRes, versRes] = await Promise.all([deps.listFlows('managed'), deps.listAllVersions('managed')]);
    mgChk.disabled = false; mgLabel.style.opacity = '1';
    if (flowsRes.error) { showToast(flowsRes.error, { id: tid, type: 'error' }); mgChk.checked = false; showManaged = false; return; }
    const mgFlows = flowsRes.data || [];
    managedLoaded = true;
    flows = flows.concat(mgFlows);
    loadedVersions = loadedVersions.concat(versRes.data || []);
    indexVersions(loadedVersions);
    rebuildTypeOptions();
    showToast(`${mgFlows.length} managed flow${mgFlows.length === 1 ? '' : 's'} fetched`, { id: tid, type: mgFlows.length ? 'success' : 'info' });
  }

  // Join the flat version list to each flow. Unmanaged flows match by
  // DurableId === DefinitionId; managed flows (DurableId is an API name) match
  // through ActiveVersionId / LatestVersionId → Flow.Id → DefinitionId.
  function indexVersions(allVersions: FlowVersion[]) {
    versionCache.clear(); realDefIdByDurable.clear();
    const byDef = new Map<string, FlowVersion[]>();
    const versionIdToDef = new Map<string, string>();
    allVersions.forEach((v) => {
      if (v.DefinitionId) { (byDef.get(v.DefinitionId) || byDef.set(v.DefinitionId, []).get(v.DefinitionId)!).push(v); }
      if (v.Id && v.DefinitionId) versionIdToDef.set(v.Id, v.DefinitionId);
    });
    flows.forEach((f) => {
      let defId: string | undefined = looksLikeId(f.DurableId) ? f.DurableId : undefined;
      if (!defId) defId = (f.LatestVersionId && versionIdToDef.get(f.LatestVersionId)) || (f.ActiveVersionId && versionIdToDef.get(f.ActiveVersionId)) || undefined;
      if (defId) {
        realDefIdByDurable.set(f.DurableId, defId);
        const vs = byDef.get(defId);
        if (vs) versionCache.set(f.DurableId, vs);
      }
    });
  }

  function visibleFlows(): FlowRow[] {
    return flows.filter((f) => {
      if (!showManaged && isManaged(f)) return false;
      if (statusFilter === 'active' && !f.IsActive) return false;
      if (statusFilter === 'inactive' && f.IsActive) return false;
      if (typeFilter !== 'all' && (f.ProcessType || 'Flow') !== typeFilter) return false;
      if (filterText) {
        const hay = `${f.Label || ''} ${f.ApiName || ''}`.toLowerCase();
        if (!hay.includes(filterText)) return false;
      }
      return true;
    }).sort((a, b) => (a.Label || a.ApiName || '').localeCompare(b.Label || b.ApiName || ''));
  }

  // ── table render ─────────────────────────────────────────────────────────────
  function renderTable() {
    syncSeg();
    syncManagedCount();
    const rows = visibleFlows();
    // Counts reflect the managed toggle so "N flows" matches what's shown.
    const scope = showManaged ? flows : flows.filter((f) => !isManaged(f));
    const activeCount = scope.filter((f) => f.IsActive).length;
    countChip.innerHTML = '';
    countChip.appendChild(el('span', { fontSize: '12px', fontWeight: '700', color: C.muted }, `${scope.length} flows`));
    countChip.appendChild(el('span', { fontSize: '11.5px', fontWeight: '700', color: C.success, background: C.accentSoft, padding: '2px 8px', borderRadius: '999px' }, `${activeCount} active`));

    scroll.innerHTML = '';
    if (!flows.length) { centerMsg('No flows found in this org.'); return; }
    if (!rows.length) { centerMsg(!showManaged ? 'No flows match the filters. Tick “Show managed” to also fetch installed-package flows.' : 'No flows match the current filters.'); return; }

    // Column header.
    const grid = '1fr 120px 120px 110px 240px';
    const table = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' });
    const hdr = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', alignItems: 'center', padding: '10px 14px', background: C.headerBg, borderBottom: `1px solid ${C.border}`, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: C.faint });
    ['Flow', 'Active ver.', 'Latest ver.', 'Status', 'Actions'].forEach((h, i) => hdr.appendChild(el('div', i >= 1 && i <= 3 ? { textAlign: 'center' } : undefined, h)));
    table.appendChild(hdr);

    rows.forEach((f, idx) => {
      table.appendChild(buildRow(f, grid, idx));
    });
    scroll.appendChild(table);
  }

  function badge(text: string, color: string, bg: string): HTMLElement {
    return el('span', { display: 'inline-block', fontSize: '11px', fontWeight: '800', color, background: bg, padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }, text);
  }

  function statusColors(status?: string): { color: string; bg: string } {
    const s = (status || '').toLowerCase();
    if (s === 'active') return { color: C.success, bg: C.accentSoft };
    if (s === 'draft' || s === 'invaliddraft') return { color: C.warn, bg: 'rgba(245,158,11,0.14)' };
    return { color: C.muted, bg: C.hover };                    // obsolete / inactive
  }

  function buildRow(f: FlowRow, grid: string, idx: number): HTMLElement {
    const wrap = el('div', { borderTop: idx === 0 ? 'none' : `1px solid ${C.divider}` });
    const row = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', alignItems: 'center', padding: '11px 14px' });

    // name cell
    const nameCell = el('div', { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '0' });
    const nameTop = el('div', { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' });
    const chev = el('span', { cursor: 'pointer', color: C.faint, fontSize: '11px', transition: 'transform .15s', flexShrink: '0', transform: expanded.has(f.DurableId) ? 'rotate(90deg)' : 'none' }, '▶');
    nameTop.appendChild(chev);
    nameTop.appendChild(el('span', { fontSize: '13px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, f.Label || f.ApiName));
    nameCell.appendChild(nameTop);
    const sub = el('div', { display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '19px', minWidth: '0' });
    sub.appendChild(el('span', { fontSize: '11.5px', color: C.faint, fontFamily: 'Fira Code, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, f.ApiName));
    sub.appendChild(badge(processLabel(f.ProcessType), C.muted, C.hover));
    if (isManaged(f)) sub.appendChild(badge('Managed', C.muted, C.hover));
    nameCell.appendChild(sub);
    row.appendChild(nameCell);

    // active / latest version numbers — both already in memory (no fetch).
    const activeVer = f.IsActive && f.VersionNumber ? String(f.VersionNumber) : '—';
    row.appendChild(el('div', { textAlign: 'center', fontSize: '13px', fontWeight: '700', color: f.IsActive ? C.text : C.faint }, activeVer));
    row.appendChild(el('div', { textAlign: 'center', fontSize: '13px', fontWeight: '600', color: C.muted }, String(maxVersion(f.DurableId) ?? '—')));

    // status
    const stCell = el('div', { textAlign: 'center' });
    stCell.appendChild(f.IsActive ? badge('Active', C.success, C.accentSoft) : badge('Inactive', C.muted, C.hover));
    row.appendChild(stCell);

    // actions
    const actions = el('div', { display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' });
    const openBtn = el('button', btnStyle(C, 'ghost'), 'Open');
    openBtn.title = 'Open the active (or latest) version in Flow Builder';
    openBtn.addEventListener('click', () => deps.openUrl(builderUrl(f, undefined, f.IsActive ? f.VersionNumber : undefined)));
    actions.appendChild(openBtn);

    if (f.IsActive) {
      const off = el('button', btnStyle(C, 'danger'), 'Deactivate');
      off.addEventListener('click', () => confirmAction(off, 'Deactivate this flow?', () => doSetActive(f, 0)));
      actions.appendChild(off);
    } else {
      const on = el('button', btnStyle(C, 'primary'), 'Activate');
      on.addEventListener('click', () => activateLatest(on, f));
      actions.appendChild(on);
    }
    row.appendChild(actions);
    wrap.appendChild(row);

    // versions panel — if this row was already expanded (e.g. the table just
    // re-rendered after an activate/deactivate), populate it now so it doesn't
    // come back empty.
    const panel = el('div', { padding: '0 14px 12px 33px', display: expanded.has(f.DurableId) ? 'block' : 'none' });
    wrap.appendChild(panel);
    if (expanded.has(f.DurableId)) renderVersions(panel, f);

    const toggle = () => {
      if (expanded.has(f.DurableId)) { expanded.delete(f.DurableId); panel.style.display = 'none'; chev.style.transform = 'none'; return; }
      expanded.add(f.DurableId); panel.style.display = 'block'; chev.style.transform = 'rotate(90deg)';
      renderVersions(panel, f);
    };
    chev.addEventListener('click', toggle);
    nameTop.addEventListener('click', (e) => { if (e.target !== chev) toggle(); });
    nameTop.style.cursor = 'pointer';

    return wrap;
  }

  function maxVersion(defId: string): number | undefined {
    const vs = versionCache.get(defId);
    if (!vs || !vs.length) return undefined;
    return vs.reduce((m, v) => Math.max(m, v.VersionNumber || 0), 0);
  }

  // ── versions sub-panel ───────────────────────────────────────────────────────
  // Reads from the already-loaded bulk cache — no per-flow network call.
  function renderVersions(panel: HTMLElement, f: FlowRow) {
    panel.innerHTML = '';
    const versions = versionCache.get(f.DurableId) || [];
    if (!versions.length) { panel.appendChild(el('div', { fontSize: '12px', color: C.muted, padding: '4px 0' }, 'No versions available (managed flows may hide their versions).')); return; }

    const list = el('div', { border: `1px solid ${C.divider}`, borderRadius: '10px', overflow: 'hidden', background: C.subtle });
    versions.slice().sort((a, b) => (b.VersionNumber || 0) - (a.VersionNumber || 0)).forEach((v, i) => {
      const vr = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 12px', borderTop: i === 0 ? 'none' : `1px solid ${C.divider}` });
      vr.appendChild(el('span', { fontSize: '12.5px', fontWeight: '800', color: C.text, minWidth: '34px' }, `v${v.VersionNumber ?? '?'}`));
      const sc = statusColors(v.Status);
      vr.appendChild(badge(v.Status || 'Unknown', sc.color, sc.bg));
      const meta = el('div', { display: 'flex', flexDirection: 'column', minWidth: '0', flex: '1' });
      if (v.MasterLabel) meta.appendChild(el('span', { fontSize: '12px', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, v.MasterLabel));
      const modBits = [v.LastModifiedDate ? new Date(v.LastModifiedDate).toLocaleDateString() : '', v.LastModifiedBy?.Name || ''].filter(Boolean).join(' · ');
      if (modBits) meta.appendChild(el('span', { fontSize: '11px', color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, modBits));
      vr.appendChild(meta);

      const vActions = el('div', { display: 'flex', gap: '6px', flexShrink: '0' });
      const openV = el('button', btnStyle(C, 'ghost'), 'Open');
      openV.addEventListener('click', () => deps.openUrl(builderUrl(f, v.Id, v.VersionNumber)));
      vActions.appendChild(openV);
      const vStatus = (v.Status || '').toLowerCase();
      if (vStatus === 'active') {
        const offV = el('button', btnStyle(C, 'danger'), 'Deactivate');
        offV.addEventListener('click', () => confirmAction(offV, 'Deactivate this flow?', () => doSetActive(f, 0)));
        vActions.appendChild(offV);
      } else if (vStatus === 'invaliddraft') {
        // Invalid drafts can't be activated until the underlying errors are fixed.
        const bad = el('span', { fontSize: '11px', fontWeight: '700', color: C.faint }, 'Not activatable');
        bad.title = 'This version has validation errors and must be fixed in Flow Builder before it can be activated.';
        vActions.appendChild(bad);
      } else {
        // Draft or Obsolete → can be made the active version. Activating it makes
        // the currently-active version Obsolete (Salesforce does this for us).
        const onV = el('button', btnStyle(C, 'primary'), 'Activate');
        onV.addEventListener('click', () => confirmAction(onV, `Activate v${v.VersionNumber}?`, () => doSetActive(f, v.VersionNumber || 0)));
        vActions.appendChild(onV);
      }
      vr.appendChild(vActions);
      list.appendChild(vr);
    });
    panel.appendChild(list);
  }

  // ── activation helpers ───────────────────────────────────────────────────────
  // The real FlowDefinition Id needed to activate/deactivate — resolved in memory
  // at load time (see indexVersions).
  const resolveDefId = (f: FlowRow): string | undefined =>
    realDefIdByDurable.get(f.DurableId) || (looksLikeId(f.DurableId) ? f.DurableId : undefined);

  function activateLatest(btn: HTMLElement, f: FlowRow) {
    const latest = maxVersion(f.DurableId);
    if (latest == null || latest === 0) { deps.flashToast('No activatable version found'); return; }
    confirmAction(btn, `Activate v${latest}?`, () => doSetActive(f, latest));
  }

  async function doSetActive(f: FlowRow, versionNumber: number) {
    const defId = resolveDefId(f);
    if (!defId) { deps.flashToast('Could not resolve this flow’s id (managed flows may be locked by their package)'); return; }
    const res = await deps.setActiveVersion(defId, versionNumber);
    if (!res.success) { deps.flashToast(res.error || 'Update failed'); return; }
    bumpUsage('rulesUpdated');
    deps.flashToast(versionNumber === 0 ? `Deactivated ${f.Label || f.ApiName}` : `Activated v${versionNumber} of ${f.Label || f.ApiName}`);
    // Reflect the change locally so the row updates instantly…
    f.IsActive = versionNumber !== 0;
    f.VersionNumber = versionNumber || f.VersionNumber;
    const vs = versionCache.get(f.DurableId);
    if (vs) vs.forEach((v) => { v.Status = (v.VersionNumber === versionNumber && versionNumber !== 0) ? 'Active' : (v.Status === 'Active' ? 'Obsolete' : v.Status); });
    renderTable();
    // …then reconcile with the server in the background (exact statuses/ids),
    // re-fetching the same scopes that are currently loaded.
    const scopes: ('unmanaged' | 'managed')[] = managedLoaded ? ['unmanaged', 'managed'] : ['unmanaged'];
    Promise.all(scopes.flatMap((s) => [deps.listFlows(s), deps.listAllVersions(s)])).then((results) => {
      const nextFlows: FlowRow[] = [];
      const nextVersions: FlowVersion[] = [];
      let ok = false;
      for (let i = 0; i < results.length; i += 2) {
        const fr = results[i] as { data?: FlowRow[] }; const vr = results[i + 1] as { data?: FlowVersion[] };
        if (fr.data) { ok = true; nextFlows.push(...fr.data); }
        if (vr.data) nextVersions.push(...vr.data);
      }
      if (ok) { flows = nextFlows; loadedVersions = nextVersions; indexVersions(loadedVersions); renderTable(); }
    }).catch(() => {});
  }

  // ── tiny inline confirm ──────────────────────────────────────────────────────
  // Turns the clicked button into a Confirm / Cancel pair to avoid a modal.
  function confirmAction(btn: HTMLElement, _label: string, run: () => void) {
    const parent = btn.parentElement; if (!parent) { run(); return; }
    const orig = btn;
    const confirmWrap = el('div', { display: 'inline-flex', gap: '4px', alignItems: 'center' });
    const yes = el('button', btnStyle(C, 'danger'), 'Confirm');
    const no = el('button', btnStyle(C, 'ghost'), 'Cancel');
    confirmWrap.appendChild(yes); confirmWrap.appendChild(no);
    parent.replaceChild(confirmWrap, orig);
    const restore = () => { if (confirmWrap.parentElement) parent.replaceChild(orig, confirmWrap); };
    no.addEventListener('click', restore);
    yes.addEventListener('click', () => { setBusy(yes, true, 'Working…'); no.style.display = 'none'; run(); });
  }

  function setBusy(btn: HTMLElement, busy: boolean, text?: string) {
    (btn as HTMLButtonElement).disabled = busy;
    btn.style.opacity = busy ? '0.6' : '1';
    btn.style.pointerEvents = busy ? 'none' : 'auto';
    if (text) btn.textContent = text;
  }

  // kick off
  syncSeg();
  load();
}

// Shared button styling by intent.
function btnStyle(C: ReturnType<typeof getTheme>, kind: 'primary' | 'danger' | 'ghost'): Partial<CSSStyleDeclaration> {
  const base: Partial<CSSStyleDeclaration> = {
    border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer',
    fontSize: '12px', fontWeight: '700', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  if (kind === 'primary') return { ...base, background: C.accent, color: '#fff' };
  if (kind === 'danger') return { ...base, background: 'transparent', color: C.danger, border: `1px solid ${C.danger}` };
  return { ...base, background: 'transparent', color: C.text, border: `1px solid ${C.border}` };
}
