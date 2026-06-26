// Content script - injects iframe to load the React app
import { setupLinks } from './links';

interface ExtensionSettings {
  position: 'right' | 'left';
  opacity: number;
  width: number;
  verticalPosition: number;
  spotlightTheme: 'light' | 'dark';
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  position: 'right',
  opacity: 100,
  width: 50,
  verticalPosition: 50,
  spotlightTheme: 'light',
};

// Tracks the spotlight theme so buildSpotlight() (module-level) can read it.
let currentSpotlightTheme: 'light' | 'dark' = 'light';

const STORAGE_KEY = 'sf_log_analyzer_settings';

function loadSettings(callback: (settings: ExtensionSettings) => void): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.get([STORAGE_KEY], (result: any) => {
      if (result[STORAGE_KEY]) {
        callback({ ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] });
      } else {
        callback(DEFAULT_SETTINGS);
      }
    });
  } else {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        callback({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
      } else {
        callback(DEFAULT_SETTINGS);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      callback(DEFAULT_SETTINGS);
    }
  }
}

function isSalesforcePage(): boolean {
  const visualForceDomains = ["visualforce.com", "vf.force.com"];
  return !!(
    document.querySelector("body.sfdcBody, body.ApexCSIPage, #auraLoadingBox, #studioBody, #flowContainer") ||
    visualForceDomains.filter(host => location.host.endsWith(host)).length > 0
  );
}

function applySettingsToIframe(
  iframe: HTMLIFrameElement,
  backdrop: HTMLElement,
  settings: ExtensionSettings,
  isPanelOpen: boolean
) {
  const isRightPosition = settings.position === 'right';
  const panelWidth = `${settings.width}vw`;
  const opacity = settings.opacity / 100;

  if (isPanelOpen) {
    iframe.style.width = panelWidth;
    iframe.style.height = '100vh';
    iframe.style.top = '0';
    iframe.style.transform = 'none';
    iframe.style[isRightPosition ? 'right' : 'left'] = '0';
    if (isRightPosition) {
      iframe.style.left = 'auto';
    } else {
      iframe.style.right = 'auto';
    }
    iframe.style.background = `rgba(255, 255, 255, ${opacity})`;
    iframe.style.opacity = String(opacity);

    if (isRightPosition) {
      backdrop.style.left = '0';
      backdrop.style.right = `${settings.width}vw`;
    } else {
      backdrop.style.right = '0';
      backdrop.style.left = `${settings.width}vw`;
    }
    backdrop.style.display = 'block';
  } else {
    // Collapsed: size the iframe to the actual trigger so the transparent
    // area doesn't block clicks on the page behind it.
    iframe.style.width = '32px';
    iframe.style.height = '116px';
    iframe.style[isRightPosition ? 'right' : 'left'] = '0';
    if (isRightPosition) {
      iframe.style.left = 'auto';
    } else {
      iframe.style.right = 'auto';
    }

    if (settings.verticalPosition === 0) {
      iframe.style.top = '10px';
      iframe.style.bottom = 'auto';
      iframe.style.transform = 'none';
    } else if (settings.verticalPosition === 100) {
      iframe.style.bottom = '10px';
      iframe.style.top = 'auto';
      iframe.style.transform = 'none';
    } else {
      iframe.style.top = `${settings.verticalPosition}%`;
      iframe.style.bottom = 'auto';
      iframe.style.transform = 'translateY(-50%)';
    }

    iframe.style.background = 'transparent';
    iframe.style.opacity = '1';
    backdrop.style.display = 'none';
  }
}

// ─── Spotlight tab configuration ─────────────────────────────────────────────

interface SpotlightTab { id: string; label: string; placeholder: string; icon: string; }

const ALL_SPOTLIGHT_TABS: SpotlightTab[] = [
  { id: 'tools', label: 'Tools', placeholder: 'Search tools & actions...', icon: '🛠️' },
  { id: 'setup', label: 'Setup', placeholder: 'Search Salesforce Setup...', icon: '🏠' },
  { id: 'recent', label: 'Recent', placeholder: 'Search recently opened...', icon: '🕘' },
  { id: 'objects', label: 'Objects', placeholder: 'Search Objects...', icon: '📦' },
  { id: 'metadata', label: 'Metadata', placeholder: 'Search Custom Metadata & Settings...', icon: '🧩' },
  { id: 'users', label: 'Users', placeholder: 'Search Users...', icon: '👤' },
  { id: 'security', label: 'Security', placeholder: 'Search Permission Sets, Groups & Profiles...', icon: '🔑' },
  { id: 'flows', label: 'Flows', placeholder: 'Search Flows...', icon: '⚡' },
  { id: 'apps', label: 'Apps & Tabs', placeholder: 'Search apps & tabs...', icon: '🚀' }
];

// Tabs that should start hidden (user can enable them from the ⚙ settings).
const HIDDEN_BY_DEFAULT = ['apps'];

interface TabConfig { order: string[]; hidden: string[]; defaultTab: string; }

const TAB_CONFIG_KEY = 'sf_spotlight_tab_config';

function defaultTabConfig(): TabConfig {
  return { order: ALL_SPOTLIGHT_TABS.map(t => t.id), hidden: [...HIDDEN_BY_DEFAULT], defaultTab: 'setup' };
}

function normalizeTabConfig(raw: any): TabConfig {
  const known = ALL_SPOTLIGHT_TABS.map(t => t.id);
  const cfg: TabConfig = { ...defaultTabConfig(), ...(raw || {}) };
  cfg.order = (cfg.order || []).filter((id: string) => known.includes(id));
  cfg.hidden = (cfg.hidden || []).filter((id: string) => known.includes(id));
  // Append any newly-introduced tabs; hide-by-default ones start hidden even for
  // users who already have a saved config from a previous version.
  known.forEach(id => {
    if (!cfg.order.includes(id)) {
      cfg.order.push(id);
      if (HIDDEN_BY_DEFAULT.includes(id) && !cfg.hidden.includes(id)) cfg.hidden.push(id);
    }
  });
  const firstVisible = cfg.order.find(id => !cfg.hidden.includes(id)) || 'setup';
  if (!known.includes(cfg.defaultTab) || cfg.hidden.includes(cfg.defaultTab)) cfg.defaultTab = firstVisible;
  return cfg;
}

// Loaded once at startup; kept in sync so the spotlight can build synchronously.
let currentTabConfig: TabConfig = defaultTabConfig();

function loadTabConfig(): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.get([TAB_CONFIG_KEY], (res: any) => {
      currentTabConfig = normalizeTabConfig(res?.[TAB_CONFIG_KEY]);
    });
  } else {
    try { currentTabConfig = normalizeTabConfig(JSON.parse(localStorage.getItem(TAB_CONFIG_KEY) || 'null')); }
    catch { currentTabConfig = normalizeTabConfig(null); }
  }
}

function saveTabConfig(cfg: TabConfig): void {
  currentTabConfig = cfg;
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.set({ [TAB_CONFIG_KEY]: cfg });
  } else {
    try { localStorage.setItem(TAB_CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  }
}

loadTabConfig();

// Load the saved spotlight theme so the modal renders with the right appearance.
loadSettings((s) => { currentSpotlightTheme = s.spotlightTheme; });

// ─── Recent items (clicked results) ──────────────────────────────────────────

interface RecentItem {
  kind: string;        // setup | object | user | security | flow
  icon: string;
  title: string;
  subtitle?: string;
  meta?: string;
  url: string;         // where to (re)open it
  ts: number;          // last-opened timestamp
}

const RECENTS_KEY = 'sf_spotlight_recents';
const MAX_RECENTS = 15;

// Loaded once at startup; kept in sync so the spotlight can read synchronously.
let recentItems: RecentItem[] = [];

function loadRecents(): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.get([RECENTS_KEY], (res: any) => {
      recentItems = Array.isArray(res?.[RECENTS_KEY]) ? res[RECENTS_KEY] : [];
    });
  } else {
    try { recentItems = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); }
    catch { recentItems = []; }
  }
}

function saveRecents(): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.set({ [RECENTS_KEY]: recentItems });
  } else {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recentItems)); } catch { /* ignore */ }
  }
}

// Push an item to the top of the recents list, de-duping by url + kind.
function recordRecent(entry: Omit<RecentItem, 'ts'>): void {
  if (!entry.url) return;
  recentItems = recentItems.filter(r => !(r.url === entry.url && r.kind === entry.kind));
  recentItems.unshift({ ...entry, ts: Date.now() });
  if (recentItems.length > MAX_RECENTS) recentItems.length = MAX_RECENTS;
  saveRecents();
}

function clearRecents(): void {
  recentItems = [];
  saveRecents();
}

loadRecents();

// ─── Pinned / favorite destinations ──────────────────────────────────────────

const FAVORITES_KEY = 'sf_spotlight_favorites';
const MAX_FAVORITES = 50;

let favoriteItems: RecentItem[] = [];

function loadFavorites(): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.get([FAVORITES_KEY], (res: any) => {
      favoriteItems = Array.isArray(res?.[FAVORITES_KEY]) ? res[FAVORITES_KEY] : [];
    });
  } else {
    try { favoriteItems = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); }
    catch { favoriteItems = []; }
  }
}

function saveFavorites(): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.set({ [FAVORITES_KEY]: favoriteItems });
  } else {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteItems)); } catch { /* ignore */ }
  }
}

function isFavorite(url: string, kind: string): boolean {
  return favoriteItems.some(f => f.url === url && f.kind === kind);
}

// Returns the new state (true = now pinned).
function toggleFavorite(entry: Omit<RecentItem, 'ts'>): boolean {
  if (!entry.url) return false;
  if (isFavorite(entry.url, entry.kind)) {
    favoriteItems = favoriteItems.filter(f => !(f.url === entry.url && f.kind === entry.kind));
    saveFavorites();
    return false;
  }
  favoriteItems.unshift({ ...entry, ts: Date.now() });
  if (favoriteItems.length > MAX_FAVORITES) favoriteItems.length = MAX_FAVORITES;
  saveFavorites();
  return true;
}

loadFavorites();

// ─── Tools: persisted toggles & page tweaks ──────────────────────────────────

interface ToolsState { showFieldApi: boolean; hideDevBar: boolean; hideLoginAd: boolean; }
const TOOLS_STATE_KEY = 'sf_spotlight_tools_state';
let toolsState: ToolsState = { showFieldApi: false, hideDevBar: false, hideLoginAd: false };

function loadToolsState(cb?: () => void): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.get([TOOLS_STATE_KEY], (res: any) => {
      toolsState = { ...toolsState, ...(res?.[TOOLS_STATE_KEY] || {}) };
      cb?.();
    });
  } else { cb?.(); }
}
function saveToolsState(): void {
  (globalThis as any).chrome?.storage?.local?.set({ [TOOLS_STATE_KEY]: toolsState });
}

// Inject (or remove) a scoped <style> used to hide page chrome.
function setHideStyle(id: string, css: string, on: boolean): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (on) {
    if (!el) { el = document.createElement('style'); el.id = id; (document.head || document.documentElement).appendChild(el); }
    el.textContent = css;
  } else {
    el?.remove();
  }
}

function applyHideDevBar(on: boolean): void {
  setHideStyle('sf-tool-hide-devbar',
    'one-app-dev-tools-panel, .oneAuraDevToolBar, .auraDevToolBar, .devModeFooter, [class*="auraDevTool"], [class*="DevToolBar"] { display: none !important; }',
    on);
}
function applyHideLoginAd(on: boolean): void {
  setHideStyle('sf-tool-hide-loginad',
    '#rightPanel, .right, .loginAd, .right-panel, [id*="rightPanel"], .marketing, .promo, .field.right { display: none !important; }',
    on);
}

// Field API-name chips on Lightning record pages.
let fieldApiTimer: any = null;
let fieldApiObserver: MutationObserver | null = null;
function scanFieldApiNames(): void {
  // Field cells expose data-target-selection-name on the inner div; the API name
  // is the third dot-segment (e.g. "…​.…​.FieldApiName").
  const fields = document.querySelectorAll(
    'record_flexipage-record-field > div, records-record-layout-item > div, div .forcePageBlockItemView'
  );
  fields.forEach((field) => {
    const sel = (field as HTMLElement).dataset?.targetSelectionName;
    if (!sel) return;
    const parts = sel.split('.');
    const api = parts[2] || parts[parts.length - 1];
    if (!api) return;
    const labelEl = field.querySelector('span');
    if (!labelEl) return;
    if (field.querySelector('.sf-api-chip')) return;

    // Pill: [ ApiName | copy ] — placed inline next to the field label.
    const chip = document.createElement('span');
    chip.className = 'sf-api-chip';
    Object.assign(chip.style, {
      display: 'inline-flex', alignItems: 'center', gap: '6px', verticalAlign: 'middle', maxWidth: '100%',
      marginLeft: '6px', padding: '0px 4px 0px 8px', borderRadius: '6px',
      background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.25)',
      color: '#2563eb', fontSize: '11px', fontWeight: '600', fontFamily: 'monospace', lineHeight: '1.7',
    });

    const text = document.createElement('span');
    text.textContent = api;
    Object.assign(text.style, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy API name';
    const copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    const okIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    copyBtn.innerHTML = copyIcon;
    Object.assign(copyBtn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px',
      background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#2563eb',
      appearance: 'none', WebkitAppearance: 'none', flexShrink: '0',
    });
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      navigator.clipboard?.writeText(api).then(() => {
        copyBtn.innerHTML = okIcon;
        setTimeout(() => { copyBtn.innerHTML = copyIcon; }, 1100);
      }).catch(() => {});
    });

    chip.appendChild(text);
    chip.appendChild(copyBtn);
    labelEl.insertAdjacentElement('afterend', chip);
  });
}
function applyShowFieldApi(on: boolean): void {
  if (on) {
    scanFieldApiNames();
    if (!fieldApiObserver) {
      fieldApiObserver = new MutationObserver(() => {
        clearTimeout(fieldApiTimer);
        fieldApiTimer = setTimeout(scanFieldApiNames, 400);
      });
      try { if (document.body) fieldApiObserver.observe(document.body, { childList: true, subtree: true }); } catch { /* ignore */ }
    }
  } else {
    fieldApiObserver?.disconnect();
    fieldApiObserver = null;
    document.querySelectorAll('.sf-api-chip').forEach((e) => e.remove());
  }
}

function applyToolToggle(key: keyof ToolsState): void {
  if (key === 'hideDevBar') applyHideDevBar(toolsState.hideDevBar);
  else if (key === 'hideLoginAd') applyHideLoginAd(toolsState.hideLoginAd);
  else if (key === 'showFieldApi') applyShowFieldApi(toolsState.showFieldApi);
}
function applyAllToolToggles(): void {
  applyHideDevBar(toolsState.hideDevBar);
  applyHideLoginAd(toolsState.hideLoginAd);
  applyShowFieldApi(toolsState.showFieldApi);
}

loadToolsState(() => applyAllToolToggles());

// Module-level caches persist across spotlight re-opens.
let cachedUsers: any[] | null = null;
let cachedFlows: any[] | null = null;
let cachedObjects: any[] | null = null;
let cachedMetadata: any[] | null = null;
let cachedSecurity: any[] | null = null;
let currentUserId: string | null = null;
let cachedApps: any[] | null = null;

function cleanSfDomain(domain: string): string {
  return domain.replace(/\.lightning\.force\./, '.my.salesforce.').replace(/\.mcas\.ms$/, '');
}

function lightningOrigin(): string {
  const host = window.location.hostname
    .replace(/\.mcas\.ms$/, '')
    .replace(/\.my\.salesforce\.com$/, '.lightning.force.com');
  return `${window.location.protocol}//${host}`;
}

// Lightning apps open via the Setup domain: <mydomain>.my.salesforce-setup.com
// using /lightning?appContextId=<AppDefinition DurableId>.
function setupOrigin(): string {
  const host = window.location.hostname
    .replace(/\.mcas\.ms$/, '')
    .replace(/\.lightning\.force\.com$/, '.my.salesforce-setup.com')
    .replace(/\.my\.salesforce\.com$/, '.my.salesforce-setup.com');
  return `${window.location.protocol}//${host}`;
}

function getSfCredentials(): Promise<any> {
  return new Promise((resolve) => {
    const chromeRuntime = (globalThis as any).chrome?.runtime;
    if (!chromeRuntime) return resolve(null);
    chromeRuntime.sendMessage(
      { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(window.location.hostname) },
      (r: any) => resolve(r?.data || null)
    );
  });
}

// ─── Record ID detection & Record Detail viewer ──────────────────────────────

const ID_CHECKSUM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

