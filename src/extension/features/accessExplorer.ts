// Access Explorer — a reverse view of permissions:
//  • Object Access: which profiles/permission sets can C/R/E/D/V/M an object
//  • Field Access:  who can Read/Edit a given field
//  • User Access:   a user's profile + permission sets and their effective object access
// Backend-agnostic via injected runQuery (METADATA_QUERY, Data API).

export interface AccessDeps {
  isDark: boolean;
  onBack?: () => void;
  hideBack?: boolean;
  runQuery: (soql: string) => Promise<{ records: any[]; error?: string }>;
  flashToast: (m: string) => void;
}

const OBJ_FLAGS: [string, string][] = [
  ['C', 'PermissionsCreate'], ['R', 'PermissionsRead'], ['E', 'PermissionsEdit'],
  ['D', 'PermissionsDelete'], ['V', 'PermissionsViewAllRecords'], ['M', 'PermissionsModifyAllRecords'],
];
const FIELD_FLAGS: [string, string][] = [['R', 'PermissionsRead'], ['E', 'PermissionsEdit']];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

const parentLabel = (p: any): { label: string; type: string } => {
  if (p?.IsOwnedByProfile) return { label: p?.Profile?.Name || p?.Label || 'Profile', type: 'Profile' };
  return { label: p?.Label || p?.Name || '—', type: 'Permission Set' };
};

