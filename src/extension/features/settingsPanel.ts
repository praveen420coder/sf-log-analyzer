// In-panel Settings screen — rendered natively (vanilla DOM) like every other
// tab screen, not a separate HTML page. Sidebar of sections + a content area,
// wired to the same chrome.storage keys the panel already uses.

import { getTheme } from '../lib/theme';
import {
  KEYS, SPOTLIGHT_TABS, defaultTabConfig, normalizeTabConfig,
  DEFAULT_APPEARANCE, DEFAULT_TOOLS, DEFAULT_PREFS, DEFAULT_USAGE, DEFAULT_EXPORT,
  type AppearanceSettings, type ToolsToggles, type Prefs, type Usage, type VisitedOrg, type TabConfig, type ExportSettings,
  get, set, remove, openTab,
} from '../lib/settingsStore';

export interface SettingsPanelDeps {
  isDark: boolean;
  // Lets the host rebuild the WHOLE panel so a theme change applies to every tab
  // instantly (not just this settings screen).
  applyTheme?: (theme: 'light' | 'dark') => void;
  // In-memory metadata caches the panel keeps (Objects, Flows, …) and a way to
  // drop them. "Clear cache" must NEVER touch saved orgs, favorites or history.
  cacheEntries?: () => { label: string; count: number }[];
  clearMetadataCache?: () => void;
}

type Theme = ReturnType<typeof getTheme>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

const SECTIONS: { group: string; items: { id: string; label: string; icon: string }[] }[] = [
  { group: 'System', items: [
    { id: 'cache', label: 'Cache', icon: '🗄️' },
    { id: 'history', label: 'History', icon: '🕘' },
    { id: 'tasks', label: 'Tasks', icon: '✅' },
  ] },
  { group: 'Experience', items: [
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    { id: 'tabs', label: 'Tabs', icon: '🧩' },
    { id: 'notification', label: 'Notification', icon: '🔔' },
    { id: 'privacy', label: 'Privacy', icon: '🛡️' },
  ] },
  { group: 'Salesforce', items: [
    { id: 'salesforce', label: 'Salesforce', icon: '☁️' },
    { id: 'export', label: 'Data Export', icon: '📤' },
    { id: 'connection', label: 'Connection', icon: '🔗' },
  ] },
  { group: 'Support', items: [{ id: 'support', label: 'Support', icon: 'ℹ️' }] },
];
const API_VERSIONS = ['64.0', '63.0', '62.0', '61.0', '60.0', '59.0', '58.0', '57.0', '56.0'];

// Real extension icon (resolves under chrome-extension:// when packaged).
const LOGO_URL = (() => {
  const cr = (globalThis as any).chrome?.runtime;
  return cr?.getURL ? cr.getURL('icons/Spotlite-Icon.svg') : '/icons/Spotlite-Icon.svg';
})();