// Common key prefixes → friendly label (nice-to-have; the real object name comes
// from the detail fetch). Not exhaustive — unknown prefixes still open fine.
const COMMON_PREFIXES: Record<string, string> = {
  '001': 'Account', '003': 'Contact', '005': 'User', '006': 'Opportunity',
  '00Q': 'Lead', '500': 'Case', '701': 'Campaign', '800': 'Contract',
  '0WO': 'Order', '00T': 'Task', '00U': 'Event', '02s': 'Email Message',
};

// Recomputes the 3-char checksum suffix from the 15-char base of a record Id.
function computeIdChecksum(id15: string): string {
  let suffix = '';
  for (let block = 0; block < 3; block++) {
    let flags = 0;
    for (let i = 0; i < 5; i++) {
      const c = id15.charAt(block * 5 + i);
      if (c >= 'A' && c <= 'Z') flags += 1 << i;
    }
    suffix += ID_CHECKSUM_ALPHABET.charAt(flags);
  }
  return suffix;
}

// 15-char Ids are accepted on format; 18-char Ids are verified via their checksum.
function isValidSalesforceId(value: string): boolean {
  if (!value) return false;
  if (value.length === 15) return /^[a-zA-Z0-9]{15}$/.test(value);
  if (value.length === 18) {
    if (!/^[a-zA-Z0-9]{18}$/.test(value)) return false;
    return computeIdChecksum(value.substring(0, 15)) === value.substring(15).toUpperCase();
  }
  return false;
}

// Pulls a record Id out of the current page URL (Lightning, classic, or params).
function extractRecordIdFromUrl(): string | null {
  const href = window.location.href;
  const m = href.match(/\/lightning\/r\/(?:[^/]+\/)?([a-zA-Z0-9]{15,18})(?:\/|$|\?)/);
  if (m && isValidSalesforceId(m[1])) return m[1];
  try {
    const params = new URL(href).searchParams;
    for (const key of ['id', 'recordId']) {
      const v = params.get(key);
      if (v && isValidSalesforceId(v)) return v;
    }
  } catch { /* ignore */ }
  for (const seg of window.location.pathname.split('/').filter(Boolean)) {
    if (isValidSalesforceId(seg)) return seg;
  }
  return null;
}

function flashToast(message: string): void {
  const isDark = currentSpotlightTheme === 'dark';
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(31,41,55,0.95)', color: '#fff',
    padding: '10px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
    fontFamily: 'Inter, system-ui, sans-serif', zIndex: '2147483648',
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)', opacity: '0', transition: 'opacity 0.2s',
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 2200);
}

