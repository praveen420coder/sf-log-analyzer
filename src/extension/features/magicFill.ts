// Magic Fill — when a record create/edit modal opens on a Lightning page, inject
// a "✨ Magic Fill" button into the modal footer (next to Save) that auto-fills
// the reliably-fillable fields (text, number, email, phone, url, textarea,
// checkbox, date) with type-correct sample values, then offers an Undo.
//
// Values reuse the Sample Data generator engine (describe → generateFieldValue),
// mapped onto on-screen fields by API name. Picklists, lookups and other complex
// controls are intentionally left untouched in v1.

import { getSfCredentials } from '../lib/sfUrls';
import { generateFieldValue, type SampleField } from './sampleDataGenerator';

const MARK = 'data-sfsl-magic';
const RELIABLE = new Set(['string', 'textarea', 'email', 'phone', 'url', 'int', 'double', 'currency', 'percent', 'date', 'boolean', 'picklist', 'address']);

const A_STREETS = ['Market St', 'Oak Ave', 'Cedar Rd', 'Pine Blvd', 'Elm Way', 'Hill Dr'];
const A_CITIES = ['Austin', 'Denver', 'Portland', 'Boston', 'Reno', 'Tampa'];
const A_STATES = ['CA', 'TX', 'NY', 'WA', 'CO'];
const aPick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const aRand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

type Ctl = HTMLInputElement | HTMLTextAreaElement;
interface Snapshot { kind: 'checkbox' | 'text' | 'picklist'; ctl?: Ctl; wrapper?: Element; original: string | boolean }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// What to fill — driven by the settings page.
let optFillNormal = true;
let optFillPicklist = true;
export function setMagicFillOptions(o: { normal: boolean; picklist: boolean }): void {
  optFillNormal = o.normal; optFillPicklist = o.picklist;
}

// Describe cache keyed by object api name (per page session).
const describeCache: Record<string, Record<string, SampleField>> = {};

// ── DOM helpers ──

// Query that pierces open shadow roots (Lightning base components render their
// <input> inside a shadow root — synthetic or native-open).
function deepQueryAll(root: Element | ShadowRoot, selector: string): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element | ShadowRoot>();
  const walk = (node: Element | ShadowRoot) => {
    if (seen.has(node)) return; seen.add(node);
    node.querySelectorAll(selector).forEach((e) => out.push(e));
    node.querySelectorAll('*').forEach((e) => { const sr = (e as HTMLElement).shadowRoot; if (sr) walk(sr); });
  };
  walk(root);
  return out;
}
function deepQuery(root: Element, selector: string): Element | null {
  const r = deepQueryAll(root, selector);
  return r.length ? r[0] : null;
}

// Set a value on a native input/textarea so Lightning's binding notices it.
function setNativeValue(ctl: Ctl, value: string): void {
  const proto = ctl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  try { setter ? setter.call(ctl, value) : (ctl.value = value); } catch { ctl.value = value; }
  ctl.dispatchEvent(new Event('input', { bubbles: true }));
  ctl.dispatchEvent(new Event('change', { bubbles: true }));
  ctl.dispatchEvent(new Event('blur', { bubbles: true }));
}

// Locate the fillable control inside a field wrapper + classify it. Returns null
// for anything we shouldn't touch in v1 (comboboxes = picklist/lookup).
function findControl(wrapper: Element): { ctl: Ctl; kind: 'checkbox' | 'text' } | null {
  const cb = deepQuery(wrapper, 'input[type="checkbox"]') as HTMLInputElement | null;
  if (cb) return { ctl: cb, kind: 'checkbox' };
  const ta = deepQuery(wrapper, 'textarea') as HTMLTextAreaElement | null;
  if (ta) return { ctl: ta, kind: 'text' };
  // Skip picklist/lookup comboboxes.
  if (deepQuery(wrapper, '[role="combobox"], lightning-combobox, lightning-grouped-combobox, lightning-lookup, records-record-picker')) return null;
  const inp = deepQuery(wrapper, 'input') as HTMLInputElement | null;
  if (inp) {
    const role = (inp.getAttribute('role') || '').toLowerCase();
    if (role === 'combobox') return null;
    return { ctl: inp, kind: 'text' };
  }
  return null;
}

// Is the field marked required on the layout? Lightning renders the red
// asterisk as abbr.slds-required (or the control carries [required]).
function isRequiredOnLayout(wrapper: Element): boolean {
  return !!deepQuery(wrapper, 'abbr.slds-required, .slds-required, [required], [aria-required="true"]');
}

interface FieldRef { apiName: string; wrapper: Element }

