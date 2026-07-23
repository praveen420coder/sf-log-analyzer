// Validation Rule Manager — see every validation rule in the org, filter by
// object / status, and activate or deactivate a rule without leaving the panel.
//
// Data sources (all through the background bridge, never chrome-*):
//   · listRules(scope)  → Tooling ValidationRule (paged)   [GET_VALIDATION_RULES]
//   · setActive(id,on)  → read-modify-write Metadata.active [SET_VALIDATION_RULE_ACTIVE]
//
// Managed (installed-package) rules aren't fetched until the user opts in — the
// "Show managed" checkbox lazily loads them. Content-script-only (imports
// ../lib/theme, ../lib/toast) so it stays in the content-ui bundle.

import { getTheme } from '../lib/theme';
import { showToast, setToastTheme } from '../lib/toast';
import { bumpUsage } from '../lib/settingsStore';

export interface VrRule {
  Id: string;
  ValidationName?: string;
  Active?: boolean;
  Description?: string;
  ErrorMessage?: string;
  ErrorDisplayField?: string;
  NamespacePrefix?: string;
  ManageableState?: string;
  EntityDefinition?: { QualifiedApiName?: string; Label?: string };
}

export interface VrManagerDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (m: string) => void;
  lightningOrigin: string;
  openUrl: (url: string) => void;
  listRules: (scope: 'unmanaged' | 'managed') => Promise<{ data?: VrRule[]; error?: string }>;
  setActive: (ruleId: string, active: boolean) => Promise<{ success: boolean; error?: string }>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