function formatFieldValue(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Wide modal showing every accessible field (label · API name · type · value).
function showRecordDetail(recordId: string): void {
  const existing = document.getElementById('sf-log-analyzer-spotlight-container');
  if (existing) existing.remove();
  if (!document.body) return;

  const isDark = currentSpotlightTheme === 'dark';
  const C = {
    backdrop: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)',
    modalBg: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.92)',
    border: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(31,41,55,0.12)',
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
    headerBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    rowHover: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    surface: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)',
    textFaint: isDark ? 'rgba(148,163,184,0.6)' : 'rgba(31,41,55,0.45)',
    inputBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    accent: '#2563eb',
  };

  const container = document.createElement('div');
  container.id = 'sf-log-analyzer-spotlight-container';
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
    zIndex: '2147483648', display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
  });
  document.body.appendChild(container);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    container.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);

  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    background: C.backdrop, pointerEvents: 'auto', cursor: 'pointer',
  });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  container.appendChild(backdrop);

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position: 'relative', width: '92%', maxWidth: '1080px', maxHeight: '85vh',
    display: 'flex', flexDirection: 'column', background: C.modalBg,
    backdropFilter: 'blur(25px)', WebkitBackdropFilter: 'blur(25px)', borderRadius: '20px',
    border: `1px solid ${C.border}`, boxShadow: '0 25px 60px rgba(0,0,0,0.45)',
    overflow: 'hidden', pointerEvents: 'auto', zIndex: '2',
    fontFamily: 'Inter, system-ui, sans-serif',
  });
  container.appendChild(modal);

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 24px',
    borderBottom: `1px solid ${C.divider}`, background: C.headerBg, flexShrink: '0',
  });

  const titleWrap = document.createElement('div');
  titleWrap.style.flex = '1';
  titleWrap.style.minWidth = '0';
  const title = document.createElement('div');
  title.textContent = 'Loading record…';
  Object.assign(title.style, { fontSize: '18px', fontWeight: '700', color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  const subtitle = document.createElement('div');
  subtitle.textContent = recordId;
  Object.assign(subtitle.style, { fontSize: '12px', color: C.textMuted, marginTop: '2px', fontFamily: 'Fira Code, monospace' });
  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);

  // The user is already on (or came from) the record, so offer the object
  // instead — opens the object's page in Setup's Object Manager. Wired once the
  // object type is known from the fetch.
  const objectBtn = document.createElement('button');
  objectBtn.textContent = 'Open object ↗';
  Object.assign(objectBtn.style, {
    fontSize: '12px', fontWeight: '700', padding: '8px 14px', borderRadius: '8px',
    border: 'none', cursor: 'pointer', background: C.accent, color: '#fff',
    fontFamily: 'inherit', flexShrink: '0', whiteSpace: 'nowrap', display: 'none',
  });

  const closeBtn = document.createElement('button');
  Object.assign(closeBtn.style, { padding: '8px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '8px', flexShrink: '0', display: 'flex' });
  closeBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${C.textMuted}" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  closeBtn.addEventListener('click', close);

  header.appendChild(titleWrap);
  header.appendChild(objectBtn);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Toolbar (filter + hide-empty) — added once data loads
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, { display: 'none', alignItems: 'center', gap: '12px', padding: '12px 24px', borderBottom: `1px solid ${C.divider}`, flexShrink: '0' });

  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.placeholder = 'Filter fields by label, API name or value…';
  Object.assign(filterInput.style, {
    flex: '1', minWidth: '0', padding: '8px 12px', fontSize: '13px', borderRadius: '8px',
    border: `1px solid ${C.border}`, background: C.inputBg, color: C.textPrimary,
    outline: 'none', fontFamily: 'inherit',
  });

  const emptyToggleWrap = document.createElement('label');
  Object.assign(emptyToggleWrap.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.textMuted, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: '600' });
  const emptyToggle = document.createElement('input');
  emptyToggle.type = 'checkbox';
  emptyToggle.style.cursor = 'pointer';
  emptyToggleWrap.appendChild(emptyToggle);
  emptyToggleWrap.appendChild(document.createTextNode('Hide empty'));

  const countLabel = document.createElement('span');
  Object.assign(countLabel.style, { fontSize: '12px', color: C.textFaint, whiteSpace: 'nowrap' });

  toolbar.appendChild(filterInput);
  toolbar.appendChild(emptyToggleWrap);
  toolbar.appendChild(countLabel);
  modal.appendChild(toolbar);

  // Body
  const body = document.createElement('div');
  Object.assign(body.style, { flex: '1', minHeight: '0', overflow: 'auto' });
  modal.appendChild(body);

  const renderMessage = (msg: string) => {
    body.innerHTML = '';
    const d = document.createElement('div');
    Object.assign(d.style, { padding: '60px 24px', textAlign: 'center', color: C.textMuted, fontSize: '14px', fontWeight: '600' });
    d.textContent = msg;
    body.appendChild(d);
  };

  renderMessage('Loading record…');

  // Show
  container.style.pointerEvents = 'auto';

  getSfCredentials().then((creds: any) => {
    if (!creds?.instanceUrl || !creds?.sessionId) {
      renderMessage('Salesforce session not detected. Open this on a logged-in Salesforce tab.');
      return;
    }
    const chromeRuntime = (globalThis as any).chrome?.runtime;
    if (!chromeRuntime) { renderMessage('Extension runtime unavailable.'); return; }

    chromeRuntime.sendMessage(
      { type: 'GET_RECORD_DETAIL', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, recordId },
      (resp: any) => {
        if (!resp?.success) {
          renderMessage(resp?.error || 'Failed to load this record.');
          return;
        }
        const data = resp.data;
        title.textContent = String(data.recordName || data.objectLabel || 'Record');
        subtitle.textContent = `${data.objectLabel} · ${recordId}`;

        objectBtn.title = `Open ${data.objectLabel} in Object Manager`;
        objectBtn.addEventListener('click', () => {
          window.open(`${lightningOrigin()}/lightning/setup/ObjectManager/${data.objectApiName}/Details/view`, '_blank');
        });
        objectBtn.style.display = 'inline-block';
        recordRecent({ kind: 'record', icon: '🗂️', title: String(data.recordName || data.objectLabel), subtitle: `${data.objectLabel}`, meta: 'Record', url: `${lightningOrigin()}/${recordId}` });

        const fields: any[] = data.fields || [];
        const objectApiName: string = data.objectApiName;
        toolbar.style.display = 'flex';

        // Builds the value cell with copy + inline edit (Save appears on change).
        const buildValueCell = (f: any) => {
          const td = document.createElement('td');
          Object.assign(td.style, { padding: '10px 16px', verticalAlign: 'top', wordBreak: 'break-word' });
          let currentValue = f.value;

          const iconBtn = (svg: string, tip: string, onClick: () => void) => {
            const b = document.createElement('button');
            b.title = tip;
            Object.assign(b.style, { padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '5px', display: 'flex', color: C.textMuted });
            b.innerHTML = svg;
            b.addEventListener('mouseover', () => { b.style.background = C.surface; });
            b.addEventListener('mouseout', () => { b.style.background = 'transparent'; });
            b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
            return b;
          };

          const copySvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
          const checkSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
          const editSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;

          const renderView = () => {
            td.innerHTML = '';

            // No FLS read access — show a lock and no value, no copy/edit.
            if (!f.accessible) {
              const noacc = document.createElement('div');
              Object.assign(noacc.style, { display: 'flex', alignItems: 'center', gap: '6px', color: C.textFaint });
              const lock = document.createElement('span');
              lock.style.display = 'flex';
              lock.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
              const txt = document.createElement('span');
              txt.textContent = 'No access';
              Object.assign(txt.style, { fontSize: '12px', fontStyle: 'italic' });
              noacc.appendChild(lock);
              noacc.appendChild(txt);
              td.appendChild(noacc);
              return;
            }

            const row = document.createElement('div');
            Object.assign(row.style, { display: 'flex', alignItems: 'flex-start', gap: '8px' });

            const valWrap = document.createElement('div');
            valWrap.style.flex = '1';
            valWrap.style.minWidth = '0';
            const display = formatFieldValue(currentValue);
            if (display === '') {
              const dash = document.createElement('span'); dash.textContent = '—'; dash.style.color = C.textFaint; valWrap.appendChild(dash);
            } else if (f.isReference && typeof currentValue === 'string' && isValidSalesforceId(currentValue)) {
              const link = document.createElement('a');
              link.textContent = display; link.href = `${lightningOrigin()}/${currentValue}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
              Object.assign(link.style, { color: C.accent, textDecoration: 'none', fontWeight: '600' });
              valWrap.appendChild(link);
            } else {
              const span = document.createElement('span'); span.textContent = display; span.style.color = C.textPrimary; valWrap.appendChild(span);
            }

            const actions = document.createElement('div');
            Object.assign(actions.style, { display: 'flex', gap: '2px', flexShrink: '0' });

            const copyBtn = iconBtn(copySvg, 'Copy value', () => {
              const txt = formatFieldValue(currentValue);
              navigator.clipboard?.writeText(txt).then(() => {
                copyBtn.innerHTML = checkSvg;
                setTimeout(() => { copyBtn.innerHTML = copySvg; }, 1200);
              }).catch(() => {});
            });
            actions.appendChild(copyBtn);
            if (f.updateable) actions.appendChild(iconBtn(editSvg, 'Edit field', renderEdit));

            row.appendChild(valWrap);
            row.appendChild(actions);
            td.appendChild(row);
          };

          const renderEdit = () => {
            td.innerHTML = '';
            const wrap = document.createElement('div');
            Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

            const original = currentValue;
            const isBool = f.type === 'boolean';
            const isPicklist = f.type === 'picklist' && Array.isArray(f.picklistValues) && f.picklistValues.length > 0;
            let input: HTMLInputElement | HTMLSelectElement;

            if (isBool) {
              const sel = document.createElement('select');
              ['true', 'false'].forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
              sel.value = original ? 'true' : 'false';
              input = sel;
            } else if (isPicklist) {
              const sel = document.createElement('select');
              const blank = document.createElement('option'); blank.value = ''; blank.textContent = '--None--'; sel.appendChild(blank);
              f.picklistValues.forEach((p: any) => { const o = document.createElement('option'); o.value = p.value; o.textContent = p.label || p.value; sel.appendChild(o); });
              sel.value = (original ?? '') as string;
              input = sel;
            } else {
              const inp = document.createElement('input');
              inp.type = 'text';
              inp.value = original === null || original === undefined ? '' : (typeof original === 'object' ? JSON.stringify(original) : String(original));
              input = inp;
            }
            Object.assign((input as HTMLElement).style, { width: '100%', padding: '6px 10px', fontSize: '13px', borderRadius: '6px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.textPrimary, outline: 'none', fontFamily: 'inherit' });

            const originalString = isBool
              ? (original ? 'true' : 'false')
              : (original === null || original === undefined ? '' : (typeof original === 'object' ? JSON.stringify(original) : String(original)));

            const btnRow = document.createElement('div');
            Object.assign(btnRow.style, { display: 'flex', gap: '6px', alignItems: 'center' });

            const saveBtn = document.createElement('button');
            saveBtn.textContent = 'Save';
            Object.assign(saveBtn.style, { display: 'none', fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: C.accent, color: '#fff', fontFamily: 'inherit' });

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            Object.assign(cancelBtn.style, { fontSize: '12px', fontWeight: '600', padding: '5px 12px', borderRadius: '6px', border: `1px solid ${C.border}`, cursor: 'pointer', background: 'transparent', color: C.textMuted, fontFamily: 'inherit' });

            const errEl = document.createElement('div');
            Object.assign(errEl.style, { display: 'none', fontSize: '12px', color: '#ef4444', fontWeight: '600', lineHeight: '1.4' });

            const checkChanged = () => { saveBtn.style.display = ((input as any).value !== originalString) ? 'inline-block' : 'none'; };
            input.addEventListener('input', checkChanged);
            input.addEventListener('change', checkChanged);
            cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); renderView(); });

            const coerce = (raw: string): any => {
              if (raw === '') return null;
              if (isBool) return raw === 'true';
              if (['double', 'currency', 'percent', 'int', 'long'].includes(f.type)) { const n = Number(raw); return isNaN(n) ? raw : n; }
              return raw;
            };

            saveBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              errEl.style.display = 'none';
              const newVal = coerce((input as any).value);
              saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
              const chromeRuntime = (globalThis as any).chrome?.runtime;
              chromeRuntime.sendMessage(
                { type: 'UPDATE_RECORD_FIELD', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, objectApiName, recordId, fieldApiName: f.apiName, value: newVal },
                (resp: any) => {
                  saveBtn.disabled = false; saveBtn.textContent = 'Save';
                  if (resp?.success) { currentValue = newVal; flashToast('Field updated'); renderView(); }
                  else { errEl.textContent = resp?.error || 'Save failed'; errEl.style.display = 'block'; }
                }
              );
            });

            btnRow.appendChild(saveBtn);
            btnRow.appendChild(cancelBtn);
            wrap.appendChild(input);
            wrap.appendChild(btnRow);
            wrap.appendChild(errEl);
            td.appendChild(wrap);
            (input as HTMLElement).focus();
          };

          renderView();
          return td;
        };

        const draw = () => {
          const q = filterInput.value.trim().toLowerCase();
          const hideEmpty = emptyToggle.checked;
          const rows = fields.filter((f) => {
            const display = formatFieldValue(f.value);
            if (hideEmpty && display === '') return false;
            if (!q) return true;
            return (
              (f.label || '').toLowerCase().includes(q) ||
              (f.apiName || '').toLowerCase().includes(q) ||
              display.toLowerCase().includes(q)
            );
          });

          countLabel.textContent = `${rows.length} of ${fields.length} fields`;
          body.innerHTML = '';

          if (rows.length === 0) { renderMessageInline('No fields match your filter.'); return; }

          const table = document.createElement('table');
          Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '13px' });

          const thead = document.createElement('thead');
          const htr = document.createElement('tr');
          ['Field', 'Type', 'Value'].forEach((h, i) => {
            const th = document.createElement('th');
            th.textContent = h;
            Object.assign(th.style, {
              position: 'sticky', top: '0', textAlign: 'left', padding: '10px 16px',
              background: C.headerBg, color: C.textFaint, fontSize: '10px',
              fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em',
              borderBottom: `1px solid ${C.divider}`, backdropFilter: 'blur(8px)',
              width: i === 1 ? '140px' : 'auto',
            });
            htr.appendChild(th);
          });
          thead.appendChild(htr);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          rows.forEach((f) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = `1px solid ${C.divider}`;
            // No-access rows are dimmed so the access level reads at a glance.
            if (!f.accessible) tr.style.opacity = '0.6';
            tr.addEventListener('mouseover', () => { tr.style.background = C.rowHover; });
            tr.addEventListener('mouseout', () => { tr.style.background = 'transparent'; });

            const tdField = document.createElement('td');
            Object.assign(tdField.style, { padding: '10px 16px', verticalAlign: 'top' });
            const fl = document.createElement('div');
            fl.textContent = f.label || f.apiName;
            Object.assign(fl.style, { fontWeight: '600', color: f.accessible ? C.textPrimary : C.textMuted });
            const fa = document.createElement('div');
            fa.textContent = f.apiName;
            Object.assign(fa.style, { fontSize: '11px', color: C.textFaint, fontFamily: 'Fira Code, monospace', marginTop: '2px' });
            tdField.appendChild(fl);
            tdField.appendChild(fa);

            const tdType = document.createElement('td');
            Object.assign(tdType.style, { padding: '10px 16px', verticalAlign: 'top' });
            const typeChip = document.createElement('span');
            typeChip.textContent = f.type || 'string';
            Object.assign(typeChip.style, { fontSize: '11px', fontWeight: '600', color: C.textMuted, background: C.surface, padding: '2px 8px', borderRadius: '6px', whiteSpace: 'nowrap' });
            tdType.appendChild(typeChip);

            const tdVal = buildValueCell(f);

            tr.appendChild(tdField);
            tr.appendChild(tdType);
            tr.appendChild(tdVal);
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          body.appendChild(table);
        };

        const renderMessageInline = (msg: string) => {
          const d = document.createElement('div');
          Object.assign(d.style, { padding: '40px 24px', textAlign: 'center', color: C.textMuted, fontSize: '13px' });
          d.textContent = msg;
          body.appendChild(d);
        };

        filterInput.addEventListener('input', draw);
        emptyToggle.addEventListener('change', draw);
        draw();
        filterInput.focus();
      }
    );
  });
}

// ─── "What's New" update card ────────────────────────────────────────────────

const WHATS_NEW_VERSION_KEY = 'sf_log_analyzer_last_seen_version';

const WHATS_NEW: { icon: string; title: string; desc: string }[] = [
  { icon: '🔗', title: 'Open records by Id', desc: 'Paste a 15/18-char record Id into Spotlight to open the record or view all its fields.' },
  { icon: '🗂️', title: 'Record field viewer', desc: 'Press Alt+D (Option+D on Mac) on any record to see every field, value and type you can access.' },
  { icon: '✏️', title: 'Inline edit & save', desc: 'Edit field values right in the viewer and save back to Salesforce — with clear errors if a save is rejected.' },
  { icon: '🌓', title: 'Dark mode for Spotlight', desc: 'Switch the Spotlight theme between light and dark in Settings.' },
  { icon: '🐞', title: 'Report an issue', desc: 'Send feedback straight from the Spotlight footer and the log panel.' },
];

function showWhatsNew(version: string): void {
  const existing = document.getElementById('sf-log-analyzer-whatsnew');
  if (existing) existing.remove();
  if (!document.body) return;

  // Persist immediately so the card only appears once across page loads.
  try { (globalThis as any).chrome?.storage?.local?.set({ [WHATS_NEW_VERSION_KEY]: version }); } catch { /* ignore */ }

  const isDark = currentSpotlightTheme === 'dark';
  const C = {
    backdrop: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)',
    modalBg: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.98)',
    border: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(31,41,55,0.12)',
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.75)' : 'rgba(31,41,55,0.65)',
    textFaint: isDark ? 'rgba(148,163,184,0.6)' : 'rgba(31,41,55,0.45)',
    accent: '#2563eb',
    chip: isDark ? 'rgba(37,99,235,0.2)' : 'rgba(37,99,235,0.1)',
  };

  const container = document.createElement('div');
  container.id = 'sf-log-analyzer-whatsnew';
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', zIndex: '2147483648',
    display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
  });
  document.body.appendChild(container);

  const close = () => { document.removeEventListener('keydown', onKey, true); container.remove(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', background: C.backdrop, pointerEvents: 'auto', cursor: 'pointer' });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  container.appendChild(backdrop);

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position: 'relative', width: '92%', maxWidth: '520px', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
    background: C.modalBg, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '18px',
    border: `1px solid ${C.border}`, boxShadow: '0 25px 60px rgba(0,0,0,0.45)', overflow: 'hidden', pointerEvents: 'auto', zIndex: '2',
  });
  container.appendChild(modal);

  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 24px 14px' });
  const hTitle = document.createElement('div');
  hTitle.textContent = "What's new";
  Object.assign(hTitle.style, { fontSize: '20px', fontWeight: '800', color: C.textPrimary, flex: '1' });
  const vChip = document.createElement('span');
  vChip.textContent = `v${version}`;
  Object.assign(vChip.style, { fontSize: '12px', fontWeight: '700', color: C.accent, background: C.chip, padding: '3px 10px', borderRadius: '999px' });
  header.appendChild(hTitle);
  header.appendChild(vChip);
  modal.appendChild(header);

  const list = document.createElement('div');
  Object.assign(list.style, { padding: '0 24px', overflow: 'auto', flex: '1' });
  WHATS_NEW.forEach((item) => {
    const r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', gap: '14px', padding: '12px 0', borderTop: `1px solid ${C.divider}` });
    const ic = document.createElement('div');
    ic.textContent = item.icon; Object.assign(ic.style, { fontSize: '22px', flexShrink: '0', lineHeight: '1.2' });
    const tx = document.createElement('div');
    const t = document.createElement('div');
    t.textContent = item.title; Object.assign(t.style, { fontSize: '15px', fontWeight: '700', color: C.textPrimary });
    const d = document.createElement('div');
    d.textContent = item.desc; Object.assign(d.style, { fontSize: '13px', color: C.textMuted, marginTop: '2px', lineHeight: '1.5' });
    tx.appendChild(t); tx.appendChild(d);
    r.appendChild(ic); r.appendChild(tx);
    list.appendChild(r);
  });
  modal.appendChild(list);

  const footer = document.createElement('div');
  Object.assign(footer.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 24px', borderTop: `1px solid ${C.divider}` });
  const docsLink = document.createElement('a');
  docsLink.textContent = 'View docs ↗';
  docsLink.href = 'https://praveen420coder.github.io/sf-log-analyzer/';
  docsLink.target = '_blank'; docsLink.rel = 'noopener noreferrer';
  Object.assign(docsLink.style, { fontSize: '13px', fontWeight: '600', color: C.textMuted, textDecoration: 'none' });
  const gotIt = document.createElement('button');
  gotIt.textContent = 'Got it';
  Object.assign(gotIt.style, { fontSize: '13px', fontWeight: '700', padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: C.accent, color: '#fff', fontFamily: 'inherit' });
  gotIt.addEventListener('click', close);
  footer.appendChild(docsLink);
  footer.appendChild(gotIt);
  modal.appendChild(footer);

  container.style.pointerEvents = 'auto';
}

// ─── Org details (shown in-extension, no redirect) ───────────────────────────

function toolBackHeader(isDark: boolean, title: string, onBack: () => void): HTMLElement {
  const textPrimary = isDark ? '#f1f5f9' : '#1f2937';
  const textMuted = isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)';
  const divider = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)';
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 28px 10px', borderBottom: `1px solid ${divider}`, marginBottom: '8px' });
  const back = document.createElement('button');
  back.innerHTML = '<span style="font-size:15px">←</span><span>Tools</span>';
  Object.assign(back.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: textMuted, fontFamily: 'inherit', fontSize: '13px', fontWeight: '700' });
  back.addEventListener('mouseover', () => { back.style.color = textPrimary; });
  back.addEventListener('mouseout', () => { back.style.color = textMuted; });
  back.addEventListener('click', onBack);
  const sep = document.createElement('span'); sep.textContent = '/'; sep.style.color = isDark ? 'rgba(148,163,184,0.5)' : 'rgba(31,41,55,0.35)';
  const t = document.createElement('div'); t.textContent = title;
  Object.assign(t.style, { fontSize: '15px', fontWeight: '800', color: textPrimary });
  wrap.appendChild(back); wrap.appendChild(sep); wrap.appendChild(t);
  return wrap;
}

function renderOrgDetailsInto(host: HTMLElement, isDark: boolean, onBack: () => void): void {
  host.innerHTML = '';
  const C = {
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)',
    textFaint: isDark ? 'rgba(148,163,184,0.6)' : 'rgba(31,41,55,0.45)',
    accent: '#2563eb',
  };
  host.appendChild(toolBackHeader(isDark, '🏢  Org Details', onBack));
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '4px 28px 20px' });
  host.appendChild(body);

  const msg = (t: string) => { body.innerHTML = ''; const d = document.createElement('div'); Object.assign(d.style, { padding: '40px 0', textAlign: 'center', color: C.textMuted, fontSize: '14px', fontWeight: '600' }); d.textContent = t; body.appendChild(d); };
  msg('Loading org details…');

  getSfCredentials().then((creds: any) => {
    if (!creds?.instanceUrl || !creds?.sessionId) { msg('Salesforce session not detected.'); return; }
    (globalThis as any).chrome.runtime.sendMessage(
      { type: 'GET_ORG_INFO', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId },
      (resp: any) => {
        if (!resp?.success || !resp.data) { msg(resp?.error || 'Could not load org details.'); return; }
        const o = resp.data;
        const rows: { label: string; value: string }[] = [
          { label: 'Name', value: o.Name || '—' },
          { label: 'Org Id', value: o.Id || '—' },
          { label: 'Edition', value: o.OrganizationType || '—' },
          { label: 'Environment', value: o.IsSandbox ? 'Sandbox' : 'Production' },
          { label: 'Instance', value: o.InstanceName || '—' },
          { label: 'Namespace', value: o.NamespacePrefix || '—' },
          { label: 'Division', value: o.Division || '—' },
          { label: 'Country', value: o.Country || '—' },
          { label: 'Locale', value: o.DefaultLocaleSidKey || o.LanguageLocaleKey || '—' },
          { label: 'Instance URL', value: creds.instanceUrl },
          { label: 'Created', value: o.CreatedDate ? String(o.CreatedDate).split('T')[0] : '—' },
        ];
        body.innerHTML = '';
        rows.forEach((r) => {
          const row = document.createElement('div');
          Object.assign(row.style, { display: 'flex', gap: '12px', padding: '10px 0', borderBottom: `1px solid ${C.divider}` });
          const lbl = document.createElement('div');
          lbl.textContent = r.label;
          Object.assign(lbl.style, { width: '120px', flexShrink: '0', fontSize: '12px', fontWeight: '700', color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.04em' });
          const val = document.createElement('div');
          val.textContent = r.value;
          Object.assign(val.style, { flex: '1', fontSize: '13px', color: C.textPrimary, wordBreak: 'break-word', fontWeight: '500' });
          const copy = document.createElement('span');
          copy.textContent = '⧉';
          Object.assign(copy.style, { cursor: 'pointer', color: C.textFaint, fontSize: '13px', flexShrink: '0' });
          copy.title = 'Copy';
          copy.addEventListener('click', () => { navigator.clipboard?.writeText(r.value).catch(() => {}); });
          row.appendChild(lbl); row.appendChild(val); row.appendChild(copy);
          body.appendChild(row);
        });
      }
    );
  });
}

// ─── Salesforce release info (shown in-extension) ────────────────────────────

function renderReleaseInfoInto(host: HTMLElement, isDark: boolean, onBack: () => void): void {
  host.innerHTML = '';
  const C = {
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
    surface: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    hover: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)',
    accent: '#2563eb',
  };
  host.appendChild(toolBackHeader(isDark, '🚀  Salesforce Release', onBack));
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '8px 28px 20px' });
  host.appendChild(body);

  // Current release banner (filled once the fetch resolves).
  const banner = document.createElement('div');
  Object.assign(banner.style, { padding: '16px', borderRadius: '12px', background: C.surface, border: `1px solid ${C.divider}`, marginBottom: '16px', textAlign: 'center' });
  const relLabel = document.createElement('div');
  relLabel.textContent = 'Loading current release…';
  Object.assign(relLabel.style, { fontSize: '22px', fontWeight: '800', color: C.textPrimary });
  const relVer = document.createElement('div');
  Object.assign(relVer.style, { fontSize: '12px', color: C.textMuted, marginTop: '4px' });
  banner.appendChild(relLabel); banner.appendChild(relVer);
  body.appendChild(banner);

  const linkRow = (icon: string, label: string, sub: string, onClick: () => void) => {
    const row = document.createElement('button');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '12px 14px', marginBottom: '8px',
      background: C.surface, border: `1px solid ${C.divider}`, borderRadius: '12px', cursor: 'pointer',
      fontFamily: 'inherit', textAlign: 'left', color: C.textPrimary,
    });
    row.innerHTML = `<span style="font-size:20px">${icon}</span><span style="flex:1"><span style="display:block;font-size:14px;font-weight:700">${label}</span><span style="display:block;font-size:12px;color:${C.textMuted}">${sub}</span></span><span style="color:${C.textMuted}">↗</span>`;
    row.addEventListener('mouseover', () => { row.style.background = C.hover; });
    row.addEventListener('mouseout', () => { row.style.background = C.surface; });
    row.addEventListener('click', onClick);
    body.appendChild(row);
  };

  // Defaults to the generic notes page until the org's API version is known,
  // then becomes a deep link to that exact release's notes.
  let releaseNotesUrl = 'https://help.salesforce.com/s/releasenotes';
  linkRow('📖', 'Release Notes', 'New features & changes', () => window.open(releaseNotesUrl, '_blank'));
  linkRow('⚙️', 'Release Updates', 'Pending updates in your org (Setup)', () => { window.open(`${lightningOrigin()}/lightning/setup/ReleaseUpdates/home`, '_blank'); });
  linkRow('🗓️', 'Release Schedule', 'Dates & maintenance windows', () => window.open('https://www.salesforce.com/blog/salesforce-release-dates/', '_blank'));

  getSfCredentials().then((creds: any) => {
    if (!creds?.instanceUrl || !creds?.sessionId) { relLabel.textContent = 'Session not detected'; relVer.textContent = ''; return; }
    (globalThis as any).chrome.runtime.sendMessage(
      { type: 'GET_RELEASE_INFO', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId },
      (resp: any) => {
        if (resp?.success && resp.data?.label) {
          relLabel.textContent = resp.data.label;
          relVer.textContent = resp.data.version ? `API v${resp.data.version} · your org is on this release` : '';
          // Map API version → release notes number (release = api*2 + 130).
          const api = parseInt(String(resp.data.version || ''), 10);
          if (!isNaN(api)) {
            const releaseNum = api * 2 + 130;
            releaseNotesUrl = `https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=${releaseNum}&type=5`;
          }
        } else {
          relLabel.textContent = 'Release unavailable';
          relVer.textContent = resp?.error || '';
        }
      }
    );
  });
}

// ─── Org limits: API usage & storage (shown in-extension) ────────────────────

function renderOrgLimitsInto(host: HTMLElement, isDark: boolean, onBack: () => void, opts: { title: string; fields: { key: string; label: string; storage?: boolean }[] }): void {
  host.innerHTML = '';
  const C = {
    track: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.1)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)',
    textFaint: isDark ? 'rgba(148,163,184,0.6)' : 'rgba(31,41,55,0.45)',
  };
  host.appendChild(toolBackHeader(isDark, opts.title, onBack));
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '8px 28px 20px' });
  host.appendChild(body);

  const msg = (t: string) => { body.innerHTML = ''; const d = document.createElement('div'); Object.assign(d.style, { padding: '40px 0', textAlign: 'center', color: C.textMuted, fontSize: '14px', fontWeight: '600' }); d.textContent = t; body.appendChild(d); };
  msg('Loading…');

  const fmt = (v: number, storage?: boolean) => {
    if (storage) return v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${Math.round(v)} MB`;
    return v.toLocaleString();
  };

  getSfCredentials().then((creds: any) => {
    if (!creds?.instanceUrl || !creds?.sessionId) { msg('Salesforce session not detected.'); return; }
    (globalThis as any).chrome.runtime.sendMessage(
      { type: 'GET_ORG_LIMITS', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId },
      (resp: any) => {
        if (!resp?.success || !resp.data) { msg(resp?.error || 'Could not load limits.'); return; }
        const data = resp.data;
        const present = opts.fields.filter((f) => data[f.key] && typeof data[f.key].Max === 'number');
        if (present.length === 0) { msg('No matching limits returned for this org.'); return; }
        body.innerHTML = '';
        present.forEach((f) => {
          const lim = data[f.key];
          const max = lim.Max || 0;
          const used = Math.max(0, max - (lim.Remaining ?? max));
          const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
          const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#16a34a';

          const row = document.createElement('div');
          row.style.marginBottom = '16px';
          const top = document.createElement('div');
          Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' });
          const lbl = document.createElement('span');
          lbl.textContent = f.label;
          Object.assign(lbl.style, { fontSize: '13px', fontWeight: '700', color: C.textPrimary });
          const val = document.createElement('span');
          val.textContent = `${fmt(used, f.storage)} / ${fmt(max, f.storage)}`;
          Object.assign(val.style, { fontSize: '12px', color: C.textMuted, fontWeight: '600' });
          top.appendChild(lbl); top.appendChild(val);

          const trackEl = document.createElement('div');
          Object.assign(trackEl.style, { height: '8px', borderRadius: '999px', background: C.track, overflow: 'hidden' });
          const fill = document.createElement('div');
          Object.assign(fill.style, { height: '100%', width: `${pct}%`, background: color, borderRadius: '999px', transition: 'width 0.3s' });
          trackEl.appendChild(fill);

          const pctLbl = document.createElement('div');
          pctLbl.textContent = `${pct.toFixed(0)}% used · ${fmt(lim.Remaining ?? 0, f.storage)} remaining`;
          Object.assign(pctLbl.style, { fontSize: '11px', color: C.textFaint, marginTop: '4px' });

          row.appendChild(top); row.appendChild(trackEl); row.appendChild(pctLbl);
          body.appendChild(row);
        });
      }
    );
  });
}

// ─── Spotlight Search ────────────────────────────────────────────────────────
// Defined BEFORE injectSidebar so it is always in scope when called.

function showSpotlightSearch() {
  const existing = document.getElementById('sf-log-analyzer-spotlight-container');
  if (existing) existing.remove();
  if (!document.body) {
    console.warn('Document body not available for spotlight search');
    return;
  }
  buildSpotlight(currentTabConfig);
}

function buildSpotlight(tabConfig: TabConfig) {
  // ─── Theme tokens (light / dark) ───────────────────────────
  const isDark = currentSpotlightTheme === 'dark';
  const T = {
    backdrop: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.2)',
    modalBg: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.15)',
    modalBorder: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(255, 255, 255, 0.3)',
    divider: isDark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.1)',
    surface: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.1)',
    surfaceHover: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.25)',
    rowHover: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(245, 245, 245, 0.69)',
    closeHover: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textSecondary: isDark ? 'rgba(226, 232, 240, 0.85)' : 'rgba(31, 41, 55, 0.8)',
    textMuted: isDark ? 'rgba(203, 213, 225, 0.65)' : 'rgba(31, 41, 55, 0.6)',
    textFaint: isDark ? 'rgba(148, 163, 184, 0.55)' : 'rgba(31, 41, 55, 0.45)',
    tabInactive: isDark ? 'rgba(148, 163, 184, 0.7)' : 'rgba(31, 41, 55, 0.5)',
    iconStroke: isDark ? '#cbd5e1' : '#1f2937',
    scrollThumb: isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(31, 41, 55, 0.25)',
    scrollThumbHover: isDark ? 'rgba(148, 163, 184, 0.55)' : 'rgba(31, 41, 55, 0.45)',
    accent: '#3b82f6',
    chipBorder: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(31, 41, 55, 0.12)',
    chipBg: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.35)',
    chipBgHidden: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(31, 41, 55, 0.04)',
    btnNeutralBg: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(31, 41, 55, 0.08)',
  };

  const spotlightContainer = document.createElement('div');
  spotlightContainer.id = 'sf-log-analyzer-spotlight-container';
  spotlightContainer.style.position = 'fixed';
  spotlightContainer.style.top = '0';
  spotlightContainer.style.left = '0';
  spotlightContainer.style.width = '100%';
  spotlightContainer.style.height = '100%';
  spotlightContainer.style.zIndex = '2147483648';
  spotlightContainer.style.pointerEvents = 'none';
  spotlightContainer.style.display = 'none';
  document.body.appendChild(spotlightContainer);

  const modalContent = document.createElement('div');
  modalContent.id = 'sf-log-analyzer-modal-content';
  modalContent.style.position = 'fixed';
  modalContent.style.top = '0';
  modalContent.style.left = '0';
  modalContent.style.width = '100%';
  modalContent.style.height = '100%';
  modalContent.style.display = 'flex';
  modalContent.style.alignItems = 'center';
  modalContent.style.justifyContent = 'center';
  modalContent.style.zIndex = '2147483648';
  modalContent.style.pointerEvents = 'none';

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.style.position = 'absolute';
  backdrop.style.top = '0';
  backdrop.style.left = '0';
  backdrop.style.width = '100%';
  backdrop.style.height = '100%';
  backdrop.style.backgroundColor = T.backdrop;
  backdrop.style.zIndex = '1';
  backdrop.style.cursor = 'pointer';
  backdrop.style.pointerEvents = 'auto';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideSpotlightSearch();
  });

  // Modal box
  const modal = document.createElement('div');
  modal.style.position = 'relative';
  modal.style.width = '100%';
  modal.style.maxWidth = '768px';
  // Opaque background, no blur behind the modal.
  modal.style.backgroundColor = isDark ? '#0f172a' : '#ffffff';
  modal.style.borderRadius = '24px';
  modal.style.boxShadow = '0 25px 50px rgba(0, 0, 0, 0.5)';
  modal.style.border = `1px solid ${T.modalBorder}`;
  modal.style.overflow = 'hidden';
  modal.style.zIndex = '2';
  modal.style.pointerEvents = 'auto';

  // Input container
  const inputContainer = document.createElement('div');
  inputContainer.style.display = 'flex';
  inputContainer.style.alignItems = 'center';
  inputContainer.style.padding = '24px 32px';
  inputContainer.style.borderBottom = `1px solid ${T.divider}`;

  const searchSvg = document.createElement('div');
  searchSvg.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${T.iconStroke}" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>`;
  searchSvg.style.marginRight = '16px';
  searchSvg.style.flexShrink = '0';

  const searchInput = document.createElement('input');
  searchInput.id = 'sf-spotlight-input';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search Salesforce Setup...';
  searchInput.style.flex = '1';
  searchInput.style.backgroundColor = 'transparent';
  searchInput.style.fontSize = '22px';
  searchInput.style.color = T.textPrimary;
  searchInput.style.border = 'none';
  searchInput.style.outline = 'none';
  searchInput.style.fontWeight = '600';
  searchInput.style.fontFamily = 'inherit';
  searchInput.style.caretColor = T.textPrimary;
  searchInput.style.textShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';

  const closeBtn = document.createElement('button');
  closeBtn.style.marginLeft = '16px';
  closeBtn.style.padding = '8px';
  closeBtn.style.backgroundColor = 'transparent';
  closeBtn.style.border = 'none';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.borderRadius = '8px';
  closeBtn.style.transition = 'background-color 0.2s';
  closeBtn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${T.iconStroke}" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  closeBtn.addEventListener('mouseover', () => { closeBtn.style.backgroundColor = T.closeHover; });
  closeBtn.addEventListener('mouseout', () => { closeBtn.style.backgroundColor = 'transparent'; });
  closeBtn.addEventListener('click', () => hideSpotlightSearch());

  inputContainer.appendChild(searchSvg);
  inputContainer.appendChild(searchInput);
  inputContainer.appendChild(closeBtn);

  // Tabs (rendered dynamically from config)
  const tabsContainer = document.createElement('div');
  tabsContainer.style.backgroundColor = T.surface;
  tabsContainer.style.borderBottom = `1px solid ${T.divider}`;
  tabsContainer.style.padding = '0 32px';
  tabsContainer.style.gap = '28px';
  tabsContainer.style.display = 'flex';
  tabsContainer.style.alignItems = 'center';

  let activeTab = tabConfig.defaultTab;
  // When set (on the Tools tab), a tool detail view is shown in-panel instead of the grid.
  let toolView: string | null = null;

  // Results container — fixed height so the modal doesn't resize between tabs.
  const resultsContainer = document.createElement('div');
  resultsContainer.style.height = '420px';
  resultsContainer.style.overflowY = 'auto';
  resultsContainer.style.scrollbarWidth = 'thin';
  resultsContainer.style.scrollbarColor = `${T.scrollThumb} transparent`;
  resultsContainer.style.scrollBehavior = 'smooth';

  // (Re)build the scoped style block each time so it tracks the active theme.
  {
    let scrollbarStyle = document.getElementById('sf-spotlight-scrollbar-style') as HTMLStyleElement | null;
    if (!scrollbarStyle) {
      scrollbarStyle = document.createElement('style');
      scrollbarStyle.id = 'sf-spotlight-scrollbar-style';
      document.head.appendChild(scrollbarStyle);
    }
    scrollbarStyle.textContent = `
      #sf-log-analyzer-spotlight-container ::-webkit-scrollbar { width: 10px; }
      #sf-log-analyzer-spotlight-container ::-webkit-scrollbar-track { background: transparent; margin: 12px 0; }
      #sf-log-analyzer-spotlight-container ::-webkit-scrollbar-thumb { background: ${T.scrollThumb}; border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; transition: background 0.2s ease; }
      #sf-log-analyzer-spotlight-container ::-webkit-scrollbar-thumb:hover { background: ${T.scrollThumbHover}; background-clip: padding-box; }
      #sf-log-analyzer-spotlight-container ::-webkit-scrollbar-corner { background: transparent; }
      #sf-spotlight-input::placeholder { color: ${T.textFaint}; opacity: 1; }
      #sf-log-analyzer-spotlight-container .sf-star { cursor: pointer; opacity: 0.55; transition: opacity 0.15s, transform 0.15s; padding: 4px; border-radius: 6px; }
      #sf-log-analyzer-spotlight-container .sf-star:hover { opacity: 1; transform: scale(1.15); }
    `;
  }

  const noResults = document.createElement('div');
  noResults.style.padding = '64px 32px';
  noResults.style.textAlign = 'center';
  noResults.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${T.textFaint}" stroke-width="2" style="margin: 0 auto 16px"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg><p style="color: ${T.textPrimary}; font-weight: 600; margin: 0; font-size: 16px">No results found</p><p style="color: ${T.textMuted}; font-size: 14px; margin: 8px 0 0 0">Try searching for something else</p>`;
  resultsContainer.appendChild(noResults);

  // ─── Footer (brand + keyboard hints) ───────────────────────
  // Show "Alt" on Windows/Linux and "⌥" on macOS for the toggle shortcut.
  const isMacPlatform = (() => {
    const uaPlatform = (navigator as any).userAgentData?.platform;
    if (uaPlatform) return /mac/i.test(uaPlatform);
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  })();
  const toggleKey = isMacPlatform ? '⌥T' : 'Alt + T';

  const hintsBar = document.createElement('div');
  hintsBar.style.display = 'flex';
  hintsBar.style.alignItems = 'center';
  hintsBar.style.justifyContent = 'space-between';
  hintsBar.style.gap = '16px';
  hintsBar.style.padding = '12px 24px';
  hintsBar.style.borderTop = `1px solid ${T.divider}`;
  hintsBar.style.backgroundColor = T.surface;

  // Brand (left) — clickable, opens the documentation site
  const brand = document.createElement('a');
  brand.href = 'https://praveen420coder.github.io/sf-log-analyzer/';
  brand.target = '_blank';
  brand.rel = 'noopener noreferrer';
  brand.title = 'Open documentation';
  brand.style.display = 'flex';
  brand.style.alignItems = 'center';
  brand.style.gap = '10px';
  brand.style.flexShrink = '0';
  brand.style.textDecoration = 'none';
  brand.style.cursor = 'pointer';
  brand.addEventListener('mouseover', () => { brand.style.opacity = '0.7'; });
  brand.addEventListener('mouseout', () => { brand.style.opacity = '1'; });

  const logo = document.createElement('div');
  logo.style.width = '18px';
  logo.style.height = '18px';
  logo.style.borderRadius = '5px';
  logo.style.background = 'linear-gradient(135deg, #4f8cff, #2563eb)';
  logo.style.boxShadow = '0 1px 4px rgba(37, 99, 235, 0.45)';
  logo.style.flexShrink = '0';

  const brandText = document.createElement('div');
  brandText.style.fontSize = '13px';
  brandText.style.whiteSpace = 'nowrap';
  brandText.innerHTML = `<span style="font-weight:700;color:${T.textPrimary};">Spotlight</span> <span style="color:${T.textFaint};font-weight:500;"> for Salesforce</span>`;

  brand.appendChild(logo);
  brand.appendChild(brandText);

  // Hints (right)
  const hintsRight = document.createElement('div');
  hintsRight.style.display = 'flex';
  hintsRight.style.alignItems = 'center';
  hintsRight.style.gap = '18px';
  hintsRight.style.flexWrap = 'wrap';
  hintsRight.style.justifyContent = 'flex-end';

  const hints = [
    { key: '↑↓', label: 'navigate' },
    { key: '⏎', label: 'open' },
    { key: 'esc', label: 'close' },
    { key: toggleKey, label: 'toggle' },
  ];

  hints.forEach(hint => {
    const hintItem = document.createElement('div');
    hintItem.style.display = 'flex';
    hintItem.style.alignItems = 'center';
    hintItem.style.gap = '6px';
    hintItem.style.whiteSpace = 'nowrap';

    const keySpan = document.createElement('span');
    keySpan.textContent = hint.key;
    keySpan.style.fontSize = '13px';
    keySpan.style.fontWeight = '600';
    keySpan.style.color = T.textMuted;

    const labelSpan = document.createElement('span');
    labelSpan.textContent = hint.label;
    labelSpan.style.fontSize = '13px';
    labelSpan.style.color = T.textFaint;

    hintItem.appendChild(keySpan);
    hintItem.appendChild(labelSpan);
    hintsRight.appendChild(hintItem);
  });

  // Docs link (explicit, next to the keyboard hints)
  const docsLink = document.createElement('a');
  docsLink.href = 'https://praveen420coder.github.io/sf-log-analyzer/';
  docsLink.target = '_blank';
  docsLink.rel = 'noopener noreferrer';
  docsLink.style.display = 'flex';
  docsLink.style.alignItems = 'center';
  docsLink.style.gap = '6px';
  docsLink.style.fontSize = '13px';
  docsLink.style.fontWeight = '600';
  docsLink.style.color = T.textMuted;
  docsLink.style.textDecoration = 'none';
  docsLink.style.whiteSpace = 'nowrap';
  docsLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg><span>Docs</span>';
  docsLink.addEventListener('mouseover', () => { docsLink.style.color = T.textPrimary; });
  docsLink.addEventListener('mouseout', () => { docsLink.style.color = T.textMuted; });
  hintsRight.appendChild(docsLink);

  // Report an issue link (opens a new GitHub issue)
  const reportLink = document.createElement('a');
  reportLink.href = 'https://forms.gle/ed2VcwQTJXTDaMUv6';
  reportLink.target = '_blank';
  reportLink.rel = 'noopener noreferrer';
  reportLink.style.display = 'flex';
  reportLink.style.alignItems = 'center';
  reportLink.style.gap = '6px';
  reportLink.style.fontSize = '13px';
  reportLink.style.fontWeight = '600';
  reportLink.style.color = T.textMuted;
  reportLink.style.textDecoration = 'none';
  reportLink.style.whiteSpace = 'nowrap';
  reportLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"></rect><path d="m19 7-3 2"></path><path d="m5 7 3 2"></path><path d="M19 19l-3-2"></path><path d="m5 19 3-2"></path><path d="M20 13h-4"></path><path d="M4 13h4"></path><path d="m10 4 1 2"></path><path d="m14 4-1 2"></path></svg><span>Report issue</span>';
  reportLink.addEventListener('mouseover', () => { reportLink.style.color = T.textPrimary; });
  reportLink.addEventListener('mouseout', () => { reportLink.style.color = T.textMuted; });
  hintsRight.appendChild(reportLink);

  hintsBar.appendChild(brand);
  hintsBar.appendChild(hintsRight);

  modal.appendChild(tabsContainer);   // tabs on top
  modal.appendChild(inputContainer);
  modal.appendChild(resultsContainer);
  modal.appendChild(hintsBar);

  modalContent.appendChild(backdrop);
  modalContent.appendChild(modal);
  spotlightContainer.appendChild(modalContent);

  // ─── Shared helpers ────────────────────────────────────────
  const showMessage = (msg: string) => {
    resultsContainer.innerHTML = '';
    const d = document.createElement('div');
    d.style.padding = '64px 32px';
    d.style.textAlign = 'center';
    d.style.color = T.textPrimary;
    d.style.fontWeight = '600';
    d.textContent = msg;
    resultsContainer.appendChild(d);
  };

  const makeResultRow = (opts: { icon: string; title: string; subtitle?: string; meta?: string; first?: boolean; onClick: () => void; fav?: Omit<RecentItem, 'ts'>; }) => {
    const resultItem = document.createElement('button');
    resultItem.style.width = '100%';
    resultItem.style.padding = '20px 32px';
    resultItem.style.display = 'flex';
    resultItem.style.alignItems = 'flex-start';
    resultItem.style.gap = '16px';
    resultItem.style.transition = 'all 0.2s';
    resultItem.style.textAlign = 'left';
    resultItem.style.backgroundColor = opts.first ? T.surface : 'transparent';
    resultItem.style.borderBottom = `1px solid ${T.divider}`;
    resultItem.style.border = 'none';
    resultItem.style.cursor = 'pointer';
    resultItem.style.fontFamily = 'inherit';
    resultItem.style.color = T.textPrimary;

    const iconContainer = document.createElement('div');
    iconContainer.style.flexShrink = '0';
    iconContainer.style.width = '48px';
    iconContainer.style.height = '48px';
    iconContainer.style.borderRadius = '12px';
    iconContainer.style.backgroundColor = T.surface;
    iconContainer.style.display = 'flex';
    iconContainer.style.alignItems = 'center';
    iconContainer.style.justifyContent = 'center';
    iconContainer.style.fontSize = '24px';
    iconContainer.style.marginTop = '4px';
    iconContainer.innerHTML = opts.icon;

    const contentContainer = document.createElement('div');
    contentContainer.style.flex = '1';
    contentContainer.style.minWidth = '0';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '17px';
    title.style.color = T.textPrimary;
    title.style.marginBottom = '6px';
    title.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.1)';
    title.textContent = opts.title;
    contentContainer.appendChild(title);

    if (opts.subtitle) {
      const s = document.createElement('div');
      s.style.fontSize = '14px';
      s.style.color = T.textSecondary;
      s.style.marginBottom = '4px';
      s.style.wordBreak = 'break-all';
      s.textContent = opts.subtitle;
      contentContainer.appendChild(s);
    }
    if (opts.meta) {
      const m = document.createElement('div');
      m.style.fontSize = '13px';
      m.style.color = T.textMuted;
      m.textContent = opts.meta;
      contentContainer.appendChild(m);
    }

    resultItem.appendChild(iconContainer);
    resultItem.appendChild(contentContainer);

    // Optional star to pin/unpin this destination. Rendered as a span (not a
    // button and without an inline cursor:pointer) so it isn't picked up by the
    // arrow-key navigation selector.
    if (opts.fav) {
      const fav = opts.fav;
      const starWrap = document.createElement('span');
      starWrap.className = 'sf-star';
      starWrap.style.flexShrink = '0';
      starWrap.style.display = 'flex';
      starWrap.style.alignItems = 'center';
      const starFilled = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#f5b301" stroke="#f5b301" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
      const starOutline = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
      const paint = () => {
        const on = isFavorite(fav.url, fav.kind);
        starWrap.innerHTML = on ? starFilled : starOutline;
        starWrap.title = on ? 'Unpin from favorites' : 'Pin to favorites';
        starWrap.style.color = on ? '#f5b301' : T.textFaint;
      };
      paint();
      starWrap.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(fav);
        paint();
        // Refresh the Recent tab so the Pinned section reflects the change.
        if (activeTab === 'recent') performSearch();
      });
      resultItem.appendChild(starWrap);
    }

    const externalLink = document.createElement('div');
    externalLink.style.flexShrink = '0';
    externalLink.style.color = T.textMuted;
    externalLink.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';

    resultItem.appendChild(externalLink);

    resultItem.addEventListener('mouseover', () => {
      resultItem.style.backgroundColor = T.rowHover;
      iconContainer.style.backgroundColor = T.surfaceHover;
      externalLink.style.color = T.textPrimary;
    });
    resultItem.addEventListener('mouseout', () => {
      resultItem.style.backgroundColor = 'transparent';
      iconContainer.style.backgroundColor = T.surface;
      externalLink.style.color = T.textMuted;
    });
    resultItem.addEventListener('click', opts.onClick);
    return resultItem;
  };

  // Per-user "⋯" action menu (debug mode, view fields, view details).
  const openUserMenu = (anchor: HTMLElement, user: { id: string; name: string; email?: string; username?: string }) => {
    document.getElementById('sf-user-action-menu')?.remove();

    const isDark = currentSpotlightTheme === 'dark';
    const menuBg = isDark ? '#1e293b' : '#ffffff';
    const menuBorder = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(31,41,55,0.15)';
    const menuText = isDark ? '#f1f5f9' : '#1f2937';
    const menuHover = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';

    const menu = document.createElement('div');
    menu.id = 'sf-user-action-menu';
    Object.assign(menu.style, {
      position: 'fixed', minWidth: '210px', background: menuBg, color: menuText,
      border: `1px solid ${menuBorder}`, borderRadius: '12px', boxShadow: '0 18px 45px rgba(0,0,0,0.35)',
      padding: '6px', zIndex: '2147483649', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px',
    });

    const setDebugMode = (enabled: boolean) => {
      getSfCredentials().then((creds: any) => {
        if (!creds?.instanceUrl || !creds?.sessionId) { flashToast('Salesforce session not detected'); return; }
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'UPDATE_RECORD_FIELD', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, objectApiName: 'User', recordId: user.id, fieldApiName: 'UserPreferencesUserDebugModePref', value: enabled },
          (resp: any) => {
            if (resp?.success) flashToast(`Debug mode ${enabled ? 'enabled' : 'disabled'} for ${user.name}`);
            else flashToast(resp?.error || 'Could not update debug mode');
          }
        );
      });
    };

    const items: { label: string; icon: string; onClick: () => void }[] = [
      { label: 'View all fields', icon: '🗂️', onClick: () => showRecordDetail(user.id) },
      { label: 'Open user detail', icon: '👤', onClick: () => {
          const url = `${lightningOrigin()}/lightning/setup/ManageUsers/page?address=%2F${user.id}%3Fnoredirect%3D1%26isUserEntityOverride%3D1`;
          recordRecent({ kind: 'user', icon: '👤', title: user.name, subtitle: user.email || user.username, meta: 'User', url });
          window.open(url, '_blank');
          hideSpotlightSearch();
        } },
      { label: 'Enable debug mode', icon: '🐞', onClick: () => setDebugMode(true) },
      { label: 'Disable debug mode', icon: '🚫', onClick: () => setDebugMode(false) },
    ];

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('keydown', onMenuKey, true);
      document.removeEventListener('click', onOutside, true);
    };
    const onMenuKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); } };
    const onOutside = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) closeMenu(); };

    items.forEach((it) => {
      const row = document.createElement('button');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '9px 10px',
        background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer',
        color: menuText, fontFamily: 'inherit', fontSize: '13px', fontWeight: '600', textAlign: 'left',
      });
      row.innerHTML = `<span style="font-size:15px">${it.icon}</span><span>${it.label}</span>`;
      row.addEventListener('mouseover', () => { row.style.background = menuHover; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', (e) => { e.stopPropagation(); it.onClick(); closeMenu(); });
      menu.appendChild(row);
    });

    document.body.appendChild(menu);

    // Position near the anchor, flipping up/left if it would overflow.
    const rect = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let top = rect.bottom + 6;
    let left = rect.right - mw;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
    if (left < 8) left = 8;
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    setTimeout(() => {
      document.addEventListener('keydown', onMenuKey, true);
      document.addEventListener('click', onOutside, true);
    }, 0);
  };

  // ─── Data fetching ─────────────────────────────────────────
  const fetchSalesforceUsers = async (): Promise<any[]> => {
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return [];
      return await new Promise<any[]>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_ALL_ACTIVE_USERS', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId },
          (response: any) => {
            if (response?.success && response?.data) {
              resolve(response.data.map((record: any) => ({
                id: record.Id,
                name: record.Name,
                email: record.Email,
                username: record.Username,
              })));
            } else {
              resolve([]);
            }
          }
        );
      });
    } catch (error) {
      console.error('Error fetching Salesforce users:', error);
      return [];
    }
  };

  // Resolve (once) the Id of the logged-in user so we can pin them to the top.
  const ensureCurrentUserId = async (): Promise<void> => {
    if (currentUserId) return;
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return;
      currentUserId = await new Promise<string | null>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'FETCH_USER_INFO', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId },
          (response: any) => resolve(response?.success && response?.data ? (response.data.id || null) : null)
        );
      });
    } catch { /* ignore */ }
  };

  const fetchSalesforceFlows = async (): Promise<any[]> => {
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return [];
      return await new Promise<any[]>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_ALL_FLOWS', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId },
          (response: any) => {
            if (response?.success && response?.data) {
              resolve(response.data.map((record: any) => ({
                apiName: record.ApiName,
                label: record.Label || record.ApiName,
                processType: record.ProcessType,
                isActive: record.IsActive,
                versionNumber: record.VersionNumber,
                manageableState: record.ManageableState,
                namespacePrefix: record.NamespacePrefix,
                versionId: record.ActiveVersionId || record.LatestVersionId,
              })));
            } else {
              resolve([]);
            }
          }
        );
      });
    } catch (error) {
      console.error('Error fetching Salesforce flows:', error);
      return [];
    }
  };

  const fetchSalesforceObjects = async (): Promise<any[]> => {
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return [];
      const objects = await new Promise<any[]>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_ALL_OBJECTS', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId },
          (response: any) => {
            if (response?.success && response?.data) {
              resolve(response.data.map((record: any) => ({
                apiName: record.QualifiedApiName,
                label: record.Label || record.QualifiedApiName,
                durableId: record.DurableId,
                keyPrefix: record.KeyPrefix,
              })));
            } else {
              resolve([]);
            }
          }
        );
      });
      objects.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      return objects;
    } catch (error) {
      console.error('Error fetching Salesforce objects:', error);
      return [];
    }
  };

  const fetchSalesforceMetadata = async (): Promise<any[]> => {
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return [];
      return await new Promise<any[]>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_ALL_METADATA', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId },
          (response: any) => {
            resolve(response?.success && response?.data ? response.data : []);
          }
        );
      });
    } catch (error) {
      console.error('Error fetching Salesforce metadata:', error);
      return [];
    }
  };

  const fetchSalesforceSecurity = async (): Promise<any[]> => {
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return [];
      return await new Promise<any[]>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_ALL_SECURITY', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId },
          (response: any) => {
            if (response?.success && response?.data) resolve(response.data);
            else resolve([]);
          }
        );
      });
    } catch (error) {
      console.error('Error fetching Salesforce security:', error);
      return [];
    }
  };

  const fetchSalesforceApps = async (): Promise<any[]> => {
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return [];
      const apps = await new Promise<any[]>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_ALL_APPS', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId },
          (response: any) => {
            if (response?.success && response?.data) {
              // Backend already returns normalized { id, label, name, type, url }.
              resolve(response.data);
            } else {
              resolve([]);
            }
          }
        );
      });
      apps.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      return apps;
    } catch (error) {
      console.error('Error fetching Salesforce apps:', error);
      return [];
    }
  };

  // ─── Search / render ───────────────────────────────────────
  // Feature hint rows shown on the Setup tab when the search box is empty.
  const makeTipRow = (t: { icon: string; title: string; desc: string; onClick?: () => void }) => {
    const el = document.createElement(t.onClick ? 'button' : 'div');
    Object.assign(el.style, {
      width: '100%', display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 12px',
      borderRadius: '10px', background: 'transparent', border: 'none', textAlign: 'left',
      cursor: t.onClick ? 'pointer' : 'default', fontFamily: 'inherit',
    });
    if (t.onClick) {
      el.addEventListener('click', t.onClick);
      el.addEventListener('mouseover', () => { el.style.background = T.surface; });
      el.addEventListener('mouseout', () => { el.style.background = 'transparent'; });
    }
    const ic = document.createElement('div');
    ic.textContent = t.icon; ic.style.fontSize = '18px'; ic.style.flexShrink = '0';
    const txt = document.createElement('div');
    const ti = document.createElement('div');
    ti.textContent = t.title; Object.assign(ti.style, { fontSize: '14px', fontWeight: '700', color: T.textPrimary });
    const de = document.createElement('div');
    de.textContent = t.desc; Object.assign(de.style, { fontSize: '12px', color: T.textMuted, marginTop: '2px' });
    txt.appendChild(ti); txt.appendChild(de);
    el.appendChild(ic); el.appendChild(txt);
    return el;
  };

  const renderSpotlightTips = () => {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    const wrap = document.createElement('div');
    wrap.style.padding = '8px 20px 20px';
    const heading = document.createElement('div');
    heading.textContent = 'Tips';
    Object.assign(heading.style, { fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: T.textFaint, padding: '4px 12px 8px' });
    wrap.appendChild(heading);
    const tips = [
      { icon: '🔗', title: 'Paste a record Id', desc: 'Open the record or view all its fields instantly.' },
      { icon: '🗂️', title: `Press ${isMac ? 'Option' : 'Alt'}+D on a record`, desc: 'See every field, its value and type — and edit inline.' },
      { icon: '🌓', title: 'Light or dark', desc: 'Switch the Spotlight theme in Settings.', onClick: () => activateTab('__settings') },
      { icon: '⚡', title: 'Search everything', desc: 'Setup, Objects, Users, Flows, Permissions, Apps and more.' },
    ];
    tips.forEach((t) => wrap.appendChild(makeTipRow(t)));
    resultsContainer.appendChild(wrap);
  };

  const performSearch = async () => {
    const query = (searchInput as HTMLInputElement).value.toLowerCase();
    resultsContainer.innerHTML = '';

    // Record-Id paste detection — works on any tab. If the input is a valid
    // 15/18-char record Id, surface quick actions instead of a normal search.
    const rawQuery = (searchInput as HTMLInputElement).value.trim();
    if (isValidSalesforceId(rawQuery)) {
      const prefix = rawQuery.substring(0, 3);
      const guessed = COMMON_PREFIXES[prefix];
      const subtitle = guessed ? `${guessed} · ${rawQuery}` : rawQuery;

      resultsContainer.appendChild(makeResultRow({
        icon: '🔗', title: 'Open record', subtitle, meta: 'Record', first: true,
        onClick: () => {
          const url = `${lightningOrigin()}/${rawQuery}`;
          recordRecent({ kind: 'record', icon: '🔗', title: guessed ? `${guessed} record` : 'Record', subtitle: rawQuery, meta: 'Record', url });
          window.open(url, '_blank');
          hideSpotlightSearch();
        },
      }));

      resultsContainer.appendChild(makeResultRow({
        icon: '🗂️', title: 'View all fields', subtitle: 'Every field, value and type you can access',
        meta: 'Detail', onClick: () => showRecordDetail(rawQuery),
      }));

      if (prefix === '005') {
        resultsContainer.appendChild(makeResultRow({
          icon: '⚙️', title: 'Open in Setup', subtitle: 'User detail in Setup', meta: 'Setup',
          onClick: () => {
            const url = `${lightningOrigin()}/lightning/setup/ManageUsers/page?address=%2F${rawQuery}%3Fnoredirect%3D1`;
            window.open(url, '_blank');
            hideSpotlightSearch();
          },
        }));
      }
      return;
    }

    if (activeTab === 'recent') {
      const matches = (r: RecentItem) => query.length === 0 ||
        (r.title || '').toLowerCase().includes(query) ||
        (r.subtitle || '').toLowerCase().includes(query) ||
        (r.meta || '').toLowerCase().includes(query);

      const favs = favoriteItems.filter(matches);
      const pinnedKeys = new Set(favoriteItems.map(f => `${f.kind}|${f.url}`));
      const recents = recentItems.filter(r => !pinnedKeys.has(`${r.kind}|${r.url}`)).filter(matches);

      if (favs.length === 0 && recents.length === 0) {
        showMessage(favoriteItems.length === 0 && recentItems.length === 0
          ? 'Nothing here yet. Open something, then tap the ☆ to pin it.'
          : 'Nothing matches your search.');
        return;
      }

      const sectionHeader = (label: string, action?: HTMLElement) => {
        const h = document.createElement('div');
        h.style.display = 'flex';
        h.style.alignItems = 'center';
        h.style.justifyContent = 'space-between';
        h.style.padding = '12px 32px 6px';
        const t = document.createElement('span');
        t.textContent = label;
        Object.assign(t.style, { fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: T.textFaint });
        h.appendChild(t);
        if (action) h.appendChild(action);
        return h;
      };

      const openRow = (r: RecentItem, first: boolean) => makeResultRow({
        icon: r.icon || '🕘',
        title: r.title,
        subtitle: r.subtitle,
        meta: r.meta,
        first,
        fav: { kind: r.kind, icon: r.icon, title: r.title, subtitle: r.subtitle, meta: r.meta, url: r.url },
        onClick: () => {
          recordRecent({ kind: r.kind, icon: r.icon, title: r.title, subtitle: r.subtitle, meta: r.meta, url: r.url });
          window.open(r.url, '_blank');
          hideSpotlightSearch();
        },
      });

      // Pinned section (above Recent).
      if (favs.length > 0) {
        resultsContainer.appendChild(sectionHeader('★ Pinned'));
        const pinnedList = document.createElement('div');
        favs.forEach((r, index) => pinnedList.appendChild(openRow(r, index === 0)));
        resultsContainer.appendChild(pinnedList);
      }

      // Recent section.
      if (recents.length > 0) {
        let clearAction: HTMLElement | undefined;
        if (query.length === 0) {
          const clearBtn = document.createElement('button');
          clearBtn.textContent = 'Clear';
          Object.assign(clearBtn.style, { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: T.textMuted, fontFamily: 'inherit' });
          clearBtn.addEventListener('mouseover', () => { clearBtn.style.color = T.textPrimary; });
          clearBtn.addEventListener('mouseout', () => { clearBtn.style.color = T.textMuted; });
          clearBtn.addEventListener('click', async () => { clearRecents(); await performSearch(); });
          clearAction = clearBtn;
        }
        resultsContainer.appendChild(sectionHeader('Recent', clearAction));
        const recentList = document.createElement('div');
        recents.forEach((r, index) => recentList.appendChild(openRow(r, favs.length === 0 && index === 0)));
        resultsContainer.appendChild(recentList);
      }

    } else if (activeTab === 'setup') {
      if (query.length === 0) {
        renderSpotlightTips();
        return;
      }

      const labelMatches = setupLinks.filter(link =>
        link.label.toLowerCase().includes(query)
      );
      const sectionMatches = setupLinks.filter(link =>
        !link.label.toLowerCase().includes(query) &&
        link.section.toLowerCase().includes(query)
      );
      const filtered = [...labelMatches, ...sectionMatches];

      if (filtered.length === 0) {
        resultsContainer.appendChild(noResults.cloneNode(true));
        return;
      }

      const resultsList = document.createElement('div');
      filtered.forEach((link, index) => {
        const fullUrl = link.isExternal ? link.link : `${window.location.protocol}//${window.location.hostname}${link.link}`;
        const entry = { kind: 'setup', icon: '🔗', title: link.label, subtitle: link.section, url: fullUrl };
        const resultItem = makeResultRow({
          icon: '🔗',
          title: link.label,
          subtitle: link.section,
          meta: link.link,
          first: index === 0,
          fav: entry,
          onClick: () => {
            recordRecent(entry);
            window.open(fullUrl, '_blank');
            hideSpotlightSearch();
          },
        });
        resultsList.appendChild(resultItem);
      });
      resultsContainer.appendChild(resultsList);

    } else if (activeTab === 'objects') {
      if (!cachedObjects) cachedObjects = await fetchSalesforceObjects();
      const objectsList = cachedObjects || [];

      let filtered = objectsList;
      if (query.length > 0) {
        filtered = objectsList.filter(o =>
          (o.label || '').toLowerCase().includes(query) ||
          (o.apiName || '').toLowerCase().includes(query)
        );
      } else {
        filtered = objectsList.slice(0, 50);
      }

      if (filtered.length === 0) {
        showMessage(objectsList.length === 0
          ? 'Could not load objects. Check Salesforce credentials.'
          : 'No objects match your search.');
        return;
      }

      const resultsList = document.createElement('div');
      filtered.forEach((o, index) => {
        const url = `${lightningOrigin()}/lightning/setup/ObjectManager/${encodeURIComponent(o.durableId || o.apiName)}/FieldsAndRelationships/view`;
        const entry = { kind: 'object', icon: '📦', title: o.label || o.apiName, subtitle: o.apiName, meta: o.keyPrefix ? `Key prefix ${o.keyPrefix}` : undefined, url };
        resultsList.appendChild(makeResultRow({
          icon: '📦',
          title: o.label || o.apiName,
          subtitle: o.apiName,
          meta: o.keyPrefix ? `Key prefix ${o.keyPrefix}` : undefined,
          first: index === 0,
          fav: entry,
          onClick: () => {
            recordRecent(entry);
            window.open(url, '_blank');
            hideSpotlightSearch();
          },
        }));
      });
      resultsContainer.appendChild(resultsList);

    } else if (activeTab === 'metadata') {
      if (!cachedMetadata) cachedMetadata = await fetchSalesforceMetadata();
      const mdList = cachedMetadata || [];

      let filtered = mdList;
      if (query.length > 0) {
        filtered = mdList.filter((m) =>
          (m.label || '').toLowerCase().includes(query) ||
          (m.apiName || '').toLowerCase().includes(query)
        );
      } else {
        filtered = mdList.slice(0, 50);
      }

      if (filtered.length === 0) {
        showMessage(mdList.length === 0
          ? 'No Custom Metadata Types or Custom Settings found (or no access).'
          : 'No Custom Metadata or Settings match your search.');
        return;
      }

      const manageUrl = (m: any): string => {
        if (m.kind === 'mdt') {
          return m.durableId
            ? `${lightningOrigin()}/lightning/setup/CustomMetadata/page?address=%2F${m.durableId}`
            : `${lightningOrigin()}/lightning/setup/CustomMetadata/home`;
        }
        return m.durableId
          ? `${lightningOrigin()}/lightning/setup/CustomSettings/page?address=%2Fsetup%2Fui%2FlistCustomSettingsData.apexp%3Fid%3D${m.durableId}`
          : `${lightningOrigin()}/lightning/setup/CustomSettings/home`;
      };

      const resultsList = document.createElement('div');
      filtered.forEach((m, index) => {
        const kindLabel = m.kind === 'mdt' ? 'Custom Metadata' : 'Custom Setting';
        const url = manageUrl(m);
        const entry = { kind: 'metadata', icon: m.kind === 'mdt' ? '🧩' : '⚙️', title: m.label || m.apiName, subtitle: m.apiName, meta: kindLabel, url };
        resultsList.appendChild(makeResultRow({
          icon: m.kind === 'mdt' ? '🧩' : '⚙️',
          title: m.label || m.apiName,
          subtitle: `${m.apiName} · Manage records`,
          meta: kindLabel,
          first: index === 0,
          fav: entry,
          onClick: () => {
            recordRecent(entry);
            window.open(url, '_blank');
            hideSpotlightSearch();
          },
        }));
      });
      resultsContainer.appendChild(resultsList);

    } else if (activeTab === 'users') {
      if (!cachedUsers) cachedUsers = await fetchSalesforceUsers();
      await ensureCurrentUserId();
      const usersList = cachedUsers || [];

      // Always float the logged-in user to the top.
      const ordered = [...usersList];
      if (currentUserId) {
        const idx = ordered.findIndex(u => u.id === currentUserId);
        if (idx > 0) { const [me] = ordered.splice(idx, 1); ordered.unshift(me); }
      }

      let filtered = ordered;
      if (query.length > 0) {
        filtered = ordered.filter(user =>
          user.name.toLowerCase().includes(query) ||
          (user.email || '').toLowerCase().includes(query) ||
          (user.username || '').toLowerCase().includes(query)
        );
      } else {
        filtered = ordered.slice(0, 15);
      }

      if (filtered.length === 0) {
        showMessage(usersList.length === 0
          ? 'Could not load users. Check Salesforce credentials.'
          : 'No users match your search.');
        return;
      }

      const resultsList = document.createElement('div');
      filtered.forEach((user, index) => {
        const resultItem = document.createElement('div');
        resultItem.style.width = '100%';
        resultItem.style.padding = '16px 32px';
        resultItem.style.display = 'flex';
        resultItem.style.alignItems = 'center';
        resultItem.style.justifyContent = 'space-between';
        resultItem.style.gap = '16px';
        resultItem.style.transition = 'all 0.2s';
        resultItem.style.backgroundColor = index === 0 ? T.surface : 'transparent';
        resultItem.style.borderBottom = `1px solid ${T.divider}`;
        resultItem.style.fontFamily = 'inherit';
        resultItem.style.color = T.textPrimary;

        const contentContainer = document.createElement('div');
        contentContainer.style.flex = '1';
        contentContainer.style.minWidth = '0';

        const isCurrentUser = !!currentUserId && user.id === currentUserId;
        const name = document.createElement('div');
        name.style.fontWeight = '700';
        name.style.fontSize = '15px';
        name.style.color = T.textPrimary;
        name.style.marginBottom = '4px';
        name.style.display = 'flex';
        name.style.alignItems = 'center';
        name.style.gap = '8px';
        const nameText = document.createElement('span');
        nameText.textContent = user.name;
        name.appendChild(nameText);
        if (isCurrentUser) {
          const youBadge = document.createElement('span');
          youBadge.textContent = 'You';
          Object.assign(youBadge.style, {
            fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em',
            color: '#fff', background: '#2563eb', padding: '2px 7px', borderRadius: '999px',
          });
          name.appendChild(youBadge);
        }

        const email = document.createElement('div');
        email.style.fontSize = '12px';
        email.style.color = T.textSecondary;
        email.textContent = user.email || user.username;

        contentContainer.appendChild(name);
        contentContainer.appendChild(email);

        const buttonGroup = document.createElement('div');
        buttonGroup.style.display = 'flex';
        buttonGroup.style.gap = '8px';
        buttonGroup.style.flexShrink = '0';

        const loginBtn = document.createElement('button');
        loginBtn.textContent = 'Login';
        loginBtn.style.padding = '6px 12px';
        loginBtn.style.backgroundColor = 'rgba(59, 130, 246, 1)';
        loginBtn.style.color = 'white';
        loginBtn.style.border = 'none';
        loginBtn.style.borderRadius = '4px';
        loginBtn.style.cursor = 'pointer';
        loginBtn.style.fontSize = '12px';
        loginBtn.style.fontWeight = '600';
        loginBtn.style.transition = 'all 0.2s';
        loginBtn.style.whiteSpace = 'nowrap';
        loginBtn.addEventListener('mouseover', () => { loginBtn.style.backgroundColor = 'rgba(59, 130, 246, 0.8)'; });
        loginBtn.addEventListener('mouseout', () => { loginBtn.style.backgroundColor = 'rgba(59, 130, 246, 1)'; });

        const incognitoBtn = document.createElement('button');
        incognitoBtn.textContent = 'Incognito';
        incognitoBtn.style.padding = '6px 12px';
        incognitoBtn.style.backgroundColor = 'rgba(107, 114, 128, 1)';
        incognitoBtn.style.color = 'white';
        incognitoBtn.style.border = 'none';
        incognitoBtn.style.borderRadius = '4px';
        incognitoBtn.style.cursor = 'pointer';
        incognitoBtn.style.fontSize = '12px';
        incognitoBtn.style.fontWeight = '600';
        incognitoBtn.style.transition = 'all 0.2s';
        incognitoBtn.style.whiteSpace = 'nowrap';
        incognitoBtn.addEventListener('mouseover', () => { incognitoBtn.style.backgroundColor = 'rgba(107, 114, 128, 0.8)'; });
        incognitoBtn.addEventListener('mouseout', () => { incognitoBtn.style.backgroundColor = 'rgba(107, 114, 128, 1)'; });

        // Login button — direct, same browser tab
        loginBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const chromeRuntime = (globalThis as any).chrome?.runtime;
          if (!chromeRuntime) return;
          chromeRuntime.sendMessage(
            { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(window.location.hostname) },
            (response: any) => {
              if (response?.data?.instanceUrl && response?.data?.sessionId) {
                const { instanceUrl, sessionId } = response.data;
                const orgId = sessionId.split('!')[0];
                const retUrl = window.location.pathname || '/';
                const loginUrl = `${instanceUrl}/servlet/servlet.su`
                  + `?oid=${encodeURIComponent(orgId)}`
                  + `&suorgadminid=${encodeURIComponent(user.id)}`
                  + `&retURL=${encodeURIComponent(retUrl)}`
                  + `&targetURL=${encodeURIComponent(retUrl)}`;
                window.open(loginUrl, '_blank');
                hideSpotlightSearch();
              }
            }
          );
        });

        // Incognito button — frontdoor.jsp trick (no cookie needed)
        incognitoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const chromeRuntime = (globalThis as any).chrome?.runtime;
          if (!chromeRuntime) return;
          chromeRuntime.sendMessage(
            { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(window.location.hostname) },
            (response: any) => {
              if (response?.data?.instanceUrl && response?.data?.sessionId) {
                const { instanceUrl, sessionId } = response.data;
                const orgId = sessionId.split('!')[0];
                const retUrl = window.location.pathname || '/';
                const loginAsUrl = `${instanceUrl}/servlet/servlet.su`
                  + `?oid=${encodeURIComponent(orgId)}`
                  + `&suorgadminid=${encodeURIComponent(user.id)}`
                  + `&retURL=${encodeURIComponent(retUrl)}`
                  + `&targetURL=${encodeURIComponent(retUrl)}`;
                const frontdoorUrl = `${instanceUrl}/secur/frontdoor.jsp`
                  + `?sid=${encodeURIComponent(sessionId)}`
                  + `&retURL=${encodeURIComponent(loginAsUrl)}`;
                chromeRuntime.sendMessage({ type: 'OPEN_INCOGNITO_TAB', url: frontdoorUrl });
                hideSpotlightSearch();
              }
            }
          );
        });

        const arrowIcon = document.createElement('div');
        arrowIcon.style.flexShrink = '0';
        arrowIcon.style.color = 'rgba(255, 255, 255, 0.4)';
        arrowIcon.style.marginRight = '8px';
        arrowIcon.style.display = 'flex';
        arrowIcon.style.alignItems = 'center';
        arrowIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

        // "⋯" menu with extra per-user actions (debug mode, view fields, details).
        const moreBtn = document.createElement('button');
        moreBtn.title = 'More actions';
        moreBtn.textContent = '⋯';
        Object.assign(moreBtn.style, {
          padding: '6px 10px', backgroundColor: T.surface, color: T.textPrimary, border: 'none',
          borderRadius: '4px', cursor: 'pointer', fontSize: '16px', fontWeight: '700', lineHeight: '1',
          whiteSpace: 'nowrap', flexShrink: '0',
        });
        moreBtn.addEventListener('mouseover', () => { moreBtn.style.backgroundColor = T.surfaceHover; });
        moreBtn.addEventListener('mouseout', () => { moreBtn.style.backgroundColor = T.surface; });
        moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openUserMenu(moreBtn, user); });

        // Login / Incognito don't make sense for yourself — only show for others.
        if (!isCurrentUser) {
          buttonGroup.appendChild(loginBtn);
          buttonGroup.appendChild(incognitoBtn);
        }
        buttonGroup.appendChild(moreBtn);
        resultItem.appendChild(contentContainer);
        resultItem.appendChild(arrowIcon);
        resultItem.appendChild(buttonGroup);

        resultItem.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const chromeRuntime = (globalThis as any).chrome?.runtime;
          if (!chromeRuntime) return;
          chromeRuntime.sendMessage(
            { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(window.location.hostname) },
            (response: any) => {
              if (response?.data?.instanceUrl) {
                const { instanceUrl } = response.data;
                const userDetailUrl = `${instanceUrl}/lightning/setup/ManageUsers/page?address=%2F${user.id}%3Fnoredirect%3D1%26isUserEntityOverride%3D1`;
                recordRecent({ kind: 'user', icon: '👤', title: user.name, subtitle: user.email || user.username, meta: 'User', url: userDetailUrl });
                window.open(userDetailUrl, '_blank');
                hideSpotlightSearch();
              }
            }
          );
        });

        resultItem.style.cursor = 'pointer';
        resultItem.addEventListener('mouseover', () => {
          resultItem.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
          arrowIcon.style.color = 'rgba(255, 255, 255, 0.8)';
        });
        resultItem.addEventListener('mouseout', () => {
          resultItem.style.backgroundColor = 'transparent';
          arrowIcon.style.color = 'rgba(255, 255, 255, 0.4)';
        });

        resultsList.appendChild(resultItem);
      });
      resultsContainer.appendChild(resultsList);

    } else if (activeTab === 'security') {
      if (!cachedSecurity) cachedSecurity = await fetchSalesforceSecurity();
      const securityList = cachedSecurity || [];

      let filtered = securityList;
      if (query.length > 0) {
        filtered = securityList.filter(s =>
          (s.label || '').toLowerCase().includes(query) ||
          (s.name || '').toLowerCase().includes(query) ||
          (s.type || '').toLowerCase().includes(query)
        );
      }

      if (filtered.length === 0) {
        showMessage(securityList.length === 0
          ? 'Could not load security data. Check Salesforce credentials.'
          : 'No permission sets, groups, or profiles match your search.');
        return;
      }

      const iconFor = (t: string) =>
        t === 'Profile' ? '👤' : t === 'Permission Set Group' ? '🗂️' : '🔑';

      const resultsList = document.createElement('div');
      filtered.forEach((s, index) => {
        const origin = lightningOrigin();
        let path = `/lightning/setup/PermSets/page?address=%2F${s.id}`;
        if (s.type === 'Profile') path = `/lightning/setup/EnhancedProfiles/page?address=%2F${s.id}`;
        else if (s.type === 'Permission Set Group') path = `/lightning/setup/PermSetGroups/page?address=%2F${s.id}`;
        const entry = { kind: 'security', icon: iconFor(s.type), title: s.label || s.name, subtitle: (s.name && s.name !== s.label) ? s.name : undefined, meta: s.type, url: origin + path };
        resultsList.appendChild(makeResultRow({
          icon: iconFor(s.type),
          title: s.label || s.name,
          subtitle: (s.name && s.name !== s.label) ? s.name : undefined,
          meta: s.type,
          first: index === 0,
          fav: entry,
          onClick: () => {
            recordRecent(entry);
            window.open(origin + path, '_blank');
            hideSpotlightSearch();
          },
        }));
      });
      resultsContainer.appendChild(resultsList);

    } else if (activeTab === 'flows') {
      if (!cachedFlows) cachedFlows = await fetchSalesforceFlows();
      const flowsList = cachedFlows || [];

      let filtered = flowsList;
      if (query.length > 0) {
        filtered = flowsList.filter(flow =>
          (flow.label || '').toLowerCase().includes(query) ||
          (flow.apiName || '').toLowerCase().includes(query)
        );
      }

      if (filtered.length === 0) {
        showMessage(flowsList.length === 0
          ? 'Could not load flows. Check Salesforce credentials.'
          : 'No flows match your search.');
        return;
      }

      const resultsList = document.createElement('div');
      filtered.forEach((flow, index) => {
        const origin = lightningOrigin();
        const isManaged = !!flow.manageableState && flow.manageableState !== 'unmanaged';
        let flowId = '';
        if (isManaged && flow.apiName && flow.versionNumber) {
          const ns = flow.namespacePrefix;
          const fullApiName = (ns && !flow.apiName.startsWith(`${ns}__`)) ? `${ns}__${flow.apiName}` : flow.apiName;
          flowId = `${fullApiName}-${flow.versionNumber}`;
        } else if (flow.versionId) {
          flowId = flow.versionId;
        }
        const flowUrl = flowId
          ? `${origin}/builder_platform_interaction/flowBuilder.app?flowId=${flowId}`
          : `${origin}/lightning/setup/Flows/home`;
        const entry = { kind: 'flow', icon: '⚡', title: flow.label, subtitle: flow.apiName, meta: `${flow.processType || 'Flow'} · ${flow.isActive ? 'Active' : 'Inactive'}`, url: flowUrl };
        resultsList.appendChild(makeResultRow({
          icon: '⚡',
          title: flow.label,
          subtitle: flow.apiName,
          meta: `${flow.processType || 'Flow'} · ${flow.isActive ? 'Active' : 'Inactive'}`,
          first: index === 0,
          fav: entry,
          onClick: () => {
            recordRecent(entry);
            window.open(flowUrl, '_blank');
            hideSpotlightSearch();
          },
        }));
      });
      resultsContainer.appendChild(resultsList);

    } else if (activeTab === 'apps') {
      if (!cachedApps) cachedApps = await fetchSalesforceApps();
      const appsList = cachedApps || [];

      let filtered = appsList;
      if (query.length > 0) {
        filtered = appsList.filter(a =>
          (a.label || '').toLowerCase().includes(query) ||
          (a.name || '').toLowerCase().includes(query)
        );
      }

      if (filtered.length === 0) {
        showMessage(appsList.length === 0
          ? 'Could not load apps & tabs. Check Salesforce credentials.'
          : 'No apps or tabs match your search.');
        return;
      }

      // Apps resolve on the Setup domain; tabs on the Lightning domain.
      const buildAppUrl = (raw: string, isApp: boolean) => {
        if (/^https?:\/\//i.test(raw)) return raw;
        const origin = isApp ? setupOrigin() : lightningOrigin();
        return `${origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
      };

      const resultsList = document.createElement('div');
      filtered.forEach((a, index) => {
        const isApp = a.type === 'app';
        const url = buildAppUrl(a.url, isApp);
        const entry = { kind: 'app', icon: isApp ? '🚀' : '📑', title: a.label || a.name, subtitle: (a.name && a.name !== a.label) ? a.name : undefined, meta: isApp ? 'App' : 'Tab', url };
        resultsList.appendChild(makeResultRow({
          icon: isApp ? '🚀' : '📑',
          title: a.label || a.name,
          subtitle: (a.name && a.name !== a.label) ? a.name : undefined,
          meta: isApp ? 'App' : 'Tab',
          first: index === 0,
          fav: entry,
          onClick: () => {
            recordRecent(entry);
            window.open(url, '_blank');
            hideSpotlightSearch();
          },
        }));
      });
      resultsContainer.appendChild(resultsList);

    } else if (activeTab === 'tools') {
      const API_FIELDS = [
        { key: 'DailyApiRequests', label: 'REST / SOAP API requests (daily)' },
        { key: 'DailyBulkApiBatches', label: 'Bulk API batches (daily)' },
        { key: 'DailyBulkV2QueryJobs', label: 'Bulk API v2 query jobs (daily)' },
        { key: 'DailyStreamingApiEvents', label: 'Streaming API events (daily)' },
        { key: 'DailyAsyncApexExecutions', label: 'Async Apex executions (daily)' },
        { key: 'HourlyTimeBasedWorkflow', label: 'Time-based workflow (hourly)' },
      ];
      const STORAGE_FIELDS = [
        { key: 'DataStorageMB', label: 'Data storage', storage: true },
        { key: 'FileStorageMB', label: 'File storage', storage: true },
      ];

      // A tool's detail view is shown in-panel (with a "Tools" back button).
      // Typing a query exits back to the grid.
      if (query.length > 0) toolView = null;
      if (toolView) {
        const isDark = currentSpotlightTheme === 'dark';
        const onBack = () => { toolView = null; performSearch(); };
        if (toolView === 'orgdetails') { renderOrgDetailsInto(resultsContainer, isDark, onBack); return; }
        if (toolView === 'release') { renderReleaseInfoInto(resultsContainer, isDark, onBack); return; }
        if (toolView === 'apiusage') { renderOrgLimitsInto(resultsContainer, isDark, onBack, { title: '📊  API Usage', fields: API_FIELDS }); return; }
        if (toolView === 'storage') { renderOrgLimitsInto(resultsContainer, isDark, onBack, { title: '💾  Storage Insights', fields: STORAGE_FIELDS }); return; }
        toolView = null;
      }

      // App-drawer style grid of quick org actions. Items are either one-shot
      // actions (run) or persisted on/off toggles (toggleKey).
      type ToolItem = { id: string; icon: string; label: string; desc: string; run?: () => void; toggleKey?: keyof ToolsState };
      const tools: ToolItem[] = [
        {
          id: 'speedtest', icon: '🏎️', label: 'Org Speed Test', desc: 'Run Salesforce speed test',
          run: () => {
            const url = `${lightningOrigin()}/speedtest.jsp`;
            recordRecent({ kind: 'tool', icon: '🏎️', title: 'Org Speed Test', subtitle: 'speedtest.jsp', meta: 'Tool', url });
            window.open(url, '_blank');
            hideSpotlightSearch();
          },
        },
        {
          id: 'classic', icon: '🕹️', label: 'Switch to Classic', desc: 'Open Salesforce Classic',
          run: () => {
            const url = `${lightningOrigin()}/ltng/switcher?destination=classic`;
            window.open(url, '_blank');
            hideSpotlightSearch();
          },
        },
        {
          id: 'orgdetails', icon: '🏢', label: 'Org Details', desc: 'View this org’s info',
          run: () => { searchInput.value = ''; toolView = 'orgdetails'; performSearch(); },
        },
        {
          id: 'release', icon: '🚀', label: 'Salesforce Release', desc: 'Current release & updates',
          run: () => { searchInput.value = ''; toolView = 'release'; performSearch(); },
        },
        {
          id: 'apiusage', icon: '📊', label: 'API Usage', desc: 'Daily API limits',
          run: () => { searchInput.value = ''; toolView = 'apiusage'; performSearch(); },
        },
        {
          id: 'storage', icon: '💾', label: 'Storage Insights', desc: 'Data & file storage',
          run: () => { searchInput.value = ''; toolView = 'storage'; performSearch(); },
        },
        {
          id: 'ghost', icon: '👻', label: 'Ghost Session', desc: 'Open your session in Incognito',
          run: () => {
            getSfCredentials().then((creds: any) => {
              if (!creds?.instanceUrl || !creds?.sessionId) { flashToast('Salesforce session not detected'); return; }
              const retUrl = window.location.pathname || '/';
              const frontdoorUrl = `${creds.instanceUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(creds.sessionId)}&retURL=${encodeURIComponent(retUrl)}`;
              (globalThis as any).chrome.runtime.sendMessage({ type: 'OPEN_INCOGNITO_TAB', url: frontdoorUrl });
              hideSpotlightSearch();
            });
          },
        },
        { id: 'fieldapi', icon: '🏷️', label: 'Show Field API Names', desc: 'On record pages', toggleKey: 'showFieldApi' },
        { id: 'devbar', icon: '🛑', label: 'Hide App Dev Bar', desc: 'Hide the dev toolbar', toggleKey: 'hideDevBar' },
        { id: 'loginad', icon: '🙈', label: 'Hide Login Page Ad', desc: 'Cleaner login page', toggleKey: 'hideLoginAd' },
        {
          id: 'whatsnew', icon: '✨', label: "What's New", desc: 'See the latest features',
          run: () => {
            const version = (globalThis as any).chrome?.runtime?.getManifest?.().version || '';
            hideSpotlightSearch();
            showWhatsNew(version);
          },
        },
      ];

      const filtered = query.length > 0
        ? tools.filter(t => t.label.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query))
        : tools;

      if (filtered.length === 0) { showMessage('No tools match your search.'); return; }

      const strongBorder = currentSpotlightTheme === 'dark' ? 'rgba(148,163,184,0.35)' : 'rgba(31,41,55,0.18)';

      const grid = document.createElement('div');
      Object.assign(grid.style, {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: '12px', padding: '20px 28px 24px',
      });

      filtered.forEach((t) => {
        const isToggle = !!t.toggleKey;
        const isOn = isToggle && toolsState[t.toggleKey as keyof ToolsState];

        const tile = document.createElement('button');
        const baseBg = isOn ? 'rgba(37,99,235,0.12)' : T.surface;
        const baseBorder = isOn ? `2px solid ${T.accent}` : `1.5px solid ${strongBorder}`;
        Object.assign(tile.style, {
          position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '8px', padding: '20px 12px', borderRadius: '16px', border: baseBorder,
          background: baseBg, cursor: 'pointer', fontFamily: 'inherit', color: T.textPrimary,
          transition: 'all 0.15s', textAlign: 'center',
        });

        // Toggle status dot (filled when on).
        if (isToggle) {
          const dot = document.createElement('span');
          Object.assign(dot.style, {
            position: 'absolute', top: '10px', right: '10px', width: '12px', height: '12px', borderRadius: '50%',
            background: isOn ? T.accent : 'transparent', border: `2px solid ${isOn ? T.accent : strongBorder}`,
          });
          tile.appendChild(dot);
        }

        const ic = document.createElement('div');
        ic.textContent = t.icon;
        Object.assign(ic.style, { fontSize: '32px', lineHeight: '1' });
        const lb = document.createElement('div');
        lb.textContent = t.label;
        Object.assign(lb.style, { fontSize: '13px', fontWeight: '700' });
        const ds = document.createElement('div');
        ds.textContent = isToggle ? (isOn ? 'On' : t.desc) : t.desc;
        Object.assign(ds.style, { fontSize: '11px', color: isOn ? T.accent : T.textMuted, fontWeight: isOn ? '700' : '400' });
        tile.appendChild(ic); tile.appendChild(lb); tile.appendChild(ds);

        tile.addEventListener('mouseover', () => { tile.style.transform = 'translateY(-2px)'; if (!isOn) tile.style.background = T.surfaceHover; });
        tile.addEventListener('mouseout', () => { tile.style.transform = 'none'; tile.style.background = baseBg; });
        tile.addEventListener('click', () => {
          if (isToggle) {
            const key = t.toggleKey as keyof ToolsState;
            toolsState[key] = !toolsState[key];
            saveToolsState();
            applyToolToggle(key);
            flashToast(`${t.label}: ${toolsState[key] ? 'On' : 'Off'}`);
            performSearch();
          } else {
            t.run?.();
          }
        });
        grid.appendChild(tile);
      });
      resultsContainer.appendChild(grid);
    }
  };

  // ─── Tab bar (dynamic) ─────────────────────────────────────
  const makeTabButton = (text: string, icon?: string) => {
    const b = document.createElement('button');
    if (icon) {
      b.innerHTML = `<span style="margin-right:6px;font-size:14px">${icon}</span><span>${text}</span>`;
    } else {
      b.textContent = text;
    }
    b.style.display = 'inline-flex';
    b.style.alignItems = 'center';
    b.style.color = T.tabInactive;
    b.style.borderBottom = '3px solid transparent';
    b.style.padding = '12px 0';
    b.style.fontWeight = '600';
    b.style.fontSize = '14px';
    b.style.backgroundColor = 'transparent';
    b.style.border = 'none';
    b.style.cursor = 'pointer';
    b.style.outline = 'none';
    b.style.transition = 'all 0.2s';
    b.style.fontFamily = 'inherit';
    return b;
  };

  const styleTabButton = (b: HTMLButtonElement, active: boolean) => {
    b.style.color = active ? T.textPrimary : T.tabInactive;
    b.style.borderBottom = active ? `3px solid ${T.accent}` : '3px solid transparent';
  };

  const tabButtons: Record<string, HTMLButtonElement> = {};

  let selectedIndex = -1;

  const activateTab = async (id: string) => {
    activeTab = id;
    selectedIndex = -1;
    toolView = null;
    Object.keys(tabButtons).forEach(tid => styleTabButton(tabButtons[tid], tid === id));

    if (id === '__settings') {
      inputContainer.style.display = 'none';
      hintsBar.style.display = 'none';
      renderSettingsPanel();
      return;
    }

    inputContainer.style.display = 'flex';
    hintsBar.style.display = 'flex';
    const def = ALL_SPOTLIGHT_TABS.find(t => t.id === id);
    searchInput.placeholder = def?.placeholder || 'Search...';
    searchInput.value = '';

    const needFetch =
      (id === 'users' && !cachedUsers) ||
      (id === 'flows' && !cachedFlows) ||
      (id === 'objects' && !cachedObjects) ||
      (id === 'security' && !cachedSecurity) ||
      (id === 'apps' && !cachedApps);
    if (needFetch) showMessage('Loading…');

    await performSearch();
    searchInput.focus();
  };

  // Dropdown listing the overflow tabs that didn't fit in the bar.
  const openTabOverflowMenu = (anchor: HTMLElement, ids: string[]) => {
    document.getElementById('sf-tab-overflow-menu')?.remove();
    const isDark = currentSpotlightTheme === 'dark';
    const menuBg = isDark ? '#1e293b' : '#ffffff';
    const menuBorder = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(31,41,55,0.15)';
    const menuText = isDark ? '#f1f5f9' : '#1f2937';
    const menuHover = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';

    const menu = document.createElement('div');
    menu.id = 'sf-tab-overflow-menu';
    Object.assign(menu.style, {
      position: 'fixed', minWidth: '180px', background: menuBg, color: menuText,
      border: `1px solid ${menuBorder}`, borderRadius: '12px', boxShadow: '0 18px 45px rgba(0,0,0,0.35)',
      padding: '6px', zIndex: '2147483649', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px',
    });

    const close = () => {
      menu.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onOut, true);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const onOut = (e: MouseEvent) => { if (!menu.contains(e.target as Node) && e.target !== anchor) close(); };

    ids.forEach((id) => {
      const def = ALL_SPOTLIGHT_TABS.find(t => t.id === id);
      if (!def) return;
      const row = document.createElement('button');
      Object.assign(row.style, {
        display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none',
        borderRadius: '8px', cursor: 'pointer', color: menuText, fontFamily: 'inherit', fontSize: '13px',
        fontWeight: activeTab === id ? '800' : '600', textAlign: 'left',
      });
      row.innerHTML = `<span style="margin-right:8px">${def.icon}</span><span>${def.label}</span>`;
      row.addEventListener('mouseover', () => { row.style.background = menuHover; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', async (e) => { e.stopPropagation(); close(); await activateTab(id); renderTabBar(); });
      menu.appendChild(row);
    });

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const mh = menu.offsetHeight;
    let top = rect.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, rect.left)}px`;
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('click', onOut, true);
    }, 0);
  };

  // Show at most this many tabs in the bar; the rest go under "More ▾".
  const MAX_VISIBLE_TABS = 6;

  const renderTabBar = () => {
    tabsContainer.innerHTML = '';
    Object.keys(tabButtons).forEach(k => delete tabButtons[k]);

    const visibleIds = tabConfig.order.filter(id => !tabConfig.hidden.includes(id) && ALL_SPOTLIGHT_TABS.some(t => t.id === id));

    let primary = visibleIds;
    let overflow: string[] = [];
    if (visibleIds.length > MAX_VISIBLE_TABS) {
      primary = visibleIds.slice(0, MAX_VISIBLE_TABS);
      overflow = visibleIds.slice(MAX_VISIBLE_TABS);
      // Ensure the active tab is always visible — swap it into the last slot.
      if (activeTab && overflow.includes(activeTab)) {
        const lastPrimary = primary[primary.length - 1];
        primary[primary.length - 1] = activeTab;
        overflow = overflow.filter(id => id !== activeTab);
        overflow.unshift(lastPrimary);
      }
    }

    primary.forEach(id => {
      const def = ALL_SPOTLIGHT_TABS.find(t => t.id === id);
      if (!def) return;
      const b = makeTabButton(def.label, def.icon);
      b.style.whiteSpace = 'nowrap';
      styleTabButton(b, activeTab === id);
      b.addEventListener('click', () => activateTab(id));
      tabButtons[id] = b;
      tabsContainer.appendChild(b);
    });

    if (overflow.length > 0) {
      const moreBtn = makeTabButton('More ▾');
      moreBtn.style.whiteSpace = 'nowrap';
      styleTabButton(moreBtn, false);
      moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openTabOverflowMenu(moreBtn, overflow); });
      tabButtons['__more'] = moreBtn;
      tabsContainer.appendChild(moreBtn);
    }

    const gear = makeTabButton('⚙');
    gear.style.fontSize = '18px';
    gear.style.marginLeft = 'auto';
    gear.title = 'Settings';
    styleTabButton(gear, activeTab === '__settings');
    gear.addEventListener('click', () => activateTab('__settings'));
    tabButtons['__settings'] = gear;
    tabsContainer.appendChild(gear);
  };

  // ─── Settings panel (reorder / default / hide) ─────────────
  const renderSettingsPanel = () => {
    resultsContainer.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.padding = '20px 28px';

    const heading = document.createElement('div');
    heading.textContent = 'Customize tabs';
    heading.style.fontSize = '16px';
    heading.style.fontWeight = '700';
    heading.style.color = T.textPrimary;
    heading.style.marginBottom = '4px';
    wrap.appendChild(heading);

    const sub = document.createElement('div');
    sub.textContent = 'Drag to reorder · pick a default · show or hide';
    sub.style.fontSize = '13px';
    sub.style.color = T.textMuted;
    sub.style.marginBottom = '16px';
    wrap.appendChild(sub);

    let dragSrcId: string | null = null;

    tabConfig.order.forEach(id => {
      const def = ALL_SPOTLIGHT_TABS.find(t => t.id === id);
      if (!def) return;
      const isHidden = tabConfig.hidden.includes(id);
      const isDefault = tabConfig.defaultTab === id;

      const row = document.createElement('div');
      row.draggable = true;
      row.dataset.tabId = id;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '12px';
      row.style.padding = '12px 14px';
      row.style.marginBottom = '8px';
      row.style.borderRadius = '12px';
      row.style.border = `1px solid ${T.chipBorder}`;
      row.style.backgroundColor = isHidden ? T.chipBgHidden : T.chipBg;
      row.style.cursor = 'grab';
      row.style.transition = 'border-color 0.15s';
      row.style.opacity = isHidden ? '0.55' : '1';

      const handle = document.createElement('span');
      handle.textContent = '⠿';
      handle.style.fontSize = '18px';
      handle.style.color = T.textFaint;
      handle.style.cursor = 'grab';
      row.appendChild(handle);

      const label = document.createElement('span');
      label.textContent = def.label;
      label.style.flex = '1';
      label.style.fontSize = '15px';
      label.style.fontWeight = '600';
      label.style.color = T.textPrimary;
      row.appendChild(label);

      const defBtn = document.createElement('button');
      defBtn.textContent = isDefault ? '★ Default' : 'Set default';
      defBtn.style.fontSize = '12px';
      defBtn.style.fontWeight = '600';
      defBtn.style.padding = '5px 10px';
      defBtn.style.borderRadius = '6px';
      defBtn.style.border = 'none';
      defBtn.style.cursor = isHidden ? 'not-allowed' : 'pointer';
      defBtn.style.fontFamily = 'inherit';
      defBtn.style.backgroundColor = isDefault ? 'rgba(59, 130, 246, 1)' : T.btnNeutralBg;
      defBtn.style.color = isDefault ? '#fff' : T.textSecondary;
      defBtn.style.opacity = isHidden ? '0.4' : '1';
      defBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isHidden) return;
        tabConfig.defaultTab = id;
        saveTabConfig(tabConfig);
        renderSettingsPanel();
      });
      row.appendChild(defBtn);

      const hideBtn = document.createElement('button');
      hideBtn.textContent = isHidden ? 'Show' : 'Hide';
      hideBtn.style.fontSize = '12px';
      hideBtn.style.fontWeight = '600';
      hideBtn.style.padding = '5px 10px';
      hideBtn.style.borderRadius = '6px';
      hideBtn.style.border = 'none';
      hideBtn.style.cursor = 'pointer';
      hideBtn.style.fontFamily = 'inherit';
      hideBtn.style.backgroundColor = T.btnNeutralBg;
      hideBtn.style.color = T.textSecondary;
      hideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isHidden) {
          tabConfig.hidden = tabConfig.hidden.filter(h => h !== id);
        } else {
          const visibleCount = tabConfig.order.filter(o => !tabConfig.hidden.includes(o)).length;
          if (visibleCount <= 1) return; // keep at least one visible tab
          tabConfig.hidden = [...tabConfig.hidden, id];
          if (tabConfig.defaultTab === id) {
            tabConfig.defaultTab = tabConfig.order.find(o => !tabConfig.hidden.includes(o)) || 'setup';
          }
        }
        saveTabConfig(tabConfig);
        renderSettingsPanel();
        renderTabBar();
      });
      row.appendChild(hideBtn);

      row.addEventListener('dragstart', (e) => {
        dragSrcId = id;
        row.style.opacity = '0.4';
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.style.opacity = isHidden ? '0.55' : '1';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        row.style.borderColor = 'rgba(59, 130, 246, 0.8)';
      });
      row.addEventListener('dragleave', () => {
        row.style.borderColor = T.chipBorder;
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.style.borderColor = T.chipBorder;
        if (!dragSrcId || dragSrcId === id) return;
        const order = [...tabConfig.order];
        const from = order.indexOf(dragSrcId);
        const to = order.indexOf(id);
        if (from < 0 || to < 0) return;
        order.splice(from, 1);
        order.splice(to, 0, dragSrcId);
        tabConfig.order = order;
        saveTabConfig(tabConfig);
        renderSettingsPanel();
        renderTabBar();
      });

      wrap.appendChild(row);
    });

    const reset = document.createElement('button');
    reset.textContent = 'Reset to defaults';
    reset.style.marginTop = '8px';
    reset.style.fontSize = '13px';
    reset.style.fontWeight = '600';
    reset.style.padding = '8px 14px';
    reset.style.borderRadius = '8px';
    reset.style.border = `1px solid ${T.chipBorder}`;
    reset.style.backgroundColor = 'transparent';
    reset.style.color = T.textSecondary;
    reset.style.cursor = 'pointer';
    reset.style.fontFamily = 'inherit';
    reset.addEventListener('click', () => {
      const d = defaultTabConfig();
      tabConfig.order = d.order;
      tabConfig.hidden = d.hidden;
      tabConfig.defaultTab = d.defaultTab;
      saveTabConfig(tabConfig);
      renderSettingsPanel();
      renderTabBar();
    });
    wrap.appendChild(reset);

    resultsContainer.appendChild(wrap);
  };

  // ─── Input + keyboard wiring ───────────────────────────────
  searchInput.addEventListener('input', async () => {
    await performSearch();
  });

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    const buttons = resultsContainer.querySelectorAll('button, div[style*="cursor: pointer"]');

    if (e.key === 'Escape') {
      e.preventDefault();
      hideSpotlightSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, buttons.length - 1);
      updateSelection(buttons, selectedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      updateSelection(buttons, selectedIndex);
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < buttons.length) {
      e.preventDefault();
      (buttons[selectedIndex] as HTMLButtonElement).click();
    }
  });

  function updateSelection(buttons: NodeListOf<Element>, index: number) {
    buttons.forEach((btn, btnIndex) => {
      (btn as HTMLElement).style.backgroundColor =
        btnIndex === index ? 'rgba(255, 255, 255, 0.2)' : 'transparent';
    });

    if (index >= 0 && index < buttons.length) {
      const selectedButton = buttons[index] as HTMLElement;
      const containerRect = resultsContainer.getBoundingClientRect();
      const buttonRect = selectedButton.getBoundingClientRect();
      const isAbove = buttonRect.top < containerRect.top;
      const isBelow = buttonRect.bottom > containerRect.bottom;
      if (isAbove || isBelow) {
        resultsContainer.scrollTo({
          top: selectedButton.offsetTop - resultsContainer.clientHeight / 2 + selectedButton.clientHeight / 2,
          behavior: 'smooth',
        });
      }
    }
  }

  // ─── Show ──────────────────────────────────────────────────
  renderTabBar();
  spotlightContainer.style.display = 'flex';
  spotlightContainer.style.pointerEvents = 'auto';
  modalContent.style.pointerEvents = 'auto';
  activateTab(tabConfig.defaultTab);
  searchInput.focus();
}