// Collect field wrappers from both LWC (lightning-input-field[field-name]) and
// Aura (data-target-selection-name="sfdc:RecordField.Object.Field") layouts.
function collectFields(modal: Element): { fields: FieldRef[]; object: string | null } {
  const fields: FieldRef[] = [];
  let object: string | null = null;

  deepQueryAll(modal, 'lightning-input-field[field-name]').forEach((w) => {
    const apiName = w.getAttribute('field-name');
    if (apiName) fields.push({ apiName, wrapper: w });
  });
  deepQueryAll(modal, '[data-target-selection-name^="sfdc:RecordField."]').forEach((w) => {
    const parts = (w.getAttribute('data-target-selection-name') || '').split('.');
    if (parts.length >= 3) { object = object || parts[1]; fields.push({ apiName: parts[2], wrapper: w }); }
  });

  if (!object) {
    const form = deepQuery(modal, '[object-api-name]');
    if (form) object = form.getAttribute('object-api-name');
  }
  return { fields, object };
}

async function describeObject(objectApiName: string): Promise<Record<string, SampleField>> {
  const key = objectApiName.toLowerCase();
  if (describeCache[key]) return describeCache[key];
  const creds = await getSfCredentials();
  const cr = (globalThis as any).chrome?.runtime;
  if (!creds?.instanceUrl || !creds?.sessionId || !cr?.sendMessage) return {};
  return new Promise((resolve) => {
    cr.sendMessage({ type: 'DESCRIBE_FOR_SAMPLE', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, objectApiName }, (r: any) => {
      const map: Record<string, SampleField> = {};
      if (r?.success && r.data?.fields) r.data.fields.forEach((f: SampleField) => { map[f.name.toLowerCase()] = f; });
      describeCache[key] = map;
      resolve(map);
    });
  });
}

// Fill one field; returns a snapshot for undo (or null if skipped).
function fillField(ctl: Ctl, kind: 'checkbox' | 'text', meta: SampleField): Snapshot | null {
  const value = generateFieldValue(meta, 0, { lookups: {}, seq: Date.now() % 100000 });
  if (value === undefined || value === null || value === '') return null;

  if (kind === 'checkbox') {
    const input = ctl as HTMLInputElement;
    const original = input.checked;
    const desired = value === true;
    if (input.checked !== desired) input.click(); // toggles + emits events
    return { ctl, kind, original };
  }
  const original = ctl.value;
  let str = String(value);
  if (meta.type === 'date') {
    const d = new Date(`${value}T00:00:00`);
    if (!isNaN(d.getTime())) str = d.toLocaleDateString(); // Lightning expects locale format
  }
  setNativeValue(ctl, str);
  return { ctl, kind, original };
}

// Open a Lightning picklist combobox, read its live options (record-type-aware,
// so we only pick values the layout actually allows) and select one. Async
// because the dropdown renders after the open click.
async function fillPicklist(wrapper: Element): Promise<Snapshot | null> {
  const trigger = deepQuery(wrapper, 'input[role="combobox"], button[role="combobox"], [role="combobox"]') as HTMLElement | null;
  if (!trigger) return null;
  const orig = (trigger as HTMLInputElement).value || trigger.textContent?.trim() || '';
  trigger.click();
  await wait(160);
  let opts = deepQueryAll(wrapper, '[role="option"], lightning-base-combobox-item');
  if (!opts.length) opts = Array.from(document.querySelectorAll('[role="option"]'));
  const usable = opts.filter((o) => { const t = (o.textContent || '').trim(); return t && !/^--\s*none\s*--$/i.test(t); });
  if (!usable.length) { trigger.click(); return null; } // close, nothing to pick
  (usable[Math.floor(Math.random() * usable.length)] as HTMLElement).click();
  await wait(40);
  return { kind: 'picklist', wrapper, original: orig };
}

async function undoPicklist(wrapper: Element, original: string): Promise<void> {
  const trigger = deepQuery(wrapper, 'input[role="combobox"], button[role="combobox"], [role="combobox"]') as HTMLElement | null;
  if (!trigger) return;
  trigger.click();
  await wait(160);
  let opts = deepQueryAll(wrapper, '[role="option"], lightning-base-combobox-item');
  if (!opts.length) opts = Array.from(document.querySelectorAll('[role="option"]'));
  const want = original.trim();
  let target = opts.find((o) => (o.textContent || '').trim() === want) as HTMLElement | undefined;
  if (!target && !want) target = opts.find((o) => /^--\s*none\s*--$/i.test((o.textContent || '').trim())) as HTMLElement | undefined;
  if (target) target.click(); else trigger.click(); // restore or just close
}

// Best-effort text label for a control (name/placeholder/aria-label/<label>).
function ctlLabel(ctl: Element): string {
  const el = ctl as HTMLInputElement;
  let lbl = '';
  const id = el.id;
  if (id) {
    try { const l = (ctl.getRootNode() as Document | ShadowRoot).querySelector?.(`label[for="${CSS.escape(id)}"]`); if (l) lbl = l.textContent || ''; } catch { /* ignore */ }
  }
  return `${el.name || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${lbl}`.toLowerCase();
}

