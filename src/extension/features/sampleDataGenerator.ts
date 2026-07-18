// Sample Data Generator — analyze an object's schema and synthesize realistic
// test records, then insert them. SANDBOX & SCRATCH ORGS ONLY: the tool detects
// the org type and hard-blocks inserting into production.
//
// Backend-agnostic via injected deps (describe / query / insert / delete), so
// the feature has no direct chrome dependency.

export interface SampleField {
  name: string; label: string; type: string;
  length: number; precision: number; scale: number; digits: number;
  createable: boolean; nillable: boolean; defaultedOnCreate: boolean;
  calculated: boolean; autoNumber: boolean; unique: boolean; restrictedPicklist: boolean;
  referenceTo: string[];
  picklistValues: { value: string; active: boolean; defaultValue: boolean }[];
}

export interface OrgInfo { isSandbox: boolean; orgType: string; trialExpiration: string | null; name?: string }

export interface SampleDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (m: string) => void;
  recordUrl: (id: string) => string;
  listObjects: () => Promise<{ name: string; label: string }[]>;
  describeObject: (name: string) => Promise<{ label?: string; createable?: boolean; fields?: SampleField[]; error?: string }>;
  orgInfo: () => Promise<OrgInfo | null>;
  queryRecords: (soql: string) => Promise<{ records: any[]; error?: string }>;
  insertRecords: (objectApiName: string, records: any[]) => Promise<{ results?: any[]; error?: string }>;
  deleteRecords: (ids: string[]) => Promise<{ results?: any[]; error?: string }>;
}

type Env = 'sandbox' | 'scratch' | 'production' | 'unknown';