function hideSpotlightSearch() {
  const spotlightContainer = document.getElementById('sf-log-analyzer-spotlight-container');
  const modalContent = document.getElementById('sf-log-analyzer-modal-content');
  if (spotlightContainer) {
    spotlightContainer.style.display = 'none';
    spotlightContainer.style.pointerEvents = 'none';
  }
  if (modalContent) {
    modalContent.style.pointerEvents = 'none';
  }
}

// ─── Sidebar Injection ───────────────────────────────────────────────────────

function injectSidebar() {
  if (!isSalesforcePage()) {
    //console.log('[SF Log Analyzer] Not a Salesforce page, skipping injection');
    return;
  }

  if (document.getElementById('sf-log-analyzer-iframe')) {
    //console.log('[SF Log Analyzer] Already injected, skipping');
    return;
  }

  //console.log('[SF Log Analyzer] Injecting sidebar on Salesforce page');

  loadSettings((settings) => {
    let isPanelOpen = false;

    const iframe = document.createElement('iframe');
    iframe.id = 'sf-log-analyzer-iframe';
    iframe.style.position = 'fixed';
    iframe.style.zIndex = '2147483647';
    iframe.style.border = 'none';
    iframe.style.width = '32px';
    iframe.style.background = 'transparent';

    const chromeRuntime = (globalThis as any).chrome?.runtime;
    if (!chromeRuntime) return;

    const cleanDomain = (domain: string): string => {
      return domain
        .replace(/\.lightning\.force\./, '.my.salesforce.')
        .replace(/\.mcas\.ms$/, '');
    };

    const parentHostname = cleanDomain(window.location.hostname);
    iframe.src = chromeRuntime.getURL('index.html') + '#hostname=' + encodeURIComponent(parentHostname);
    document.body.appendChild(iframe);

    const backdrop = document.createElement('div');
    backdrop.id = 'sf-log-analyzer-backdrop';
    backdrop.style.position = 'fixed';
    backdrop.style.top = '0';
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
    backdrop.style.zIndex = '2147483646';
    backdrop.style.display = 'none';
    backdrop.style.cursor = 'pointer';
    document.body.appendChild(backdrop);

    applySettingsToIframe(iframe, backdrop, settings, false);

    // One-time "What's New" card — shown when the user opens the extension
    // (not on page load), once per version update.
    const maybeShowWhatsNew = () => {
      try {
        const manifestVersion = chromeRuntime.getManifest?.().version || '';
        const storage = (globalThis as any).chrome?.storage?.local;
        if (!manifestVersion || !storage) return;
        storage.get([WHATS_NEW_VERSION_KEY], (res: any) => {
          if (res?.[WHATS_NEW_VERSION_KEY] !== manifestVersion) {
            setTimeout(() => showWhatsNew(manifestVersion), 600);
          }
        });
      } catch { /* ignore */ }
    };

    const openPanel = () => {
      isPanelOpen = true;
      iframe.contentWindow?.postMessage({ type: 'OPEN_PANEL' }, '*');
      applySettingsToIframe(iframe, backdrop, settings, true);
      maybeShowWhatsNew();
    };

    const closePanel = () => {
      isPanelOpen = false;
      iframe.contentWindow?.postMessage({ type: 'CLOSE_PANEL' }, '*');
      applySettingsToIframe(iframe, backdrop, settings, false);
    };

    backdrop.addEventListener('click', () => closePanel());

    // Clicking the toolbar icon (handled in background) opens Spotlight.
    if (chromeRuntime.onMessage) {
      chromeRuntime.onMessage.addListener((msg: any) => {
        if (msg?.type === 'SF_TOOLBAR_OPEN' && window.top === window) {
          showSpotlightSearch();
          maybeShowWhatsNew();
        }
      });
    }

    // ✅ FIX: Listen for postMessage from iframe (handles Mac where iframe keeps focus)
    window.addEventListener('message', (event) => {
      if (event.data.type === 'SF_LOG_ANALYZER_TOGGLE') {
        isPanelOpen = event.data.isOpen;
        applySettingsToIframe(iframe, backdrop, settings, event.data.isOpen);
      } else if (event.data.type === 'SF_LOG_ANALYZER_SETTINGS_CHANGED') {
        Object.assign(settings, event.data.settings);
        currentSpotlightTheme = settings.spotlightTheme;
        applySettingsToIframe(iframe, backdrop, settings, isPanelOpen);
      } else if (event.data.type === 'SF_SPOTLIGHT_SHORTCUT') {
        // ✅ Triggered from inside the iframe (Mac fix)
        showSpotlightSearch();
      } else if (event.data.type === 'SF_OPEN_PANEL') {
        // ✅ Triggered from inside the iframe (Mac fix)
        openPanel();
      }
    });

    // Keyboard shortcuts on the main document (works when focus is NOT in iframe)
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Alt+D to open panel
      if (event.ctrlKey && event.altKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
        return false;
      }

      // Alt+S / Option+S to open panel
      if (event.altKey && event.code === 'KeyS') {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
        return false;
      }

      // Alt+D / Option+D to open the Record Detail viewer for the current record.
      // Guard against Ctrl+Alt+D (which opens the panel). event.code avoids Mac char remap.
      if (event.altKey && !event.ctrlKey && event.code === 'KeyD') {
        event.preventDefault();
        event.stopPropagation();
        const id = extractRecordIdFromUrl();
        if (id) {
          showRecordDetail(id);
        } else {
          flashToast('No record detected on this page');
        }
        return false;
      }

      // ✅ Alt+T / Option+T to open spotlight — use event.code to avoid Mac special chars (†)
      if (event.altKey && event.code === 'KeyT') {
        event.preventDefault();
        event.stopPropagation();
        //console.log('[SF Log Analyzer] Alt/Option+T pressed on main page');
        showSpotlightSearch();
        return false;
      }

      // Escape to close panel
      if (event.key === 'Escape' && isPanelOpen) {
        event.preventDefault();
        closePanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    //console.log('[SF Log Analyzer] Keyboard shortcut listener attached to document');
  });
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSidebar);
} else {
  injectSidebar();
}