export function renderAccessExplorerInto(host: HTMLElement, deps: AccessDeps): void {
  const isDark = deps.isDark;
  const C = {
    bg: isDark ? '#0e1626' : '#ffffff',
    panel: isDark ? '#111c30' : '#ffffff',
    headerBg: isDark ? '#16223b' : '#eef2f7',
    text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? '#94a3b8' : '#64748b',
    faint: isDark ? 'rgba(148,163,184,0.5)' : 'rgba(31,41,55,0.4)',
    border: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,0,0,0.12)',
    divider: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.07)',
    accent: '#3b82f6',
    grant: isDark ? '#4ade80' : '#16a34a',
    hover: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    zebra: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
  };

  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  // header
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 24px 12px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  if (!deps.hideBack && deps.onBack) {
    const back = el('button', { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontFamily: 'inherit', fontSize: '13px', fontWeight: '700' });
    back.innerHTML = '<span style="font-size:15px">←</span> Tools';
    back.addEventListener('click', deps.onBack);
    head.appendChild(back);
    head.appendChild(el('span', { color: C.faint }, '/'));
  }
  head.appendChild(el('div', { fontSize: '15px', fontWeight: '800', color: C.text }, '🗺️ Access Explorer'));
  root.appendChild(head);

  // sub-tabs
  let mode: 'object' | 'field' | 'user' = 'object';
  const tabBar = el('div', { display: 'flex', gap: '4px', padding: '8px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(tabBar);
  const seg = el('div', { display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' });
  const segBtns: Record<string, HTMLButtonElement> = {};
  ([['object', 'Object Access'], ['field', 'Field Access'], ['user', 'User Access']] as const).forEach(([id, label]) => {
    const b = el('button', { background: 'transparent', border: 'none', padding: '7px 16px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', color: C.muted }, label);
    b.addEventListener('click', () => { mode = id; paintSeg(); render(); });
    segBtns[id] = b; seg.appendChild(b);
  });
  const paintSeg = () => Object.entries(segBtns).forEach(([id, b]) => Object.assign(b.style, { background: mode === id ? C.accent : 'transparent', color: mode === id ? '#fff' : C.muted, fontWeight: mode === id ? '700' : '500' }));
  tabBar.appendChild(seg);

  const controls = el('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(controls);
  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto' });
  root.appendChild(scroll);

  const msg = (t: string, color?: string) => { scroll.innerHTML = ''; scroll.appendChild(el('div', { padding: '24px', color: color || C.muted, fontSize: '13px', whiteSpace: 'pre-wrap' }, t)); };

  // ── shared cells ──
  const flagCell = (rec: any, pairs: [string, string][]) => {
    const d = el('div', { display: 'flex', gap: '6px', fontFamily: 'monospace', fontSize: '13px', fontWeight: '700' });
    pairs.forEach(([letter, field]) => {
      const on = !!rec?.[field];
      d.appendChild(el('span', { color: on ? C.grant : C.faint, textDecoration: on ? 'none' : 'line-through', opacity: on ? '1' : '0.6' }, letter));
    });
    return d;
  };
  const buildTable = (headers: { label: string; align?: string }[]): HTMLTableElement => {
    const t = el('table', { borderCollapse: 'collapse', width: '100%', fontSize: '13px' });
    const thead = el('thead'); const htr = el('tr');
    headers.forEach((h) => htr.appendChild(el('th', { position: 'sticky', top: '0', textAlign: (h.align as any) || 'left', padding: '9px 16px', background: C.headerBg, color: C.text, fontWeight: '700', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`, zIndex: '1' } as Partial<CSSStyleDeclaration>, h.label)));
    thead.appendChild(htr); t.appendChild(thead); t.appendChild(el('tbody'));
    return t;
  };
  const td = (): Partial<CSSStyleDeclaration> => ({ padding: '8px 16px', borderBottom: `1px solid ${C.divider}`, color: C.text, whiteSpace: 'nowrap' });
  const typeChip = (type: string) => el('span', { fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', color: type === 'Profile' ? (isDark ? '#93c5fd' : '#1d4ed8') : (isDark ? '#c4b5fd' : '#7c3aed'), background: type === 'Profile' ? 'rgba(59,130,246,0.14)' : 'rgba(168,85,247,0.14)' }, type);

  // ── object list (shared by Object & Field tabs) ──
  let objectList: string[] | null = null;
  const ensureObjects = async (): Promise<string[]> => {
    if (objectList) return objectList;
    const { records } = await deps.runQuery('SELECT SobjectType FROM ObjectPermissions GROUP BY SobjectType ORDER BY SobjectType LIMIT 2000');
    objectList = Array.from(new Set((records || []).map((r: any) => r.SobjectType).filter(Boolean))) as string[];
    return objectList;
  };
  const objectInput = (onPick: (v: string) => void): HTMLElement => {
    const wrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: C.muted });
    wrap.appendChild(document.createTextNode('Object:'));
    const inp = el('input', { padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', minWidth: '220px' }) as HTMLInputElement;
    inp.placeholder = 'e.g. Account or MyObject__c';
    const dl = document.createElement('datalist'); dl.id = 'sf-access-objs'; inp.setAttribute('list', dl.id);
    ensureObjects().then((objs) => objs.forEach((o) => { const op = el('option'); op.value = o; dl.appendChild(op); }));
    inp.addEventListener('change', () => onPick(inp.value.trim()));
    wrap.appendChild(inp); wrap.appendChild(dl);
    return wrap;
  };

  // ════════ render dispatch ════════
  function render() {
    controls.innerHTML = '';
    scroll.innerHTML = '';
    if (mode === 'object') renderObject();
    else if (mode === 'field') renderField();
    else renderUser();
  }

  // ════════ OBJECT ACCESS ════════
  let objSel = '';
  function renderObject() {
    controls.appendChild(objectInput((v) => { objSel = v; loadObject(); }));
    controls.appendChild(el('span', { fontSize: '12px', color: C.muted }, 'See which profiles & permission sets can access an object.'));
    if (!objSel) { msg('Pick an object to see who can access it.'); return; }
    loadObject();
  }
  async function loadObject() {
    if (!objSel) return;
    msg(`Loading access for ${objSel}…`);
    const fields = OBJ_FLAGS.map(([, f]) => f).join(', ');
    const { records, error } = await deps.runQuery(`SELECT ParentId, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name, ${fields} FROM ObjectPermissions WHERE SobjectType = '${objSel}' ORDER BY Parent.IsOwnedByProfile DESC, Parent.Profile.Name, Parent.Label`);
    if (error) { msg('Could not load object permissions:\n' + error, C.faint); return; }
    if (!records.length) { msg(`No profiles or permission sets grant access to ${objSel}.`); return; }
    scroll.innerHTML = '';
    const granted = (f: string) => records.filter((r: any) => r[f]).length;
    const FLAG_NAMES: Record<string, string> = { C: 'Create', R: 'Read', E: 'Edit', D: 'Delete', V: 'View All', M: 'Modify All' };
    const summary = el('div', { padding: '14px 24px', fontSize: '12.5px', color: C.muted, display: 'flex', gap: '16px', flexWrap: 'wrap', borderBottom: `1px solid ${C.divider}` });
    OBJ_FLAGS.forEach(([l, f]) => {
      const s = el('span', {});
      s.appendChild(document.createTextNode(`${FLAG_NAMES[l]}: `));
      s.appendChild(el('b', { color: C.text }, String(granted(f))));
      summary.appendChild(s);
    });
    summary.appendChild(el('span', {}, `· ${records.length} total`));
    scroll.appendChild(summary);

    const table = buildTable([{ label: 'Access For' }, { label: 'Type' }, { label: 'C R E D V M' }]);
    const tb = table.querySelector('tbody')!;
    records.forEach((r: any, i: number) => {
      const { label, type } = parentLabel(r.Parent);
      const tr = el('tr', { background: i % 2 ? C.zebra : '' });
      tr.addEventListener('mouseover', () => (tr.style.background = C.hover));
      tr.addEventListener('mouseout', () => (tr.style.background = i % 2 ? C.zebra : ''));
      tr.appendChild(el('td', { ...td(), fontWeight: '600' }, label));
      const tt = el('td', td()); tt.appendChild(typeChip(type)); tr.appendChild(tt);
      const ft = el('td', td()); ft.appendChild(flagCell(r, OBJ_FLAGS)); tr.appendChild(ft);
      tb.appendChild(tr);
    });
    scroll.appendChild(legend('C Create · R Read · E Edit · D Delete · V View All · M Modify All'));
    scroll.appendChild(table);
  }

  // ════════ FIELD ACCESS ════════
  let fObj = '', fField = '', fRecords: any[] = [];
  function renderField() {
    controls.appendChild(objectInput((v) => { fObj = v; fField = ''; loadFieldList(); }));
    const fWrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: C.muted });
    fWrap.appendChild(document.createTextNode('Field:'));
    const fInp = el('input', { padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', minWidth: '200px' }) as HTMLInputElement;
    fInp.placeholder = fObj ? 'Field API name' : 'pick an object first';
    const dl = document.createElement('datalist'); dl.id = 'sf-access-fields'; fInp.setAttribute('list', dl.id);
    fInp.addEventListener('change', () => { fField = fInp.value.trim(); renderFieldTable(); });
    fWrap.appendChild(fInp); fWrap.appendChild(dl);
    controls.appendChild(fWrap);
    (renderField as any)._fieldDatalist = dl;
    (renderField as any)._fieldInput = fInp;
    if (!fObj) { msg('Pick an object, then a field, to see who can read/edit it.'); return; }
    if (fRecords.length) populateFieldDatalist();
    if (fField) renderFieldTable(); else if (fObj) msg('Now pick a field.');
  }
  async function loadFieldList() {
    if (!fObj) return;
    msg(`Loading fields for ${fObj}…`);
    const { records, error } = await deps.runQuery(`SELECT ParentId, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${fObj}' ORDER BY Field LIMIT 5000`);
    if (error) { msg('Could not load field permissions:\n' + error, C.faint); return; }
    fRecords = records;
    populateFieldDatalist();
    msg(records.length ? 'Now pick a field.' : `No field-level security entries for ${fObj}.`);
  }
  function populateFieldDatalist() {
    const dl = (renderField as any)._fieldDatalist as HTMLDataListElement | undefined;
    const inp = (renderField as any)._fieldInput as HTMLInputElement | undefined;
    if (!dl) return;
    dl.innerHTML = '';
    const fields = Array.from(new Set(fRecords.map((r) => r.Field))).sort();
    fields.forEach((f) => { const op = el('option'); op.value = String(f).includes('.') ? String(f).split('.').slice(1).join('.') : String(f); dl.appendChild(op); });
    if (inp) inp.placeholder = 'Field API name';
  }
  function renderFieldTable() {
    if (!fField) { msg('Pick a field.'); return; }
    const rows = fRecords.filter((r) => { const short = String(r.Field).includes('.') ? String(r.Field).split('.').slice(1).join('.') : String(r.Field); return short.toLowerCase() === fField.toLowerCase() || String(r.Field).toLowerCase() === fField.toLowerCase(); });
    scroll.innerHTML = '';
    if (!rows.length) { msg(`No FLS entries for ${fObj}.${fField}.`); return; }
    const readers = rows.filter((r) => r.PermissionsRead).length, editors = rows.filter((r) => r.PermissionsEdit).length;
    scroll.appendChild(el('div', { padding: '14px 24px', fontSize: '12.5px', color: C.muted, borderBottom: `1px solid ${C.divider}` }, `${fObj}.${fField} — Read: ${readers} · Edit: ${editors}`));
    const table = buildTable([{ label: 'Access For' }, { label: 'Type' }, { label: 'R E' }]);
    const tb = table.querySelector('tbody')!;
    rows.sort((a, b) => (b.Parent?.IsOwnedByProfile ? 1 : 0) - (a.Parent?.IsOwnedByProfile ? 1 : 0)).forEach((r, i) => {
      const { label, type } = parentLabel(r.Parent);
      const tr = el('tr', { background: i % 2 ? C.zebra : '' });
      tr.appendChild(el('td', { ...td(), fontWeight: '600' }, label));
      const tt = el('td', td()); tt.appendChild(typeChip(type)); tr.appendChild(tt);
      const ft = el('td', td()); ft.appendChild(flagCell(r, FIELD_FLAGS)); tr.appendChild(ft);
      tb.appendChild(tr);
    });
    scroll.appendChild(legend('R Read · E Edit'));
    scroll.appendChild(table);
  }

  // ════════ USER ACCESS ════════
  let userList: { id: string; name: string }[] | null = null;
  let userSel = '';
  function renderUser() {
    const wrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: C.muted });
    wrap.appendChild(document.createTextNode('User:'));
    const sel = el('select', { padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', minWidth: '260px', maxWidth: '340px' }) as HTMLSelectElement;
    const ph = el('option'); ph.value = ''; ph.textContent = '— select a user —'; sel.appendChild(ph);
    sel.addEventListener('change', () => { userSel = sel.value; loadUser(); });
    wrap.appendChild(sel);
    controls.appendChild(wrap);
    controls.appendChild(el('span', { fontSize: '12px', color: C.muted }, "A user's profile, permission sets, and effective object access."));
    const fill = (list: { id: string; name: string }[]) => { list.forEach((u) => { const o = el('option'); o.value = u.id; o.textContent = u.name; if (u.id === userSel) o.selected = true; sel.appendChild(o); }); };
    if (userList) fill(userList);
    else deps.runQuery('SELECT Id, Name, Username FROM User WHERE IsActive = true ORDER BY Name LIMIT 2000').then(({ records }) => { userList = (records || []).map((u: any) => ({ id: u.Id, name: `${u.Name} (${u.Username})` })); fill(userList); });
    if (!userSel) { msg('Pick a user to see their access summary.'); return; }
    loadUser();
  }
  async function loadUser() {
    if (!userSel) return;
    msg('Loading user access…');
    const asg = await deps.runQuery(`SELECT PermissionSetId, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Profile.Name FROM PermissionSetAssignment WHERE AssigneeId = '${userSel}'`);
    if (asg.error) { msg('Could not load assignments:\n' + asg.error, C.faint); return; }
    const sets = asg.records || [];
    if (!sets.length) { msg('No permission set assignments found for this user.'); return; }
    const ids = sets.map((s: any) => s.PermissionSetId);
    const fields = OBJ_FLAGS.map(([, f]) => f).join(', ');
    const obj = await deps.runQuery(`SELECT SobjectType, ${fields} FROM ObjectPermissions WHERE ParentId IN (${ids.map((i: string) => `'${i}'`).join(',')}) LIMIT 5000`);
    // Aggregate (OR) per object.
    const eff = new Map<string, any>();
    (obj.records || []).forEach((r: any) => {
      const cur = eff.get(r.SobjectType) || {};
      OBJ_FLAGS.forEach(([, f]) => { cur[f] = cur[f] || !!r[f]; });
      eff.set(r.SobjectType, cur);
    });

    scroll.innerHTML = '';
    // Profile + permission sets summary
    const profile = sets.find((s: any) => s.PermissionSet?.IsOwnedByProfile);
    const permSets = sets.filter((s: any) => !s.PermissionSet?.IsOwnedByProfile);
    const sumBox = el('div', { padding: '16px 24px', borderBottom: `1px solid ${C.divider}`, display: 'flex', flexDirection: 'column', gap: '8px' });
    const pl = el('div', {});
    pl.appendChild(el('span', { fontSize: '12px', fontWeight: '700', color: C.muted }, 'PROFILE  '));
    pl.appendChild(el('span', { fontSize: '13.5px', fontWeight: '700' }, profile?.PermissionSet?.Profile?.Name || '—'));
    sumBox.appendChild(pl);
    const ps = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' });
    ps.appendChild(el('span', { fontSize: '12px', fontWeight: '700', color: C.muted, marginRight: '4px' }, `PERMISSION SETS (${permSets.length})`));
    if (!permSets.length) ps.appendChild(el('span', { fontSize: '12.5px', color: C.faint }, 'none'));
    permSets.forEach((s: any) => ps.appendChild(el('span', { fontSize: '12px', padding: '3px 10px', borderRadius: '999px', background: 'rgba(168,85,247,0.14)', color: isDark ? '#c4b5fd' : '#7c3aed', fontWeight: '600' }, s.PermissionSet?.Label || s.PermissionSetId)));
    sumBox.appendChild(ps);
    scroll.appendChild(sumBox);

    scroll.appendChild(el('div', { padding: '12px 24px 4px', fontSize: '13px', fontWeight: '800' }, `Effective Object Access (${eff.size} objects)`));
    scroll.appendChild(legend('Combined across the profile + all permission sets · C Create · R Read · E Edit · D Delete · V View All · M Modify All'));
    const table = buildTable([{ label: 'Object' }, { label: 'C R E D V M' }]);
    const tb = table.querySelector('tbody')!;
    Array.from(eff.keys()).sort().forEach((name, i) => {
      const r = eff.get(name);
      const tr = el('tr', { background: i % 2 ? C.zebra : '' });
      tr.appendChild(el('td', { ...td(), fontWeight: '600', fontFamily: 'monospace', fontSize: '12.5px' }, name));
      const ft = el('td', td()); ft.appendChild(flagCell(r, OBJ_FLAGS)); tr.appendChild(ft);
      tb.appendChild(tr);
    });
    scroll.appendChild(table);
  }

  function legend(text: string): HTMLElement {
    return el('div', { padding: '8px 24px', fontSize: '11.5px', color: C.muted, borderBottom: `1px solid ${C.divider}` }, `${text} · green = granted, struck-through = not granted`);
  }

  paintSeg();
  render();
}