function classifyEnv(info: OrgInfo | null): Env {
  if (!info) return 'unknown';
  if (info.isSandbox) return 'sandbox';
  if (info.trialExpiration) return 'scratch'; // scratch/trial orgs are time-limited
  return 'production';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

// ── sample value pools ──
const FIRST = ['Ava', 'Liam', 'Noah', 'Maya', 'Ethan', 'Olivia', 'Ravi', 'Sara', 'Kai', 'Mia', 'Leo', 'Zoe', 'Ivan', 'Nina', 'Owen', 'Priya'];
const LAST = ['Nolan', 'Reyes', 'Kim', 'Patel', 'Silva', 'Okafor', 'Chen', 'Brooks', 'Ahmed', 'Rossi', 'Haas', 'Vance', 'Ito', 'Mora'];
const COMPANY = ['Freight', 'Systems', 'Labs', 'Logistics', 'Dynamics', 'Networks', 'Foods', 'Analytics', 'Robotics', 'Textiles', 'Health', 'Media'];
const SUFFIX = ['Co.', 'Inc.', 'LLC', 'Group', 'Partners', 'Corp.'];
const WORDS = ['alpha', 'delta', 'harbor', 'quartz', 'vector', 'summit', 'orbit', 'cobalt', 'maple', 'nova', 'pine', 'flint'];
const STREETS = ['Market St', 'Oak Ave', 'Cedar Rd', 'Pine Blvd', 'Elm Way', 'Hill Dr'];

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const clamp = (s: string, len: number) => (len > 0 && s.length > len ? s.slice(0, len) : s);

// Produce a decimal that fits a field's precision/scale exactly.
//   precision = total digits, scale = digits after the decimal point.
//   integer digits allowed = precision - scale, so the value never overflows.
// Decimals are capped at 2 (fewer is always valid) and at the field's scale, so
// a Number(3,0) yields e.g. 742 and a Currency(18,2) yields 48213.55.
// `capInt` optionally caps the integer part (e.g. percent ≤ 100).
function boundedNumber(precision: number, scale: number, capInt?: number): number {
  const decimals = Math.min(scale > 0 ? scale : 0, 2);
  const intDigits = precision > 0 ? Math.max(1, precision - (scale > 0 ? scale : 0)) : 6;
  let maxInt = Math.pow(10, intDigits) - 1;
  maxInt = Math.min(maxInt, 9999999); // realism cap — still ≤ the field's capacity
  if (capInt != null) maxInt = Math.min(maxInt, capInt);
  const intPart = randInt(capInt != null ? 0 : 1, Math.max(capInt != null ? 0 : 1, Math.floor(maxInt)));
  const fracUnits = decimals > 0 ? randInt(0, Math.pow(10, decimals) - 1) : 0;
  return Number((intPart + fracUnits / Math.pow(10, decimals)).toFixed(decimals));
}

// Is this field writeable at all (worth generating)?
export function isWriteable(f: SampleField): boolean {
  return f.createable && !f.calculated && !f.autoNumber;
}
// Required = must be provided by us (not nillable, not auto-defaulted like OwnerId).
export function isRequired(f: SampleField): boolean {
  return isWriteable(f) && !f.nillable && !f.defaultedOnCreate;
}

// Coerce a raw edited string back to the value type for a field. Empty → the
// field is omitted from the record.
export function coerceValue(f: SampleField, raw: string): any {
  const s = raw.trim();
  if (s === '') return undefined;
  if (f.type === 'int') { const n = parseInt(s, 10); return isNaN(n) ? undefined : n; }
  if (f.type === 'double' || f.type === 'currency' || f.type === 'percent') { const n = Number(s); return isNaN(n) ? undefined : n; }
  if (f.type === 'boolean') return /^(true|1|yes)$/i.test(s);
  return s;
}

interface GenCtx { lookups: Record<string, string[]>; seq: number }

// Synthesize a single field value appropriate to its type/constraints.
export function generateFieldValue(f: SampleField, i: number, ctx: GenCtx): any {
  const uniq = f.unique ? `-${ctx.seq}${i}` : '';
  switch (f.type) {
    case 'string':
    case 'textarea':
    case 'encryptedstring':
    case 'combobox': {
      const n = f.name.toLowerCase();
      let base: string;
      if (n === 'firstname') base = pick(FIRST);
      else if (n === 'lastname') base = pick(LAST);
      else if (n === 'name' || n.endsWith('name')) base = `${pick(LAST)} ${pick(COMPANY)} ${pick(SUFFIX)}`;
      else if (n.includes('street')) base = `${randInt(10, 9999)} ${pick(STREETS)}`;
      else if (n.includes('city')) base = pick(['Austin', 'Denver', 'Portland', 'Boston', 'Reno']);
      else if (n.includes('state')) base = pick(['CA', 'TX', 'NY', 'WA', 'CO']);
      else if (n.includes('country')) base = 'United States';
      else if (n.includes('postal') || n.includes('zip')) base = String(randInt(10000, 99999));
      else if (n.includes('title')) base = pick(['Manager', 'Engineer', 'Analyst', 'Director', 'Lead']);
      else base = `${pick(WORDS)} ${pick(WORDS)}`;
      return clamp(base + uniq, f.length);
    }
    case 'email':
      return clamp(`${pick(WORDS)}.${pick(LAST).toLowerCase()}${i}${uniq}@example.com`, f.length || 80);
    case 'phone':
      return `(4${randInt(10, 99)}) 555-0${randInt(100, 199)}`;
    case 'url':
      return clamp(`https://example.com/${pick(WORDS)}${i}${uniq}`, f.length || 255);
    case 'picklist': {
      const active = f.picklistValues.filter((p) => p.active);
      if (!active.length) return undefined;
      return (active.find((p) => p.defaultValue) || pick(active)).value;
    }
    case 'multipicklist': {
      const active = f.picklistValues.filter((p) => p.active);
      if (!active.length) return undefined;
      const n = Math.min(active.length, randInt(1, 2));
      return active.slice(0, n).map((p) => p.value).join(';');
    }
    case 'boolean':
      return i % 2 === 0;
    case 'int': {
      // Integer fields report their max size in `digits` (no decimals).
      const digits = f.digits > 0 ? f.digits : 4;
      const max = Math.min(Math.pow(10, digits) - 1, 999999999);
      return randInt(1, Math.max(1, max));
    }
    case 'double': {
      // Geolocation components come through as `double` but have hard ranges
      // (latitude −90..90, longitude −180..180). Detect by name so we don't
      // trip NUMBER_OUTSIDE_VALID_RANGE.
      const dn = f.name.toLowerCase();
      if (dn.includes('latitude')) return Number((Math.random() * 180 - 90).toFixed(Math.min(f.scale || 6, 6)));
      if (dn.includes('longitude')) return Number((Math.random() * 360 - 180).toFixed(Math.min(f.scale || 6, 6)));
      return boundedNumber(f.precision, f.scale);
    }
    case 'currency':
      return boundedNumber(f.precision, f.scale);
    case 'percent':
      return boundedNumber(f.precision, f.scale, 100);
    case 'date': {
      const d = new Date(Date.now() - randInt(1, 365) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    case 'datetime':
      return new Date(Date.now() - randInt(1, 365) * 86400000).toISOString();
    case 'time': {
      const p = (x: number) => String(x).padStart(2, '0');
      return `${p(randInt(8, 18))}:${p(randInt(0, 59))}:00.000Z`;
    }
    case 'reference': {
      const target = f.referenceTo[0];
      const ids = target ? ctx.lookups[target] : undefined;
      return ids && ids.length ? pick(ids) : undefined;
    }
    default:
      return undefined; // id, address, location, base64, anyType — skip
  }
}

export function renderSampleDataInto(host: HTMLElement, deps: SampleDeps): void {
  const isDark = deps.isDark;
  const C = {
    bg: isDark ? '#0e1626' : '#ffffff',
    panel: isDark ? '#111c30' : '#ffffff',
    subtle: isDark ? '#0c1322' : '#f8fafc',
    headerBg: isDark ? '#16223b' : '#eef2f7',
    text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? '#94a3b8' : '#64748b',
    faint: isDark ? 'rgba(148,163,184,0.5)' : 'rgba(31,41,55,0.4)',
    border: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,0,0,0.12)',
    divider: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.07)',
    accent: '#3b82f6',
    ok: '#16a34a',
    warn: '#f59e0b',
    danger: '#ef4444',
  };

  host.innerHTML = '';
  const root = el('div', { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', background: C.bg, color: C.text });
  host.appendChild(root);

  // header
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '← Tools');
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
  titleWrap.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '🧪 Sample Data Generator'));
  titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, 'Analyze an object and create realistic test records'));
  head.appendChild(titleWrap);
  root.appendChild(head);

  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '16px 24px' });
  root.appendChild(scroll);

  // Persistent safety banner — always visible.
  const safety = el('div', {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', marginBottom: '14px',
    borderRadius: '10px', border: `1px solid ${C.warn}`, background: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.10)',
    color: isDark ? '#fcd34d' : '#92400e', fontSize: '12.5px', fontWeight: '600',
  });
  safety.innerHTML = '⚠️&nbsp; For use in <b>sandbox &amp; scratch orgs only</b> — never generate data in a production org.';
  scroll.appendChild(safety);

  // Env status line (filled once org info loads) + prod block state.
  let env: Env = 'unknown';
  const envLine = el('div', { fontSize: '12.5px', fontWeight: '700', marginBottom: '14px', color: C.muted }, 'Checking org type…');
  scroll.appendChild(envLine);

  // ── controls ──
  const controls = el('div', { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' });
  const objWrap = el('div', {});
  objWrap.appendChild(el('label', { fontSize: '12px', color: C.muted, display: 'block', marginBottom: '6px', fontWeight: '600' }, 'Object'));
  const objInput = el('input', { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
  objInput.placeholder = 'Account';
  objInput.setAttribute('list', 'sample-obj-list');
  const dl = el('datalist'); dl.id = 'sample-obj-list';
  objWrap.appendChild(objInput); objWrap.appendChild(dl);
  controls.appendChild(objWrap);

  const cntWrap = el('div', {});
  cntWrap.appendChild(el('label', { fontSize: '12px', color: C.muted, display: 'block', marginBottom: '6px', fontWeight: '600' }, 'How many records (1–200)'));
  const cntInput = el('input', { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
  cntInput.type = 'number'; cntInput.min = '1'; cntInput.max = '200'; cntInput.value = '25';
  cntWrap.appendChild(cntInput);
  controls.appendChild(cntWrap);
  scroll.appendChild(controls);

  // options row
  const optRow = el('div', { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' });
  const optWrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', color: C.text, cursor: 'pointer' });
  const optCb = el('input') as HTMLInputElement; optCb.type = 'checkbox';
  optWrap.appendChild(optCb); optWrap.appendChild(document.createTextNode('Also fill optional fields (more validation risk)'));
  optRow.appendChild(optWrap);
  const genBtn = el('button', { marginLeft: 'auto', background: C.accent, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, '⚡ Generate preview');
  optRow.appendChild(genBtn);
  scroll.appendChild(optRow);

  // preview + results containers
  const previewBox = el('div', {});
  scroll.appendChild(previewBox);
  const resultsBox = el('div', { marginTop: '14px' });
  scroll.appendChild(resultsBox);

  // ── state ──
  let fields: SampleField[] = [];
  let objectApiName = '';
  let generated: any[] = [];       // records ready for insert (with attributes)
  let insertedIds: string[] = [];
  const msg = (host: HTMLElement, t: string, color = C.muted) => { host.innerHTML = ''; host.appendChild(el('div', { padding: '18px 4px', color, fontSize: '13px', fontWeight: '600' }, t)); };

  // Load org type up front and gate production.
  deps.orgInfo().then((info) => {
    env = classifyEnv(info);
    const nm = info?.name ? ` · ${info.name}` : '';
    if (env === 'sandbox') { envLine.textContent = `✅ Sandbox org${nm} — safe to generate data.`; envLine.style.color = C.ok; }
    else if (env === 'scratch') { envLine.textContent = `✅ Scratch / trial org${nm} — safe to generate data.`; envLine.style.color = C.ok; }
    else if (env === 'production') {
      envLine.innerHTML = `⛔ <b>Production org detected${nm}</b> — you'll be asked to confirm before any records are inserted.`;
      envLine.style.color = C.danger;
    } else { envLine.textContent = '⚠️ Could not verify org type — you\'ll be asked to confirm before inserting.'; envLine.style.color = C.warn; }
    updateInsertGate();
  });

  // Load object list for the datalist.
  deps.listObjects().then((list) => {
    list.slice(0, 2000).forEach((o) => { const op = document.createElement('option'); op.value = o.name; op.label = o.label; dl.appendChild(op); });
  });

  // Sandbox/scratch insert straight away; anything else asks for confirmation.
  const needsConfirm = () => !(env === 'sandbox' || env === 'scratch');
  let insertBtn: HTMLButtonElement | null = null;
  const updateInsertGate = () => {
    if (!insertBtn) return;
    const ok = generated.length > 0;
    insertBtn.style.opacity = ok ? '1' : '0.5';
    insertBtn.style.pointerEvents = ok ? 'auto' : 'none';
  };

  // Warning popup shown before inserting into a non-sandbox/scratch org.
  function confirmProd(onConfirm: () => void) {
    const overlay = el('div', { position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10', padding: '20px' });
    const box = el('div', { maxWidth: '420px', width: '100%', background: C.panel, border: `1px solid ${C.danger}`, borderRadius: '14px', padding: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.35)' });
    box.appendChild(el('div', { fontSize: '15px', fontWeight: '800', color: C.danger, marginBottom: '8px' }, '⚠️ This is not a sandbox or scratch org'));
    box.appendChild(el('div', { fontSize: '13px', color: C.text, lineHeight: '1.5', marginBottom: '16px' }, `You're about to insert ${generated.length} record${generated.length === 1 ? '' : 's'} into ${objectApiName}. This tool is meant for sandbox & scratch orgs — inserting test data into a production org can be hard to undo. Continue only if you're sure.`));
    const btnRow = el('div', { display: 'flex', gap: '10px', justifyContent: 'flex-end' });
    const cancel = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit' }, 'Cancel');
    const proceed = el('button', { background: C.danger, border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, 'Insert anyway');
    cancel.addEventListener('click', () => overlay.remove());
    proceed.addEventListener('click', () => { overlay.remove(); onConfirm(); });
    btnRow.appendChild(cancel); btnRow.appendChild(proceed);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    root.appendChild(overlay);
  }

  // Resolve lookup Ids for the reference fields we intend to fill.
  async function resolveLookups(refFields: SampleField[]): Promise<{ ctx: GenCtx; missing: string[] }> {
    const ctx: GenCtx = { lookups: {}, seq: Date.now() % 100000 };
    const missing: string[] = [];
    const targets = Array.from(new Set(refFields.map((f) => f.referenceTo[0]).filter(Boolean)));
    for (const t of targets) {
      const r = await deps.queryRecords(`SELECT Id FROM ${t} LIMIT 50`);
      ctx.lookups[t] = (r.records || []).map((x: any) => x.Id).filter(Boolean);
    }
    // Any REQUIRED reference whose target has no records can't be satisfied.
    refFields.forEach((f) => {
      if (isRequired(f) && !(ctx.lookups[f.referenceTo[0]] || []).length) missing.push(`${f.label} → needs an existing ${f.referenceTo[0]}`);
    });
    return { ctx, missing };
  }

  async function generate() {
    const name = objInput.value.trim();
    if (!name) { deps.flashToast('Pick an object first'); return; }
    let count = parseInt(cntInput.value, 10) || 0;
    count = Math.max(1, Math.min(200, count));
    cntInput.value = String(count);

    previewBox.innerHTML = ''; resultsBox.innerHTML = ''; generated = []; insertedIds = [];
    msg(previewBox, 'Analyzing object schema…');

    const d = await deps.describeObject(name);
    if (d.error || !d.fields) { msg(previewBox, d.error || 'Could not describe this object.', C.danger); return; }
    if (d.createable === false) { msg(previewBox, `You can't create ${name} records (object not createable).`, C.danger); return; }
    objectApiName = name;
    fields = d.fields;

    // Decide which fields to fill.
    const includeOptional = optCb.checked;
    const chosen = fields.filter((f) => isWriteable(f) && !f.defaultedOnCreate && (isRequired(f) || (includeOptional && f.nillable)));
    const refFields = chosen.filter((f) => f.type === 'reference');

    msg(previewBox, 'Resolving lookups…');
    const { ctx, missing } = await resolveLookups(refFields);
    if (missing.length) {
      previewBox.innerHTML = '';
      const box = el('div', { padding: '14px', borderRadius: '10px', border: `1px solid ${C.danger}`, background: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.06)', color: isDark ? '#fca5a5' : '#b91c1c', fontSize: '13px' });
      box.appendChild(el('div', { fontWeight: '700', marginBottom: '6px' }, 'Missing required related records:'));
      missing.forEach((m) => box.appendChild(el('div', { fontSize: '12.5px' }, `• ${m}`)));
      box.appendChild(el('div', { marginTop: '8px', fontSize: '12px', color: C.muted }, 'Create at least one parent record, then try again.'));
      previewBox.appendChild(box);
      return;
    }

    // Build records.
    generated = [];
    for (let i = 0; i < count; i++) {
      const rec: any = { attributes: { type: objectApiName } };
      chosen.forEach((f) => {
        const v = generateFieldValue(f, i, ctx);
        if (v !== undefined && v !== null && v !== '') rec[f.name] = v;
      });
      generated.push(rec);
    }
    renderPreview(chosen);
    updateInsertGate();
  }

  function renderPreview(chosen: SampleField[]) {
    previewBox.innerHTML = '';
    const wrap = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' });
    const bar = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px', background: C.headerBg, borderBottom: `1px solid ${C.border}` });
    bar.appendChild(el('span', { fontSize: '13px', fontWeight: '700' }, `Preview — row 1 of ${generated.length} · ${objectApiName}`));
    const barRight = el('div', { display: 'flex', alignItems: 'center', gap: '12px' });
    const applyWrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: C.muted, cursor: 'pointer', whiteSpace: 'nowrap' });
    const applyAllCb = el('input') as HTMLInputElement; applyAllCb.type = 'checkbox';
    applyWrap.appendChild(applyAllCb); applyWrap.appendChild(document.createTextNode('Apply edits to all rows'));
    const regen = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '7px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: 'inherit' }, '↻ Regenerate');
    regen.addEventListener('click', generate);
    barRight.appendChild(applyWrap); barRight.appendChild(regen);
    bar.appendChild(barRight);
    wrap.appendChild(bar);

    const table = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', tableLayout: 'fixed' });
    const first = generated[0] || {};
    // Show chosen fields (with value) then a couple of skipped system fields for transparency.
    chosen.forEach((f, idx) => {
      const tr = el('tr', { borderTop: idx === 0 ? 'none' : `1px solid ${C.divider}` });
      tr.appendChild(el('td', { padding: '8px 14px', width: '34%', wordBreak: 'break-word' }, `${f.label}${isRequired(f) ? ' *' : ''}`));
      tr.appendChild(el('td', { padding: '8px 14px', width: '22%', color: C.muted }, prettyType(f)));
      const val = first[f.name];
      const tdVal = el('td', { padding: '5px 10px' });
      const input = el('input', { width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12.5px', fontFamily: 'monospace', border: `1px solid ${C.border}`, borderRadius: '6px', background: C.panel, color: C.text, outline: 'none' }) as HTMLInputElement;
      input.value = val === undefined ? '' : String(val);
      input.placeholder = '—';
      input.addEventListener('change', () => {
        const v = coerceValue(f, input.value);
        const targets = applyAllCb.checked ? generated : (generated[0] ? [generated[0]] : []);
        targets.forEach((rec) => { if (v === undefined) delete rec[f.name]; else rec[f.name] = v; });
        if (v !== undefined) input.value = String(v); // reflect any coercion
      });
      tdVal.appendChild(input);
      tr.appendChild(tdVal);
      table.appendChild(tr);
    });
    // system/skipped hint
    const skipped = fields.filter((f) => f.calculated || f.autoNumber).slice(0, 2);
    skipped.forEach((f) => {
      const tr = el('tr', { borderTop: `1px solid ${C.divider}` });
      tr.appendChild(el('td', { padding: '8px 14px', color: C.faint }, f.label));
      tr.appendChild(el('td', { padding: '8px 14px', color: C.faint }, f.autoNumber ? 'Auto-number' : 'Formula'));
      tr.appendChild(el('td', { padding: '8px 14px', color: C.faint, fontStyle: 'italic' }, 'skipped — not writeable'));
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    previewBox.appendChild(wrap);

    // insert row
    const insertRow = el('div', { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' });
    const note = el('span', { fontSize: '12px', color: C.muted }, `${chosen.length} field${chosen.length === 1 ? '' : 's'} filled · ${generated.length} record${generated.length === 1 ? '' : 's'} ready`);
    insertRow.appendChild(note);
    insertBtn = el('button', { marginLeft: 'auto', background: C.ok, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, `⬆ Insert ${generated.length} records`);
    insertBtn.addEventListener('click', doInsert);
    insertRow.appendChild(insertBtn);
    previewBox.appendChild(insertRow);
    updateInsertGate();
  }

  const prettyType = (f: SampleField) => {
    if (f.type === 'string' || f.type === 'textarea') return `Text(${f.length || '?'})`;
    if (f.type === 'reference') return `Lookup(${f.referenceTo[0] || '?'})`;
    return f.type.charAt(0).toUpperCase() + f.type.slice(1);
  };

  function doInsert() {
    if (!generated.length) return;
    if (needsConfirm()) { confirmProd(performInsert); return; }
    performInsert();
  }

  async function performInsert() {
    if (!generated.length) return;
    insertBtn && (insertBtn.textContent = 'Inserting…', insertBtn.style.pointerEvents = 'none');
    const r = await deps.insertRecords(objectApiName, generated);
    if (r.error) { renderResults(0, generated.length, [r.error]); return; }
    const results = r.results || [];
    insertedIds = results.filter((x: any) => x.success && x.id).map((x: any) => x.id);
    const errs = results.filter((x: any) => !x.success).map((x: any) => {
      const e = (x.errors && x.errors[0]) || {};
      return `${e.statusCode || 'ERROR'}: ${e.message || 'insert failed'}`;
    });
    renderResults(insertedIds.length, results.length, dedupe(errs));
  }

  const dedupe = (arr: string[]) => Array.from(new Set(arr)).slice(0, 8);

  function renderResults(ok: number, total: number, errors: string[]) {
    resultsBox.innerHTML = '';
    const card = el('div', { border: `1px solid ${ok > 0 ? C.ok : C.danger}`, borderRadius: '12px', padding: '14px', background: isDark ? 'rgba(255,255,255,0.02)' : '#fff' });
    card.appendChild(el('div', { fontSize: '14px', fontWeight: '800', color: ok > 0 ? C.ok : C.danger }, `Inserted ${ok} of ${total} record${total === 1 ? '' : 's'}`));
    if (errors.length) {
      card.appendChild(el('div', { fontSize: '12px', color: C.muted, margin: '8px 0 4px' }, `${total - ok} failed — top reasons (often validation rules or triggers):`));
      const pre = el('pre', { margin: '0', padding: '10px 12px', borderRadius: '8px', background: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.06)', color: isDark ? '#fca5a5' : '#b91c1c', fontSize: '12px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' });
      pre.textContent = errors.join('\n');
      card.appendChild(pre);
    }
    if (insertedIds.length) {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' });
      const openFirst = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '7px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '↗ Open first record');
      openFirst.addEventListener('click', () => window.open(deps.recordUrl(insertedIds[0]), '_blank'));
      const undo = el('button', { background: 'transparent', border: `1px solid ${C.danger}`, color: C.danger, borderRadius: '8px', padding: '7px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '700', fontFamily: 'inherit' }, `🗑 Delete these ${insertedIds.length} records`);
      undo.addEventListener('click', async () => {
        undo.textContent = 'Deleting…'; undo.style.pointerEvents = 'none';
        const dr = await deps.deleteRecords(insertedIds);
        if (dr.error) { deps.flashToast(dr.error); undo.textContent = 'Delete failed — retry'; undo.style.pointerEvents = 'auto'; return; }
        deps.flashToast(`Deleted ${insertedIds.length} records`);
        insertedIds = []; resultsBox.innerHTML = '';
      });
      row.appendChild(openFirst); row.appendChild(undo);
      card.appendChild(row);
    }
    resultsBox.appendChild(card);
    if (insertBtn) { insertBtn.textContent = `⬆ Insert ${generated.length} records`; updateInsertGate(); }
  }

  genBtn.addEventListener('click', generate);
}