export function renderSettingsPanelInto(host: HTMLElement, deps: SettingsPanelDeps): void {
  let dark = deps.isDark;
  let C: Theme = getTheme(dark);
  let active = 'cache';

  // in-memory state (loaded from storage)
  let A: AppearanceSettings = { ...DEFAULT_APPEARANCE };
  let TL: ToolsToggles = { ...DEFAULT_TOOLS };
  let P: Prefs = { ...DEFAULT_PREFS };
  let U: Usage = { ...DEFAULT_USAGE };
  let SES: VisitedOrg[] = [];
  let TC: TabConfig = defaultTabConfig();
  let EX: ExportSettings = { ...DEFAULT_EXPORT };

  host.innerHTML = '';
  host.appendChild(el('div', { padding: '30px', fontSize: '13px', color: getTheme(dark).muted }, 'Loading settings…'));

  // Loads saved orgs (for the Connection table). Deliberately does NOT feed the
  // Cache section — saved orgs / favorites are user data, not cache.
  const loadSessions = async () => {
    const sess = await get<VisitedOrg[]>(KEYS.sessions, []);
    SES = Array.isArray(sess) ? sess : [];
  };

  Promise.all([
    get(KEYS.settings, {}), get(KEYS.tools, {}), get(KEYS.prefs, {}), get(KEYS.usage, {}), get<TabConfig | null>(KEYS.tabConfig, null), get(KEYS.exportSettings, {}), loadSessions(),
  ]).then(([s, t, p, u, tc, ex]) => {
    A = { ...DEFAULT_APPEARANCE, ...(s as object) };
    TL = { ...DEFAULT_TOOLS, ...(t as object) };
    P = { ...DEFAULT_PREFS, ...(p as object) };
    U = { ...DEFAULT_USAGE, ...(u as object) };
    TC = normalizeTabConfig(tc);
    EX = { ...DEFAULT_EXPORT, ...(ex as object) };
    dark = A.spotlightTheme === 'dark';
    build();
  });

  // ── persistence helpers ────────────────────────────────────────────────────
  const saveA = (patch: Partial<AppearanceSettings>) => {
    A = { ...A, ...patch }; set(KEYS.settings, A);
    if (patch.spotlightTheme) {
      dark = A.spotlightTheme === 'dark';
      // Rebuild the whole panel so every tab picks up the theme immediately.
      if (deps.applyTheme) { deps.applyTheme(A.spotlightTheme); return; }
      build();
    } else renderContent();
  };
  const saveTL = (patch: Partial<ToolsToggles>) => { TL = { ...TL, ...patch }; set(KEYS.tools, TL); renderContent(); };
  const saveP = (patch: Partial<Prefs>) => { P = { ...P, ...patch }; set(KEYS.prefs, P); renderContent(); };
  const saveTC = (next: TabConfig) => { TC = normalizeTabConfig(next); set(KEYS.tabConfig, TC); renderContent(); };
  const saveEX = (patch: Partial<ExportSettings>) => { EX = { ...EX, ...patch }; set(KEYS.exportSettings, EX); renderContent(); };

  // ── shell ───────────────────────────────────────────────────────────────────
  let contentEl: HTMLElement;
  function build() {
    C = getTheme(dark);
    host.innerHTML = '';
    const root = el('div', { display: 'flex', height: '100%', minHeight: '0', background: C.bg, color: C.text });
    host.appendChild(root);

    // sidebar
    const side = el('div', { width: '210px', flexShrink: '0', borderRight: `1px solid ${C.divider}`, display: 'flex', flexDirection: 'column', padding: '16px 10px 0', background: C.side, overflowY: 'auto' });
    const brand = el('div', { display: 'flex', alignItems: 'center', gap: '9px', padding: '0 8px 16px' });
    const logo = el('img', { width: '26px', height: '26px', borderRadius: '7px', display: 'block' }) as HTMLImageElement;
    logo.src = LOGO_URL; logo.alt = '';
    brand.appendChild(logo);
    brand.appendChild(el('span', { fontSize: '15px', fontWeight: '800' }, 'SF Spotlight'));
    side.appendChild(brand);
    SECTIONS.forEach((grp) => {
      side.appendChild(el('div', { fontSize: '10.5px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.faint, padding: '10px 10px 6px' }, grp.group));
      grp.items.forEach((it) => {
        const on = active === it.id;
        const b = el('button', { display: 'flex', alignItems: 'center', gap: '11px', width: '100%', textAlign: 'left', padding: '10px 10px', marginBottom: '2px', borderRadius: '9px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: on ? '700' : '600', background: on ? C.accentSoft : 'transparent', color: on ? C.accent : C.muted });
        b.appendChild(el('span', { fontSize: '18px', lineHeight: '1', width: '22px', textAlign: 'center' }, it.icon));
        b.appendChild(el('span', undefined, it.label));
        b.addEventListener('click', () => { active = it.id; build(); });
        side.appendChild(b);
      });
    });
    const spacer = el('div', { flex: '1' }); side.appendChild(spacer);
    root.appendChild(side);

    // content
    contentEl = el('div', { flex: '1', minWidth: '0', minHeight: '0', overflowY: 'auto', padding: '26px 30px' });
    root.appendChild(contentEl);
    renderContent();
  }

  // ── primitives ────────────────────────────────────────────────────────────
  const card = (): HTMLElement => el('div', { background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '22px 26px', marginBottom: '18px' });
  const divider = () => el('div', { height: '1px', background: C.divider, margin: '18px 0' });
  const sectionHead = (kicker: string, title: string, desc?: string, right?: HTMLElement): HTMLElement => {
    const wrap = el('div', { display: 'flex', alignItems: 'flex-start', gap: '12px' });
    const left = el('div', { flex: '1', minWidth: '0' });
    if (kicker) left.appendChild(el('div', { fontSize: '11px', fontWeight: '800', letterSpacing: '0.07em', textTransform: 'uppercase', color: C.faint }, kicker));
    left.appendChild(el('div', { fontSize: '18px', fontWeight: '800', marginTop: kicker ? '4px' : '0' }, title));
    if (desc) left.appendChild(el('div', { fontSize: '13px', marginTop: '5px', color: C.muted, lineHeight: '1.5' }, desc));
    wrap.appendChild(left);
    if (right) wrap.appendChild(right);
    return wrap;
  };
  const toggle = (checked: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const t = el('button', { width: '44px', height: '25px', borderRadius: '999px', border: 'none', cursor: 'pointer', padding: '3px', background: checked ? C.accent : (dark ? 'rgba(148,163,184,0.3)' : '#cbd5e1'), display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'background .18s', flexShrink: '0' });
    t.appendChild(el('span', { width: '19px', height: '19px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }));
    t.addEventListener('click', () => onChange(!checked));
    return t;
  };
  const pillToggle = (checked: boolean, onChange: (v: boolean) => void, on = 'Enabled', off = 'Disabled'): HTMLElement => {
    const wrap = el('div', { display: 'flex', alignItems: 'center', gap: '9px' });
    wrap.appendChild(toggle(checked, onChange));
    wrap.appendChild(el('span', { fontSize: '12.5px', fontWeight: '700', color: checked ? C.text : C.muted, minWidth: '30px' }, checked ? on : off));
    return wrap;
  };
  const checkbox = (checked: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const b = el('button', { width: '18px', height: '18px', flexShrink: '0', borderRadius: '5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${checked ? C.accent : (dark ? 'rgba(148,163,184,0.4)' : '#cbd5e1')}`, background: checked ? C.accent : 'transparent', color: '#fff', fontSize: '12px', lineHeight: '1' }, checked ? '✓' : '');
    b.addEventListener('click', () => onChange(!checked));
    return b;
  };
  const optionRow = (checked: boolean, onChange: (v: boolean) => void, title: string, desc: string): HTMLElement => {
    const row = el('div', { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '5px 0' });
    const c = el('div', { marginTop: '2px' }); c.appendChild(checkbox(checked, onChange)); row.appendChild(c);
    const txt = el('div');
    txt.appendChild(el('div', { fontSize: '13.5px', fontWeight: '700', color: C.text }, title));
    txt.appendChild(el('div', { fontSize: '12.5px', color: C.muted, marginTop: '2px' }, desc));
    row.appendChild(txt);
    return row;
  };
  const btn = (label: string, variant: 'primary' | 'ghost' | 'danger', onClick: () => void): HTMLElement => {
    const base: Partial<CSSStyleDeclaration> = { display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '8px 14px', borderRadius: '9px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
    const styles: Record<string, Partial<CSSStyleDeclaration>> = {
      primary: { ...base, background: C.accent, color: '#fff', border: 'none' },
      ghost: { ...base, background: 'transparent', color: C.text, border: `1px solid ${C.border}` },
      danger: { ...base, background: 'transparent', color: C.danger, border: `1px solid ${C.danger}` },
    };
    const b = el('button', styles[variant], label);
    b.addEventListener('click', onClick);
    return b;
  };
  const fieldLabel = (t: string) => el('div', { fontSize: '12.5px', fontWeight: '700', color: C.text, marginBottom: '8px' }, t);
  const badge = (t: string, color: string, bg: string) => el('span', { display: 'inline-block', fontSize: '11px', fontWeight: '800', color, background: bg, padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }, t);
  const numberField = (value: number, min: number, max: number, onChange: (n: number) => void): HTMLElement => {
    const i = el('input', { width: '90px', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
    i.type = 'number'; i.value = String(value); i.min = String(min); i.max = String(max);
    i.addEventListener('change', () => { const n = Math.max(min, Math.min(max, Number(i.value) || min)); onChange(n); });
    return i;
  };
  const segBtns = (value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement => {
    const wrap = el('div', { display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden' });
    options.forEach(([v, label]) => {
      const on = v === value;
      const b = el('button', { padding: '8px 20px', fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: on ? C.accent : 'transparent', color: on ? '#fff' : C.muted }, label);
      b.addEventListener('click', () => onChange(v));
      wrap.appendChild(b);
    });
    return wrap;
  };
  const sliderRow = (label: string, value: number, min: number, max: number, suffix: string, onChange: (n: number) => void): HTMLElement => {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '14px', padding: '7px 0' });
    row.appendChild(el('span', { fontSize: '13px', fontWeight: '600', width: '130px' }, label));
    const r = el('input', { flex: '1', accentColor: C.accent }) as HTMLInputElement;
    r.type = 'range'; r.min = String(min); r.max = String(max); r.value = String(value);
    const out = el('span', { fontSize: '13px', fontWeight: '700', width: '46px', textAlign: 'right' }, `${value}${suffix}`);
    r.addEventListener('input', () => { out.textContent = `${r.value}${suffix}`; onChange(Number(r.value)); });
    row.appendChild(r); row.appendChild(out);
    return row;
  };

  // ── content router ──────────────────────────────────────────────────────────
  function renderContent() {
    if (!contentEl) return;
    contentEl.innerHTML = '';
    const add = (...nodes: HTMLElement[]) => nodes.forEach((n) => contentEl.appendChild(n));
    switch (active) {
      case 'cache': return renderCache(add);
      case 'history': return renderHistory(add);
      case 'tasks': return renderTasks(add);
      case 'appearance': return renderAppearance(add);
      case 'tabs': return renderTabs(add);
      case 'notification': return renderNotification(add);
      case 'privacy': return renderPrivacy(add);
      case 'salesforce': return renderSalesforce(add);
      case 'export': return renderExport(add);
      case 'connection': return renderConnection(add);
      case 'support': return renderSupport(add);
    }
  }

  // ── sections ─────────────────────────────────────────────────────────────────
  function renderCache(add: (...n: HTMLElement[]) => void) {
    const entries = deps.cacheEntries?.() || [];
    const c1 = card();
    c1.appendChild(sectionHead('System', 'Cache acceleration', 'Keeps metadata from frequently used tools handy so screens load faster without hitting Salesforce every time.', pillToggle(P.cacheEnabled, (v) => saveP({ cacheEnabled: v }))));
    c1.appendChild(divider());
    c1.appendChild(optionRow(P.cacheAutoUpdate, (v) => saveP({ cacheAutoUpdate: v }), 'Auto update cache', 'Keeps cached data fresh in the background.'));
    const clr = el('div', { marginTop: '16px' });
    // Clears ONLY the in-memory metadata caches — never saved orgs, favorites or history.
    clr.appendChild(btn('🗑  Clear cache', 'danger', () => { deps.clearMetadataCache?.(); renderContent(); }));
    c1.appendChild(clr);

    const c2 = card();
    c2.appendChild(sectionHead('', 'Cached entries', 'Metadata cached this session to speed up screens (cleared on refresh).'));
    const chips = el('div', { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' });
    if (!entries.length) chips.appendChild(el('div', { fontSize: '13px', color: C.muted }, 'Nothing cached yet.'));
    entries.forEach((d) => {
      const chip = el('span', { display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: '999px', fontSize: '12.5px', fontWeight: '600' });
      chip.appendChild(el('span', undefined, d.label));
      chip.appendChild(el('span', { color: C.faint }, String(d.count)));
      chips.appendChild(chip);
    });
    c2.appendChild(chips);
    add(c1, c2);
  }

  function renderHistory(add: (...n: HTMLElement[]) => void) {
    const c = card();
    c.appendChild(sectionHead('System', 'History retention', 'Keeps a record of your recent actions so you can pick up where you left off.', pillToggle(P.historyEnabled, (v) => saveP({ historyEnabled: v }))));
    c.appendChild(divider());
    c.appendChild(optionRow(P.historyLimit, (v) => saveP({ historyLimit: v }), 'Limit history count', 'Keeps the list snappy by trimming older items.'));
    if (P.historyLimit) {
      const box = el('div', { margin: '10px 0 0 30px' });
      box.appendChild(fieldLabel('Maximum entries'));
      box.appendChild(numberField(P.historyMax, 5, 500, (n) => saveP({ historyMax: n })));
      box.appendChild(el('div', { fontSize: '12px', color: C.muted, marginTop: '6px' }, 'The oldest entries will be removed first once this limit is reached.'));
      c.appendChild(box);
    }
    c.appendChild(divider());
    c.appendChild(optionRow(P.historyAutoDelete, (v) => saveP({ historyAutoDelete: v }), 'Auto-delete history', 'Removes entries that get stale.'));
    if (P.historyAutoDelete) {
      const box = el('div', { margin: '10px 0 0 30px' });
      box.appendChild(fieldLabel('Delete entries older than (days)'));
      box.appendChild(numberField(P.historyMaxDays, 1, 365, (n) => saveP({ historyMaxDays: n })));
      c.appendChild(box);
    }
    const clr = el('div', { marginTop: '18px' });
    clr.appendChild(btn('🗑  Clear history', 'danger', async () => { await remove([KEYS.recents]); renderContent(); }));
    c.appendChild(clr);
    add(c);
  }

  function renderTasks(add: (...n: HTMLElement[]) => void) {
    const c = card();
    c.appendChild(sectionHead('System', 'Background tasks', 'Long-running operations the extension is handling for you.'));
    c.appendChild(divider());
    const empty = el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '26px 0', color: C.muted });
    empty.appendChild(el('div', { fontSize: '26px', opacity: '0.5' }, '✅'));
    empty.appendChild(el('div', { fontSize: '13.5px', fontWeight: '700', color: C.text }, 'No active tasks'));
    empty.appendChild(el('div', { fontSize: '12.5px' }, 'Debug-log live tailing and bulk operations will appear here while they run.'));
    c.appendChild(empty);
    add(c);
  }

  function renderAppearance(add: (...n: HTMLElement[]) => void) {
    const c1 = card();
    c1.appendChild(sectionHead('Experience', 'Panel appearance', 'Where and how the Spotlight panel shows up on Salesforce pages.'));
    c1.appendChild(divider());
    c1.appendChild(fieldLabel('Theme'));
    c1.appendChild(segBtns(A.spotlightTheme, [['light', 'Light'], ['dark', 'Dark']], (v) => saveA({ spotlightTheme: v as 'light' | 'dark' })));
    c1.appendChild(el('div', { height: '16px' }));
    c1.appendChild(fieldLabel('Panel position'));
    c1.appendChild(segBtns(A.position, [['right', 'Right'], ['left', 'Left']], (v) => saveA({ position: v as 'right' | 'left' })));
    c1.appendChild(divider());
    c1.appendChild(sliderRow('Width', A.width, 30, 100, '%', (n) => saveA({ width: n })));
    c1.appendChild(sliderRow('Opacity', A.opacity, 40, 100, '%', (n) => saveA({ opacity: n })));
    c1.appendChild(sliderRow('Vertical position', A.verticalPosition, 0, 100, '%', (n) => saveA({ verticalPosition: n })));

    const c2 = card();
    c2.appendChild(sectionHead('Experience', 'Behavior', 'Toggle panel features and on-page tweaks.'));
    c2.appendChild(divider());
    c2.appendChild(optionRow(A.minimalView, (v) => saveA({ minimalView: v }), 'Minimal view', 'Show only the universal search strip instead of the full tabbed panel.'));
    c2.appendChild(optionRow(A.showObjectExplorer, (v) => saveA({ showObjectExplorer: v }), 'Object Explorer icon', 'Add an Object Explorer shortcut to the Salesforce global header.'));
    c2.appendChild(optionRow(TL.hideDevBar, (v) => saveTL({ hideDevBar: v }), 'Hide Lightning dev bar', 'Hide the developer footer bar on Lightning pages.'));
    c2.appendChild(optionRow(TL.magicFill, (v) => saveTL({ magicFill: v }), 'Magic Fill', 'Add an auto-fill button to Lightning new-record modals.'));
    c2.appendChild(el('div', { fontSize: '12px', color: C.muted, marginTop: '12px' }, 'Theme applies right away; other changes take effect next time you open the panel.'));
    add(c1, c2);
  }

  function renderTabs(add: (...n: HTMLElement[]) => void) {
    const c = card();
    c.appendChild(sectionHead('Experience', 'Panel tabs', "Reorder the tabs in the Spotlight panel, hide the ones you don't use, and choose which tab opens first.", btn('Reset', 'ghost', () => saveTC(defaultTabConfig()))));
    c.appendChild(divider());
    const grid = '28px 1fr 90px 84px';
    const hdr = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', alignItems: 'center', padding: '0 4px 8px', fontSize: '11px', fontWeight: '800', letterSpacing: '0.04em', textTransform: 'uppercase', color: C.faint });
    ['#', 'Tab', 'Default', 'Visible'].forEach((h, i) => hdr.appendChild(el('div', i === 2 ? { textAlign: 'center' } : i === 3 ? { textAlign: 'right' } : undefined, h)));
    c.appendChild(hdr);
    const list = el('div', { border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' });
    let dragFrom = -1;   // index of the row currently being dragged
    TC.order.forEach((id, idx) => {
      const m = SPOTLIGHT_TABS.find((t) => t.id === id); if (!m) return;
      const hidden = TC.hidden.includes(id);
      const row = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', alignItems: 'center', padding: '10px 12px', borderTop: idx === 0 ? 'none' : `1px solid ${C.divider}`, opacity: hidden ? '0.55' : '1' });
      // Drag-and-drop reordering (arrows remain as a keyboard/click fallback).
      row.draggable = true;
      row.addEventListener('dragstart', (e) => { dragFrom = idx; row.style.opacity = '0.4'; try { (e as DragEvent).dataTransfer!.effectAllowed = 'move'; (e as DragEvent).dataTransfer!.setData('text/plain', id); } catch { /* ignore */ } });
      row.addEventListener('dragend', () => { row.style.opacity = hidden ? '0.55' : '1'; row.style.boxShadow = 'none'; dragFrom = -1; });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragFrom === -1 || dragFrom === idx) { row.style.boxShadow = 'none'; return; }
        const r = row.getBoundingClientRect();
        const after = (e as DragEvent).clientY > r.top + r.height / 2;
        row.style.boxShadow = after ? `inset 0 -2px 0 ${C.accent}` : `inset 0 2px 0 ${C.accent}`;
      });
      row.addEventListener('dragleave', () => { row.style.boxShadow = 'none'; });
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.style.boxShadow = 'none';
        if (dragFrom === -1 || dragFrom === idx) return;
        const r = row.getBoundingClientRect();
        const after = (e as DragEvent).clientY > r.top + r.height / 2;
        const o = [...TC.order];
        const [moved] = o.splice(dragFrom, 1);
        let insert = o.indexOf(id);
        if (after) insert += 1;
        o.splice(insert, 0, moved);
        saveTC({ ...TC, order: o });
      });
      const arrows = el('div', { display: 'flex', flexDirection: 'column' });
      const up = el('button', { background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: C.muted, padding: '0', lineHeight: '1', opacity: idx === 0 ? '0.4' : '1', fontSize: '11px' }, '▲');
      const down = el('button', { background: 'transparent', border: 'none', cursor: idx === TC.order.length - 1 ? 'default' : 'pointer', color: C.muted, padding: '0', lineHeight: '1', opacity: idx === TC.order.length - 1 ? '0.4' : '1', fontSize: '11px' }, '▼');
      up.addEventListener('click', () => { if (idx === 0) return; const o = [...TC.order]; [o[idx - 1], o[idx]] = [o[idx], o[idx - 1]]; saveTC({ ...TC, order: o }); });
      down.addEventListener('click', () => { if (idx === TC.order.length - 1) return; const o = [...TC.order]; [o[idx + 1], o[idx]] = [o[idx], o[idx + 1]]; saveTC({ ...TC, order: o }); });
      arrows.appendChild(up); arrows.appendChild(down); row.appendChild(arrows);
      const name = el('div', { display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13.5px', fontWeight: '700' });
      const grip = el('span', { color: C.faint, cursor: 'grab', fontSize: '13px', letterSpacing: '-1px', userSelect: 'none' }, '⠿');
      grip.title = 'Drag to reorder';
      name.appendChild(grip);
      name.appendChild(el('span', undefined, m.icon)); name.appendChild(el('span', undefined, m.label)); row.appendChild(name);
      const def = el('div', { textAlign: 'center' });
      const radio = el('input') as HTMLInputElement; radio.type = 'radio'; radio.name = 'defaultTab'; radio.checked = TC.defaultTab === id; radio.disabled = hidden; radio.style.accentColor = C.accent; radio.style.cursor = hidden ? 'not-allowed' : 'pointer';
      radio.addEventListener('change', () => saveTC({ ...TC, defaultTab: id })); def.appendChild(radio); row.appendChild(def);
      const vis = el('div', { display: 'flex', justifyContent: 'flex-end' });
      const eye = el('button', { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px 9px', cursor: 'pointer', color: hidden ? C.faint : C.accent, fontSize: '13px' }, hidden ? '🚫' : '👁');
      eye.title = hidden ? 'Show tab' : 'Hide tab';
      eye.addEventListener('click', () => { const h = hidden ? TC.hidden.filter((x) => x !== id) : [...TC.hidden, id]; saveTC({ ...TC, hidden: h }); });
      vis.appendChild(eye); row.appendChild(vis);
      list.appendChild(row);
    });
    c.appendChild(list);
    c.appendChild(el('div', { fontSize: '12px', color: C.muted, marginTop: '12px' }, 'Drag rows (or use the arrows) to reorder. Applies to the overlay panel and takes effect next time you open it — the full-page tab uses a fixed sidebar.'));
    add(c);
  }

  function renderNotification(add: (...n: HTMLElement[]) => void) {
    const c = card();
    c.appendChild(sectionHead('Experience', 'Notification preferences', 'Choose how and when you want to be notified about background operations.'));
    c.appendChild(divider());
    c.appendChild(optionRow(P.notifToast, (v) => saveP({ notifToast: v }), 'In-extension notifications', 'Show toast messages within the extension for quick feedback.'));
    add(c);
  }

  function renderPrivacy(add: (...n: HTMLElement[]) => void) {
    const c = card();
    const shield = el('div', { width: '34px', height: '34px', borderRadius: '9px', background: C.accentSoft, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', fontSize: '17px' }, '🛡');
    const noData = badge('No data collected', C.success, dark ? 'rgba(34,197,94,0.14)' : '#f0fdf4');
    const headWrap = el('div', { display: 'flex', alignItems: 'flex-start', gap: '12px' });
    headWrap.appendChild(shield);
    headWrap.appendChild(sectionHead('Privacy & data', 'Everything stays in your browser', "SF Spotlight has no servers, no accounts, and no analytics. It runs entirely on your machine and talks only to your Salesforce org, using the session you're already logged in with.", noData));
    c.appendChild(headWrap);
    c.appendChild(divider());
    // developer warning
    const warn = el('div', { display: 'flex', gap: '12px', alignItems: 'flex-start', background: dark ? 'rgba(217,119,6,0.12)' : '#fffbeb', border: `1px solid ${dark ? 'rgba(217,119,6,0.4)' : '#fde68a'}`, borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' });
    warn.appendChild(el('span', { fontSize: '17px', flexShrink: '0' }, '⚠️'));
    const wtxt = el('div');
    wtxt.appendChild(el('div', { fontSize: '13.5px', fontWeight: '800', color: dark ? '#fcd34d' : '#92400e' }, 'Developer tool — not for production orgs'));
    wtxt.appendChild(el('div', { fontSize: '13px', color: C.muted, marginTop: '4px', lineHeight: '1.5' }, "Built for Salesforce developers and admins working in sandbox, scratch, and developer orgs. Some tools make real changes — activating or deactivating flows and validation rules, running Apex, and inserting or deleting records. Please don't run those against a production org."));
    warn.appendChild(wtxt); c.appendChild(warn);
    const info = (title: string, items: string[], tint: string) => {
      const b = el('div', { background: C.subtle, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' });
      b.appendChild(el('div', { fontSize: '13.5px', fontWeight: '800', marginBottom: '10px' }, title));
      items.forEach((t) => { const r = el('div', { display: 'flex', gap: '9px', fontSize: '13px', color: C.muted, marginBottom: '7px' }); r.appendChild(el('span', { color: tint }, '•')); r.appendChild(el('span', undefined, t)); b.appendChild(r); });
      return b;
    };
    c.appendChild(info('How it works', [
      'Runs 100% locally as a Chrome extension — there is no backend and no external server.',
      'Talks to Salesforce directly using your existing browser session (cookies), only when you trigger an action.',
      'No telemetry, tracking, analytics, or third-party requests of any kind.',
      "Your preferences, history, and cached data live only in this browser's local storage.",
    ], C.accent));
    c.appendChild(info('What never leaves your browser', [
      'Salesforce record data, field values, or org data',
      'Your Salesforce credentials or session / OAuth tokens',
      'Cached metadata, debug logs, or history saved by the extension',
      'Anything else — no data is ever transmitted to us or anyone.',
    ], C.success));
    add(c);
  }

  function renderSalesforce(add: (...n: HTMLElement[]) => void) {
    const c = card();
    c.appendChild(sectionHead('Salesforce integration', 'API version', 'Select the preferred Salesforce API version for SOQL queries, Tooling API calls, and metadata operations.'));
    c.appendChild(divider());
    c.appendChild(fieldLabel('API Version'));
    const sel = el('select', { padding: '9px 12px', fontSize: '13.5px', fontWeight: '600', borderRadius: '9px', border: `1px solid ${C.border}`, background: C.card, color: C.text, fontFamily: 'inherit', cursor: 'pointer', minWidth: '160px' }) as HTMLSelectElement;
    API_VERSIONS.forEach((v) => { const o = el('option', undefined, v); o.value = v; sel.appendChild(o); });
    sel.value = P.apiVersion;
    sel.addEventListener('change', () => saveP({ apiVersion: sel.value }));
    c.appendChild(sel);
    c.appendChild(el('div', { fontSize: '12.5px', color: C.muted, marginTop: '12px' }, 'ℹ  This version is used for new Salesforce API requests made by the extension.'));
    add(c);
  }

  function renderExport(add: (...n: HTMLElement[]) => void) {
    const c1 = card();
    c1.appendChild(sectionHead('Salesforce integration', 'Data Export', 'Preferences for the Export Data / SOQL tool — CSV format, query behavior, and the editor.'));
    c1.appendChild(divider());
    c1.appendChild(fieldLabel('CSV separator'));
    c1.appendChild(segBtns(EX.separator, [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab']], (v) => saveEX({ separator: v as ExportSettings['separator'] })));

    const c2 = card();
    c2.appendChild(sectionHead('', 'Query behavior', 'How queries run and what columns come back.'));
    c2.appendChild(divider());
    c2.appendChild(optionRow(EX.defaultTooling, (v) => saveEX({ defaultTooling: v }), 'Use Tooling API by default', 'New query tabs query the Tooling API instead of the standard data API.'));
    c2.appendChild(optionRow(EX.hideRelations, (v) => saveEX({ hideRelations: v }), 'Hide relationship columns', 'Collapse parent/relationship columns in the results table by default.'));
    c2.appendChild(optionRow(EX.includeFormula, (v) => saveEX({ includeFormula: v }), 'Include formula fields in autocomplete', 'Suggest formula fields when building a query.'));
    c2.appendChild(optionRow(EX.typoFix, (v) => saveEX({ typoFix: v }), 'Auto-fix SOQL typos', 'Correct common keyword typos (e.g. SELCT → SELECT) when a query runs.'));
    c2.appendChild(optionRow(EX.sobjectContext, (v) => saveEX({ sobjectContext: v }), 'Seed from current record/object', 'Pre-fill the first query from the object or record you opened the panel on.'));
    c2.appendChild(optionRow(EX.showExecTime, (v) => saveEX({ showExecTime: v }), 'Show execution time', 'Display how long each query took.'));
    c2.appendChild(optionRow(EX.localTime, (v) => saveEX({ localTime: v }), 'Local time', 'Render datetime values in your local timezone instead of UTC.'));

    const c3 = card();
    c3.appendChild(sectionHead('', 'Editor & history', 'Editor conveniences and how much is kept.'));
    c3.appendChild(divider());
    c3.appendChild(optionRow(EX.showStop, (v) => saveEX({ showStop: v }), 'Show Stop button', 'Show a button to cancel a running query.'));
    c3.appendChild(optionRow(EX.wrap, (v) => saveEX({ wrap: v }), 'Wrap cell text', 'Wrap long values in the results table instead of truncating.'));
    c3.appendChild(optionRow(EX.showButtons, (v) => saveEX({ showButtons: v }), 'Show action buttons', 'Show the secondary action buttons under the editor.'));
    c3.appendChild(optionRow(EX.promptTemplateName, (v) => saveEX({ promptTemplateName: v }), 'Prompt for a name when saving', 'Ask for a name each time you save a query.'));
    c3.appendChild(optionRow(EX.disableAutofocus, (v) => saveEX({ disableAutofocus: v }), "Don't autofocus the editor", 'Skip focusing the query editor when the tool opens.'));
    c3.appendChild(divider());
    const nums = el('div', { display: 'flex', gap: '28px', flexWrap: 'wrap' });
    const nf = (label: string, value: number, min: number, max: number, on: (n: number) => void) => { const w = el('div'); w.appendChild(fieldLabel(label)); w.appendChild(numberField(value, min, max, on)); return w; };
    nums.appendChild(nf('History limit', EX.historyLimit, 0, 500, (n) => saveEX({ historyLimit: n })));
    nums.appendChild(nf('Saved queries limit', EX.savedLimit, 0, 500, (n) => saveEX({ savedLimit: n })));
    c3.appendChild(nums);
    add(c1, c2, c3);
  }

  // Fetch the LIVE session id (= access token) for an org from its cookies via
  // the background — nothing sensitive is stored, so we read it on demand.
  const fetchCreds = (host: string): Promise<{ sessionId?: string; instanceUrl?: string }> => new Promise((resolve) => {
    const cr = (globalThis as any).chrome?.runtime;
    if (!cr?.sendMessage) { resolve({}); return; }
    try { cr.sendMessage({ type: 'GET_SF_CREDENTIALS', hostname: host }, (resp: any) => resolve(resp?.data || {})); }
    catch { resolve({}); }
  });
  // Copy `value`, flashing the button to confirm; empty value → "No session".
  const copyWithFlash = (btnEl: HTMLElement, label: string, value: string | undefined) => {
    if (!value) { flashBtn(btnEl, label, 'No session'); return; }
    navigator.clipboard?.writeText(value).then(() => flashBtn(btnEl, label, '✓ Copied')).catch(() => flashBtn(btnEl, label, 'Failed'));
  };
  const flashBtn = (btnEl: HTMLElement, label: string, msg: string) => {
    btnEl.textContent = msg;
    setTimeout(() => { btnEl.textContent = label; }, 1200);
  };

  function renderConnection(add: (...n: HTMLElement[]) => void) {
    const c = card();
    c.appendChild(sectionHead('Salesforce integration', 'Manage connections', "Orgs you've launched the extension from. Copy live credentials for tooling (SFDX, Postman, Workbench) or remove an org. Session ids are read live from cookies — never stored."));
    if (!SES.length) {
      c.appendChild(el('div', { fontSize: '13px', color: C.muted, padding: '18px 2px' }, 'No saved orgs yet. Open a Salesforce org and launch the extension to save its connection here.'));
      add(c); return;
    }
    const orgType = (o: VisitedOrg) => { const h = (o.host || '').toLowerCase(); if (h.includes('scratch')) return 'Scratch'; if (h.includes('sandbox') || h.includes('--')) return 'Sandbox'; if (h.includes('dev-ed') || h.includes('trailblaze')) return 'Developer'; return 'Production'; };
    // Copying a live session token puts an org-access credential on the clipboard.
    const warn = el('div', { display: 'flex', gap: '9px', alignItems: 'flex-start', background: dark ? 'rgba(217,119,6,0.12)' : '#fffbeb', border: `1px solid ${dark ? 'rgba(217,119,6,0.4)' : '#fde68a'}`, borderRadius: '10px', padding: '10px 13px', margin: '12px 0 4px' });
    warn.appendChild(el('span', { fontSize: '14px', flexShrink: '0' }, '⚠️'));
    warn.appendChild(el('div', { fontSize: '12.5px', color: C.muted, lineHeight: '1.5' }, 'Session id / access token are live org credentials — anything on your clipboard can be read by other apps. Copy them only when you need them, and prefer sandbox / scratch / dev orgs.'));
    c.appendChild(warn);
    const table = el('div', { marginTop: '10px', border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' });
    const grid = '110px 1fr 140px 300px';
    const hdr = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', padding: '10px 14px', background: C.headerBg, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.04em', color: C.faint });
    ['Type', 'Domain', 'Nickname', 'Actions'].forEach((h, i) => hdr.appendChild(el('div', i === 3 ? { textAlign: 'right' } : undefined, h)));
    table.appendChild(hdr);
    const miniBtn = (label: string, title: string, danger = false): HTMLElement => {
      const b = el('button', { background: 'transparent', border: `1px solid ${danger ? C.danger : C.border}`, borderRadius: '7px', padding: '5px 9px', cursor: 'pointer', color: danger ? C.danger : C.text, fontSize: '11.5px', fontWeight: '700', fontFamily: 'inherit', whiteSpace: 'nowrap' }, label);
      b.title = title; return b;
    };
    SES.forEach((o, idx) => {
      const row = el('div', { display: 'grid', gridTemplateColumns: grid, gap: '8px', alignItems: 'center', padding: '11px 14px', borderTop: idx === 0 ? 'none' : `1px solid ${C.divider}` });
      row.appendChild(el('div', { fontSize: '12.5px', fontWeight: '600' }, orgType(o)));
      row.appendChild(el('div', { fontSize: '12px', fontFamily: 'Fira Code, monospace', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, o.host));
      const nick = el('input', { padding: '7px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.card, color: C.text, fontFamily: 'inherit', width: '120px', outline: 'none' }) as HTMLInputElement;
      nick.placeholder = 'Enter nickname'; nick.value = P.nicknames?.[o.host] || '';
      nick.addEventListener('change', () => saveP({ nicknames: { ...P.nicknames, [o.host]: nick.value } }));
      row.appendChild(nick);

      const acts = el('div', { display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' });
      const sid = miniBtn('Session Id', 'Copy the live session id');
      sid.addEventListener('click', async () => { const cr = await fetchCreds(o.host); copyWithFlash(sid, 'Session Id', cr.sessionId); });
      const tok = miniBtn('Access Token', 'Copy the access token (Bearer) — same value used in the Authorization header');
      tok.addEventListener('click', async () => { const cr = await fetchCreds(o.host); copyWithFlash(tok, 'Access Token', cr.sessionId); });
      const auth = miniBtn('Auth Info', 'Copy an SFDX-style auth JSON (instance URL + access token)');
      auth.addEventListener('click', async () => {
        const cr = await fetchCreds(o.host);
        const info = JSON.stringify({ orgLabel: o.label, user: o.user || undefined, host: o.host, instanceUrl: cr.instanceUrl || o.instanceUrl, accessToken: cr.sessionId }, null, 2);
        copyWithFlash(auth, 'Auth Info', cr.sessionId ? info : '');
      });
      const del = miniBtn('🗑', 'Remove this org', true);
      del.addEventListener('click', async () => { SES = SES.filter((s) => s.host !== o.host); await set(KEYS.sessions, SES); renderContent(); });
      acts.append(sid, tok, auth, del);
      row.appendChild(acts);
      table.appendChild(row);
    });
    c.appendChild(table);
    add(c);
  }

  function renderSupport(add: (...n: HTMLElement[]) => void) {
    const c = card();
    c.appendChild(sectionHead('Support & feedback', 'Usage statistics', 'Your activity with the extension at a glance.'));
    const stats: [string, number, string][] = [
      ['SOQL queries', U.soql, '🧾'], ['Debug logs', U.debugLogs, '🐞'], ['Rules updated', U.rulesUpdated, '🔀'], ['Apex tests', U.apexTests, '✅'],
    ];
    const grid = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px', margin: '18px 0 6px' });
    stats.forEach(([label, value, icon]) => {
      const box = el('div', { background: C.subtle, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '18px 12px', textAlign: 'center' });
      box.appendChild(el('div', { fontSize: '18px' }, icon));
      box.appendChild(el('div', { fontSize: '26px', fontWeight: '800', marginTop: '6px' }, value.toLocaleString()));
      box.appendChild(el('div', { fontSize: '11.5px', fontWeight: '700', letterSpacing: '0.04em', textTransform: 'uppercase', color: C.faint, marginTop: '4px' }, label));
      grid.appendChild(box);
    });
    c.appendChild(grid);
    c.appendChild(divider());
    c.appendChild(el('div', { fontSize: '14px', fontWeight: '800' }, 'Help us improve'));
    c.appendChild(el('div', { fontSize: '13px', color: C.muted, margin: '5px 0 14px' }, 'Your feedback helps us build a better experience for everyone.'));
    const row = el('div', { display: 'flex', gap: '10px' });
    row.appendChild(btn('❤  Leave a review', 'primary', () => openTab('https://chromewebstore.google.com/detail/sf-spotlight/pimcahebopafaacgibleicnlffadcnoj?hl=en-GB&utm_source=ext_sidebar')));
    row.appendChild(btn('🐛  Report a bug', 'ghost', () => openTab('https://forms.gle/ed2VcwQTJXTDaMUv6')));
    c.appendChild(row);
    add(c);
  }
}
