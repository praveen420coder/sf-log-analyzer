// Permission Comparison: pick two permission sets / profiles and compare their
// object- and field-level access side by side ("Name Access Comparison").
// Backend-agnostic: all data comes through the injected runQuery (METADATA_QUERY).

export interface PermCompareDeps {
  isDark: boolean;
  onBack: () => void;
  runQuery: (soql: string) => Promise<{ records: any[]; error?: string }>;
  flashToast: (msg: string) => void;
}

interface Entity { id: string; label: string; isProfile: boolean; }

const OBJ_FLAGS: [string, string][] = [
  ['C', 'PermissionsCreate'], ['R', 'PermissionsRead'], ['E', 'PermissionsEdit'],
  ['D', 'PermissionsDelete'], ['V', 'PermissionsViewAllRecords'], ['M', 'PermissionsModifyAllRecords'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

export function renderPermissionCompareInto(host: HTMLElement, deps: PermCompareDeps): void {
  const isDark = deps.isDark;
  const C = {
    bg: isDark ? '#0e1626' : '#ffffff',
    panel: isDark ? '#111c30' : '#ffffff',
    headerBg: isDark ? '#16223b' : '#eef2f7',
    text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? '#94a3b8' : '#64748b',
    faint: isDark ? 'rgba(148,163,184,0.45)' : 'rgba(31,41,55,0.35)',
    border: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,0,0,0.12)',
    divider: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)',
    accent: '#3b82f6',
    grant: isDark ? '#4ade80' : '#16a34a',
    diff: isDark ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.12)',
    zebra: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
  };

  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  // header
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 24px 12px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontFamily: 'inherit', fontSize: '13px', fontWeight: '700' });
  back.innerHTML = '<span style="font-size:15px">←</span> Tools';
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  head.appendChild(el('span', { color: C.faint }, '/'));
  head.appendChild(el('div', { fontSize: '15px', fontWeight: '800', color: C.text }, '🔐 Name Access Comparison'));
  root.appendChild(head);

  // pickers
  const pickerBar = el('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(pickerBar);
  const mkSelect = () => {
    const s = el('select', { flex: '1', minWidth: '180px', maxWidth: '320px', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit' }) as HTMLSelectElement;
    return s;
  };
  const selA = mkSelect();
  const selB = mkSelect();
  pickerBar.appendChild(labelled('A', selA));
  pickerBar.appendChild(el('span', { color: C.muted, fontWeight: '800' }, 'vs'));
  pickerBar.appendChild(labelled('B', selB));

  function labelled(letter: string, sel: HTMLSelectElement): HTMLElement {
    const w = el('label', { display: 'inline-flex', alignItems: 'center', gap: '8px', flex: '1', minWidth: '180px', maxWidth: '340px' });
    const b = el('span', { width: '22px', height: '22px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '800', color: '#fff', background: letter === 'A' ? '#6366f1' : '#a855f7', flexShrink: '0' }, letter);
    w.appendChild(b); w.appendChild(sel);
    return w;
  }

  // sub-tabs + controls
  const ctrl = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 24px', flexWrap: 'wrap', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(ctrl);
  let mode: 'objects' | 'fields' = 'objects';
  const seg = el('div', { display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' });
  const segBtns: Record<string, HTMLButtonElement> = {};
  (['objects', 'fields'] as const).forEach((m) => {
    const b = el('button', { background: 'transparent', border: 'none', padding: '6px 14px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit', color: C.muted }, m === 'objects' ? 'Objects' : 'Fields');
    b.addEventListener('click', () => { mode = m; paintSeg(); render(); });
    segBtns[m] = b; seg.appendChild(b);
  });
  const paintSeg = () => Object.entries(segBtns).forEach(([m, b]) => Object.assign(b.style, { background: mode === m ? C.accent : 'transparent', color: mode === m ? '#fff' : C.muted, fontWeight: mode === m ? '700' : '500' }));
  ctrl.appendChild(seg);

  const objSelWrap = el('label', { display: 'none', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: C.muted });
  objSelWrap.appendChild(document.createTextNode('Object:'));
  const objSel = el('select', { padding: '6px 8px', fontSize: '12.5px', borderRadius: '6px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', maxWidth: '220px' }) as HTMLSelectElement;
  objSel.addEventListener('change', () => render());
  objSelWrap.appendChild(objSel);
  ctrl.appendChild(objSelWrap);

  const search = el('input', { padding: '6px 10px', fontSize: '12.5px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', minWidth: '160px' }) as HTMLInputElement;
  search.placeholder = 'Filter by name…';
  let searchVal = '';
  search.addEventListener('input', () => { searchVal = search.value.trim().toLowerCase(); render(); });
  ctrl.appendChild(search);

  const diffLbl = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: C.muted, cursor: 'pointer' });
  const diffChk = el('input') as HTMLInputElement; diffChk.type = 'checkbox'; diffChk.style.cursor = 'pointer';
  let diffOnly = false;
  diffChk.addEventListener('change', () => { diffOnly = diffChk.checked; render(); });
  diffLbl.appendChild(diffChk); diffLbl.appendChild(document.createTextNode('Differences only'));
  ctrl.appendChild(diffLbl);

  const count = el('span', { marginLeft: 'auto', fontSize: '12px', color: C.muted });
  ctrl.appendChild(count);

  // Always-visible legend explaining the access flags.
  const legendStrip = el('div', { padding: '8px 24px', fontSize: '11.5px', color: C.muted, flexShrink: '0', borderBottom: `1px solid ${C.divider}`, lineHeight: '1.6' });
  root.appendChild(legendStrip);
  const flagDef = (letter: string, name: string) => `<b style="color:${C.text};font-family:monospace">${letter}</b>&nbsp;${name}`;
  const OBJ_LEGEND = [['C', 'Create'], ['R', 'Read'], ['E', 'Edit'], ['D', 'Delete'], ['V', 'View All'], ['M', 'Modify All']];
  const FIELD_LEGEND = [['R', 'Read'], ['E', 'Edit']];
  const updateLegend = () => {
    const defs = (mode === 'objects' ? OBJ_LEGEND : FIELD_LEGEND).map(([l, n]) => flagDef(l, n)).join(' &nbsp;·&nbsp; ');
    legendStrip.innerHTML = `Access: ${defs}<br><span style="color:${C.grant}">■</span> granted &nbsp;·&nbsp; <span style="text-decoration:line-through;opacity:.7">A</span> not granted &nbsp;·&nbsp; <span style="background:${C.diff};padding:0 6px;border-radius:4px">amber row</span> differs`;
  };

  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto' });
  root.appendChild(scroll);

  // ── data ──
  let entities: Entity[] = [];
  let objCache: { key: string; a: Map<string, any>; b: Map<string, any>; objects: string[] } | null = null;
  const labelOf = (id: string) => entities.find((e) => e.id === id)?.label || id;

  const msg = (txt: string) => { scroll.innerHTML = ''; scroll.appendChild(el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, txt)); };

  // load entity list
  msg('Loading permission sets & profiles…');
  deps.runQuery("SELECT Id, Label, Name, IsOwnedByProfile, Profile.Name FROM PermissionSet ORDER BY IsOwnedByProfile DESC, Label LIMIT 2000").then(({ records, error }) => {
    if (error) { msg('Could not load permission sets: ' + error); return; }
    entities = records.map((r: any) => ({
      id: r.Id,
      isProfile: !!r.IsOwnedByProfile,
      label: r.IsOwnedByProfile ? `Profile: ${r.Profile?.Name || r.Label}` : r.Label || r.Name,
    })).sort((a: Entity, b: Entity) => a.label.localeCompare(b.label));
    populate(selA); populate(selB);
    // Default to None — the user picks A and B explicitly.
    selA.selectedIndex = 0; selB.selectedIndex = 0;
    paintSeg();
    render();
  });

  function populate(sel: HTMLSelectElement) {
    sel.innerHTML = '';
    const ph = el('option'); ph.value = ''; ph.textContent = '— select —'; sel.appendChild(ph);
    const profiles = entities.filter((e) => e.isProfile);
    const psets = entities.filter((e) => !e.isProfile);
    const addGroup = (name: string, list: Entity[]) => {
      if (!list.length) return;
      const og = document.createElement('optgroup'); og.label = name;
      list.forEach((e) => { const o = el('option'); o.value = e.id; o.textContent = e.label.replace(/^Profile:\s*/, ''); og.appendChild(o); });
      sel.appendChild(og);
    };
    addGroup('Profiles', profiles);
    addGroup('Permission Sets', psets);
  }
  selA.addEventListener('change', () => { objCache = null; render(); });
  selB.addEventListener('change', () => { objCache = null; render(); });

  // ── render ──
  const flagsEqual = (a: any, b: any) => OBJ_FLAGS.every(([, f]) => !!a?.[f] === !!b?.[f]);
  const flagCell = (rec: any, pairs: [string, string][]) => {
    const d = el('div', { display: 'flex', gap: '5px', fontFamily: 'monospace', fontSize: '12px', fontWeight: '700' });
    pairs.forEach(([letter, field]) => {
      const on = !!rec?.[field];
      d.appendChild(el('span', { color: on ? C.grant : C.faint, textDecoration: on ? 'none' : 'line-through', opacity: on ? '1' : '0.6' }, letter));
    });
    return d;
  };

  async function render() {
    updateLegend();
    const aId = selA.value, bId = selB.value;
    objSelWrap.style.display = mode === 'fields' ? 'inline-flex' : 'none';
    if (!aId || !bId) { msg('Select a permission set or profile for both A and B to compare.'); count.textContent = ''; return; }
    if (aId === bId) { msg('Pick two different entries to compare.'); count.textContent = ''; return; }

    if (mode === 'objects') return renderObjects(aId, bId);
    return renderFields(aId, bId);
  }

  async function renderObjects(aId: string, bId: string) {
    const cacheKey = `${aId}|${bId}`;
    if (!objCache || objCache.key !== cacheKey) {
      msg('Loading object permissions…');
      const fields = OBJ_FLAGS.map(([, f]) => f).join(', ');
      const { records, error } = await deps.runQuery(`SELECT ParentId, SobjectType, ${fields} FROM ObjectPermissions WHERE ParentId IN ('${aId}','${bId}') LIMIT 5000`);
      if (error) { msg('Could not load object permissions: ' + error); return; }
      const a = new Map<string, any>(), b = new Map<string, any>();
      records.forEach((r: any) => (r.ParentId === aId ? a : b).set(r.SobjectType, r));
      const objects = Array.from(new Set([...a.keys(), ...b.keys()])).sort();
      objCache = { key: cacheKey, a, b, objects };
      // populate object dropdown for the Fields tab
      const cur = objSel.value;
      objSel.innerHTML = '';
      objects.forEach((o) => { const op = el('option'); op.value = o; op.textContent = o; objSel.appendChild(op); });
      if (cur && objects.includes(cur)) objSel.value = cur;
    }
    const { a, b, objects } = objCache;
    let rows = objects.filter((o) => !searchVal || o.toLowerCase().includes(searchVal));
    if (diffOnly) rows = rows.filter((o) => !flagsEqual(a.get(o), b.get(o)));
    count.textContent = `${rows.length} object${rows.length === 1 ? '' : 's'}`;

    const table = buildTable(['Object', labelOf(aId), labelOf(bId)]);
    const tb = table.querySelector('tbody')!;
    rows.forEach((o, i) => {
      const ra = a.get(o), rb = b.get(o);
      const differ = !flagsEqual(ra, rb);
      const tr = el('tr', { background: differ ? C.diff : (i % 2 ? C.zebra : '') });
      tr.appendChild(el('td', tdName(), o));
      const ca = el('td', tdCell()); ca.appendChild(flagCell(ra, OBJ_FLAGS)); tr.appendChild(ca);
      const cb = el('td', tdCell()); cb.appendChild(flagCell(rb, OBJ_FLAGS)); tr.appendChild(cb);
      tb.appendChild(tr);
    });
    finish(table, rows.length, 'No objects match.');
  }

  async function renderFields(aId: string, bId: string) {
    const obj = objSel.value || objCache?.objects[0];
    if (!obj) { msg('Open the Objects tab first (it lists the objects to pick from), then choose an object here.'); count.textContent = ''; return; }
    msg(`Loading field permissions for ${obj}…`);
    const { records, error } = await deps.runQuery(`SELECT ParentId, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${obj}' AND ParentId IN ('${aId}','${bId}') LIMIT 5000`);
    if (error) { msg('Could not load field permissions: ' + error); return; }
    const a = new Map<string, any>(), b = new Map<string, any>();
    records.forEach((r: any) => (r.ParentId === aId ? a : b).set(r.Field, r));
    const FLAGS: [string, string][] = [['R', 'PermissionsRead'], ['E', 'PermissionsEdit']];
    const eq = (x: any, y: any) => FLAGS.every(([, f]) => !!x?.[f] === !!y?.[f]);
    let fields = Array.from(new Set([...a.keys(), ...b.keys()])).sort();
    const short = (f: string) => f.includes('.') ? f.split('.').slice(1).join('.') : f;
    if (searchVal) fields = fields.filter((f) => short(f).toLowerCase().includes(searchVal));
    if (diffOnly) fields = fields.filter((f) => !eq(a.get(f), b.get(f)));
    count.textContent = `${fields.length} field${fields.length === 1 ? '' : 's'}`;

    const table = buildTable(['Field', labelOf(aId), labelOf(bId)]);
    const tb = table.querySelector('tbody')!;
    fields.forEach((f, i) => {
      const ra = a.get(f), rb = b.get(f);
      const differ = !eq(ra, rb);
      const tr = el('tr', { background: differ ? C.diff : (i % 2 ? C.zebra : '') });
      tr.appendChild(el('td', tdName(), short(f)));
      const ca = el('td', tdCell()); ca.appendChild(flagCell(ra, FLAGS)); tr.appendChild(ca);
      const cb = el('td', tdCell()); cb.appendChild(flagCell(rb, FLAGS)); tr.appendChild(cb);
      tb.appendChild(tr);
    });
    finish(table, fields.length, 'No fields match.');
  }

  // ── table helpers ──
  function buildTable(headers: string[]): HTMLTableElement {
    const t = el('table', { borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' });
    const thead = el('thead'); const htr = el('tr');
    headers.forEach((h, i) => {
      const th = el('th', { position: 'sticky', top: '0', textAlign: 'left', padding: '8px 14px', background: C.headerBg, color: C.text, fontWeight: '700', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`, zIndex: '1', maxWidth: i === 0 ? '' : '220px' } as Partial<CSSStyleDeclaration>, h);
      htr.appendChild(th);
    });
    thead.appendChild(htr); t.appendChild(thead); t.appendChild(el('tbody'));
    return t;
  }
  const tdName = (): Partial<CSSStyleDeclaration> => ({ padding: '6px 14px', borderBottom: `1px solid ${C.divider}`, color: C.text, whiteSpace: 'nowrap', maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace', fontSize: '12px' });
  const tdCell = (): Partial<CSSStyleDeclaration> => ({ padding: '6px 14px', borderBottom: `1px solid ${C.divider}` });
  function finish(table: HTMLTableElement, n: number, emptyMsg: string) {
    scroll.innerHTML = '';
    if (n === 0) { scroll.appendChild(el('div', { padding: '20px', color: C.muted, fontSize: '13px' }, emptyMsg)); return; }
    scroll.appendChild(table);
  }
}
