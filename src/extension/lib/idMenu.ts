// Shared Salesforce-Id action menu: renders an Id as a clickable link that opens
// a small popover (Go to record / View record data / Copy Id). "View record data"
// opens a modal listing the record's readable fields. Used by the Export table and
// the Data Import results table so Id behavior is identical everywhere.

export interface RecordData { recordName: string; objectLabel: string; fields: { label: string; apiName: string; value: any }[] }
export interface IdMenuDeps {
  isDark: boolean;
  recordUrl: (id: string) => string;
  fetchRecord: (id: string, sobject?: string) => Promise<{ data?: RecordData; error?: string }>;
  flashToast?: (m: string) => void;
}

function palette(isDark: boolean) {
  return {
    panel: isDark ? '#111c30' : '#ffffff', text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? '#94a3b8' : '#64748b', faint: isDark ? 'rgba(148,163,184,0.5)' : 'rgba(31,41,55,0.4)',
    border: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,0,0,0.12)', divider: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.07)',
    accent: '#3b82f6', fail: '#ef4444', zebra: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

let openMenu: HTMLElement | null = null;
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
let listenerBound = false;

export function createIdLink(id: string, deps: IdMenuDeps, sobject?: string): HTMLAnchorElement {
  const C = palette(deps.isDark);
  if (!listenerBound) { document.addEventListener('click', closeMenu); listenerBound = true; }

  const a = el('a', { color: C.accent, textDecoration: 'none', fontFamily: 'monospace', cursor: 'pointer', borderBottom: `1px dotted ${C.accent}` }, id);
  a.href = 'javascript:void(0)';
  a.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    closeMenu();
    const menu = el('div', { position: 'fixed', zIndex: '2147483647', minWidth: '190px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.28)', overflow: 'hidden', padding: '4px' });
    const item = (icon: string, text: string, fn: () => void, extra?: Partial<CSSStyleDeclaration>) => {
      const it = el('div', { display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 11px', fontSize: '12.5px', color: C.text, cursor: 'pointer', borderRadius: '7px', ...extra });
      it.appendChild(el('span', { fontSize: '13px' }, icon)); it.appendChild(el('span', {}, text));
      it.addEventListener('mouseenter', () => { it.style.background = C.zebra; });
      it.addEventListener('mouseleave', () => { it.style.background = 'transparent'; });
      it.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); fn(); });
      return it;
    };
    menu.appendChild(item('↗', 'Go to record', () => window.open(deps.recordUrl(id), '_blank', 'noopener')));
    menu.appendChild(item('👁', 'View record data', () => showRecordModal(id, deps, sobject)));
    menu.appendChild(item('⧉', 'Copy Id', () => { navigator.clipboard?.writeText(id); deps.flashToast?.('Id copied'); }, { color: C.muted, borderTop: `1px solid ${C.divider}`, marginTop: '2px' }));
    document.body.appendChild(menu);
    const r = a.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.min(r.left, window.innerWidth - mw - 8)}px`;
    menu.style.top = `${r.bottom + mh + 6 > window.innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
    openMenu = menu;
  });
  return a;
}

export function showRecordModal(id: string, deps: IdMenuDeps, sobject?: string) {
  const C = palette(deps.isDark);
  const inp = (extra?: Partial<CSSStyleDeclaration>) => ({ padding: '7px 10px', fontSize: '12.5px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', ...extra } as Partial<CSSStyleDeclaration>);
  const overlay = el('div', { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const box = el('div', { width: '640px', maxWidth: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '14px', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', fontFamily: 'system-ui, sans-serif' });
  const hd = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', borderBottom: `1px solid ${C.divider}`, flexShrink: '0' });
  const title = el('div', { fontSize: '14px', fontWeight: '800', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, 'Record data');
  hd.appendChild(title);
  const goBtn = el('button', { background: 'transparent', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: '8px', padding: '5px 11px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', marginLeft: 'auto', fontFamily: 'inherit' }, '↗ Open');
  goBtn.addEventListener('click', () => window.open(deps.recordUrl(id), '_blank', 'noopener'));
  const xBtn = el('button', { background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '5px 10px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }, '✕');
  xBtn.addEventListener('click', () => overlay.remove());
  hd.appendChild(goBtn); hd.appendChild(xBtn);
  box.appendChild(hd);
  const body = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '6px 0' });
  body.appendChild(el('div', { padding: '22px 18px', color: C.muted, fontSize: '13px' }, 'Loading record…'));
  box.appendChild(body); overlay.appendChild(box); document.body.appendChild(overlay);

  deps.fetchRecord(id, sobject).then(({ data, error }) => {
    body.innerHTML = '';
    if (error || !data) { body.appendChild(el('div', { padding: '22px 18px', color: C.fail, fontSize: '13px' }, error || 'Could not load record.')); return; }
    title.textContent = `${data.recordName || id} · ${data.objectLabel}`;
    const filter = el('input', inp({ margin: '8px 18px 10px', width: 'calc(100% - 36px)' })) as HTMLInputElement;
    filter.placeholder = 'Filter fields…';
    body.appendChild(filter);
    const tbl = el('table', { borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' });
    const render = (q: string) => {
      tbl.innerHTML = '';
      data.fields.filter((f) => !q || f.label.toLowerCase().includes(q) || f.apiName.toLowerCase().includes(q)).forEach((f, i) => {
        const tr = el('tr', { background: i % 2 ? C.zebra : '' });
        const l = el('td', { padding: '7px 18px', verticalAlign: 'top', width: '42%', borderBottom: `1px solid ${C.divider}` });
        l.appendChild(el('div', { fontWeight: '600', color: C.text }, f.label));
        l.appendChild(el('div', { fontSize: '10.5px', color: C.faint, fontFamily: 'monospace' }, f.apiName));
        const vRaw = f.value == null ? '' : typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
        const v = el('td', { padding: '7px 18px', verticalAlign: 'top', color: vRaw === '' ? C.faint : C.text, borderBottom: `1px solid ${C.divider}`, wordBreak: 'break-word' }, vRaw === '' ? '—' : vRaw);
        tr.appendChild(l); tr.appendChild(v); tbl.appendChild(tr);
      });
    };
    filter.addEventListener('input', () => render(filter.value.trim().toLowerCase()));
    render('');
    body.appendChild(tbl);
  });
}
