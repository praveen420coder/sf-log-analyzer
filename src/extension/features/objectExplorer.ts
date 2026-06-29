// Object Explorer: injects an icon into Salesforce's global-actions header that
// opens a themed panel of Object Manager sections for the current object.
// Dependencies are injected so this stays decoupled from content-ui's module state.

export interface ObjectExplorerDeps {
  isEnabled: () => boolean;
  getTheme: () => 'light' | 'dark';
  lightningOrigin: () => string;
  detectPageObject: () => string | null;
  iconUrl: () => string;
}

const SECTIONS: { group: string; items: [string, string][] }[] = [
  { group: 'Schema', items: [['Fields & Relationships', 'FieldsAndRelationships'], ['Compact Layouts', 'CompactLayouts'], ['Field Sets', 'FieldSets'], ['Record Types', 'RecordTypes'], ['Object Limits', 'Limits']] },
  { group: 'UI', items: [['Page Layouts', 'PageLayouts'], ['Lightning Record Pages', 'LightningPages'], ['Buttons, Links & Actions', 'ButtonsLinksActions'], ['Search Layouts', 'SearchLayouts'], ['List View Button Layout', 'ListViewButtonLayout']] },
  { group: 'Logic', items: [['Validation Rules', 'ValidationRules'], ['Triggers', 'Triggers'], ['Flow Triggers', 'FlowTriggers'], ['Restriction Rules', 'RestrictionRules'], ['Scoping Rules', 'ScopingRules']] },
  { group: 'Other', items: [['Related Lookup Filters', 'RelatedLookupFilters'], ['Object Details', 'Details']] },
];

const ICON_ID = 'sf-spotlight-object-explorer';
const PANEL_ID = 'sf-spotlight-obj-explorer-panel';

