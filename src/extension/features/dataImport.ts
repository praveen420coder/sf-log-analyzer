// Data Import Wizard — paste/upload CSV or TSV, map columns to fields, and
// insert / update / upsert / delete via the REST Composite sObject Collections
// API (≤200 per batch). Field-mapping model follows Salesforce Inspector
// reloaded (MIT © Thomas Prouvot): the column header IS the target field name,
// validated against the importable-field set, with "Unknown field" + Skip.
// This is an independent, modern-UI reimplementation.

import { createIdLink } from '../lib/idMenu';
import { getTheme } from '../lib/theme';

export interface ImportField { name: string; label: string; type: string; createable: boolean; updateable: boolean; externalId: boolean; idLookup: boolean; }
export interface DataImportDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (m: string) => void;
  listObjects: () => Promise<{ name: string; label: string }[]>;
  describeObject: (name: string) => Promise<{ fields: ImportField[]; error?: string }>;
  runImport: (payload: any) => Promise<{ results?: any[]; error?: string }>;
  recordUrl: (id: string) => string;
  fetchRecord: (id: string, sobject?: string) => Promise<{ data?: { recordName: string; objectLabel: string; fields: { label: string; apiName: string; value: any }[] }; error?: string }>;
}

type Op = 'insert' | 'update' | 'upsert' | 'delete';
const OPS: { id: Op; label: string }[] = [
  { id: 'insert', label: 'Insert' }, { id: 'update', label: 'Update' },
  { id: 'upsert', label: 'Upsert' }, { id: 'delete', label: 'Delete' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

function parseDelimited(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!t) return [];
  const firstLine = t.split('\n')[0];
  const delim = firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) { if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field); rows.push(row);
  return rows;
}