// Compound Address field: fill the inner street/city/state/postal/country
// controls. State & country may be picklists (state/country picklists enabled),
// which we fill via the combobox path when picklist filling is on.
async function fillAddress(wrapper: Element): Promise<Snapshot[]> {
  const snaps: Snapshot[] = [];
  const ctls = deepQueryAll(wrapper, 'input, textarea').filter((el) => {
    const i = el as HTMLInputElement;
    return (i.getAttribute('role') || '').toLowerCase() !== 'combobox' && i.type !== 'hidden' && !i.disabled && !i.readOnly;
  }) as Ctl[];
  const used = new Set<Ctl>();
  for (const ctl of ctls) {
    if (used.has(ctl)) continue;
    const hay = ctlLabel(ctl);
    let val: string | null = null;
    if (/street|address/.test(hay)) val = `${aRand(10, 9999)} ${aPick(A_STREETS)}`;
    else if (/city/.test(hay)) val = aPick(A_CITIES);
    else if (/state|province/.test(hay)) val = aPick(A_STATES);
    else if (/zip|postal/.test(hay)) val = String(aRand(10000, 99999));
    else if (/country/.test(hay)) val = 'United States';
    if (val != null) { used.add(ctl); const original = ctl.value; setNativeValue(ctl, val); snaps.push({ kind: 'text', ctl, original }); }
  }
  // Inner state/country picklists.
  if (optFillPicklist) {
    for (const combo of deepQueryAll(wrapper, 'lightning-combobox')) {
      const snap = await fillPicklist(combo);
      if (snap) snaps.push(snap);
    }
  }
  return snaps;
}

async function undo(snaps: Snapshot[]): Promise<void> {
  for (const s of snaps) {
    if (s.kind === 'checkbox') {
      const input = s.ctl as HTMLInputElement;
      if (input.checked !== s.original) input.click();
    } else if (s.kind === 'picklist' && s.wrapper) {
      await undoPicklist(s.wrapper, s.original as string);
    } else if (s.ctl) {
      setNativeValue(s.ctl, s.original as string);
    }
  }
}

// ── button injection ──

// Inject the shared gradient-border styles once — used by the modal button and
// by the Tools-grid tile (.sfsl-magic-tile). Exported so the tile can request it.
export function ensureMagicStyles(): void {
  if (document.getElementById('sfsl-magic-style')) return;
  const s = document.createElement('style');
  s.id = 'sfsl-magic-style';
  const borderBg = 'background:linear-gradient(90deg,#8b5cf6,#3b82f6,#22c55e,#f59e0b,#8b5cf6);background-size:300% 100%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:sfsl-border-move 3s linear infinite;pointer-events:none;';
  s.textContent = [
    '.sfsl-magic-btn{position:relative;display:inline-flex;align-items:center;align-self:center;justify-content:center;vertical-align:middle;height:36px;padding:0 20px;margin:0;border:none;border-radius:100px;background:transparent;color:#6d28d9;font-family:inherit;font-size:13px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer;box-sizing:border-box;}',
    '.sfsl-magic-btn:hover{color:#5b21b6;}',
    '.sfsl-magic-btn:disabled{opacity:.6;cursor:default;}',
    `.sfsl-magic-btn::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:2px;${borderBg}}`,
    `.sfsl-magic-tile::before{content:'';position:absolute;inset:0;border-radius:16px;padding:2px;${borderBg}}`,
    '@keyframes sfsl-border-move{to{background-position:300% 0;}}',
  ].join('');
  (document.head || document.documentElement).appendChild(s);
}

function styleButton(btn: HTMLButtonElement, label: string): void {
  ensureMagicStyles();
  btn.className = 'sfsl-magic-btn';
  btn.setAttribute(MARK, '1');
  btn.type = 'button';
  btn.textContent = label;
}

// Wire a click that never bubbles to the modal's form (which would fire Save).
function onBtnClick(btn: HTMLButtonElement, fn: () => void): void {
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
}