function togglePanel(obj: string, deps: ObjectExplorerDeps): void {
  const existing = document.getElementById(PANEL_ID);
  if (existing) { existing.remove(); return; }

  const isDark = deps.getTheme() === 'dark';
  const P = {
    bg: isDark ? '#0f172a' : '#ffffff',
    text: isDark ? '#e2e8f0' : '#1f2937',
    faint: isDark ? 'rgba(148,163,184,0.6)' : '#9aa3b2',
    border: isDark ? 'rgba(148,163,184,0.18)' : '#eef0f3',
    hover: isDark ? 'rgba(59,130,246,0.18)' : '#eef2ff',
    accent: '#3b82f6',
  };
  const icoUrl = deps.iconUrl();
  const origin = deps.lightningOrigin();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position: 'fixed', top: '0', right: '0', width: '340px', maxWidth: '92vw', height: '100vh',
    background: P.bg, boxShadow: '-8px 0 40px rgba(0,0,0,0.28)', zIndex: '2147483646',
    display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif', color: P.text,
    borderLeft: `1px solid ${P.border}`,
  });

  const header = document.createElement('div');
  Object.assign(header.style, { background: 'linear-gradient(135deg, #4f8cff, #2563eb)', color: '#fff', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: '0' });
  header.innerHTML = icoUrl
    ? `<img src="${icoUrl}" alt="" style="width:22px;height:22px;border-radius:5px;flex-shrink:0;background:rgba(255,255,255,0.18)" />`
    : `<svg viewBox="0 0 520 520" width="22" height="22" style="fill:#fff;flex-shrink:0"><g><path d="M235 248a63 63 0 00-63 63c0 35 28 63 63 63s63-28 63-63-28-63-63-63z"></path></g></svg>`;
  const titleWrap = document.createElement('div'); titleWrap.style.flex = '1'; titleWrap.style.minWidth = '0';
  titleWrap.innerHTML = `<div style="font-weight:800;font-size:15px;line-height:1.2">Object Explorer</div><div style="font-size:12px;opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${obj}</div>`;
  header.appendChild(titleWrap);
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✕';
  Object.assign(closeBtn.style, { background: 'transparent', border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer', padding: '2px 6px', flexShrink: '0' });
  closeBtn.addEventListener('click', () => panel.remove());
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  Object.assign(body.style, { flex: '1', overflow: 'auto', padding: '8px 0' });
  panel.appendChild(body);
  SECTIONS.forEach((sec) => {
    const gh = document.createElement('div');
    gh.textContent = sec.group.toUpperCase();
    Object.assign(gh.style, { fontSize: '10px', fontWeight: '800', letterSpacing: '0.08em', color: P.faint, padding: '14px 18px 4px' });
    body.appendChild(gh);
    sec.items.forEach(([label, node]) => {
      const a = document.createElement('a');
      a.href = `${origin}/lightning/setup/ObjectManager/${obj}/${node}/view`;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = label;
      Object.assign(a.style, { display: 'block', padding: '9px 18px 9px 14px', fontSize: '13.5px', color: P.text, textDecoration: 'none', cursor: 'pointer', borderLeft: '4px solid transparent', transition: 'background 0.12s, border-color 0.12s' });
      a.addEventListener('mouseover', () => { a.style.background = P.hover; a.style.color = P.accent; a.style.borderLeftColor = P.accent; a.style.fontWeight = '700'; });
      a.addEventListener('mouseout', () => { a.style.background = 'transparent'; a.style.color = P.text; a.style.borderLeftColor = 'transparent'; a.style.fontWeight = '400'; });
      body.appendChild(a);
    });
  });

  const footer = document.createElement('a');
  footer.href = `${origin}/lightning/setup/ObjectManager/${obj}/Details/view`;
  footer.target = '_blank'; footer.rel = 'noopener noreferrer';
  footer.textContent = 'Open in Salesforce Setup ↗';
  Object.assign(footer.style, { flexShrink: '0', textAlign: 'center', padding: '12px', fontSize: '12px', color: P.accent, textDecoration: 'none', borderTop: `1px solid ${P.border}` });
  panel.appendChild(footer);

  document.body.appendChild(panel);
  const onOut = (e: MouseEvent) => {
    const t = e.target as Node;
    if (!panel.contains(t) && !document.getElementById(ICON_ID)?.contains(t)) { panel.remove(); document.removeEventListener('mousedown', onOut, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', onOut, true), 0);
}

export function initObjectExplorer(deps: ObjectExplorerDeps): void {
  const ensure = () => {
    const existing = document.getElementById(ICON_ID) as HTMLLIElement | null;
    if (!deps.isEnabled()) { existing?.remove(); document.getElementById(PANEL_ID)?.remove(); return; }
    const ul = document.querySelector('ul.slds-global-actions');
    if (!ul) return;
    const obj = deps.detectPageObject();
    if (!obj) { existing?.remove(); return; } // only on record/object pages
    if (existing) { existing.dataset.obj = obj; return; }
    const li = document.createElement('li');
    li.id = ICON_ID;
    li.className = 'slds-global-actions__item slds-grid';
    li.title = 'Object Explorer (SF Spotlight)';
    li.dataset.obj = obj;
    Object.assign(li.style, { cursor: 'pointer', display: 'flex', alignItems: 'center' });
    const icoUrl = deps.iconUrl();
    li.innerHTML = icoUrl
      ? `<img src="${icoUrl}" alt="Object Explorer" style="width:22px;height:22px;border-radius:5px;display:block" />`
      : `<svg focusable="false" aria-hidden="true" viewBox="0 0 520 520" class="slds-icon slds-icon_small" style="fill:#5c5c5c"><g><path d="M235 248a63 63 0 00-63 63c0 35 28 63 63 63s63-28 63-63-28-63-63-63z"></path></g></svg>`;
    li.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(li.dataset.obj || obj, deps); });
    ul.insertBefore(li, ul.firstChild);
  };
  ensure();
  // Header renders late and the SPA swaps pages without reload — re-check periodically.
  setInterval(ensure, 1500);
}