function btnStyle(C: ReturnType<typeof getTheme>, kind: 'primary' | 'danger' | 'ghost'): Partial<CSSStyleDeclaration> {
  const base: Partial<CSSStyleDeclaration> = {
    border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer',
    fontSize: '12px', fontWeight: '700', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  if (kind === 'primary') return { ...base, background: C.accent, color: '#fff' };
  if (kind === 'danger') return { ...base, background: 'transparent', color: C.danger, border: `1px solid ${C.danger}` };
  return { ...base, background: 'transparent', color: C.text, border: `1px solid ${C.border}` };
}

const objOf = (r: VrRule) => r.EntityDefinition?.QualifiedApiName || '(unknown object)';

export function renderValidationRuleManagerInto(host: HTMLElement, deps: VrManagerDeps): void {
  const C = getTheme(deps.isDark);

  // ── state ────────────────────────────────────────────────────────────────────
  let rules: VrRule[] = [];
  let filterText = '';
  let statusFilter: 'all' | 'active' | 'inactive' = 'all';
  let objectFilter = 'all';
  let showManaged = false;
  let managedLoaded = false;

  const isManaged = (r: VrRule) => !!r.ManageableState && r.ManageableState !== 'unmanaged';

  host.innerHTML = '';
  const root = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', background: C.bg, color: C.text });
  host.appendChild(root);

  // ── header ─────────────────────────────────────────────────────────────────
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '← Tools');
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
  titleWrap.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '✅ Validation Rules'));
  titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, 'Activate, deactivate and open validation rules'));
  head.appendChild(titleWrap);
  const countChip = el('div', { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' });
  head.appendChild(countChip);
  const refreshBtn = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '↻ Refresh');
  refreshBtn.addEventListener('click', () => load(true));
  head.appendChild(refreshBtn);
  root.appendChild(head);

  // ── toolbar ──────────────────────────────────────────────────────────────────
  const bar = el('div', { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '14px 24px 8px', flexShrink: '0' });
  const input = el('input', { flex: '1', minWidth: '220px', boxSizing: 'border-box', padding: '9px 13px', fontSize: '13px', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
  input.placeholder = 'Filter by rule, object or error message…';
  input.addEventListener('input', () => { filterText = input.value.trim().toLowerCase(); renderTable(); });
  bar.appendChild(input);

  const seg = el('div', { display: 'flex', border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden' });
  const segBtns: Record<string, HTMLElement> = {};
  (['all', 'active', 'inactive'] as const).forEach((s) => {
    const b = el('button', { background: 'transparent', border: 'none', color: C.muted, padding: '8px 14px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '700', fontFamily: 'inherit', textTransform: 'capitalize' }, s);
    b.addEventListener('click', () => { statusFilter = s; syncSeg(); renderTable(); });
    segBtns[s] = b; seg.appendChild(b);
  });
  const syncSeg = () => Object.entries(segBtns).forEach(([s, b]) => { const on = s === statusFilter; b.style.background = on ? C.accent : 'transparent'; b.style.color = on ? '#fff' : C.muted; });
  bar.appendChild(seg);

  const objSel = el('select', { padding: '8px 12px', fontSize: '12.5px', fontWeight: '600', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', cursor: 'pointer', outline: 'none', maxWidth: '220px' }) as HTMLSelectElement;
  objSel.addEventListener('change', () => { objectFilter = objSel.value; renderTable(); });
  bar.appendChild(objSel);

  const mgLabel = el('label', { display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', color: C.muted, userSelect: 'none', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '10px' });
  const mgChk = el('input', { cursor: 'pointer', accentColor: C.accent, margin: '0' }) as HTMLInputElement;
  mgChk.type = 'checkbox';
  const mgCount = el('span', { fontSize: '11px', fontWeight: '700', color: C.faint });
  mgChk.addEventListener('change', async () => {
    showManaged = mgChk.checked;
    if (showManaged && !managedLoaded) await loadManaged();
    renderTable();
  });
  mgLabel.append(mgChk, el('span', undefined, 'Show managed'), mgCount);
  bar.appendChild(mgLabel);
  root.appendChild(bar);
  const syncManagedCount = () => { const n = managedLoaded ? rules.filter(isManaged).length : 0; mgCount.textContent = n ? `(${n})` : ''; };

  // ── scroll area ──────────────────────────────────────────────────────────────
  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '6px 24px 24px' });
  root.appendChild(scroll);
  const centerMsg = (t: string, color = C.muted) => { scroll.innerHTML = ''; scroll.appendChild(el('div', { padding: '40px 6px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color }, t)); };

  const ruleSetupUrl = (r: VrRule) => `${deps.lightningOrigin}/lightning/setup/ObjectManager/${encodeURIComponent(objOf(r))}/ValidationRules/${r.Id}/view`;

  function rebuildObjectOptions() {
    const objs = Array.from(new Set(rules.map(objOf))).sort();
    objSel.innerHTML = '';
    const optAll = el('option', undefined, 'All objects'); optAll.value = 'all'; objSel.appendChild(optAll);
    objs.forEach((o) => { const opt = el('option', undefined, o); opt.value = o; objSel.appendChild(opt); });
    objSel.value = objectFilter;
  }

  // ── data load ────────────────────────────────────────────────────────────────
  async function load(force = false) {
    if (force && !showManaged) managedLoaded = false;
    centerMsg('Loading validation rules…');
    setToastTheme(deps.isDark);
    const tid = showToast('Fetching validation rules…', { type: 'loading' });
    const res = await deps.listRules('unmanaged');
    if (res.error) { showToast(res.error, { id: tid, type: 'error' }); centerMsg(res.error, C.danger); return; }
    rules = (res.data || []).slice();
    if (force && showManaged && managedLoaded) {
      const mg = await deps.listRules('managed');
      if (mg.data) rules = rules.concat(mg.data);
    }
    showToast(`${rules.filter((r) => !isManaged(r)).length} validation rules fetched`, { id: tid, type: 'success' });
    rebuildObjectOptions();
    renderTable();
  }

  async function loadManaged() {
    setToastTheme(deps.isDark);
    const tid = showToast('Fetching managed rules…', { type: 'loading' });
    mgChk.disabled = true; mgLabel.style.opacity = '0.6';
    const res = await deps.listRules('managed');
    mgChk.disabled = false; mgLabel.style.opacity = '1';
    if (res.error) { showToast(res.error, { id: tid, type: 'error' }); mgChk.checked = false; showManaged = false; return; }
    const mg = res.data || [];
    managedLoaded = true;
    rules = rules.concat(mg);
    rebuildObjectOptions();
    showToast(`${mg.length} managed rule${mg.length === 1 ? '' : 's'} fetched`, { id: tid, type: mg.length ? 'success' : 'info' });
  }

  function visibleRules(): VrRule[] {
    return rules.filter((r) => {
      if (!showManaged && isManaged(r)) return false;
      if (statusFilter === 'active' && !r.Active) return false;
      if (statusFilter === 'inactive' && r.Active) return false;
      if (objectFilter !== 'all' && objOf(r) !== objectFilter) return false;
      if (filterText) {
        const hay = `${objOf(r)} ${r.ValidationName || ''} ${r.ErrorMessage || ''} ${r.Description || ''}`.toLowerCase();
        if (!hay.includes(filterText)) return false;
      }
      return true;
    }).sort((a, b) => (objOf(a).localeCompare(objOf(b)) || (a.ValidationName || '').localeCompare(b.ValidationName || '')));
  }

  function badge(text: string, color: string, bg: string): HTMLElement {
    return el('span', { display: 'inline-block', fontSize: '11px', fontWeight: '800', color, background: bg, padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }, text);
  }

  // ── table render ─────────────────────────────────────────────────────────────
  function renderTable() {
    syncSeg();
    syncManagedCount();
    const rows = visibleRules();
    const scope = showManaged ? rules : rules.filter((r) => !isManaged(r));
    const activeCount = scope.filter((r) => r.Active).length;
    countChip.innerHTML = '';
    countChip.appendChild(el('span', { fontSize: '12px', fontWeight: '700', color: C.muted }, `${scope.length} rules`));
    countChip.appendChild(el('span', { fontSize: '11.5px', fontWeight: '700', color: C.success, background: C.accentSoft, padding: '2px 8px', borderRadius: '999px' }, `${activeCount} active`));

    scroll.innerHTML = '';
    if (!rules.length) { centerMsg('No validation rules found in this org.'); return; }
    if (!rows.length) { centerMsg(!showManaged ? 'No rules match the filters. Tick “Show managed” to also fetch installed-package rules.' : 'No rules match the current filters.'); return; }

    const grid = '200px 1fr 100px 210px';
    const table = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' });
    const hdr = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', alignItems: 'center', padding: '10px 14px', background: C.headerBg, borderBottom: `1px solid ${C.border}`, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: C.faint });
    ['Object', 'Rule', 'Status', 'Actions'].forEach((h, i) => hdr.appendChild(el('div', i === 2 ? { textAlign: 'center' } : undefined, h)));
    table.appendChild(hdr);
    rows.forEach((r, idx) => table.appendChild(buildRow(r, grid, idx)));
    scroll.appendChild(table);
  }

  function buildRow(r: VrRule, grid: string, idx: number): HTMLElement {
    const row = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', alignItems: 'center', padding: '11px 14px', borderTop: idx === 0 ? 'none' : `1px solid ${C.divider}` });

    // object
    const objCell = el('div', { minWidth: '0' });
    objCell.appendChild(el('div', { fontSize: '12.5px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, objOf(r)));
    row.appendChild(objCell);

    // rule name + error message
    const nameCell = el('div', { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '0' });
    const top = el('div', { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' });
    top.appendChild(el('span', { fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, r.ValidationName || r.Id));
    if (isManaged(r)) top.appendChild(badge('Managed', C.muted, C.hover));
    nameCell.appendChild(top);
    if (r.ErrorMessage) nameCell.appendChild(el('div', { fontSize: '11.5px', color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, r.ErrorMessage));
    row.appendChild(nameCell);

    // status
    const stCell = el('div', { textAlign: 'center' });
    stCell.appendChild(r.Active ? badge('Active', C.success, C.accentSoft) : badge('Inactive', C.muted, C.hover));
    row.appendChild(stCell);

    // actions
    const actions = el('div', { display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' });
    const openBtn = el('button', btnStyle(C, 'ghost'), 'Open');
    openBtn.title = 'Open this rule in Setup';
    openBtn.addEventListener('click', () => deps.openUrl(ruleSetupUrl(r)));
    actions.appendChild(openBtn);

    if (isManaged(r)) {
      // Subscribers usually can't toggle packaged rules — surface that instead of
      // offering a button that will fail.
      const lock = el('span', { fontSize: '11px', fontWeight: '700', color: C.faint }, 'Locked');
      lock.title = 'Managed validation rules are controlled by their package.';
      actions.appendChild(lock);
    } else if (r.Active) {
      const off = el('button', btnStyle(C, 'danger'), 'Deactivate');
      off.addEventListener('click', () => confirmAction(off, () => doSetActive(r, false)));
      actions.appendChild(off);
    } else {
      const on = el('button', btnStyle(C, 'primary'), 'Activate');
      on.addEventListener('click', () => confirmAction(on, () => doSetActive(r, true)));
      actions.appendChild(on);
    }
    row.appendChild(actions);
    return row;
  }

  async function doSetActive(r: VrRule, active: boolean) {
    const res = await deps.setActive(r.Id, active);
    if (!res.success) { deps.flashToast(res.error || 'Update failed'); return; }
    bumpUsage('rulesUpdated');
    deps.flashToast(`${active ? 'Activated' : 'Deactivated'} ${r.ValidationName || 'rule'} on ${objOf(r)}`);
    r.Active = active;   // reflect instantly
    renderTable();
  }

  // Inline Confirm / Cancel (no modal) — mirrors the Flow Manager.
  function confirmAction(btn: HTMLElement, run: () => void) {
    const parent = btn.parentElement; if (!parent) { run(); return; }
    const wrap = el('div', { display: 'inline-flex', gap: '4px', alignItems: 'center' });
    const yes = el('button', btnStyle(C, 'danger'), 'Confirm');
    const no = el('button', btnStyle(C, 'ghost'), 'Cancel');
    wrap.append(yes, no);
    parent.replaceChild(wrap, btn);
    no.addEventListener('click', () => { if (wrap.parentElement) parent.replaceChild(btn, wrap); });
    yes.addEventListener('click', () => { (yes as HTMLButtonElement).disabled = true; yes.textContent = 'Working…'; no.style.display = 'none'; run(); });
  }

  syncSeg();
  load();
}