async function runFill(btn: HTMLButtonElement, modal: Element): Promise<void> {
  btn.disabled = true; const prev = btn.textContent; btn.textContent = 'Filling…';
  try {
    const { fields, object } = collectFields(modal);
    if (!object || !fields.length) { btn.textContent = 'No fields found'; setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500); return; }
    const describe = await describeObject(object);
    const snaps: Snapshot[] = [];
    const seen = new Set<Ctl>();
    const seenWrap = new Set<Element>();
    // Fill required-on-layout fields first so they're never missed.
    const ordered = [...fields].sort((a, b) => (isRequiredOnLayout(b.wrapper) ? 1 : 0) - (isRequiredOnLayout(a.wrapper) ? 1 : 0));
    for (const f of ordered) {
      const meta = describe[f.apiName.toLowerCase()];
      if (!meta || !RELIABLE.has(meta.type) || meta.calculated || meta.autoNumber) continue;
      // Compound address reports createable:false (its components are writeable),
      // so exempt it from the createable gate.
      if (meta.type !== 'address' && !meta.createable) continue;
      if (meta.type === 'picklist') {
        if (!optFillPicklist || seenWrap.has(f.wrapper)) continue;
        seenWrap.add(f.wrapper);
        const snap = await fillPicklist(f.wrapper);
        if (snap) snaps.push(snap);
        continue;
      }
      if (!optFillNormal) continue;
      if (meta.type === 'address') {
        if (seenWrap.has(f.wrapper)) continue;
        seenWrap.add(f.wrapper);
        (await fillAddress(f.wrapper)).forEach((s) => snaps.push(s));
        continue;
      }
      const c = findControl(f.wrapper);
      if (!c || seen.has(c.ctl) || (c.ctl as HTMLInputElement).disabled || (c.ctl as HTMLInputElement).readOnly) continue;
      seen.add(c.ctl);
      const snap = fillField(c.ctl, c.kind, meta);
      if (snap) snaps.push(snap);
    }
    btn.disabled = false;
    if (!snaps.length) { btn.textContent = 'Nothing to fill'; setTimeout(() => { btn.textContent = prev; }, 1500); return; }
    // Switch to Undo mode.
    styleButton(btn, `Undo (${snaps.length})`);
    onBtnClick(btn, () => { undo(snaps).then(() => { styleButton(btn, 'Auto Fill'); onBtnClick(btn, () => runFill(btn, modal)); }); });
  } catch {
    btn.disabled = false; btn.textContent = prev;
  }
}

function injectInto(modal: Element): void {
  const footer = deepQuery(modal, '.slds-modal__footer, footer.slds-modal__footer, .footer');
  if (!footer || footer.querySelector(`[${MARK}]`)) return;
  const btn = document.createElement('button');
  styleButton(btn, 'Auto Fill');
  btn.title = 'Auto-fill the fillable fields with sample data';
  // Stop mousedown too — some modal footers act on it before click.
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  onBtnClick(btn, () => runFill(btn, modal));
  // Prefer to drop it into the Cancel/Save button group (ul.slds-button-group-row)
  // as another <li>, so it aligns perfectly with the real buttons. Fall back to
  // appending to the footer if that group isn't found.
  const group = deepQuery(footer, 'ul.slds-button-group-row') || deepQuery(modal, 'ul.slds-button-group-row');
  if (group) {
    const li = document.createElement('li');
    li.className = 'slds-button-group-item visible';
    li.setAttribute('role', 'presentation');
    li.appendChild(btn);
    group.appendChild(li);
  } else {
    btn.style.marginLeft = '12px';
    footer.appendChild(btn);
  }
}

// A modal is a record create/edit form if it has any of our recognised field
// wrappers. Requiring that avoids injecting on unrelated dialogs.
function isRecordModal(modal: Element): boolean {
  return !!deepQuery(modal, 'lightning-input-field[field-name], [data-target-selection-name^="sfdc:RecordField."]');
}

function scan(): void {
  document.querySelectorAll('.slds-modal.slds-fade-in-open, .slds-modal.slds-modal_medium, section.slds-modal').forEach((modal) => {
    if (modal.querySelector(`[${MARK}]`)) return;
    if (!isRecordModal(modal)) return;
    injectInto(modal);
  });
}

let observer: MutationObserver | null = null;
let pending = 0;
let desired = false;

function startObserver(): void {
  if (observer) return;
  const schedule = () => { if (pending) return; pending = window.setTimeout(() => { pending = 0; scan(); }, 250); };
  observer = new MutationObserver(schedule);
  try { observer.observe(document.body, { childList: true, subtree: true }); } catch { /* ignore */ }
  scan();
}
function stopObserver(): void {
  observer?.disconnect(); observer = null;
  if (pending) { clearTimeout(pending); pending = 0; }
  document.querySelectorAll(`[${MARK}]`).forEach((e) => e.remove());
}

// Turn Magic Fill on or off (persisted via the Tools toggle). Defers until the
// DOM is ready and only runs in the top frame.
export function setMagicFillEnabled(on: boolean): void {
  if (typeof document === 'undefined' || window !== window.top) return;
  desired = on;
  const apply = () => { if (desired) startObserver(); else stopObserver(); };
  if (!document.body) { document.addEventListener('DOMContentLoaded', apply, { once: true }); return; }
  apply();
}