export function renderDataImportInto(host: HTMLElement, deps: DataImportDeps): void {
  const isDark = deps.isDark;
  const C = getTheme(isDark);
  const inp = (extra?: Partial<CSSStyleDeclaration>) => ({ padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', ...extra } as Partial<CSSStyleDeclaration>);
  const btn = (bg: string, fg: string) => ({ background: bg, color: fg, border: bg === 'transparent' ? `1px solid ${C.border}` : 'none', borderRadius: '8px', padding: '7px 14px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '700', fontFamily: 'inherit' } as Partial<CSSStyleDeclaration>);

  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  // ── state ──
  let sobject = '', op: Op = 'insert', extId = 'Id', batchSize = 200, allOrNone = false;
  let fields: ImportField[] = [];
  let table: string[][] = [];      // parsed rows incl header
  let mapping: string[] = [];      // per column: field name or '' (skip)
  let importing = false;
  let importResults: { row: number; success: boolean; id: string; error: string; action: string }[] = [];

  // ── header ──
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 24px 12px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontFamily: 'inherit', fontSize: '13px', fontWeight: '700' });
  back.innerHTML = '<span style="font-size:15px">←</span> Tools';
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  head.appendChild(el('span', { color: C.faint }, '/'));
  head.appendChild(el('div', { fontSize: '15px', fontWeight: '800' }, '⬆️ Data Import'));
  root.appendChild(head);

  // ── top region: Configure Import (left) + Field Mapping (right), two cards ──
  const topRow = el('div', { display: 'flex', gap: '16px', padding: '14px 24px', height: '40vh', minHeight: '260px', boxSizing: 'border-box', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(topRow);
  const card = (extra?: Partial<CSSStyleDeclaration>) => el('div', { display: 'flex', flexDirection: 'column', minHeight: '0', border: `1px solid ${C.border}`, borderRadius: '12px', background: C.panel, overflow: 'hidden', ...extra });
  const cardTitle = (t: string, right?: HTMLElement) => { const h = el('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 16px', borderBottom: `1px solid ${C.divider}`, flexShrink: '0' }); h.appendChild(el('div', { fontSize: '13.5px', fontWeight: '800' }, t)); if (right) { right.style.marginLeft = 'auto'; h.appendChild(right); } return h; };

  // Configure Import card
  const cfgCard = card({ flex: '0 0 40%', minWidth: '0' });
  topRow.appendChild(cfgCard);
  cfgCard.appendChild(cardTitle('Configure Import'));
  const cfgBody = el('div', { padding: '12px 16px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '11px' });
  cfgCard.appendChild(cfgBody);
  const cfgRow = (label: string, control: HTMLElement) => { const r = el('div', { display: 'flex', alignItems: 'center', gap: '12px' }); r.appendChild(el('div', { width: '84px', flexShrink: '0', fontSize: '12.5px', color: C.muted, fontWeight: '600' }, label)); const cw = el('div', { flex: '1', minWidth: '0' }); cw.appendChild(control); r.appendChild(cw); return r; };
  const objSel = el('select', inp({ width: '100%' })) as HTMLSelectElement;
  objSel.appendChild(Object.assign(el('option'), { value: '', textContent: 'Loading…' }));
  objSel.addEventListener('change', () => { sobject = objSel.value; loadFields(); });
  cfgBody.appendChild(cfgRow('Object', objSel));
  const opSel = el('select', inp({ width: '100%' })) as HTMLSelectElement;
  OPS.forEach((o) => { const e = el('option'); e.value = o.id; e.textContent = o.label; opSel.appendChild(e); });
  opSel.addEventListener('change', () => { op = opSel.value as Op; renderExtras(); autoMap(); renderMap(); renderTable(); });
  cfgBody.appendChild(cfgRow('Operation', opSel));
  const extras = el('div', { display: 'flex', flexDirection: 'column', gap: '11px' });
  cfgBody.appendChild(extras);
  function renderExtras() {
    extras.innerHTML = '';
    if (op === 'upsert') {
      const s = el('select', inp({ width: '100%' })) as HTMLSelectElement;
      const io = el('option'); io.value = 'Id'; io.textContent = 'Id'; s.appendChild(io);
      fields.filter((f) => f.externalId || f.idLookup).forEach((f) => { const o = el('option'); o.value = f.name; o.textContent = f.name; s.appendChild(o); });
      s.value = extId; s.addEventListener('change', () => { extId = s.value; });
      extras.appendChild(cfgRow('External Id', s));
    }
    const bi = el('input', inp({ width: '90px' })) as HTMLInputElement; bi.type = 'number'; bi.min = '1'; bi.max = '200'; bi.value = String(batchSize);
    bi.addEventListener('change', () => { batchSize = Math.max(1, Math.min(200, Number(bi.value) || 200)); bi.value = String(batchSize); });
    extras.appendChild(cfgRow('Batch size', bi));
    const ac = el('input') as HTMLInputElement; ac.type = 'checkbox'; ac.checked = allOrNone; ac.style.cursor = 'pointer';
    ac.addEventListener('change', () => { allOrNone = ac.checked; });
    const aw = el('label', { display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', color: C.text, cursor: 'pointer' }); aw.appendChild(ac); aw.appendChild(document.createTextNode('All or none (roll back the batch on any error)'));
    extras.appendChild(cfgRow('Options', aw));
  }
  renderExtras();
  // Data row: small paste box (clears after paste) + load-file + parsed-count
  const dataCtl = el('div', { display: 'flex', flexDirection: 'column', gap: '6px' });
  const dataTop = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
  const rowsLbl = el('div', { fontSize: '11.5px', color: C.faint }, 'No data yet');
  const fileBtn = el('button', { ...btn('transparent', C.text), padding: '4px 10px', fontSize: '11.5px', marginLeft: 'auto' }, '📁 Load file');
  const fileInp = el('input', { display: 'none' }) as HTMLInputElement; fileInp.type = 'file'; fileInp.accept = '.csv,.tsv,.txt';
  fileBtn.addEventListener('click', () => fileInp.click());
  fileInp.addEventListener('change', () => { const f = fileInp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ta.value = String(r.result || ''); parseData(); ta.value = ''; }; r.readAsText(f); });
  dataTop.appendChild(rowsLbl); dataTop.appendChild(fileBtn); dataTop.appendChild(fileInp);
  const ta = el('textarea', { width: '100%', boxSizing: 'border-box', minHeight: '52px', maxHeight: '120px', padding: '8px 10px', fontSize: '12px', fontFamily: 'monospace', borderRadius: '8px', border: `1px dashed ${C.border}`, background: C.zebra, color: C.text, outline: 'none', resize: 'vertical' }) as HTMLTextAreaElement;
  ta.placeholder = 'Paste data here — CSV or TSV, first row = headers';
  ta.addEventListener('paste', () => setTimeout(() => { parseData(); ta.value = ''; }, 0));
  dataCtl.appendChild(dataTop); dataCtl.appendChild(ta);
  cfgBody.appendChild(cfgRow('Data', dataCtl));

  // Field Mapping card
  const mapCard = card({ flex: '1 1 60%', minWidth: '0', background: C.side });
  topRow.appendChild(mapCard);
  const mapCount = el('span', { fontSize: '11.5px', color: C.muted });
  const mapHead = cardTitle('Field Mapping', mapCount);
  mapCard.appendChild(mapHead);
  const mapTools = el('div', { display: 'flex', gap: '8px', alignItems: 'center', padding: '9px 16px', borderBottom: `1px solid ${C.divider}`, flexShrink: '0' });
  const colFilter = el('input', inp({ flex: '1', minWidth: '0', padding: '6px 9px', fontSize: '12px' })) as HTMLInputElement;
  colFilter.placeholder = 'Filter columns…';
  colFilter.addEventListener('input', () => renderMap());
  const autoBtn = el('button', { ...btn('transparent', C.accent), padding: '6px 11px', fontSize: '12px', borderColor: C.accent } as Partial<CSSStyleDeclaration>, 'Auto-map');
  autoBtn.addEventListener('click', () => { autoMap(); renderMap(); renderTable(); });
  const skipUnknownBtn = el('button', { ...btn('transparent', C.text), padding: '6px 11px', fontSize: '12px' }, 'Skip unknown');
  skipUnknownBtn.addEventListener('click', () => { mapping = mapping.map((m) => (isValid(m) ? m : '')); renderMap(); renderTable(); });
  mapTools.appendChild(colFilter); mapTools.appendChild(autoBtn); mapTools.appendChild(skipUnknownBtn);
  mapCard.appendChild(mapTools);
  const mapList = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '4px 0' });
  mapCard.appendChild(mapList);

  // ── main: run bar + data/results table (full width, below the top row) ──
  const main = el('div', { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' });
  root.appendChild(main);
  const runBarHost = el('div', { flexShrink: '0' });
  const tableHost = el('div', { flex: '1', minHeight: '0', overflow: 'auto' });
  main.appendChild(runBarHost); main.appendChild(tableHost);

  // datalist of valid field names (shared by all mapping inputs)
  const dl = document.createElement('datalist'); dl.id = 'sf-import-fields'; root.appendChild(dl);

  // ── field-set helpers (Inspector rules) ──
  function validNames(): Set<string> {
    if (op === 'delete') return new Set(['id']);
    const s = new Set<string>();
    fields.forEach((f) => { if (f.createable || f.updateable) s.add(f.name.toLowerCase()); });
    if (op === 'update' || op === 'upsert') fields.forEach((f) => { if (f.idLookup) s.add(f.name.toLowerCase()); });
    return s;
  }
  let validSet = validNames();
  const isValid = (name: string) => !!name && validSet.has(name.toLowerCase());
  const canonical = (name: string) => { const f = fields.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()); return f ? f.name : name.trim(); };

  // ── load objects ──
  deps.listObjects().then((objs) => {
    objSel.innerHTML = '';
    objSel.appendChild(Object.assign(el('option'), { value: '', textContent: '— select object —' }));
    objs.forEach((o) => { const e = el('option'); e.value = o.name; e.textContent = `${o.label} (${o.name})`; objSel.appendChild(e); });
  });

  async function loadFields() {
    fields = []; validSet = validNames();
    renderMap();
    if (!sobject) return;
    const { fields: fs, error } = await deps.describeObject(sobject);
    if (error) { deps.flashToast('Describe failed: ' + error); return; }
    fields = fs; validSet = validNames();
    dl.innerHTML = '';
    fields.forEach((f) => { const o = el('option'); o.value = f.name; dl.appendChild(o); });
    renderExtras(); autoMap(); renderMap(); renderTable();
  }

  function autoMap() {
    if (!table.length) return;
    // Header IS the field name (canonicalised to real casing where it exists).
    mapping = table[0].map((h) => canonical(h));
  }

  function parseData() {
    const rows = parseDelimited(ta.value);
    table = rows.filter((r) => r.some((c) => c.trim() !== ''));
    importResults = [];
    rowsLbl.textContent = table.length ? `✓ ${table.length - 1} row${table.length - 1 === 1 ? '' : 's'}, ${table[0].length} columns` : 'No data yet';
    rowsLbl.style.color = table.length ? C.ok : C.faint;
    autoMap();
    renderMap(); renderTable();
  }

  // ── Field Mapping panel ──
  function renderMap() {
    validSet = validNames();
    mapList.innerHTML = '';
    if (!table.length) { mapCount.textContent = ''; mapList.appendChild(el('div', { padding: '18px 14px', color: C.muted, fontSize: '12.5px' }, 'Paste data to map columns.')); return; }
    if (!sobject) { mapCount.textContent = ''; mapList.appendChild(el('div', { padding: '18px 14px', color: C.muted, fontSize: '12.5px' }, 'Select an object.')); return; }
    if (!fields.length) { mapCount.textContent = ''; mapList.appendChild(el('div', { padding: '18px 14px', color: C.muted, fontSize: '12.5px' }, `Loading ${sobject} fields…`)); return; }

    const headers = table[0];
    const q = colFilter.value.trim().toLowerCase();
    const mapped = mapping.filter((m) => isValid(m)).length;
    mapCount.textContent = `${mapped}/${headers.length} mapped`;

    headers.forEach((h, i) => {
      if (q && !(h || '').toLowerCase().includes(q) && !(mapping[i] || '').toLowerCase().includes(q)) return;
      const val = mapping[i] || '';
      const valid = isValid(val);
      const empty = !val;
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 16px', borderBottom: `1px solid ${C.divider}` });
      const src = el('div', { width: '190px', flexShrink: '0', fontSize: '12px', fontWeight: '700', color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, h || `(col ${i + 1})`);
      src.title = h;
      row.appendChild(src);
      row.appendChild(el('span', { color: C.faint, flexShrink: '0', fontSize: '12px' }, '→'));
      const fi = el('input', inp({ flex: '1', minWidth: '0', padding: '6px 9px', fontSize: '12.5px', border: `1px solid ${empty ? C.border : valid ? C.ok : C.fail}` })) as HTMLInputElement;
      fi.setAttribute('list', dl.id); fi.value = val; fi.placeholder = '— skip —';
      fi.addEventListener('input', () => { mapping[i] = fi.value.trim(); const v2 = isValid(mapping[i]); fi.style.borderColor = !mapping[i] ? C.border : v2 ? C.ok : C.fail; mapCount.textContent = `${mapping.filter((m) => isValid(m)).length}/${headers.length} mapped`; refreshRowStatus(); });
      fi.addEventListener('change', () => { mapping[i] = canonical(fi.value); fi.value = mapping[i]; renderMap(); renderTable(); });
      row.appendChild(fi);
      const status = el('div', { width: '78px', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' });
      const refreshRowStatus = () => {
        status.innerHTML = '';
        const v = mapping[i];
        if (!v) { status.appendChild(el('span', { fontSize: '11px', color: C.faint }, 'skip')); return; }
        if (isValid(v)) { status.appendChild(el('span', { fontSize: '13px', color: C.ok }, '✓')); return; }
        status.appendChild(el('span', { fontSize: '11px', color: C.fail, whiteSpace: 'nowrap' }, 'Unknown'));
        const sk = el('button', { ...btn('transparent', C.accent), padding: '3px 8px', fontSize: '11px' }, 'Skip');
        sk.addEventListener('click', () => { mapping[i] = ''; renderMap(); renderTable(); });
        status.appendChild(sk);
      };
      refreshRowStatus();
      row.appendChild(status);
      mapList.appendChild(row);
    });
  }

  // Id → popover menu (Go to record / View record data / Copy Id), shared with the Export table.
  const idLink = (id: string) => { const a = createIdLink(id, { isDark, recordUrl: deps.recordUrl, fetchRecord: deps.fetchRecord, flashToast: deps.flashToast }, sobject); a.style.fontSize = '11.5px'; return a; };

  // ── data / results table (left) ──
  function renderTable() {
    runBarHost.innerHTML = ''; tableHost.innerHTML = '';
    if (!table.length) { tableHost.appendChild(el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'Paste data above to begin.')); return; }
    const headers = table[0];
    const dataRows = table.slice(1);
    const done = importResults.length > 0;
    const resById = new Map<number, typeof importResults[number]>();
    importResults.forEach((r) => resById.set(r.row, r));

    // run bar
    const runBar = el('div', { display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 24px', flexWrap: 'wrap', borderBottom: `1px solid ${C.divider}` });
    const runBtn = el('button', btn(C.accent, '#fff'), `${OPS.find((o) => o.id === op)!.label} ${dataRows.length} record${dataRows.length === 1 ? '' : 's'}`);
    const progressWrap = el('div', { display: 'none', alignItems: 'center', gap: '10px' });
    const track = el('div', { width: '160px', height: '8px', borderRadius: '999px', background: C.zebra, overflow: 'hidden' });
    const bar = el('div', { width: '0%', height: '8px', background: C.accent }); track.appendChild(bar);
    const pText = el('span', { fontSize: '12px', color: C.muted }); progressWrap.appendChild(track); progressWrap.appendChild(pText);
    runBtn.addEventListener('click', () => doImport(dataRows, runBtn, progressWrap, bar, pText));
    runBar.appendChild(runBtn); runBar.appendChild(progressWrap);
    if (done) {
      const ok = importResults.filter((r) => r.success).length;
      runBar.appendChild(el('span', { fontSize: '13px', fontWeight: '700', color: C.ok }, `✓ ${ok}`));
      runBar.appendChild(el('span', { fontSize: '13px', fontWeight: '700', color: importResults.length - ok ? C.fail : C.muted }, `✗ ${importResults.length - ok}`));
      const exp = el('button', { ...btn('transparent', C.text), padding: '6px 12px', fontSize: '12px' }, '⬇ Export');
      exp.addEventListener('click', () => exportResults(headers, dataRows));
      runBar.appendChild(exp);
    }
    runBarHost.appendChild(runBar);

    // table
    const t = el('table', { borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' });
    const th: Partial<CSSStyleDeclaration> = { position: 'sticky', top: '0', textAlign: 'left', padding: '8px 12px', background: C.headerBg, color: C.text, fontWeight: '700', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`, zIndex: '1' };
    const resH = done ? ['__Status', '__Id', '__Action', '__Errors'] : [];
    const thead = el('thead'); const htr = el('tr');
    headers.forEach((h, i) => { const cell = el('th', th); const mapped = isValid(mapping[i]); cell.innerHTML = `${h}${mapped ? '' : ` <span style="color:${C.faint};font-weight:500;font-size:10px">(skip)</span>`}`; htr.appendChild(cell); });
    resH.forEach((h) => htr.appendChild(el('th', th, h)));
    thead.appendChild(htr); t.appendChild(thead);
    const tb = el('tbody');
    const tdS: Partial<CSSStyleDeclaration> = { padding: '6px 12px', borderBottom: `1px solid ${C.divider}`, whiteSpace: 'nowrap', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', color: C.text };
    const MAX = 3000;
    dataRows.slice(0, MAX).forEach((r, ri) => {
      const res = resById.get(ri);
      const tr = el('tr', { background: res && !res.success ? (isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)') : (ri % 2 ? C.zebra : '') });
      headers.forEach((_, ci) => tr.appendChild(el('td', { ...tdS, color: isValid(mapping[ci]) ? C.text : C.muted }, r[ci] ?? '')));
      if (done) {
        tr.appendChild(el('td', { ...tdS, color: res?.success ? C.ok : C.fail, fontWeight: '700' }, res ? (res.success ? 'Succeeded' : 'Failed') : '—'));
        const idTd = el('td', tdS);
        if (res?.id) idTd.appendChild(idLink(res.id));
        tr.appendChild(idTd);
        tr.appendChild(el('td', { ...tdS, color: C.muted }, res?.action || ''));
        tr.appendChild(el('td', { ...tdS, color: C.fail, whiteSpace: 'normal' }, res?.error || ''));
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb); tableHost.appendChild(t);
    if (dataRows.length > MAX) tableHost.appendChild(el('div', { padding: '8px 24px', fontSize: '11.5px', color: C.muted }, `Showing first ${MAX} of ${dataRows.length} rows.`));
  }

  function coerce(value: string, fieldName: string): any {
    const type = fields.find((x) => x.name === fieldName)?.type || '';
    if (type === 'boolean') return /^true$/i.test(value.trim());
    if (value === '') return null;
    return value;
  }

  function confirmDml(dataRows: string[][], activeCols: { m: string; i: number }[]): Promise<boolean> {
    return new Promise((resolve) => {
      const opLabel = OPS.find((o) => o.id === op)!.label;
      const danger = op === 'delete';
      const accent = danger ? C.fail : C.accent;
      const overlay = el('div', { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' });
      const done = (v: boolean) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
      document.addEventListener('keydown', onKey);
      const box = el('div', { width: '440px', maxWidth: '100%', background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '14px', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' });
      box.appendChild(el('div', { padding: '18px 20px 10px', fontSize: '16px', fontWeight: '800' }, `${danger ? '⚠️ ' : ''}Confirm ${opLabel}`));
      const bodyWrap = el('div', { padding: '0 20px 16px', fontSize: '13.5px', lineHeight: '1.55', color: C.text });
      const n = dataRows.length;
      const msg = op === 'delete'
        ? `Permanently delete ${n} ${sobject} record${n === 1 ? '' : 's'} in this org? This cannot be undone from here.`
        : `${opLabel} ${n} ${sobject} record${n === 1 ? '' : 's'} using ${activeCols.length} mapped field${activeCols.length === 1 ? '' : 's'}${op === 'upsert' ? ` (external Id: ${extId})` : ''}?`;
      bodyWrap.appendChild(el('div', {}, msg));
      const meta = el('div', { marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' });
      const chip = (t: string) => el('span', { fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '999px', background: C.zebra, color: C.muted }, t);
      meta.appendChild(chip(`Batch size ${batchSize}`));
      meta.appendChild(chip(allOrNone ? 'All-or-none ON' : 'All-or-none off'));
      if (op !== 'delete') activeCols.slice(0, 8).forEach((c) => meta.appendChild(chip(c.m)));
      if (op !== 'delete' && activeCols.length > 8) meta.appendChild(chip(`+${activeCols.length - 8} more`));
      bodyWrap.appendChild(meta);
      box.appendChild(bodyWrap);
      const foot = el('div', { display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '12px 20px 18px' });
      const cancel = el('button', { ...btn('transparent', C.text) }, 'Cancel');
      cancel.addEventListener('click', () => done(false));
      const ok = el('button', { ...btn(accent, '#fff') }, danger ? `Delete ${n}` : `${opLabel} ${n}`);
      ok.addEventListener('click', () => done(true));
      foot.appendChild(cancel); foot.appendChild(ok);
      box.appendChild(foot);
      overlay.appendChild(box); document.body.appendChild(overlay);
      ok.focus();
    });
  }

  async function doImport(dataRows: string[][], runBtn: HTMLButtonElement, progressWrap: HTMLElement, bar: HTMLElement, pText: HTMLElement) {
    if (importing) return;
    const activeCols = mapping.map((m, i) => ({ m, i })).filter((x) => isValid(x.m));
    if (op === 'delete') { if (!activeCols.some((x) => x.m.toLowerCase() === 'id')) { deps.flashToast('Map a column to Id for delete.'); return; } }
    else if (!activeCols.length) { deps.flashToast('Map at least one valid field.'); return; }
    else if (op === 'update' && !activeCols.some((x) => x.m.toLowerCase() === 'id')) { deps.flashToast('Update needs a column mapped to Id.'); return; }
    else if (op === 'upsert' && extId.toLowerCase() !== 'id' && !activeCols.some((x) => x.m.toLowerCase() === extId.toLowerCase())) { deps.flashToast(`Upsert needs the external Id field (${extId}) mapped.`); return; }

    if (!(await confirmDml(dataRows, activeCols))) return;

    importing = true; runBtn.disabled = true; runBtn.style.opacity = '0.55'; runBtn.style.cursor = 'not-allowed';
    progressWrap.style.display = 'flex'; importResults = [];
    const idCol = mapping.findIndex((m) => m.toLowerCase() === 'id');

    const items = dataRows.map((r, idx) => {
      if (op === 'delete') return { id: (idCol >= 0 ? r[idCol] : '') || '', row: idx };
      const rec: any = { attributes: { type: sobject } };
      activeCols.forEach(({ m, i }) => { rec[m] = coerce(r[i] ?? '', m); });
      return { record: rec, row: idx };
    }).filter((x) => op === 'delete' ? !!x.id : Object.keys(x.record!).length > 1);

    const total = items.length; let done = 0;
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const payload: any = { operation: op, sobject, externalIdField: extId, allOrNone };
      if (op === 'delete') payload.ids = chunk.map((c) => c.id); else payload.records = chunk.map((c) => c.record);
      const { results, error } = await deps.runImport(payload);
      const baseAction = op === 'insert' ? 'Inserted' : op === 'update' ? 'Updated' : op === 'delete' ? 'Deleted' : 'Upserted';
      if (error) chunk.forEach((c) => importResults.push({ row: c.row, success: false, id: '', error, action: '' }));
      else (results || []).forEach((res: any, j: number) => {
        const c = chunk[j];
        const errs = (res.errors || []).map((e: any) => `${e.statusCode || ''}: ${e.message || ''}${e.fields?.length ? ' [' + e.fields.join(',') + ']' : ''}`).join('; ');
        const action = op === 'upsert' ? (res.created ? 'Inserted' : 'Updated') : baseAction;
        importResults.push({ row: c.row, success: !!res.success, id: res.id || '', error: res.success ? '' : (errs || 'Failed'), action: res.success ? action : '' });
      });
      done += chunk.length;
      const pct = Math.round((done / total) * 100); bar.style.width = `${pct}%`; pText.textContent = `${done}/${total} · ${pct}%`;
    }
    importing = false;
    const ok = importResults.filter((r) => r.success).length;
    deps.flashToast(`Import complete — ${ok} succeeded, ${importResults.length - ok} failed`);
    renderTable();
  }

  function exportResults(headers: string[], dataRows: string[][]) {
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const resById = new Map<number, typeof importResults[number]>();
    importResults.forEach((r) => resById.set(r.row, r));
    const lines = [[...headers, '__Status', '__Id', '__Action', '__Errors'].map(esc).join(',')];
    dataRows.forEach((r, i) => {
      const res = resById.get(i);
      lines.push([...headers.map((_, ci) => r[ci] ?? ''), res ? (res.success ? 'Succeeded' : 'Failed') : '', res?.id || '', res?.action || '', res?.error || ''].map((x) => esc(String(x))).join(','));
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `import-results-${sobject || 'data'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  renderMap(); renderTable();
}
