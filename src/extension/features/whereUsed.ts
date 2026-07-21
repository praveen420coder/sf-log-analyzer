// Where Used — "where is this used?" dependency finder. Enter a component's API
// name and see everything that references it, via the Tooling API's
// MetadataComponentDependency (the Dependency API). Read-only.

import { getTheme } from '../lib/theme';

export interface WhereUsedDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (m: string) => void;
  // tooling query — returns records or an error
  runQuery: (soql: string, tooling?: boolean) => Promise<{ records: any[]; error?: string }>;
}

interface DepRow {
  MetadataComponentId?: string;
  MetadataComponentName?: string;
  MetadataComponentType?: string;
  RefMetadataComponentName?: string;
  RefMetadataComponentType?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

const soqlStr = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Friendly icon per metadata type.
const typeIcon = (t: string): string => {
  const k = (t || '').toLowerCase();
  if (k.includes('apexclass')) return '🧩';
  if (k.includes('apextrigger')) return '⚙️';
  if (k.includes('flow')) return '⚡';
  if (k.includes('validation')) return '✅';
  if (k.includes('field')) return '🏷️';
  if (k.includes('layout')) return '📄';
  if (k.includes('lightning') || k.includes('aura')) return '🔆';
  if (k.includes('report')) return '📊';
  if (k.includes('permission')) return '🔑';
  if (k.includes('object') || k.includes('entity')) return '📦';
  return '🔗';
};

export function renderWhereUsedInto(host: HTMLElement, deps: WhereUsedDeps): void {
  const isDark = deps.isDark;
  const C = getTheme(isDark);

  host.innerHTML = '';
  const root = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', background: C.bg, color: C.text });
  host.appendChild(root);

  // header
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '← Tools');
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
  titleWrap.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '🔎 Where Used'));
  titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, 'Find everything that references a component'));
  head.appendChild(titleWrap);
  root.appendChild(head);

  // search bar
  const bar = el('div', { display: 'flex', gap: '10px', padding: '16px 24px 6px', flexShrink: '0' });
  const input = el('input', { flex: '1', boxSizing: 'border-box', padding: '10px 14px', fontSize: '13px', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.card, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
  input.placeholder = 'Field (Account.Industry), Apex class, flow, LWC — or paste a 15/18-char Id';
  const goBtn = el('button', { background: C.accent, border: 'none', color: '#fff', borderRadius: '10px', padding: '10px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, 'Find usages');
  bar.appendChild(input); bar.appendChild(goBtn);
  root.appendChild(bar);
  root.appendChild(el('div', { padding: '0 24px 8px', fontSize: '11.5px', color: C.faint }, 'Uses Salesforce’s Dependency API. Enter a custom field as Object.Field, or the exact API name of an Apex class, flow, LWC or Aura bundle. You can also paste the component’s record Id.'));

  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '6px 24px 24px' });
  root.appendChild(scroll);

  const msg = (t: string, color = C.muted) => { scroll.innerHTML = ''; scroll.appendChild(el('div', { padding: '30px 6px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color }, t)); };

  const isSfId = (s: string) => /^[a-zA-Z0-9]{15}$/.test(s) || /^[a-zA-Z0-9]{18}$/.test(s);

  // Resolve the entered name to a component Id — the Dependency API only reliably
  // filters on RefMetadataComponentId, and this org doesn't expose the *Name field.
  async function resolveRefId(inputVal: string): Promise<{ id?: string; error?: string }> {
    if (isSfId(inputVal)) return { id: inputVal };
    if (inputVal.includes('.')) {
      const [obj, fld] = inputVal.split('.');
      const r = await deps.runQuery(`SELECT DurableId FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = ${soqlStr(obj)} AND QualifiedApiName = ${soqlStr(fld)} LIMIT 1`, true);
      if (r.error) return { error: r.error };
      const durable = r.records?.[0]?.DurableId as string | undefined;
      if (durable) return { id: durable.includes('.') ? durable.split('.').pop() : durable };
      return { error: `Field “${inputVal}” not found.` };
    }
    const tries: [string, string][] = [
      ['ApexClass', 'Name'], ['ApexTrigger', 'Name'],
      ['LightningComponentBundle', 'DeveloperName'], ['AuraDefinitionBundle', 'DeveloperName'],
      ['FlowDefinition', 'DeveloperName'],
    ];
    for (const [obj, field] of tries) {
      const r = await deps.runQuery(`SELECT Id FROM ${obj} WHERE ${field} = ${soqlStr(inputVal)} LIMIT 1`, true);
      if (!r.error && r.records && r.records.length) return { id: r.records[0].Id };
    }
    return { error: `Couldn’t find “${inputVal}”. Use Object.Field for a field, an exact API name for a class/flow/LWC, or paste the record Id.` };
  }

  async function search() {
    const name = input.value.trim();
    if (!name) { deps.flashToast('Enter a component API name or Id'); return; }
    goBtn.style.pointerEvents = 'none'; goBtn.style.opacity = '0.6';
    msg('Resolving component…');
    const resolved = await resolveRefId(name);
    if (resolved.error || !resolved.id) { msg(resolved.error || 'Could not resolve that component.', C.danger); goBtn.style.pointerEvents = 'auto'; goBtn.style.opacity = '1'; return; }

    msg('Searching dependencies…');
    const soql = `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = ${soqlStr(resolved.id)} ORDER BY MetadataComponentType, MetadataComponentName`;
    const { records, error } = await deps.runQuery(soql, true);
    goBtn.style.pointerEvents = 'auto'; goBtn.style.opacity = '1';

    if (error) {
      const dep = /MetadataComponentDependency|not supported|INVALID_TYPE|sObject type|Dependency/i.test(error);
      msg(dep ? 'Could not query the Dependency API for this org — it may be disabled in Setup.' : error, C.danger);
      return;
    }
    render(name, (records || []) as DepRow[]);
  }

  function render(name: string, rows: DepRow[]) {
    scroll.innerHTML = '';
    if (!rows.length) {
      msg(`No references found for “${name}”. It may be unused, or its type isn’t tracked by the Dependency API.`);
      return;
    }

    const summary = el('div', { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '4px 2px 14px' });
    summary.appendChild(el('span', { fontSize: '14px', fontWeight: '800', color: C.text }, `${rows.length} reference${rows.length === 1 ? '' : 's'} to “${name}”`));
    scroll.appendChild(summary);

    // Group referrers by type.
    const byType = new Map<string, DepRow[]>();
    rows.forEach((r) => { const t = r.MetadataComponentType || 'Other'; const a = byType.get(t) || []; a.push(r); byType.set(t, a); });
    const groups = Array.from(byType.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    groups.forEach(([type, items]) => {
      const wrap = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '12px' });
      const gh = el('div', { display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 14px', background: C.headerBg, borderBottom: `1px solid ${C.border}` });
      gh.appendChild(el('span', { fontSize: '15px' }, typeIcon(type)));
      gh.appendChild(el('span', { fontSize: '13px', fontWeight: '800' }, type));
      gh.appendChild(el('span', { marginLeft: 'auto', fontSize: '11.5px', fontWeight: '700', color: C.faint }, String(items.length)));
      wrap.appendChild(gh);
      items.forEach((r, i) => {
        const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', borderTop: i === 0 ? 'none' : `1px solid ${C.divider}` });
        row.appendChild(el('span', { fontSize: '13px', fontWeight: '600', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1' }, r.MetadataComponentName || r.MetadataComponentId || '(unnamed)'));
        const copy = el('span', { cursor: 'pointer', color: C.faint, fontSize: '13px', flexShrink: '0' }, '⧉');
        copy.title = 'Copy name';
        copy.addEventListener('click', () => { navigator.clipboard?.writeText(r.MetadataComponentName || '').then(() => deps.flashToast('Copied')); });
        row.appendChild(copy);
        wrap.appendChild(row);
      });
      scroll.appendChild(wrap);
    });
  }

  goBtn.addEventListener('click', search);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  setTimeout(() => input.focus(), 40);
}
