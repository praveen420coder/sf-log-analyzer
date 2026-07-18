// Content script - injects iframe to load the React app
import { setupLinks } from './links';
import { renderLogAnalyzerInto } from './log-analyzer/logAnalyzerView';
import { METADATA_CATALOG } from './spotlight/metadataCatalog';
import type { MetaType } from './spotlight/metadataCatalog';
import { initObjectExplorer } from './features/objectExplorer';
import { COMMON_PREFIXES, isValidSalesforceId } from './lib/salesforceId';
import { createIdLink } from './lib/idMenu';
import { loadRecentsAndFavorites, getRecents, getFavorites, recordRecent, clearRecents, isFavorite, toggleFavorite } from './state/recents';
import type { RecentItem } from './state/recents';
import { STORAGE_KEY, loadSettings, persistSettings, saveSpotlightTheme } from './state/settings';
import type { ExtensionSettings } from './state/settings';
import { SPOTLIGHT_PAGE, sfHostname, cleanSfDomain, lightningOrigin, setupOrigin, getSfCredentials, activeSfHost } from './lib/sfUrls';
import { toolsState, loadToolsState, saveToolsState, applyToolToggle, applyShowFieldApi, applyAllToolToggles } from './state/toolsState';
import type { ToolsState } from './state/toolsState';
import { showWhatsNew, WHATS_NEW_VERSION_KEY } from './features/whatsNew';
import { renderPermissionCompareInto } from './features/permissionCompare';
import { renderApexTestsInto } from './features/apexTestRunner';
import { renderAccessExplorerInto } from './features/accessExplorer';
import { renderDataImportInto } from './features/dataImport';

import { renderOrgLimitsExplorerInto } from './features/orgLimits';
import { renderObjectManagerInto } from './features/objectManager';
import type { SfObjectRef, FlsTarget } from './features/objectManager';
import { renderAutomationMapInto } from './features/automationMap';
import type { AutomationData } from './features/automationMap';
import { renderExecuteAnonymousInto } from './features/executeAnonymous';
import { renderSampleDataInto } from './features/sampleDataGenerator';
import { ensureMagicStyles } from './features/magicFill';

import { enterInspectMode, isInspecting, exitInspectMode } from './features/componentInspector';

import { loadCustomShortcuts, getCustomShortcuts } from './state/customShortcuts';
import { renderCustomShortcutsInto, resolveShortcutUrl } from './features/customShortcuts';

import { loadVisitedOrgs, recordVisitedOrg } from './state/sessions';
import { renderSessionSwitcherInto } from './features/sessionSwitcher';
import { renderApiConsoleInto, type ApiConsoleHandle } from './features/apiConsole';
import type { BundleInfo } from './features/componentInspector/detect';
import type { LwcFile } from './features/componentInspector/viewer';

// Settings shape, defaults and persistence live in ./state/settings.

// Tracks the spotlight theme so buildSpotlight() (module-level) can read it.
let currentSpotlightTheme: 'light' | 'dark' = 'light';

// Live API-activity console handle; destroyed and rebuilt with the spotlight so
// its background port doesn't leak across reopens.
let apiConsoleHandle: ApiConsoleHandle | null = null;
// Whether the Object Explorer icon is shown in the Salesforce global header.
let objectExplorerEnabled = true;
// When a theme toggle rebuilds the modal, reopen the Settings panel afterwards.
let reopenSettingsAfterBuild = false;

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
  { id: 'users', label: 'Users', placeholder: 'Search Users...', icon: '👤' },
  { id: 'flows', label: 'Flows', placeholder: 'Search Flows...', icon: '⚡' },
  { id: 'metadata', label: 'Metadata Explorer', placeholder: 'Search metadata types...', icon: '🧩' },
  { id: 'security', label: 'Security', placeholder: 'Search Permission Sets, Groups & Profiles...', icon: '🔑' },
  { id: 'debug', label: 'Log Explorer', placeholder: 'Search your debug logs...', icon: '🐞' },
  { id: 'objects', label: 'Objects', placeholder: 'Search Objects...', icon: '📦' },
  { id: 'apextests', label: 'Apex Tests', placeholder: 'Search tests...', icon: '🧪' },
  { id: 'access', label: 'Access Explorer', placeholder: 'Access map...', icon: '🗺️' },
  { id: 'recent', label: 'Recent', placeholder: 'Search recently opened...', icon: '🕘' },
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

// ─── Tools grid order (user-draggable) ─────────────────────────
// Persisted list of tool ids in the order the user arranged them. Unknown /
// newly-introduced ids are reconciled at render time, so this only needs to
// store the ids we have seen.
const TOOLS_ORDER_KEY = 'sf_spotlight_tools_order';
let currentToolsOrder: string[] = [];

function loadToolsOrder(): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.get([TOOLS_ORDER_KEY], (res: any) => {
      currentToolsOrder = Array.isArray(res?.[TOOLS_ORDER_KEY]) ? res[TOOLS_ORDER_KEY] : [];
    });
  } else {
    try { const v = JSON.parse(localStorage.getItem(TOOLS_ORDER_KEY) || 'null'); currentToolsOrder = Array.isArray(v) ? v : []; }
    catch { currentToolsOrder = []; }
  }
}

function saveToolsOrder(order: string[]): void {
  currentToolsOrder = order;
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.set({ [TOOLS_ORDER_KEY]: order });
  } else {
    try { localStorage.setItem(TOOLS_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
  }
}

loadToolsOrder();

// Load the saved spotlight theme so the modal renders with the right appearance.
loadSettings((s) => { currentSpotlightTheme = s.spotlightTheme; objectExplorerEnabled = s.showObjectExplorer !== false; });
// Keep the global-header toggle in sync when changed from another tab/the settings page.
try {
  (globalThis as any).chrome?.storage?.onChanged?.addListener((changes: any, area: string) => {
    if (area === 'local' && changes[STORAGE_KEY]?.newValue) {
      const v = changes[STORAGE_KEY].newValue;
      objectExplorerEnabled = v.showObjectExplorer !== false;
    }
  });
} catch { /* ignore */ }

// Recent items + Pinned favorites persistence lives in ./state/recents.
loadRecentsAndFavorites();

// User-defined Setup shortcuts (shown in Setup search). Lives in ./state/customShortcuts.
loadCustomShortcuts();

// Visited orgs for the footer session switcher. Lives in ./state/sessions.
loadVisitedOrgs();

// ─── Tools: persisted toggles & page tweaks ──────────────────────────────────
// Tools state + page tweaks live in ./state/toolsState.
loadToolsState(() => applyAllToolToggles());

// Module-level caches persist across spotlight re-opens.
let cachedUsers: any[] | null = null;
let cachedFlows: any[] | null = null;
let cachedObjects: any[] | null = null;
let cachedSecurity: any[] | null = null;
let cachedDebugLogs: any[] | null = null;
let currentUserId: string | null = null;

// ─── Metadata Explorer catalog ───────────────────────────────────────────────
// Each entry: a metadata type, its query (tooling or data API) and table columns.
// Metadata Explorer catalog (types, queries, columns) lives in ./spotlight/metadataCatalog.
let cachedApps: any[] | null = null;

// SF host / origin helpers + getSfCredentials live in ./lib/sfUrls.
// When opened as spotlight.html?...&analyzeLog=<logId>, jump straight into the
// Log Explorer and open the analyzer for that log.
let pageAnalyzeLog: string | null = null;
if (SPOTLIGHT_PAGE) {
  try { pageAnalyzeLog = new URLSearchParams(location.search).get('analyzeLog'); } catch { pageAnalyzeLog = null; }
}

// ─── Record ID detection & Record Detail viewer ──────────────────────────────

// Record-Id helpers (checksum, validation, key-prefix labels) live in ./lib/salesforceId.

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

  // Toggle the field API-name chips on the live record page from here.
  const apiBtn = document.createElement('button');
  Object.assign(apiBtn.style, {
    fontSize: '12px', fontWeight: '700', padding: '8px 12px', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: '0', whiteSpace: 'nowrap',
  });
  apiBtn.title = 'Show field API names on the record page';
  const paintApiBtn = () => {
    const on = toolsState.showFieldApi;
    apiBtn.textContent = 'Show API Name';
    apiBtn.style.background = on ? 'rgba(37,99,235,0.12)' : 'transparent';
    apiBtn.style.color = on ? C.accent : C.textPrimary;
    apiBtn.style.border = `1.5px solid ${on ? C.accent : C.border}`;
  };
  apiBtn.addEventListener('click', () => {
    toolsState.showFieldApi = !toolsState.showFieldApi;
    saveToolsState();
    applyShowFieldApi(toolsState.showFieldApi);
    paintApiBtn();
    flashToast(`Field API names: ${toolsState.showFieldApi ? 'On' : 'Off'}`);
  });
  paintApiBtn();

  const closeBtn = document.createElement('button');
  Object.assign(closeBtn.style, { padding: '8px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '8px', flexShrink: '0', display: 'flex' });
  closeBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${C.textMuted}" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  closeBtn.addEventListener('click', close);

  header.appendChild(titleWrap);
  header.appendChild(apiBtn);
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
              background: currentSpotlightTheme === 'dark' ? '#1e293b' : '#ffffff', color: C.textFaint, fontSize: '10px',
              fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em',
              borderBottom: `1px solid ${C.divider}`,
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

// "What's New" update card lives in ./features/whatsNew.

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

// ─── Magic Fill settings (enable + what to fill) ─────────────────────────────

function renderMagicFillSettingsInto(host: HTMLElement, isDark: boolean, onBack: () => void): void {
  host.innerHTML = '';
  const C = {
    text: isDark ? '#f1f5f9' : '#1f2937',
    muted: isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)',
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
  };
  host.appendChild(toolBackHeader(isDark, '✨  Magic Fill', onBack));
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '6px 28px 24px' });
  host.appendChild(body);

  const intro = document.createElement('div');
  intro.textContent = 'Adds an “Auto Fill” button to record create/edit modals that fills the fields with sample data. Choose what it fills below.';
  Object.assign(intro.style, { fontSize: '13px', color: C.muted, lineHeight: '1.5', marginBottom: '10px' });
  body.appendChild(intro);

  const subRows: { key: keyof ToolsState; cb: HTMLInputElement }[] = [];
  const syncSubState = () => {
    subRows.forEach(({ cb }) => {
      const on = !!toolsState.magicFill;
      cb.disabled = !on;
      (cb.parentElement as HTMLElement).style.opacity = on ? '1' : '0.5';
    });
  };

  const row = (key: keyof ToolsState, title: string, sub: string, sublevel = false) => {
    const label = document.createElement('label');
    Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 0', paddingLeft: sublevel ? '24px' : '0', borderBottom: `1px solid ${C.divider}`, cursor: 'pointer' });
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!toolsState[key];
    Object.assign(cb.style, { width: '18px', height: '18px', cursor: 'pointer', flexShrink: '0' });
    cb.addEventListener('change', () => {
      (toolsState as any)[key] = cb.checked;
      saveToolsState();
      applyToolToggle(key);
      if (key === 'magicFill') syncSubState();
    });
    const txt = document.createElement('div');
    txt.innerHTML = `<div style="font-size:14px;font-weight:700;color:${C.text}">${title}</div><div style="font-size:12px;color:${C.muted};margin-top:2px">${sub}</div>`;
    label.appendChild(cb); label.appendChild(txt);
    body.appendChild(label);
    if (sublevel) subRows.push({ key, cb });
    return cb;
  };

  row('magicFill', 'Enable Magic Fill', 'Show the Auto Fill button in record modals');
  row('magicFillNormal', 'Fill normal fields', 'Text, number, email, phone, URL, checkbox, date', true);
  row('magicFillPicklist', 'Fill picklist values', 'Pick a valid option for picklist fields', true);
  syncSubState();
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

// ─── Data Export (SOQL → table → CSV) ────────────────────────────────────────

// Saved queries + run history (persisted).
const SOQL_SAVED_KEY = 'sf_soql_saved';
const SOQL_HISTORY_KEY = 'sf_soql_history';
let soqlSaved: { name: string; query: string }[] = [];
let soqlHistory: { query: string; ts: number }[] = [];
function loadSoqlStore(): void {
  (globalThis as any).chrome?.storage?.local?.get([SOQL_SAVED_KEY, SOQL_HISTORY_KEY], (res: any) => {
    soqlSaved = Array.isArray(res?.[SOQL_SAVED_KEY]) ? res[SOQL_SAVED_KEY] : [];
    soqlHistory = Array.isArray(res?.[SOQL_HISTORY_KEY]) ? res[SOQL_HISTORY_KEY] : [];
  });
}
function persistSoqlSaved(): void { (globalThis as any).chrome?.storage?.local?.set({ [SOQL_SAVED_KEY]: soqlSaved }); }
function persistSoqlHistory(): void { (globalThis as any).chrome?.storage?.local?.set({ [SOQL_HISTORY_KEY]: soqlHistory }); }
function addSoqlHistory(q: string): void {
  q = q.trim(); if (!q) return;
  soqlHistory = soqlHistory.filter(h => h.query !== q);
  soqlHistory.unshift({ query: q, ts: Date.now() });
  const lim = Math.max(1, exportSettings.historyLimit || 30);
  if (soqlHistory.length > lim) soqlHistory.length = lim;
  persistSoqlHistory();
}
loadSoqlStore();

// Data Export preferences (dedicated settings page).
interface ExportSettings {
  separator: ',' | ';' | '\t';
  wrap: boolean;
  hideRelations: boolean;       // hide parent/relationship columns by default
  defaultTooling: boolean;
  maxRows: number;
  showExecTime: boolean;        // show query execution time
  localTime: boolean;           // render datetimes in local time
  sobjectContext: boolean;      // seed query from the current record/object page
  showButtons: boolean;         // show the secondary action buttons
  includeFormula: boolean;      // include formula fields in autocomplete
  disableAutofocus: boolean;    // don't focus the editor on open
  historyLimit: number;
  savedLimit: number;
  templates: string[];          // query templates
  typoFix: boolean;             // auto-fix common SOQL keyword typos
  promptTemplateName: boolean;  // prompt for a name when saving
  showStop: boolean;            // show a Stop button to cancel a running query
}
const EXPORT_SETTINGS_KEY = 'sf_export_settings';
let exportSettings: ExportSettings = {
  separator: ',', wrap: false, hideRelations: false, defaultTooling: false, maxRows: 1000,
  showExecTime: true, localTime: false, sobjectContext: false, showButtons: true, includeFormula: true,
  disableAutofocus: false, historyLimit: 30, savedLimit: 50, templates: [], typoFix: false, promptTemplateName: true, showStop: true,
};
function loadExportSettings(): void {
  (globalThis as any).chrome?.storage?.local?.get([EXPORT_SETTINGS_KEY], (res: any) => {
    if (res?.[EXPORT_SETTINGS_KEY]) exportSettings = { ...exportSettings, ...res[EXPORT_SETTINGS_KEY] };
  });
}
function saveExportSettings(): void { (globalThis as any).chrome?.storage?.local?.set({ [EXPORT_SETTINGS_KEY]: exportSettings }); }
loadExportSettings();

// Handoff from the Query Builder → Export view.
let pendingExportQuery: string | null = null;
let pendingExportRun = false;

// Object + field metadata caches for autocomplete.
let soqlObjects: { name: string; label: string }[] | null = null;
const soqlFieldCache: Record<string, { name: string; label: string; type: string; calculated?: boolean }[]> = {};
function getSoqlObjects(cb: (list: { name: string; label: string }[]) => void): void {
  if (soqlObjects) { cb(soqlObjects); return; }
  getSfCredentials().then((creds: any) => {
    if (!creds?.instanceUrl || !creds?.sessionId) { cb([]); return; }
    (globalThis as any).chrome.runtime.sendMessage(
      { type: 'GET_ALL_OBJECTS', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId },
      (r: any) => {
        soqlObjects = (r?.success && r.data) ? r.data.map((o: any) => ({ name: o.QualifiedApiName, label: o.Label || o.QualifiedApiName })) : [];
        cb(soqlObjects || []);
      }
    );
  });
}
function getSoqlFields(object: string, cb: (fields: { name: string; label: string; type: string; calculated?: boolean }[]) => void): void {
  const key = object.toLowerCase();
  if (soqlFieldCache[key]) { cb(soqlFieldCache[key]); return; }
  getSfCredentials().then((creds: any) => {
    if (!creds?.instanceUrl || !creds?.sessionId) { cb([]); return; }
    (globalThis as any).chrome.runtime.sendMessage(
      { type: 'GET_OBJECT_FIELDS', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, objectApiName: object },
      (r: any) => { const fields = (r?.success && r.data) ? r.data : []; soqlFieldCache[key] = fields; cb(fields); }
    );
  });
}

// Cleans up query syntax (matches Inspector's "typo fix"): stray/double commas,
// a comma left before FROM, and collapses excess whitespace.
function fixSoqlTypos(q: string): string {
  return q
    .replace(/,\s*,/g, ',')              // double commas → one
    .replace(/,\s*FROM\s+/gi, ' FROM ')  // comma right before FROM
    .replace(/\s+/g, ' ')                // collapse whitespace/newlines
    .trim();
}
function formatLocalTimeCell(v: any): any {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleString();
  }
  return v;
}
function detectPageObject(): string | null {
  const m = window.location.pathname.match(/\/lightning\/[ro]\/([A-Za-z0-9_]+)\//);
  return m ? m[1] : null;
}

// Flatten SOQL records into { columns, rows }, expanding parent relationships
// into dotted columns (e.g. Owner.Name) and JSON-stringifying anything else.
function flattenSoqlRecords(records: any[]): { columns: string[]; rows: Record<string, any>[] } {
  const columns: string[] = [];
  const seen = new Set<string>();
  const addCol = (c: string) => { if (!seen.has(c)) { seen.add(c); columns.push(c); } };
  const rows = records.map((rec) => {
    const flat: Record<string, any> = {};
    const walk = (obj: any, prefix: string) => {
      Object.keys(obj).forEach((k) => {
        if (k === 'attributes') return;
        const key = prefix ? `${prefix}.${k}` : k;
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && v.attributes) {
          walk(v, key);
        } else if (v && typeof v === 'object') {
          flat[key] = JSON.stringify(v); addCol(key);
        } else {
          flat[key] = v ?? ''; addCol(key);
        }
      });
    };
    walk(rec, '');
    return flat;
  });
  return { columns, rows };
}

function renderExportInto(host: HTMLElement, isDark: boolean, onBack: () => void, onBuilder: () => void): void {
  host.innerHTML = '';
  const C = {
    border: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(31,41,55,0.15)',
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
    surface: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    headerBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    menuBg: isDark ? '#1e293b' : '#ffffff',
    hover: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    inputBg: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)',
    textFaint: isDark ? 'rgba(148,163,184,0.6)' : 'rgba(31,41,55,0.45)',
    borderStrong: isDark ? 'rgba(148,163,184,0.35)' : 'rgba(31,41,55,0.22)',
    zebra: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
    tabActive: isDark ? 'rgba(255,255,255,0.08)' : '#ffffff',
    accent: '#2563eb',
  };

  // Id cells in results open the shared Go-to-record / View-record-data menu.
  const exportIdMenuDeps = {
    isDark, flashToast,
    recordUrl: (id: string) => `${lightningOrigin()}/${id}`,
    fetchRecord: (id: string) => new Promise<{ data?: any; error?: string }>((resolve) => {
      getSfCredentials().then((creds: any) => {
        if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ error: 'Salesforce session not detected' }); return; }
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_RECORD_DETAIL', recordId: id, instanceUrl: creds.instanceUrl, sessionId: creds.sessionId },
          (resp: any) => resolve(resp?.success ? { data: resp.data } : { error: resp?.error || 'Could not load record.' }),
        );
      });
    }),
  };

  // Layout: fixed header + editor/controls; only the table area scrolls.
  const root = document.createElement('div');
  Object.assign(root.style, { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column' });
  host.appendChild(root);
  const exportHeader = toolBackHeader(isDark, '📤  Export Data', onBack);
  root.appendChild(exportHeader);

  // Query tabs — each keeps its own query + results.
  const DEFAULT_QUERY = 'SELECT Id, Name, CreatedDate FROM Account ORDER BY CreatedDate DESC LIMIT 50';
  const ctxObject = exportSettings.sobjectContext ? detectPageObject() : null;
  const seedFromBuilder = pendingExportQuery;
  const runFromBuilder = pendingExportRun;
  pendingExportQuery = null; pendingExportRun = false;
  const SEED_QUERY = seedFromBuilder || (ctxObject ? `SELECT Id, Name FROM ${ctxObject} LIMIT 50` : DEFAULT_QUERY);
  type ExportTab = { name: string; query: string; cols: string[]; rows: Record<string, any>[]; status: string; tooling: boolean; queryAll: boolean };
  const tabs: ExportTab[] = [{ name: 'Query 1', query: SEED_QUERY, cols: [], rows: [], status: '', tooling: exportSettings.defaultTooling, queryAll: false }];
  let active = 0;
  const tabStrip = document.createElement('div');
  Object.assign(tabStrip.style, { flexShrink: '0', display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 24px 0', overflowX: 'auto' });
  root.appendChild(tabStrip);

  const top = document.createElement('div');
  Object.assign(top.style, { flexShrink: '0', padding: '4px 24px 14px', display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(top);

  // Query editor (wrapped so the autocomplete box can anchor to it).
  const editorWrap = document.createElement('div');
  editorWrap.style.position = 'relative';
  const ta = document.createElement('textarea');
  ta.value = 'SELECT Id, Name, CreatedDate FROM Account ORDER BY CreatedDate DESC LIMIT 50';
  ta.spellcheck = false;
  Object.assign(ta.style, {
    width: '100%', minHeight: '76px', resize: 'vertical', boxSizing: 'border-box', padding: '10px 12px',
    fontFamily: 'Fira Code, monospace', fontSize: '13px', borderRadius: '10px',
    border: `1.5px solid ${C.borderStrong}`, background: C.inputBg, color: C.textPrimary, outline: 'none',
    lineHeight: '1.5', transition: 'border-color 0.15s, box-shadow 0.15s',
  });
  // Highlight the editor border on focus.
  ta.addEventListener('focus', () => { ta.style.borderColor = C.accent; ta.style.boxShadow = `0 0 0 3px ${isDark ? 'rgba(37,99,235,0.35)' : 'rgba(37,99,235,0.18)'}`; });
  ta.addEventListener('blur', () => { ta.style.borderColor = C.borderStrong; ta.style.boxShadow = 'none'; });
  editorWrap.appendChild(ta);

  const suggBox = document.createElement('div');
  Object.assign(suggBox.style, {
    position: 'absolute', left: '0', top: '100%', marginTop: '2px', width: '100%', maxHeight: '240px', overflowY: 'auto',
    background: C.menuBg, border: `1px solid ${C.border}`, borderRadius: '10px', boxShadow: '0 14px 36px rgba(0,0,0,0.3)',
    zIndex: '40', display: 'none', padding: '4px',
  });
  editorWrap.appendChild(suggBox);
  top.appendChild(editorWrap);

  // Controls
  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
  const mkBtn = (label: string, primary?: boolean) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      fontSize: '13px', fontWeight: '700', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
      border: primary ? 'none' : `1px solid ${C.borderStrong}`, background: primary ? C.accent : 'transparent', color: primary ? '#fff' : C.textPrimary,
    });
    return b;
  };
  const mkCheck = (text: string) => {
    const l = document.createElement('label');
    Object.assign(l.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.textMuted, cursor: 'pointer', fontWeight: '600' });
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.style.cursor = 'pointer';
    l.appendChild(cb); l.appendChild(document.createTextNode(text));
    return { l, cb };
  };

  const runBtn = mkBtn('Run', true);
  const stopBtn = mkBtn('Stop');
  Object.assign(stopBtn.style, { display: 'none', border: '1px solid #ef4444', color: '#ef4444' });
  const builderBtn = mkBtn('🧱 Builder');
  builderBtn.addEventListener('click', onBuilder);
  const planBtn = mkBtn('Query Plan');
  const saveBtn = mkBtn('Save');
  const histBtn = mkBtn('Saved / History ▾');
  const copyMenuBtn = mkBtn('Copy ▾');
  const csvBtn = mkBtn('Download CSV');
  copyMenuBtn.disabled = csvBtn.disabled = true;
  copyMenuBtn.style.opacity = csvBtn.style.opacity = '0.5';

  const tooling = mkCheck('Tooling API');
  const qall = mkCheck('Query All (deleted)');
  tooling.cb.checked = tabs[active].tooling;

  const filterInput = document.createElement('input');
  filterInput.type = 'text'; filterInput.placeholder = 'Filter results…'; filterInput.spellcheck = false;
  Object.assign(filterInput.style, { padding: '7px 10px', fontSize: '12px', borderRadius: '8px', border: `1px solid ${C.borderStrong}`, background: C.inputBg, color: C.textPrimary, outline: 'none', width: '150px' });

  const status = document.createElement('span');
  Object.assign(status.style, { fontSize: '12px', color: C.textMuted, marginLeft: 'auto' });

  // Group the buttons so the toolbar reads cleanly: run actions | query mgmt |
  // (spacer) | options | export | settings.
  const group = (els: HTMLElement[], gap = '6px') => { const g = document.createElement('div'); Object.assign(g.style, { display: 'flex', alignItems: 'center', gap }); els.forEach((e) => g.appendChild(e)); return g; };
  const vdiv = () => { const d = document.createElement('div'); Object.assign(d.style, { width: '1px', alignSelf: 'stretch', minHeight: '22px', background: C.divider, margin: '0 2px' }); return d; };

  // Builder + Saved/History live up in the header bar; Save stays with the actions.
  const headerActions = document.createElement('div');
  Object.assign(headerActions.style, { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' });
  headerActions.appendChild(builderBtn);
  headerActions.appendChild(histBtn);
  if (!exportSettings.showButtons) histBtn.style.display = 'none';
  exportHeader.appendChild(headerActions);

  const grpRun = group([runBtn, stopBtn, planBtn]);
  const div1 = vdiv();
  const grpMgmt = group([saveBtn]);
  const spacer = document.createElement('div'); spacer.style.flex = '1'; spacer.style.minWidth = '12px';
  const grpOpts = group([tooling.l, qall.l], '14px');
  const div2 = vdiv();
  const grpExport = group([copyMenuBtn, csvBtn]);

  filterInput.style.width = '170px';
  status.style.marginLeft = '4px';
  [grpRun, div1, grpMgmt, spacer, filterInput, grpOpts, div2, grpExport, status].forEach((el) => controls.appendChild(el));
  if (!exportSettings.showButtons) [planBtn, div1, grpMgmt, div2, grpExport].forEach((el) => { (el as HTMLElement).style.display = 'none'; });
  top.appendChild(controls);

  // Table scroll area — the ONLY part that scrolls (vertically & horizontally).
  const tableScroll = document.createElement('div');
  Object.assign(tableScroll.style, { flex: '1', minHeight: '0', overflow: 'auto', padding: '0' });
  root.appendChild(tableScroll);

  let cols: string[] = tabs[0].cols;
  let rows: Record<string, any>[] = tabs[0].rows;
  let filterText = '';
  const displayRows = () => {
    if (!filterText) return rows;
    const w = filterText.toLowerCase();
    return rows.filter((r) => cols.some((c) => String(r[c] ?? '').toLowerCase().includes(w)));
  };
  const setExportEnabled = (on: boolean) => {
    copyMenuBtn.disabled = csvBtn.disabled = !on;
    copyMenuBtn.style.opacity = csvBtn.style.opacity = on ? '1' : '0.5';
  };

  const visibleCols = () => (exportSettings.hideRelations ? cols.filter((c) => !c.includes('.')) : cols);

  const renderTable = () => {
    tableScroll.innerHTML = '';
    if (rows.length === 0) return;
    const dr = displayRows();
    if (dr.length === 0) { const n = document.createElement('div'); n.textContent = 'No rows match the filter.'; Object.assign(n.style, { padding: '16px 24px', fontSize: '13px', color: C.textFaint }); tableScroll.appendChild(n); return; }
    const vcols = visibleCols();
    const MAX_DOM = Math.max(50, exportSettings.maxRows || 1000);
    const wrap = exportSettings.wrap;
    const table = document.createElement('table');
    Object.assign(table.style, { borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'Fira Code, monospace', borderTop: `1px solid ${C.borderStrong}` });
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    vcols.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c;
      Object.assign(th.style, { position: 'sticky', top: '0', textAlign: 'left', padding: '8px 12px', background: currentSpotlightTheme === 'dark' ? '#1e293b' : '#ffffff', color: C.textPrimary, fontWeight: '700', whiteSpace: 'nowrap', border: `1px solid ${C.borderStrong}` });
      htr.appendChild(th);
    });
    thead.appendChild(htr); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    dr.slice(0, MAX_DOM).forEach((r, ri) => {
      const tr = document.createElement('tr');
      if (ri % 2 === 1) tr.style.background = C.zebra;
      vcols.forEach((c) => {
        const td = document.createElement('td');
        const cell = exportSettings.localTime ? formatLocalTimeCell(r[c]) : r[c];
        const str = cell === undefined || cell === null ? '' : String(cell);
        if (typeof cell === 'string' && isValidSalesforceId(cell)) {
          td.appendChild(createIdLink(cell, exportIdMenuDeps));
        } else {
          td.textContent = str;
        }
        Object.assign(td.style, { padding: '6px 12px', color: C.textPrimary, border: `1px solid ${C.divider}`, verticalAlign: 'top',
          ...(wrap ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '420px' } : { whiteSpace: 'nowrap', maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis' }) });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableScroll.appendChild(table);
    if (dr.length > MAX_DOM) {
      const note = document.createElement('div');
      note.textContent = `Showing first ${MAX_DOM} of ${dr.length} rows — export to get them all.`;
      Object.assign(note.style, { padding: '10px 14px', fontSize: '12px', color: C.textFaint });
      tableScroll.appendChild(note);
    }
  };

  // ── Export (operates on the filtered/visible rows) ──
  const csvCell = (v: any, sep: string) => { const s = v === undefined || v === null ? '' : String(v); const re = sep === '\t' ? /[\t"\n]/ : /[",\n;]/; return re.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const buildDelimited = (sep: string) => {
    const dr = displayRows();
    const vc = visibleCols();
    const head = vc.map((c) => csvCell(c, sep)).join(sep);
    const body = dr.map((r) => vc.map((c) => csvCell(r[c], sep)).join(sep)).join('\n');
    return head + '\n' + body;
  };
  const buildJson = () => {
    const vc = visibleCols();
    return JSON.stringify(displayRows().map((r) => { const o: Record<string, any> = {}; vc.forEach((c) => { o[c] = r[c]; }); return o; }), null, 2);
  };

  csvBtn.addEventListener('click', () => {
    const blob = new Blob(['﻿' + buildDelimited(exportSettings.separator)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `export_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });

  copyMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('sf-copy-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'sf-copy-menu';
    Object.assign(menu.style, { position: 'fixed', minWidth: '180px', background: C.menuBg, color: C.textPrimary, border: `1px solid ${C.borderStrong}`, borderRadius: '10px', boxShadow: '0 14px 36px rgba(0,0,0,0.3)', padding: '6px', zIndex: '2147483649', fontFamily: 'Inter, system-ui, sans-serif' });
    const closeM = () => { menu.remove(); document.removeEventListener('click', oo, true); };
    const oo = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node) && ev.target !== copyMenuBtn) closeM(); };
    const opt = (label: string, fn: () => string) => {
      const r = document.createElement('button');
      r.textContent = label;
      Object.assign(r.style, { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', border: 'none', borderRadius: '7px', cursor: 'pointer', color: C.textPrimary, fontSize: '13px', fontWeight: '600', fontFamily: 'inherit' });
      r.addEventListener('mouseover', () => { r.style.background = C.hover; });
      r.addEventListener('mouseout', () => { r.style.background = 'transparent'; });
      r.addEventListener('click', () => { navigator.clipboard?.writeText(fn()).then(() => flashToast('Copied to clipboard')).catch(() => {}); closeM(); });
      menu.appendChild(r);
    };
    opt('Copy as CSV', () => buildDelimited(exportSettings.separator));
    opt('Copy as Excel (TSV)', () => buildDelimited('\t'));
    opt('Copy as JSON', () => buildJson());
    document.body.appendChild(menu);
    const rect = copyMenuBtn.getBoundingClientRect();
    let mtop = rect.bottom + 6; const mh = menu.offsetHeight;
    if (mtop + mh > window.innerHeight - 8) mtop = Math.max(8, rect.top - mh - 6);
    menu.style.top = `${mtop}px`; menu.style.left = `${Math.max(8, rect.left)}px`;
    setTimeout(() => document.addEventListener('click', oo, true), 0);
  });

  filterInput.addEventListener('input', () => { filterText = filterInput.value.trim(); renderTable(); });

  const showError = (msg: string) => { tableScroll.innerHTML = ''; const e = document.createElement('div'); e.textContent = msg; Object.assign(e.style, { padding: '14px 24px', color: '#ef4444', fontSize: '13px', fontWeight: '600' }); tableScroll.appendChild(e); };

  let activeReqId: string | null = null;
  const endRun = () => { activeReqId = null; runBtn.disabled = false; runBtn.style.opacity = '1'; stopBtn.style.display = 'none'; };

  const run = () => {
    let query = ta.value.trim();
    if (!query) return;
    if (exportSettings.typoFix) { const fixed = fixSoqlTypos(query); if (fixed !== query) { query = fixed; ta.value = query; } }
    tabs[active].query = query; tabs[active].tooling = tooling.cb.checked; tabs[active].queryAll = qall.cb.checked;
    status.textContent = 'Running…'; status.style.color = C.textMuted;
    runBtn.disabled = true; runBtn.style.opacity = '0.6';
    if (exportSettings.showStop) { stopBtn.style.display = 'inline-block'; stopBtn.disabled = false; }
    setExportEnabled(false);
    const reqId = 'q' + Date.now() + Math.random().toString(36).slice(2);
    activeReqId = reqId;
    const t0 = performance.now();
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) { status.textContent = 'No session'; endRun(); return; }
      (globalThis as any).chrome.runtime.sendMessage(
        { type: 'RUN_SOQL', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, query, useTooling: tooling.cb.checked, queryAll: qall.cb.checked, requestId: reqId },
        (resp: any) => {
          if (activeReqId !== reqId) return; // cancelled or superseded
          endRun();
          if (resp?.cancelled) { status.textContent = 'Cancelled'; return; }
          if (!resp?.success) { status.textContent = ''; showError(resp?.error || 'Query failed.'); return; }
          addSoqlHistory(query);
          const recs = resp.data.records || [];
          const flat = flattenSoqlRecords(recs);
          cols = flat.columns; rows = flat.rows;
          tabs[active].cols = cols; tabs[active].rows = rows;
          const ms = Math.round(performance.now() - t0);
          const capped = resp.data.done === false;
          const timePart = exportSettings.showExecTime ? ` · ${ms}ms` : '';
          status.textContent = `${recs.length.toLocaleString()} row${recs.length === 1 ? '' : 's'}${timePart}${capped ? ' (capped 50k)' : ''}`;
          tabs[active].status = status.textContent;
          setExportEnabled(recs.length > 0);
          renderTable();
        }
      );
    });
  };
  stopBtn.addEventListener('click', () => {
    if (!activeReqId) return;
    (globalThis as any).chrome?.runtime?.sendMessage({ type: 'CANCEL_SOQL', requestId: activeReqId });
    endRun();
    status.textContent = 'Cancelled'; status.style.color = C.textMuted;
  });
  runBtn.addEventListener('click', run);

  // ── Query Plan ──
  planBtn.addEventListener('click', () => {
    const query = ta.value.trim(); if (!query) return;
    status.textContent = 'Planning…';
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) { status.textContent = 'No session'; return; }
      (globalThis as any).chrome.runtime.sendMessage(
        { type: 'GET_QUERY_PLAN', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, query, useTooling: tooling.cb.checked },
        (resp: any) => {
          if (!resp?.success) { status.textContent = ''; showError(resp?.error || 'Query Plan failed.'); return; }
          status.textContent = 'Query plan';
          const plans = resp.data.plans || [];
          tableScroll.innerHTML = '';
          if (plans.length === 0) { showError('No plan returned.'); return; }
          const cols2 = ['Leading operation', 'Cost', 'Cardinality', 'sObject cardinality', 'Fields'];
          const table = document.createElement('table');
          Object.assign(table.style, { borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'Fira Code, monospace', borderTop: `1px solid ${C.borderStrong}` });
          const htr = document.createElement('tr');
          cols2.forEach((c) => { const th = document.createElement('th'); th.textContent = c; Object.assign(th.style, { textAlign: 'left', padding: '8px 12px', background: C.headerBg, color: C.textPrimary, fontWeight: '700', whiteSpace: 'nowrap', border: `1px solid ${C.borderStrong}` }); htr.appendChild(th); });
          table.appendChild(htr);
          plans.forEach((p: any) => {
            const tr = document.createElement('tr');
            [p.leadingOperationType, (p.relativeCost ?? '').toString(), (p.cardinality ?? '').toString(), (p.sobjectCardinality ?? '').toString(), (p.fields || []).join(', ')].forEach((v) => {
              const td = document.createElement('td'); td.textContent = String(v); Object.assign(td.style, { padding: '6px 12px', color: C.textPrimary, border: `1px solid ${C.divider}`, maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }); tr.appendChild(td);
            });
            table.appendChild(tr);
          });
          tableScroll.appendChild(table);
        }
      );
    });
  });

  // ── Save + Saved/History dropdown ──
  saveBtn.addEventListener('click', () => {
    const q = ta.value.trim(); if (!q) return;
    const autoName = q.replace(/\s+/g, ' ').slice(0, 40);
    let name: string | null = autoName;
    if (exportSettings.promptTemplateName) { name = window.prompt('Save query as:', autoName); if (!name) return; }
    soqlSaved = soqlSaved.filter((s) => s.name !== name);
    soqlSaved.unshift({ name, query: q });
    const lim = Math.max(1, exportSettings.savedLimit || 50);
    if (soqlSaved.length > lim) soqlSaved.length = lim;
    persistSoqlSaved();
    flashToast('Query saved');
  });

  histBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('sf-soql-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'sf-soql-menu';
    Object.assign(menu.style, { position: 'fixed', minWidth: '320px', maxWidth: '480px', maxHeight: '360px', overflowY: 'auto', background: C.menuBg, color: C.textPrimary, border: `1px solid ${C.borderStrong}`, borderRadius: '12px', boxShadow: '0 18px 45px rgba(0,0,0,0.35)', padding: '6px', zIndex: '2147483649', fontFamily: 'Inter, system-ui, sans-serif' });
    const closeMenu = () => { menu.remove(); document.removeEventListener('click', onOut, true); document.removeEventListener('keydown', onEsc, true); };
    const onOut = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node) && ev.target !== histBtn) closeMenu(); };
    const onEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeMenu(); };
    const section = (title: string) => { const s = document.createElement('div'); s.textContent = title; Object.assign(s.style, { fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textFaint, padding: '8px 10px 4px' }); menu.appendChild(s); };
    const item = (primary: string, sub: string, q: string) => {
      const row = document.createElement('button');
      Object.assign(row.style, { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '8px 10px', fontFamily: 'inherit', color: C.textPrimary });
      row.innerHTML = `<div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${primary.replace(/</g, '&lt;')}</div><div style="font-size:11px;color:${C.textMuted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:Fira Code,monospace">${sub.replace(/</g, '&lt;')}</div>`;
      row.addEventListener('mouseover', () => { row.style.background = C.hover; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', () => { ta.value = q; closeMenu(); ta.focus(); });
      menu.appendChild(row);
    };
    const templates = (exportSettings.templates || []).filter((t) => t.trim());
    if (soqlSaved.length === 0 && soqlHistory.length === 0 && templates.length === 0) { const empty = document.createElement('div'); empty.textContent = 'No saved queries, templates or history yet.'; Object.assign(empty.style, { padding: '14px', fontSize: '13px', color: C.textMuted }); menu.appendChild(empty); }
    if (templates.length) { section('Templates'); templates.forEach((t) => item(t.replace(/\s+/g, ' ').slice(0, 60), t, t)); }
    if (soqlSaved.length) { section('★ Saved'); soqlSaved.forEach((s) => item(s.name, s.query, s.query)); }
    if (soqlHistory.length) { section('Recent'); soqlHistory.forEach((h) => item(h.query.replace(/\s+/g, ' ').slice(0, 60), h.query, h.query)); }
    document.body.appendChild(menu);
    const rect = histBtn.getBoundingClientRect(); const mh = menu.offsetHeight;
    let mtop = rect.bottom + 6; if (mtop + mh > window.innerHeight - 8) mtop = Math.max(8, rect.top - mh - 6);
    menu.style.top = `${mtop}px`; menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    setTimeout(() => { document.addEventListener('click', onOut, true); document.addEventListener('keydown', onEsc, true); }, 0);
  });

  // ── Query tabs ──
  const switchTab = (i: number) => {
    tabs[active].query = ta.value; tabs[active].tooling = tooling.cb.checked; tabs[active].queryAll = qall.cb.checked;
    active = i;
    const t = tabs[i];
    ta.value = t.query; tooling.cb.checked = t.tooling; qall.cb.checked = t.queryAll;
    cols = t.cols; rows = t.rows; filterText = ''; filterInput.value = '';
    status.textContent = t.status; setExportEnabled(rows.length > 0);
    renderTable(); renderTabStrip();
  };
  const addTab = () => { tabs.push({ name: `Query ${tabs.length + 1}`, query: DEFAULT_QUERY, cols: [], rows: [], status: '', tooling: exportSettings.defaultTooling, queryAll: false }); switchTab(tabs.length - 1); };
  const closeTab = (i: number) => { if (tabs.length <= 1) return; tabs.splice(i, 1); if (active >= tabs.length) active = tabs.length - 1; if (active > i) active -= 1; const t = tabs[active]; ta.value = t.query; tooling.cb.checked = t.tooling; qall.cb.checked = t.queryAll; cols = t.cols; rows = t.rows; status.textContent = t.status; setExportEnabled(rows.length > 0); renderTable(); renderTabStrip(); };
  function renderTabStrip() {
    tabStrip.innerHTML = '';
    tabs.forEach((t, i) => {
      const tb = document.createElement('div');
      Object.assign(tb.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '8px 8px 0 0', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap', border: `1px solid ${i === active ? C.borderStrong : 'transparent'}`, borderBottom: 'none', background: i === active ? C.tabActive : 'transparent', color: i === active ? C.textPrimary : C.textMuted });
      const label = document.createElement('span'); label.textContent = t.name; tb.appendChild(label);
      tb.addEventListener('click', () => { if (i !== active) switchTab(i); });
      if (tabs.length > 1) {
        const x = document.createElement('span'); x.textContent = '×'; Object.assign(x.style, { fontSize: '14px', color: C.textFaint });
        x.addEventListener('click', (ev) => { ev.stopPropagation(); closeTab(i); });
        tb.appendChild(x);
      }
      tabStrip.appendChild(tb);
    });
    const add = document.createElement('button');
    add.textContent = '+'; add.title = 'New query tab';
    Object.assign(add.style, { padding: '4px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', fontWeight: '700', color: C.textMuted, fontFamily: 'inherit' });
    add.addEventListener('click', addTab);
    tabStrip.appendChild(add);
  }

  ta.value = tabs[0].query;
  renderTabStrip();

  // ── Autocomplete (objects / fields / functions) ──
  const SOQL_FUNCS = [
    { insert: 'FIELDS(ALL)', sub: 'all fields' },
    { insert: 'FIELDS(STANDARD)', sub: 'standard fields' },
    { insert: 'FIELDS(CUSTOM)', sub: 'custom fields' },
    { insert: 'COUNT()', sub: 'aggregate' },
    { insert: 'COUNT_DISTINCT()', sub: 'aggregate' },
    { insert: 'SUM()', sub: 'aggregate' },
    { insert: 'AVG()', sub: 'aggregate' },
    { insert: 'MIN()', sub: 'aggregate' },
    { insert: 'MAX()', sub: 'aggregate' },
  ];
  type Sugg = { insert: string; label: string; sub: string; kind: 'object' | 'field' | 'func' };
  let suggItems: Sugg[] = [];
  let selIdx = 0;
  let suggCtx: { word: string; wordStart: number; clause: string } | null = null;

  const parseCtx = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const word = (before.match(/[A-Za-z0-9_]*$/) || [''])[0];
    const wordStart = caret - word.length;
    const objM = value.match(/FROM\s+([A-Za-z0-9_]+)/i);
    const object = objM ? objM[1] : '';
    const kwAt = (kw: string) => { const re = new RegExp(`\\b${kw}\\b`, 'gi'); let m: RegExpExecArray | null, idx = -1; while ((m = re.exec(before))) idx = m.index; return idx; };
    const pos: [string, number][] = [['select', kwAt('SELECT')], ['from', kwAt('FROM')], ['where', kwAt('WHERE')], ['having', kwAt('HAVING')], ['order', kwAt('ORDER BY')], ['group', kwAt('GROUP BY')]];
    let last: [string, number] = ['none', -1];
    pos.forEach((p) => { if (p[1] > last[1]) last = p; });
    let clause: string;
    if (last[0] === 'select') clause = 'selectList';
    else if (last[0] === 'from') clause = /FROM\s+[A-Za-z0-9_]*$/i.test(before) ? 'object' : 'where';
    else if (last[0] === 'where' || last[0] === 'having') clause = 'where';
    else if (last[0] === 'order' || last[0] === 'group') clause = 'orderGroup';
    else clause = 'none';
    return { word, wordStart, object, clause };
  };

  const rankFilter = (list: { name: string; label?: string }[], word: string) => {
    const w = word.toLowerCase();
    return list
      .map((o) => {
        const n = o.name.toLowerCase(), l = (o.label || '').toLowerCase();
        let r = 99;
        if (!w) r = 0;
        else if (n.startsWith(w)) r = 0;
        else if (l.startsWith(w)) r = 1;
        else if (n.includes(w)) r = 2;
        else if (l.includes(w)) r = 3;
        return { o, r };
      })
      .filter((x) => x.r < 99)
      .sort((a, b) => a.r - b.r || a.o.name.localeCompare(b.o.name))
      .slice(0, 12)
      .map((x) => x.o);
  };
  const filterFuncs = (word: string): Sugg[] => {
    const w = word.toLowerCase();
    return SOQL_FUNCS
      .filter((f) => !w || f.insert.toLowerCase().startsWith(w) || f.insert.toLowerCase().includes(w))
      .map((f) => ({ insert: f.insert, label: f.insert, sub: f.sub, kind: 'func' as const }));
  };

  let suggRows: HTMLElement[] = [];
  const highlight = () => { suggRows.forEach((r, i) => { r.style.background = i === selIdx ? C.hover : 'transparent'; }); };
  const paintSugg = () => {
    suggBox.innerHTML = '';
    suggRows = [];
    suggItems.forEach((it, i) => {
      const row = document.createElement('div');
      Object.assign(row.style, { padding: '7px 10px', borderRadius: '7px', cursor: 'pointer', background: i === selIdx ? C.hover : 'transparent' });
      const tag = it.kind === 'func' ? 'ƒ' : it.kind === 'object' ? '▦' : '◇';
      row.innerHTML = `<span style="color:${C.textFaint};font-size:11px;margin-right:6px">${tag}</span><span style="font-family:Fira Code,monospace;font-size:13px;font-weight:600;color:${C.textPrimary}">${it.label}</span> <span style="font-size:11px;color:${C.textFaint}">${it.sub}</span>`;
      // mousedown (not click) + preventDefault keeps the textarea focused so the insert lands.
      row.addEventListener('mousedown', (ev) => { ev.preventDefault(); selIdx = i; insertSugg(); });
      row.addEventListener('mouseover', () => { selIdx = i; highlight(); });
      suggBox.appendChild(row);
      suggRows.push(row);
    });
  };
  const hideSugg = () => { suggBox.style.display = 'none'; suggItems = []; suggCtx = null; };
  const showSugg = (items: Sugg[], ctx: { word: string; wordStart: number; clause: string }) => {
    if (items.length === 0) { hideSugg(); return; }
    suggItems = items; suggCtx = ctx; selIdx = 0; suggBox.style.display = 'block'; paintSugg();
  };
  const insertSugg = () => {
    const it = suggItems[selIdx]; if (!it || !suggCtx) return;
    const caret = ta.selectionStart;
    const v = ta.value;
    const insert = it.insert;
    let suffix = '';
    let caretOffset: number | null = null;
    if (it.kind === 'func') {
      if (insert.endsWith('()')) caretOffset = insert.length - 1; // caret inside the parens
    } else if (it.kind === 'object') {
      suffix = ' ';
    } else {
      // Field: add a comma so the next field can be typed — but not right before FROM
      // or where a comma already follows.
      if (suggCtx.clause === 'where') {
        suffix = ' ';
      } else {
        const after = v.slice(caret).replace(/^\s*/, '');
        if (after.startsWith(',')) suffix = '';
        else if (/^from\b/i.test(after)) suffix = ' ';
        else suffix = ', ';
      }
    }
    ta.value = v.slice(0, suggCtx.wordStart) + insert + suffix + v.slice(caret);
    const pos = caretOffset != null ? suggCtx.wordStart + caretOffset : suggCtx.wordStart + insert.length + suffix.length;
    ta.setSelectionRange(pos, pos);
    hideSugg(); ta.focus(); updateSugg();
  };

  const updateSugg = () => {
    const caret = ta.selectionStart;
    const ctx = parseCtx(ta.value, caret);
    const setCtx = { word: ctx.word, wordStart: ctx.wordStart, clause: ctx.clause };
    if (ctx.clause === 'object') {
      getSoqlObjects((list) => showSugg(rankFilter(list, ctx.word).map((o: any) => ({ insert: o.name, label: o.name, sub: o.label, kind: 'object' as const })), setCtx));
    } else if (ctx.clause === 'selectList') {
      const funcItems = filterFuncs(ctx.word);
      if (!ctx.object) { showSugg(funcItems, setCtx); return; }
      getSoqlFields(ctx.object, (allFields) => {
        const fields = exportSettings.includeFormula ? allFields : allFields.filter((f) => !f.calculated);
        const fieldItems: Sugg[] = rankFilter(fields, ctx.word).map((f: any) => ({ insert: f.name, label: f.name, sub: `${f.label} · ${f.type}`, kind: 'field' as const }));
        showSugg([...funcItems, ...fieldItems].slice(0, 14), setCtx);
      });
    } else if ((ctx.clause === 'where' || ctx.clause === 'orderGroup') && ctx.object) {
      getSoqlFields(ctx.object, (allFields) => {
        const fields = exportSettings.includeFormula ? allFields : allFields.filter((f) => !f.calculated);
        showSugg(rankFilter(fields, ctx.word).map((f: any) => ({ insert: f.name, label: f.name, sub: `${f.label} · ${f.type}`, kind: 'field' as const })), setCtx);
      });
    } else {
      hideSugg();
    }
  };

  ta.addEventListener('input', updateSugg);
  ta.addEventListener('click', updateSugg);
  ta.addEventListener('blur', () => setTimeout(hideSugg, 150));
  ta.addEventListener('keydown', (e) => {
    const open = suggBox.style.display === 'block' && suggItems.length > 0;
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, suggItems.length - 1); highlight(); suggRows[selIdx]?.scrollIntoView({ block: 'nearest' }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); highlight(); suggRows[selIdx]?.scrollIntoView({ block: 'nearest' }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertSugg(); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideSugg(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  // Warm the object cache for snappy first suggestions.
  getSoqlObjects(() => {});
  if (!exportSettings.disableAutofocus) setTimeout(() => ta.focus(), 40);
  if (runFromBuilder) setTimeout(run, 80);
}

// Appends the Data Export setting rows into a container (used by the main
// settings panel) — colors are supplied so it matches the host theme.
function appendExportSettings(body: HTMLElement, C: { border: string; divider: string; inputBg: string; textPrimary: string; textMuted: string; accent: string }): void {
  const row = (title: string, hint: string, control: HTMLElement) => {
    const r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 0', borderBottom: `1px solid ${C.divider}` });
    const txt = document.createElement('div'); txt.style.flex = '1';
    const t = document.createElement('div'); t.textContent = title; Object.assign(t.style, { fontSize: '14px', fontWeight: '700', color: C.textPrimary });
    const h = document.createElement('div'); h.textContent = hint; Object.assign(h.style, { fontSize: '12px', color: C.textMuted, marginTop: '2px' });
    txt.appendChild(t); txt.appendChild(h);
    control.style.flexShrink = '0';
    r.appendChild(txt); r.appendChild(control);
    body.appendChild(r);
  };
  const mkToggle = (get: () => boolean, set: (v: boolean) => void) => {
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = get();
    Object.assign(cb.style, { width: '18px', height: '18px', cursor: 'pointer', accentColor: C.accent });
    cb.addEventListener('change', () => { set(cb.checked); saveExportSettings(); });
    return cb;
  };

  const sep = document.createElement('select');
  Object.assign(sep.style, { padding: '7px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.textPrimary, cursor: 'pointer', fontFamily: 'inherit' });
  [['Comma  (,)', ','], ['Semicolon  (;)', ';'], ['Tab', '\t']].forEach(([label, val]) => { const o = document.createElement('option'); o.value = val; o.textContent = label; sep.appendChild(o); });
  sep.value = exportSettings.separator;
  sep.addEventListener('change', () => { exportSettings.separator = sep.value as ExportSettings['separator']; saveExportSettings(); });
  row('CSV separator', 'Delimiter for Download CSV and Copy as CSV.', sep);

  row('Wrap long values', 'Let result cells wrap instead of truncating with “…”.', mkToggle(() => exportSettings.wrap, (v) => { exportSettings.wrap = v; }));
  row('Hide relationship columns', 'Hide parent columns like Owner.Name from the table and exports.', mkToggle(() => exportSettings.hideRelations, (v) => { exportSettings.hideRelations = v; }));
  row('Default to Tooling API', 'New query tabs start with the Tooling API checkbox on.', mkToggle(() => exportSettings.defaultTooling, (v) => { exportSettings.defaultTooling = v; }));

  row('Display query execution time', 'Show how long each query took, in milliseconds.', mkToggle(() => exportSettings.showExecTime, (v) => { exportSettings.showExecTime = v; }));
  row('Show local time', 'Render date/time values in your local timezone in the table.', mkToggle(() => exportSettings.localTime, (v) => { exportSettings.localTime = v; }));
  row('Use SObject context', 'When opening Export from a record/object page, seed the query with that object.', mkToggle(() => exportSettings.sobjectContext, (v) => { exportSettings.sobjectContext = v; }));
  row('Show buttons', 'Show the secondary action buttons (Plan, Save, History, Copy, Download).', mkToggle(() => exportSettings.showButtons, (v) => { exportSettings.showButtons = v; }));
  row('Show stop button', 'Show a Stop button while a query runs so you can cancel long queries.', mkToggle(() => exportSettings.showStop, (v) => { exportSettings.showStop = v; }));
  row('Include formula fields from suggestions', 'Suggest formula (calculated) fields in autocomplete.', mkToggle(() => exportSettings.includeFormula, (v) => { exportSettings.includeFormula = v; }));
  row('Disable query input autofocus', 'Don’t focus the query editor automatically when Export opens.', mkToggle(() => exportSettings.disableAutofocus, (v) => { exportSettings.disableAutofocus = v; }));
  row('Enable query typo fix', 'On Run, clean up the query: remove stray/double commas, a comma before FROM, and extra spaces.', mkToggle(() => exportSettings.typoFix, (v) => { exportSettings.typoFix = v; }));
  row('Prompt template name', 'Ask for a name when saving a query (off = auto-name).', mkToggle(() => exportSettings.promptTemplateName, (v) => { exportSettings.promptTemplateName = v; }));

  const mkNum = (get: () => number, set: (v: number) => void, min: number, max: number, step: number, dflt: number) => {
    const i = document.createElement('input'); i.type = 'number'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(get());
    Object.assign(i.style, { width: '90px', padding: '7px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.textPrimary, outline: 'none', fontFamily: 'inherit' });
    i.addEventListener('change', () => { const n = parseInt(i.value, 10); const v = isNaN(n) ? dflt : Math.max(min, Math.min(max, n)); set(v); i.value = String(v); saveExportSettings(); });
    return i;
  };
  row('Queries kept in history', 'How many recent queries to remember.', mkNum(() => exportSettings.historyLimit, (v) => { exportSettings.historyLimit = v; }, 5, 200, 5, 30));
  row('Saved queries limit', 'Maximum number of saved queries.', mkNum(() => exportSettings.savedLimit, (v) => { exportSettings.savedLimit = v; }, 5, 200, 5, 50));
  row('Max rows to display', 'How many rows to render in the table (exports include all).', mkNum(() => exportSettings.maxRows, (v) => { exportSettings.maxRows = v; }, 50, 10000, 50, 1000));

  // Query templates (one per line) — surfaced in the Saved/History dropdown.
  const tplWrap = document.createElement('div');
  Object.assign(tplWrap.style, { padding: '14px 0' });
  const tplTitle = document.createElement('div'); tplTitle.textContent = 'Query templates'; Object.assign(tplTitle.style, { fontSize: '14px', fontWeight: '700', color: C.textPrimary });
  const tplHint = document.createElement('div'); tplHint.textContent = 'One SOQL query per line. These appear under “Templates” in the Saved/History menu.'; Object.assign(tplHint.style, { fontSize: '12px', color: C.textMuted, margin: '2px 0 8px' });
  const tplArea = document.createElement('textarea');
  tplArea.value = (exportSettings.templates || []).join('\n'); tplArea.spellcheck = false;
  Object.assign(tplArea.style, { width: '100%', minHeight: '90px', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px', fontFamily: 'Fira Code, monospace', fontSize: '12px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.textPrimary, outline: 'none' });
  tplArea.addEventListener('change', () => { exportSettings.templates = tplArea.value.split('\n').map((s) => s.trim()).filter(Boolean); saveExportSettings(); });
  tplWrap.appendChild(tplTitle); tplWrap.appendChild(tplHint); tplWrap.appendChild(tplArea);
  body.appendChild(tplWrap);

  const note = document.createElement('div');
  note.textContent = 'Settings are saved automatically and persist across sessions.';
  Object.assign(note.style, { fontSize: '12px', color: C.textMuted, marginTop: '14px' });
  body.appendChild(note);
}

// Visual SOQL builder — pick object, fields, functions, filters, order, limit.
function renderQueryBuilderInto(host: HTMLElement, isDark: boolean, onBack: () => void, openExport: (query: string, run: boolean) => void): void {
  host.innerHTML = '';
  const C = {
    border: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(31,41,55,0.2)',
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
    surface: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    inputBg: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
    chip: isDark ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.1)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.7)' : 'rgba(31,41,55,0.6)',
    textFaint: isDark ? 'rgba(148,163,184,0.6)' : 'rgba(31,41,55,0.45)',
    accent: '#2563eb',
  };
  host.appendChild(toolBackHeader(isDark, '🧱  Query Builder', onBack));
  const root = document.createElement('div');
  Object.assign(root.style, { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'row', overflow: 'hidden' });
  host.appendChild(root);
  const form = document.createElement('div');
  Object.assign(form.style, { flex: '1', minWidth: '0', minHeight: '0', overflowY: 'auto', overflowX: 'hidden', padding: '8px 20px 16px', borderRight: `1px solid ${C.divider}` });
  root.appendChild(form);

  const inputCss = { padding: '7px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.textPrimary, outline: 'none', fontFamily: 'inherit' };
  const card = (title: string) => {
    const c = document.createElement('div');
    Object.assign(c.style, { marginBottom: '14px' });
    const t = document.createElement('div'); t.textContent = title; Object.assign(t.style, { fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textFaint, marginBottom: '6px' });
    c.appendChild(t); form.appendChild(c); return c;
  };
  const mkSelect = () => { const s = document.createElement('select'); Object.assign(s.style, { ...inputCss, cursor: 'pointer' }); return s; };
  const fillSelect = (s: HTMLSelectElement, opts: { value: string; label: string }[], keep = true) => {
    const cur = s.value; s.innerHTML = '';
    opts.forEach((o) => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; s.appendChild(op); });
    if (keep && opts.some((o) => o.value === cur)) s.value = cur;
  };

  // ── State ──
  let objectName = '';
  let fieldsMeta: { name: string; label: string; type: string }[] = [];
  const checkedSet = new Set<string>();
  const aggregates: string[] = [];
  let fieldsMode: 'fields' | 'ALL' | 'STANDARD' | 'CUSTOM' = 'fields';
  const whereRows: { field: HTMLSelectElement; op: HTMLSelectElement; val: HTMLInputElement }[] = [];

  const fieldOptions = () => [{ value: '', label: '— field —' }, ...fieldsMeta.map((f) => ({ value: f.name, label: `${f.name}` }))];

  // ── Object ──
  const objCard = card('Object');
  const objInput = document.createElement('input');
  objInput.setAttribute('list', 'sf-qb-objs'); objInput.placeholder = 'Search object (e.g. Account)…'; objInput.spellcheck = false;
  Object.assign(objInput.style, { ...inputCss, width: '260px' });
  const dl = document.createElement('datalist'); dl.id = 'sf-qb-objs';
  getSoqlObjects((list) => { list.forEach((o) => { const op = document.createElement('option'); op.value = o.name; op.label = o.label; dl.appendChild(op); }); });
  objCard.appendChild(objInput); objCard.appendChild(dl);

  // ── Fields ──
  const fieldsCard = card('Fields');
  const fControls = document.createElement('div');
  Object.assign(fControls.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' });
  const fFilter = document.createElement('input'); fFilter.placeholder = 'Filter fields…'; fFilter.spellcheck = false; Object.assign(fFilter.style, { ...inputCss, width: '180px' });
  const modeBtns: HTMLButtonElement[] = [];
  const mkModeBtn = (label: string, mode: typeof fieldsMode) => {
    const b = document.createElement('button'); b.textContent = label;
    Object.assign(b.style, { fontSize: '12px', fontWeight: '700', padding: '6px 10px', borderRadius: '7px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.border}`, background: 'transparent', color: C.textPrimary });
    b.addEventListener('click', () => { fieldsMode = fieldsMode === mode ? 'fields' : mode; paintModes(); updatePreview(); });
    modeBtns.push(b); return b;
  };
  const allBtn = mkModeBtn('FIELDS(ALL)', 'ALL');
  const stdBtn = mkModeBtn('FIELDS(STANDARD)', 'STANDARD');
  const cusBtn = mkModeBtn('FIELDS(CUSTOM)', 'CUSTOM');
  const paintModes = () => { [['ALL', allBtn], ['STANDARD', stdBtn], ['CUSTOM', cusBtn]].forEach(([m, b]) => { const on = fieldsMode === m; (b as HTMLButtonElement).style.background = on ? C.chip : 'transparent'; (b as HTMLButtonElement).style.borderColor = on ? C.accent : C.border; (b as HTMLButtonElement).style.color = on ? C.accent : C.textPrimary; }); fieldList.style.opacity = fieldsMode === 'fields' ? '1' : '0.4'; };
  fControls.appendChild(fFilter); fControls.appendChild(allBtn); fControls.appendChild(stdBtn); fControls.appendChild(cusBtn);
  fieldsCard.appendChild(fControls);
  const fieldList = document.createElement('div');
  Object.assign(fieldList.style, { maxHeight: '180px', overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px' });
  fieldsCard.appendChild(fieldList);
  const renderFieldList = () => {
    const q = fFilter.value.trim().toLowerCase();
    fieldList.innerHTML = '';
    if (fieldsMeta.length === 0) { const e = document.createElement('div'); e.textContent = objectName ? 'Loading fields…' : 'Pick an object first.'; Object.assign(e.style, { padding: '8px', color: C.textMuted, fontSize: '12px' }); fieldList.appendChild(e); return; }
    fieldsMeta.filter((f) => !q || f.name.toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q)).forEach((f) => {
      const lab = document.createElement('label');
      Object.assign(lab.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: C.textPrimary });
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checkedSet.has(f.name); cb.style.cursor = 'pointer';
      cb.addEventListener('change', () => { if (cb.checked) checkedSet.add(f.name); else checkedSet.delete(f.name); updatePreview(); });
      const span = document.createElement('span'); span.innerHTML = `<span style="font-family:Fira Code,monospace">${f.name}</span> <span style="color:${C.textFaint}">${f.type}</span>`;
      lab.appendChild(cb); lab.appendChild(span); fieldList.appendChild(lab);
    });
  };
  fFilter.addEventListener('input', renderFieldList);

  // ── Aggregate functions ──
  const aggCard = card('Functions (aggregate)');
  const aggRow = document.createElement('div'); Object.assign(aggRow.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' });
  const aggFunc = mkSelect(); fillSelect(aggFunc, ['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX'].map((f) => ({ value: f, label: f })));
  const aggField = mkSelect();
  const aggAdd = document.createElement('button'); aggAdd.textContent = 'Add'; Object.assign(aggAdd.style, { fontSize: '12px', fontWeight: '700', padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: C.accent, color: '#fff' });
  const aggChips = document.createElement('div'); Object.assign(aggChips.style, { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' });
  const renderAggChips = () => {
    aggChips.innerHTML = '';
    aggregates.forEach((a, i) => { const ch = document.createElement('span'); Object.assign(ch.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 8px', borderRadius: '999px', background: C.chip, color: C.accent, fontSize: '12px', fontWeight: '600', fontFamily: 'Fira Code, monospace' }); ch.textContent = a; const x = document.createElement('span'); x.textContent = '×'; x.style.cursor = 'pointer'; x.addEventListener('click', () => { aggregates.splice(i, 1); renderAggChips(); updatePreview(); }); ch.appendChild(x); aggChips.appendChild(ch); });
  };
  aggAdd.addEventListener('click', () => { const fn = aggFunc.value; const fld = aggField.value || (fn === 'COUNT' ? '' : 'Id'); aggregates.push(fld ? `${fn}(${fld})` : 'COUNT()'); renderAggChips(); updatePreview(); });
  aggRow.appendChild(aggFunc); aggRow.appendChild(aggField); aggRow.appendChild(aggAdd);
  aggCard.appendChild(aggRow); aggCard.appendChild(aggChips);

  // ── WHERE ──
  const whereCard = card('Filters (WHERE)');
  const connRow = document.createElement('div'); Object.assign(connRow.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' });
  const connSel = mkSelect(); fillSelect(connSel, [{ value: 'AND', label: 'Match ALL (AND)' }, { value: 'OR', label: 'Match ANY (OR)' }]); connSel.addEventListener('change', updatePreview);
  connRow.appendChild(connSel);
  whereCard.appendChild(connRow);
  const whereList = document.createElement('div'); whereCard.appendChild(whereList);
  const OPS = ['=', '!=', '<', '<=', '>', '>=', 'LIKE', 'IN', 'NOT IN', 'INCLUDES', 'EXCLUDES'];
  const addWhereRow = () => {
    const r = document.createElement('div'); Object.assign(r.style, { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' });
    const fSel = mkSelect(); fillSelect(fSel, fieldOptions()); fSel.addEventListener('change', updatePreview);
    const oSel = mkSelect(); fillSelect(oSel, OPS.map((o) => ({ value: o, label: o }))); oSel.addEventListener('change', updatePreview);
    const vIn = document.createElement('input'); vIn.placeholder = 'value'; Object.assign(vIn.style, { ...inputCss, flex: '1', minWidth: '120px' }); vIn.addEventListener('input', updatePreview);
    const del = document.createElement('button'); del.textContent = '×'; Object.assign(del.style, { fontSize: '16px', fontWeight: '700', padding: '4px 10px', borderRadius: '7px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted });
    del.addEventListener('click', () => { const idx = whereRows.findIndex((w) => w.field === fSel); if (idx >= 0) whereRows.splice(idx, 1); r.remove(); updatePreview(); });
    r.appendChild(fSel); r.appendChild(oSel); r.appendChild(vIn); r.appendChild(del);
    whereList.appendChild(r); whereRows.push({ field: fSel, op: oSel, val: vIn });
  };
  const addCond = document.createElement('button'); addCond.textContent = '+ Add condition'; Object.assign(addCond.style, { fontSize: '12px', fontWeight: '700', padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.border}`, background: 'transparent', color: C.textPrimary });
  addCond.addEventListener('click', () => { addWhereRow(); updatePreview(); });
  whereCard.appendChild(addCond);

  // ── ORDER BY + LIMIT ──
  const tailCard = card('Order & Limit');
  const tailRow = document.createElement('div'); Object.assign(tailRow.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' });
  const orderSel = mkSelect(); fillSelect(orderSel, fieldOptions()); orderSel.addEventListener('change', updatePreview);
  const dirSel = mkSelect(); fillSelect(dirSel, [{ value: 'ASC', label: 'ASC' }, { value: 'DESC', label: 'DESC' }]); dirSel.addEventListener('change', updatePreview);
  const limitIn = document.createElement('input'); limitIn.type = 'number'; limitIn.min = '1'; limitIn.placeholder = 'LIMIT'; Object.assign(limitIn.style, { ...inputCss, width: '110px' }); limitIn.value = '50'; limitIn.addEventListener('input', updatePreview);
  const ob = document.createElement('span'); ob.textContent = 'ORDER BY'; Object.assign(ob.style, { fontSize: '12px', color: C.textMuted, fontWeight: '700' });
  tailRow.appendChild(ob); tailRow.appendChild(orderSel); tailRow.appendChild(dirSel); tailRow.appendChild(limitIn);
  tailCard.appendChild(tailRow);

  const populateFieldSelects = () => { whereRows.forEach((w) => fillSelect(w.field, fieldOptions())); fillSelect(orderSel, fieldOptions()); fillSelect(aggField, [{ value: '', label: '— field —' }, ...fieldsMeta.map((f) => ({ value: f.name, label: f.name }))]); };

  const loadFields = () => {
    if (!objectName) { fieldsMeta = []; renderFieldList(); populateFieldSelects(); updatePreview(); return; }
    fieldsMeta = []; renderFieldList();
    getSoqlFields(objectName, (fields) => { fieldsMeta = fields; renderFieldList(); populateFieldSelects(); updatePreview(); });
  };
  objInput.addEventListener('change', () => { objectName = objInput.value.trim(); checkedSet.clear(); aggregates.length = 0; renderAggChips(); loadFields(); });

  // ── Build query ──
  const quoteVal = (field: string, raw: string) => {
    const s = raw.trim();
    if (s === '') return "''";
    const meta = fieldsMeta.find((f) => f.name === field);
    const type = meta?.type || 'string';
    if (['int', 'double', 'currency', 'percent', 'long'].includes(type)) return s;
    if (type === 'boolean') return s.toLowerCase();
    if (/^(null|true|false)$/i.test(s)) return s;
    if (/^'.*'$/.test(s)) return s;
    if (/^-?\d+(\.\d+)?$/.test(s)) return s;
    if (/^[A-Z_]+(:\-?\d+)?$/.test(s)) return s; // date literal e.g. LAST_N_DAYS:30, TODAY
    if (['date', 'datetime'].includes(type) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    return `'${s.replace(/'/g, "\\'")}'`;
  };
  const buildCond = (w: { field: HTMLSelectElement; op: HTMLSelectElement; val: HTMLInputElement }) => {
    const f = w.field.value; const op = w.op.value; const v = w.val.value;
    if (!f || v.trim() === '') return '';
    if (['IN', 'NOT IN', 'INCLUDES', 'EXCLUDES'].includes(op)) {
      const items = v.replace(/^\(|\)$/g, '').split(',').map((x) => quoteVal(f, x)).join(', ');
      return `${f} ${op} (${items})`;
    }
    return `${f} ${op} ${quoteVal(f, v)}`;
  };
  const buildQuery = () => {
    let selParts: string[];
    if (fieldsMode !== 'fields') selParts = [`FIELDS(${fieldsMode})`];
    else selParts = [...aggregates, ...Array.from(checkedSet)];
    if (selParts.length === 0) selParts = ['Id'];
    let q = `SELECT ${selParts.join(', ')} FROM ${objectName || 'ObjectName'}`;
    const conds = whereRows.map(buildCond).filter(Boolean);
    if (conds.length) q += ` WHERE ${conds.join(` ${connSel.value} `)}`;
    if (orderSel.value) q += ` ORDER BY ${orderSel.value} ${dirSel.value}`;
    if (limitIn.value && Number(limitIn.value) > 0) q += ` LIMIT ${parseInt(limitIn.value, 10)}`;
    return q;
  };

  // ── Side panel: live query + actions ──
  const side = document.createElement('div');
  Object.assign(side.style, { flexShrink: '0', width: '340px', minHeight: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '12px 18px', background: C.surface });
  root.appendChild(side);
  const sideTitle = document.createElement('div');
  sideTitle.textContent = 'Generated SOQL';
  Object.assign(sideTitle.style, { fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textFaint, marginBottom: '8px' });
  side.appendChild(sideTitle);
  const preview = document.createElement('div');
  Object.assign(preview.style, { maxHeight: '220px', overflow: 'auto', flexShrink: '0', fontFamily: 'Fira Code, monospace', fontSize: '13px', lineHeight: '1.6', color: C.textPrimary, background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' });
  side.appendChild(preview);
  const copyQ = document.createElement('button');
  copyQ.textContent = 'Copy query';
  Object.assign(copyQ.style, { fontSize: '12px', fontWeight: '600', padding: '7px 12px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, marginTop: '10px' });
  copyQ.addEventListener('click', () => { navigator.clipboard?.writeText(buildQuery()).then(() => flashToast('Query copied')).catch(() => {}); });
  side.appendChild(copyQ);
  const actions = document.createElement('div'); Object.assign(actions.style, { display: 'flex', gap: '8px', marginTop: '10px' });
  const useBtn = document.createElement('button'); useBtn.textContent = 'Use query'; Object.assign(useBtn.style, { flex: '1', fontSize: '13px', fontWeight: '700', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.border}`, background: 'transparent', color: C.textPrimary });
  const runBuiltBtn = document.createElement('button'); runBuiltBtn.textContent = 'Build & Run'; Object.assign(runBuiltBtn.style, { flex: '1', fontSize: '13px', fontWeight: '700', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: C.accent, color: '#fff' });
  useBtn.addEventListener('click', () => openExport(buildQuery(), false));
  runBuiltBtn.addEventListener('click', () => openExport(buildQuery(), true));
  actions.appendChild(useBtn); actions.appendChild(runBuiltBtn);
  side.appendChild(actions);

  function updatePreview() { preview.textContent = buildQuery(); }

  // Init
  addWhereRow();
  renderFieldList();
  paintModes();
  updatePreview();
  // Seed from current page object if available.
  const seed = detectPageObject();
  if (seed) { objInput.value = seed; objectName = seed; loadFields(); }
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
  // Tear down a prior API console (and its background port) before rebuilding.
  apiConsoleHandle?.destroy();
  apiConsoleHandle = null;

  // ─── Theme tokens (light / dark) ───────────────────────────
  const isDark = currentSpotlightTheme === 'dark';
  const fullPage = SPOTLIGHT_PAGE; // rendered as a standalone tab, not an overlay
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
    tabInactive: isDark ? '#cbd5e1' : '#475569',
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
  modalContent.style.alignItems = fullPage ? 'stretch' : 'center';
  modalContent.style.justifyContent = fullPage ? 'stretch' : 'center';
  modalContent.style.zIndex = '2147483648';
  modalContent.style.pointerEvents = 'none';

  // Backdrop (dim overlay) — not used in full-page mode.
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
  if (fullPage) backdrop.style.display = 'none';
  else backdrop.addEventListener('click', (e) => { if (e.target === backdrop) hideSpotlightSearch(); });

  // Modal box
  const modal = document.createElement('div');
  modal.style.position = 'relative';
  modal.style.width = '100%';
  modal.style.backgroundColor = isDark ? '#0f172a' : '#ffffff';
  modal.style.overflow = 'hidden';
  modal.style.zIndex = '2';
  modal.style.pointerEvents = 'auto';
  if (fullPage) {
    // Fill the whole tab.
    modal.style.maxWidth = 'none';
    modal.style.height = '100vh';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.borderRadius = '0';
  } else {
    modal.style.maxWidth = '768px';
    modal.style.borderRadius = '24px';
    modal.style.boxShadow = '0 25px 50px rgba(0, 0, 0, 0.5)';
    modal.style.border = `1px solid ${T.modalBorder}`;
  }

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
  if (fullPage) closeBtn.style.display = 'none';

  // Open Spotlight as a full-page tab (overlay mode only).
  const openTabBtn = document.createElement('button');
  openTabBtn.title = 'Open in a new tab';
  openTabBtn.style.marginLeft = '8px';
  openTabBtn.style.padding = '8px';
  openTabBtn.style.backgroundColor = 'transparent';
  openTabBtn.style.border = 'none';
  openTabBtn.style.cursor = 'pointer';
  openTabBtn.style.borderRadius = '8px';
  openTabBtn.style.transition = 'background-color 0.2s';
  openTabBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${T.iconStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>`;
  openTabBtn.addEventListener('mouseover', () => { openTabBtn.style.backgroundColor = T.closeHover; });
  openTabBtn.addEventListener('mouseout', () => { openTabBtn.style.backgroundColor = 'transparent'; });
  openTabBtn.addEventListener('click', () => {
    const cr = (globalThis as any).chrome?.runtime;
    const host = cleanSfDomain(sfHostname());
    const url = cr?.getURL ? `${cr.getURL('spotlight.html')}?host=${encodeURIComponent(host)}` : '';
    if (url) cr.sendMessage({ type: 'OPEN_TAB', url });
    hideSpotlightSearch();
  });
  if (fullPage) openTabBtn.style.display = 'none';

  inputContainer.appendChild(searchSvg);
  inputContainer.appendChild(searchInput);
  inputContainer.appendChild(openTabBtn);
  inputContainer.appendChild(closeBtn);

  // Tabs (rendered dynamically from config)
  const tabsContainer = document.createElement('div');
  tabsContainer.style.backgroundColor = T.surface;
  tabsContainer.style.borderBottom = `1px solid ${T.divider}`;
  tabsContainer.style.padding = '0 32px';
  tabsContainer.style.gap = '28px';
  tabsContainer.style.display = 'flex';
  tabsContainer.style.alignItems = 'center';

  let activeTab = (SPOTLIGHT_PAGE && pageAnalyzeLog) ? 'debug' : tabConfig.defaultTab;
  // When opened via ?analyzeLog=<id>, the Log Explorer opens this log's analyzer immediately.
  let pendingAnalyzeLogId: string | null = (SPOTLIGHT_PAGE && pageAnalyzeLog) ? pageAnalyzeLog : null;
  // When set (on the Tools tab), a tool detail view is shown in-panel instead of the grid.
  let toolView: string | null = null;
  // Active section in the ⚙ settings panel.
  let settingsCat: 'general' | 'export' = 'general';
  // Debug Logs live auto-refresh timer (cleared when leaving the tab).
  let debugLiveTimer: any = null;
  // Metadata Explorer: currently-selected type id (null = show the type list).
  let metadataType: string | null = null;
  const metadataRecordsCache: Record<string, any[]> = {};
  // Metadata Explorer table sort (persists across search-keystroke re-renders).
  let metadataSortKey: string | null = null;
  let metadataSortDir: 'asc' | 'desc' = 'asc';

  // Results container — fixed height (overlay) so the modal doesn't resize
  // between tabs; flex-fill in full-page mode.
  const resultsContainer = document.createElement('div');
  if (fullPage) { resultsContainer.style.flex = '1'; resultsContainer.style.minHeight = '0'; }
  else { resultsContainer.style.height = '420px'; }
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
      /* Animated moving-highlight border for featured tool tiles. A masked
         gradient ring sits on the tile edge and flows continuously. */
      #sf-log-analyzer-spotlight-container .sf-tool-featured::after {
        content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 2px;
        background: linear-gradient(115deg, #2563eb, #a855f7, #ec4899, #22d3ee, #2563eb);
        background-size: 300% 300%; animation: sfToolBorderFlow 4s linear infinite;
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none;
      }
      @keyframes sfToolBorderFlow { 0% { background-position: 0% 50%; } 100% { background-position: 300% 50%; } }
      @media (prefers-reduced-motion: reduce) {
        #sf-log-analyzer-spotlight-container .sf-tool-featured::after { animation: none; }
      }
    `;
  }

  const noResults = document.createElement('div');
  noResults.style.padding = '64px 32px';
  noResults.style.textAlign = 'center';
  noResults.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${T.textFaint}" stroke-width="2" style="margin: 0 auto 16px"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg><p style="color: ${T.textPrimary}; font-weight: 600; margin: 0; font-size: 16px">No results found</p><p style="color: ${T.textMuted}; font-size: 14px; margin: 8px 0 0 0">Try searching for something else</p>`;
  resultsContainer.appendChild(noResults);

  // ─── Footer (brand + keyboard hints) ───────────────────────
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
  brand.href = 'https://sfspotlight.vercel.app/index.html';
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

  const logo = document.createElement('img');
  try { logo.src = (globalThis as any).chrome?.runtime?.getURL?.('icons/Spotlite-Icon.svg') || ''; } catch { /* ignore */ }
  Object.assign(logo.style, { width: '20px', height: '20px', borderRadius: '5px', flexShrink: '0', display: 'block' });
  // Fallback to a gradient chip if the icon can't load.
  logo.addEventListener('error', () => { logo.style.background = 'linear-gradient(135deg, #4f8cff, #2563eb)'; logo.style.boxShadow = '0 1px 4px rgba(37, 99, 235, 0.45)'; });

  const brandText = document.createElement('div');
  brandText.style.fontSize = '13px';
  brandText.style.whiteSpace = 'nowrap';
  brandText.innerHTML = `<span style="font-weight:800;color:${T.textPrimary};letter-spacing:-0.2px;">SF Spotlight</span>`;

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
    { key: '⏎', label: 'open' },
    { key: 'esc', label: 'close' },
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
  docsLink.href = 'https://sfspotlight.vercel.app/docs.html';
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

  // Reloads the footer identity (greet + org badges) for the ACTIVE session —
  // assigned inside the full-page block, re-invoked by the session switcher.
  let refreshGreet: (() => void) | null = null;

  // Full-page footer greets the logged-in user in a colourful badge.
  if (fullPage) {
    const isDark = currentSpotlightTheme === 'dark';
    const greet = document.createElement('div');
    Object.assign(greet.style, {
      display: 'flex', alignItems: 'center', gap: '9px', marginLeft: '14px', padding: '3px 13px 3px 3px',
      borderRadius: '999px', whiteSpace: 'nowrap', maxWidth: '340px', overflow: 'hidden', flexShrink: '0',
      background: isDark ? 'linear-gradient(135deg, rgba(79,140,255,0.18), rgba(168,85,247,0.16))' : 'linear-gradient(135deg, rgba(37,99,235,0.10), rgba(168,85,247,0.10))',
      border: `1px solid ${isDark ? 'rgba(129,140,248,0.40)' : 'rgba(99,102,241,0.30)'}`,
    });
    const avatar = document.createElement('div');
    Object.assign(avatar.style, { width: '26px', height: '26px', borderRadius: '50%', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', color: '#fff', background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 1px 5px rgba(99,102,241,0.5)' });
    avatar.textContent = '…';
    const txt = document.createElement('div');
    Object.assign(txt.style, { display: 'flex', flexDirection: 'column', lineHeight: '1.2', overflow: 'hidden' });
    const nm = document.createElement('span');
    Object.assign(nm.style, { fontSize: '12px', fontWeight: '700', color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis' });
    nm.textContent = 'Loading…';
    const em = document.createElement('span');
    Object.assign(em.style, { fontSize: '10.5px', color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', display: 'none' });
    txt.appendChild(nm); txt.appendChild(em);
    greet.appendChild(avatar); greet.appendChild(txt);
    hintsBar.appendChild(greet);

    const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() || '').join('') || 'U';

    // Org-context badges: edition · instance · API version · release.
    const badges = document.createElement('div');
    Object.assign(badges.style, { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '10px', overflow: 'hidden', flexShrink: '1' });
    hintsBar.appendChild(badges);
    const mkBadge = (fg: string, bg: string, border: string) => {
      const b = document.createElement('span');
      Object.assign(b.style, { display: 'none', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: '700', whiteSpace: 'nowrap', color: fg, background: bg, border: `1px solid ${border}` });
      badges.appendChild(b);
      return b;
    };
    const fillBadge = (b: HTMLElement, icon: string, text: string) => { if (!text) return; b.innerHTML = `<span style="font-size:11px">${icon}</span>${text}`; b.style.display = 'inline-flex'; };
    const bEd = mkBadge(isDark ? '#fca5a5' : '#b91c1c', 'rgba(239,68,68,0.14)', 'rgba(239,68,68,0.35)');
    const bInst = mkBadge(isDark ? '#93c5fd' : '#1d4ed8', 'rgba(59,130,246,0.14)', 'rgba(59,130,246,0.35)');
    const bVer = mkBadge(isDark ? '#86efac' : '#15803d', 'rgba(34,197,94,0.14)', 'rgba(34,197,94,0.35)');
    const bRel = mkBadge(isDark ? '#c4b5fd' : '#7c3aed', 'rgba(168,85,247,0.14)', 'rgba(168,85,247,0.35)');

    refreshGreet = () => {
      nm.textContent = 'Loading…'; em.style.display = 'none'; avatar.textContent = '…';
      [bEd, bInst, bVer, bRel].forEach((b) => { b.style.display = 'none'; });
      getSfCredentials().then((creds: any) => {
        if (!creds?.instanceUrl || !creds?.sessionId) { nm.textContent = 'Guest'; avatar.textContent = 'G'; return; }
        const msg = { instanceUrl: creds.instanceUrl, sessionId: creds.sessionId };
        (globalThis as any).chrome?.runtime?.sendMessage({ type: 'FETCH_USER_INFO', ...msg }, (r: any) => {
          if (r?.success && r.data) {
            const name = r.data.displayName || r.data.name || 'User';
            const email = r.data.email || r.data.username || '';
            nm.textContent = name;
            avatar.textContent = initialsOf(name);
            if (email) { em.textContent = email; em.style.display = ''; }
          } else { nm.textContent = 'User'; avatar.textContent = 'U'; }
        });
        (globalThis as any).chrome?.runtime?.sendMessage({ type: 'GET_ORG_INFO', ...msg }, (r: any) => {
          if (r?.success && r.data) {
            fillBadge(bEd, '🏛️', r.data.OrganizationType || '');
            fillBadge(bInst, '📍', r.data.InstanceName || '');
          }
        });
        (globalThis as any).chrome?.runtime?.sendMessage({ type: 'GET_RELEASE_INFO', ...msg }, (r: any) => {
          if (r?.success && r.data) {
            fillBadge(bVer, '‹›', r.data.version || '');
            fillBadge(bRel, '☁️', r.data.label || '');
          }
        });
      });
    };
    refreshGreet();
  }

  // ── Footer session switcher: retarget the panel to another org you've visited.
  let sessionSwitcher: { refresh: () => void } | null = null;
  const recordActiveOrg = () => {
    const host = activeSfHost();
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) return;
      const msg = { instanceUrl: creds.instanceUrl, sessionId: creds.sessionId };
      (globalThis as any).chrome?.runtime?.sendMessage({ type: 'GET_ORG_INFO', ...msg }, (r: any) => {
        const label = (r?.success && r.data && (r.data.Name || r.data.InstanceName)) || host;
        (globalThis as any).chrome?.runtime?.sendMessage({ type: 'FETCH_USER_INFO', ...msg }, (u: any) => {
          const user = (u?.success && u.data && (u.data.displayName || u.data.name || u.data.username)) || undefined;
          recordVisitedOrg({ host, instanceUrl: creds.instanceUrl, label, user });
          sessionSwitcher?.refresh();
        });
      });
    });
  };

  const switcherWrap = document.createElement('div');
  Object.assign(switcherWrap.style, { marginLeft: '12px', flexShrink: '0' });
  hintsBar.appendChild(switcherWrap);
  sessionSwitcher = renderSessionSwitcherInto(switcherWrap, {
    isDark: currentSpotlightTheme === 'dark',
    flashToast,
    onSwitched: () => { refreshGreet?.(); recordActiveOrg(); performSearch(); },
  });
  recordActiveOrg();

  hintsBar.appendChild(hintsRight);

  // Live API-activity console — transparency panel above the footer.
  const apiConsoleWrap = document.createElement('div');
  apiConsoleWrap.style.flexShrink = '0';
  apiConsoleHandle = renderApiConsoleInto(apiConsoleWrap, { isDark });

  modal.appendChild(tabsContainer);   // tabs on top
  modal.appendChild(inputContainer);
  modal.appendChild(resultsContainer);
  modal.appendChild(apiConsoleWrap);  // console sits between results and footer
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
  // Per-user actions, reused by the ⋯ menu (overlay) and inline buttons (full page).
  const userActions = (user: { id: string; name: string; email?: string; username?: string }): { label: string; short: string; icon: string; onClick: () => void }[] => {
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
    return [
      { label: 'View all fields', short: 'Fields', icon: '🗂️', onClick: () => showRecordDetail(user.id) },
      { label: 'Open user detail', short: 'Detail', icon: '👤', onClick: () => {
          const url = `${lightningOrigin()}/lightning/setup/ManageUsers/page?address=%2F${user.id}%3Fnoredirect%3D1%26isUserEntityOverride%3D1`;
          recordRecent({ kind: 'user', icon: '👤', title: user.name, subtitle: user.email || user.username, meta: 'User', url });
          window.open(url, '_blank');
          hideSpotlightSearch();
        } },
      { label: 'Enable debug mode', short: 'Debug On', icon: '🐞', onClick: () => setDebugMode(true) },
      { label: 'Disable debug mode', short: 'Debug Off', icon: '🚫', onClick: () => setDebugMode(false) },
    ];
  };

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

    const items = userActions(user);

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

  const fetchDebugLogs = async (): Promise<any[]> => {
    try {
      const credentials = await getSfCredentials();
      if (!credentials?.sessionId || !credentials?.instanceUrl) return [];
      return await new Promise<any[]>((resolve) => {
        (globalThis as any).chrome.runtime.sendMessage(
          { type: 'GET_DEBUG_LOGS', instanceUrl: credentials.instanceUrl, sessionId: credentials.sessionId, userId: currentUserId },
          (response: any) => resolve(response?.success && response?.data ? response.data : [])
        );
      });
    } catch (error) {
      console.error('Error fetching debug logs:', error);
      return [];
    }
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

      const favs = getFavorites().filter(matches);
      const pinnedKeys = new Set(getFavorites().map(f => `${f.kind}|${f.url}`));
      const recents = getRecents().filter(r => !pinnedKeys.has(`${r.kind}|${r.url}`)).filter(matches);

      if (favs.length === 0 && recents.length === 0) {
        showMessage(getFavorites().length === 0 && getRecents().length === 0
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

      // User-defined shortcuts that match (shown first, above the built-in links).
      const customMatches = getCustomShortcuts().filter(s =>
        s.label.toLowerCase().includes(query) || s.url.toLowerCase().includes(query)
      );

      if (filtered.length === 0 && customMatches.length === 0) {
        resultsContainer.appendChild(noResults.cloneNode(true));
        return;
      }

      const resultsList = document.createElement('div');

      customMatches.forEach((s, index) => {
        const fullUrl = resolveShortcutUrl(s.url);
        const entry = { kind: 'shortcut', icon: '🔖', title: s.label, subtitle: 'Custom Shortcut', url: fullUrl };
        resultsList.appendChild(makeResultRow({
          icon: '🔖',
          title: s.label,
          subtitle: 'Custom Shortcut',
          meta: s.url,
          first: index === 0,
          fav: entry,
          onClick: () => {
            recordRecent(entry);
            window.open(fullUrl, '_blank');
            hideSpotlightSearch();
          },
        }));
      });

      filtered.forEach((link, idx) => {
        const index = idx + customMatches.length;
        const fullUrl = link.isExternal ? link.link : `${lightningOrigin()}${link.link}`;
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
      // ── Master view: list of metadata types ──
      if (!metadataType) {
        (searchInput as HTMLInputElement).placeholder = 'Search metadata types...';
        let types = METADATA_CATALOG;
        if (query.length > 0) types = types.filter((t) => t.label.toLowerCase().includes(query) || t.id.toLowerCase().includes(query));
        if (types.length === 0) { showMessage('No metadata types match your search.'); return; }
        const list = document.createElement('div');
        types.forEach((t, index) => {
          list.appendChild(makeResultRow({
            icon: t.icon,
            title: t.label,
            subtitle: `${t.tooling ? 'Tooling API' : 'Data API'} · ${t.id}`,
            meta: 'Open ▸',
            first: index === 0,
            onClick: () => { metadataType = t.id; metadataSortKey = null; (searchInput as HTMLInputElement).value = ''; performSearch(); (searchInput as HTMLInputElement).focus(); },
          }));
        });
        resultsContainer.appendChild(list);
        return;
      }

      // ── Detail view: records of the selected type, in a searchable table ──
      const cat = METADATA_CATALOG.find((t) => t.id === metadataType);
      if (!cat) { metadataType = null; performSearch(); return; }
      (searchInput as HTMLInputElement).placeholder = `Search ${cat.label}...`;

      const idField = cat.idField || 'Id';
      // Columns shown = catalog columns + an auto Namespace column where supported.
      const displayColumns: { key: string; label: string }[] = [...cat.columns];
      if (cat.namespace && !displayColumns.some((c) => c.key === 'NamespacePrefix')) {
        displayColumns.push({ key: 'NamespacePrefix', label: 'Namespace' });
      }
      const ensureField = (soql: string, field: string): string => {
        const selectClause = soql.split(/\sFROM\s/i)[0] || '';
        if (new RegExp(`(^|[\\s,])${field}([\\s,]|$)`, 'i').test(selectClause)) return soql;
        return soql.replace(/^SELECT\s/i, `SELECT ${field}, `);
      };
      const fetchMeta = (c: MetaType) => new Promise<{ records: any[]; error?: string }>((resolve) => {
        getSfCredentials().then((creds: any) => {
          if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ records: [], error: 'Salesforce session not detected' }); return; }
          // Ensure the id field (for the row link) and NamespacePrefix are selected.
          let soql = ensureField(c.soql, idField);
          if (c.namespace) soql = ensureField(soql, 'NamespacePrefix');
          (globalThis as any).chrome.runtime.sendMessage(
            { type: 'METADATA_QUERY', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, query: soql, tooling: c.tooling },
            (resp: any) => resolve(resp?.success ? { records: resp.data || [] } : { records: [], error: resp?.error || 'Query failed' }),
          );
        });
      });

      const getVal = (rec: any, key: string) => key.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), rec);
      const fmtVal = (key: string, v: any): string => {
        if (v == null) return '';
        if (typeof v === 'boolean') return v ? '✓' : '✗';
        if ((key.includes('Date') || key.includes('Time')) && typeof v === 'string') { const d = new Date(v); if (!isNaN(d.getTime())) return d.toLocaleString(); }
        return String(v);
      };

      const root = document.createElement('div');
      Object.assign(root.style, { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column' });
      resultsContainer.appendChild(root);

      const head = document.createElement('div');
      Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 4px 12px', flexShrink: '0', borderBottom: `1px solid ${T.divider}` });
      const back = document.createElement('button');
      back.innerHTML = '← Types';
      Object.assign(back.style, { background: 'transparent', border: `1px solid ${T.chipBorder}`, color: T.textPrimary, borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit', flexShrink: '0' });
      back.addEventListener('click', () => { metadataType = null; (searchInput as HTMLInputElement).value = ''; performSearch(); });
      head.appendChild(back);
      const title = document.createElement('div');
      title.style.color = T.textPrimary;
      title.innerHTML = `<span style="font-size:15px">${cat.icon}</span> <span style="font-weight:800;font-size:14px">${cat.label}</span>`;
      head.appendChild(title);
      const countEl = document.createElement('span');
      Object.assign(countEl.style, { marginLeft: 'auto', fontSize: '12px', color: T.textMuted });
      head.appendChild(countEl);
      const refresh = document.createElement('button');
      refresh.textContent = '↻';
      refresh.title = 'Reload';
      Object.assign(refresh.style, { background: 'transparent', border: `1px solid ${T.chipBorder}`, color: T.textPrimary, borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', flexShrink: '0' });
      refresh.addEventListener('click', () => { delete metadataRecordsCache[cat.id]; performSearch(); });
      head.appendChild(refresh);
      root.appendChild(head);

      const tableScroll = document.createElement('div');
      Object.assign(tableScroll.style, { flex: '1', minHeight: '0', overflow: 'auto' });
      root.appendChild(tableScroll);

      let mdRecords = metadataRecordsCache[cat.id];
      if (!mdRecords) {
        const loading = document.createElement('div');
        Object.assign(loading.style, { padding: '20px', color: T.textMuted, fontSize: '13px' });
        loading.textContent = 'Loading…';
        tableScroll.appendChild(loading);
        const res = await fetchMeta(cat);
        tableScroll.innerHTML = '';
        if (res.error) {
          const err = document.createElement('div');
          Object.assign(err.style, { padding: '20px', color: '#ef4444', fontSize: '13px', whiteSpace: 'pre-wrap' });
          err.textContent = `Could not load ${cat.label}:\n${res.error}`;
          tableScroll.appendChild(err);
          countEl.textContent = '';
          return;
        }
        mdRecords = res.records;
        metadataRecordsCache[cat.id] = mdRecords;
      }

      const filteredRecords = query.length === 0 ? mdRecords : mdRecords.filter((r) => displayColumns.some((c) => fmtVal(c.key, getVal(r, c.key)).toLowerCase().includes(query)));
      countEl.textContent = `${filteredRecords.length.toLocaleString()}${query ? ` / ${mdRecords.length.toLocaleString()}` : ''} record${filteredRecords.length === 1 ? '' : 's'}`;

      // Sort (persisted across re-renders via metadataSortKey/Dir).
      const sortedRecords = (() => {
        if (!metadataSortKey) return filteredRecords;
        const key = metadataSortKey;
        const isDate = key.includes('Date') || key.includes('Time');
        const cmp = (a: any, b: any) => {
          const va = getVal(a, key), vb = getVal(b, key);
          if (isDate) return (Date.parse(va) || 0) - (Date.parse(vb) || 0);
          const na = Number(va), nb = Number(vb);
          if (va !== '' && vb !== '' && va != null && vb != null && !isNaN(na) && !isNaN(nb)) return na - nb;
          return String(va ?? '').toLowerCase().localeCompare(String(vb ?? '').toLowerCase());
        };
        return [...filteredRecords].sort((a, b) => { const c = cmp(a, b); return metadataSortDir === 'asc' ? c : -c; });
      })();

      if (mdRecords.length === 0) {
        const empty = document.createElement('div');
        Object.assign(empty.style, { padding: '20px', color: T.textMuted, fontSize: '13px' });
        empty.textContent = `No ${cat.label} found in this org (or no access).`;
        tableScroll.appendChild(empty);
        return;
      }

      const table = document.createElement('table');
      Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' });
      const thStyle = { position: 'sticky', top: '0', textAlign: 'left', padding: '8px 12px', background: currentSpotlightTheme === 'dark' ? '#1e293b' : '#ffffff', color: T.textPrimary, fontWeight: '700', whiteSpace: 'nowrap', borderBottom: `1px solid ${T.chipBorder}`, zIndex: '1' } as Partial<CSSStyleDeclaration>;
      const thead = document.createElement('thead'); const htr = document.createElement('tr');
      const headerCols: { key: string; label: string }[] = [{ key: idField, label: 'Id' }, ...displayColumns];
      headerCols.forEach((c) => {
        const th = document.createElement('th'); Object.assign(th.style, { ...thStyle, cursor: 'pointer', userSelect: 'none' });
        const active = metadataSortKey === c.key;
        th.innerHTML = `${c.label} <span style="color:${active ? T.accent : T.textFaint};font-size:11px">${active ? (metadataSortDir === 'asc' ? '▲' : '▼') : '↕'}</span>`;
        th.addEventListener('click', () => {
          if (metadataSortKey === c.key) metadataSortDir = metadataSortDir === 'asc' ? 'desc' : 'asc';
          else { metadataSortKey = c.key; metadataSortDir = 'asc'; }
          performSearch();
        });
        htr.appendChild(th);
      });
      thead.appendChild(htr); table.appendChild(thead);
      const tbody = document.createElement('tbody');
      const tdStyle = { padding: '6px 12px', color: T.textPrimary, whiteSpace: 'nowrap', borderBottom: `1px solid ${T.divider}`, maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis' } as Partial<CSSStyleDeclaration>;
      sortedRecords.forEach((r, ri) => {
        const tr = document.createElement('tr');
        if (ri % 2 === 1) tr.style.background = T.surface;
        tr.addEventListener('mouseover', () => (tr.style.background = T.rowHover));
        tr.addEventListener('mouseout', () => (tr.style.background = ri % 2 === 1 ? T.surface : ''));
        // Id cell — links to the metadata record in Salesforce.
        const idTd = document.createElement('td'); Object.assign(idTd.style, { ...tdStyle, maxWidth: '160px' });
        const idVal = r[idField];
        if (idVal) {
          const a = document.createElement('a');
          a.textContent = String(idVal);
          a.href = `${lightningOrigin()}/${idVal}`;
          a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.title = `Open ${idVal}`;
          Object.assign(a.style, { color: T.accent, textDecoration: 'none', fontFamily: 'Fira Code, monospace', fontSize: '11.5px' });
          a.addEventListener('mouseover', () => (a.style.textDecoration = 'underline'));
          a.addEventListener('mouseout', () => (a.style.textDecoration = 'none'));
          idTd.appendChild(a);
        } else { idTd.textContent = '—'; idTd.style.color = T.textFaint; }
        tr.appendChild(idTd);
        displayColumns.forEach((c) => {
          const td = document.createElement('td'); Object.assign(td.style, tdStyle);
          const val = fmtVal(c.key, getVal(r, c.key));
          td.textContent = val || (c.key === 'NamespacePrefix' ? '' : val); td.title = val;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableScroll.appendChild(table);
      if (filteredRecords.length === 0) {
        const none = document.createElement('div'); Object.assign(none.style, { padding: '16px', color: T.textMuted, fontSize: '13px' });
        none.textContent = 'No records match your search.'; tableScroll.appendChild(none);
      }
      return;

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
        resultItem.style.boxSizing = 'border-box';
        resultItem.style.maxWidth = '100%';
        resultItem.style.overflow = 'hidden';
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
        email.style.overflow = 'hidden';
        email.style.textOverflow = 'ellipsis';
        email.style.whiteSpace = 'nowrap';
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
            { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(sfHostname()) },
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
            { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(sfHostname()) },
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
        // Full-page tab has room, so show every action as its own button; the
        // overlay keeps the compact ⋯ menu.
        if (fullPage) {
          userActions(user).forEach((a) => {
            const ab = document.createElement('button');
            ab.title = a.label;
            ab.innerHTML = `<span style="margin-right:4px">${a.icon}</span>${a.short}`;
            Object.assign(ab.style, {
              padding: '6px 10px', backgroundColor: T.surface, color: T.textPrimary, border: 'none',
              borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: '0',
            });
            ab.addEventListener('mouseover', () => { ab.style.backgroundColor = T.surfaceHover; });
            ab.addEventListener('mouseout', () => { ab.style.backgroundColor = T.surface; });
            ab.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
            buttonGroup.appendChild(ab);
          });
        } else {
          buttonGroup.appendChild(moreBtn);
        }
        resultItem.appendChild(contentContainer);
        resultItem.appendChild(arrowIcon);
        resultItem.appendChild(buttonGroup);

        resultItem.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const chromeRuntime = (globalThis as any).chrome?.runtime;
          if (!chromeRuntime) return;
          chromeRuntime.sendMessage(
            { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(sfHostname()) },
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

    } else if (activeTab === 'apextests') {
      inputContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      const sendMsg = (extra: any) => new Promise<any>((resolve) => {
        getSfCredentials().then((creds: any) => {
          if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ success: false, error: 'Salesforce session not detected' }); return; }
          (globalThis as any).chrome.runtime.sendMessage({ instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, ...extra }, (resp: any) => resolve(resp || { success: false, error: 'No response' }));
        });
      });
      renderApexTestsInto(resultsContainer, {
        isDark: currentSpotlightTheme === 'dark',
        orgLabel: sfHostname(),
        flashToast,
        runQuery: (soql: string, tooling = false) => sendMsg({ type: 'METADATA_QUERY', query: soql, tooling }).then((r) => (r.success ? { records: r.data || [] } : { records: [], error: r.error || 'Query failed' })),
        runTests: (payload: any) => sendMsg({ type: 'APEX_RUN_TESTS', payload }).then((r) => (r.success ? { jobId: r.jobId } : { error: r.error || 'Failed to run tests' })),
      });
      return;

    } else if (activeTab === 'access') {
      inputContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      renderAccessExplorerInto(resultsContainer, {
        isDark: currentSpotlightTheme === 'dark',
        hideBack: true,
        flashToast,
        runQuery: (soql: string) => new Promise((resolve) => {
          getSfCredentials().then((creds: any) => {
            if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ records: [], error: 'Salesforce session not detected' }); return; }
            (globalThis as any).chrome.runtime.sendMessage({ type: 'METADATA_QUERY', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, query: soql, tooling: false }, (resp: any) => resolve(resp?.success ? { records: resp.data || [] } : { records: [], error: resp?.error || 'Query failed' }));
          });
        }),
      });
      return;

    } else if (activeTab === 'debug') {
      inputContainer.style.display = 'none';
      await ensureCurrentUserId();
      resultsContainer.innerHTML = '';
      if (debugLiveTimer) { clearInterval(debugLiveTimer); debugLiveTimer = null; }

      const C2 = { border: T.chipBorder, divider: T.divider, headerBg: T.surface, textPrimary: T.textPrimary, textMuted: T.textMuted, textFaint: T.textFaint, zebra: T.surface, accent: T.accent, hover: T.rowHover };
      let logs: any[] = cachedDebugLogs || [];
      let sortKey = 'StartTime';
      let sortDir: 'asc' | 'desc' = 'desc';
      const selected = new Set<string>();
      let live = false;

      const root = document.createElement('div');
      Object.assign(root.style, { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column' });
      resultsContainer.appendChild(root);
      const tableScroll = document.createElement('div');
      Object.assign(tableScroll.style, { flex: '1', minHeight: '0', overflow: 'auto' });
      root.appendChild(tableScroll);
      const footer = document.createElement('div');
      Object.assign(footer.style, { flexShrink: '0', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderTop: `1px solid ${C2.divider}`, background: C2.headerBg });
      root.appendChild(footer);

      const dateOf = (s: string) => { try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
      const timeOf = (s: string) => { try { return new Date(s).toLocaleTimeString(); } catch { return ''; } };
      const sortVal = (l: any) => { switch (sortKey) { case 'DurationMilliseconds': return l.DurationMilliseconds ?? 0; case 'LogLength': return l.LogLength ?? 0; case 'Operation': return (l.Operation || '').toLowerCase(); case 'User': return (l.LogUser?.Name || '').toLowerCase(); default: return new Date(l.StartTime).getTime() || 0; } };
      const sortedLogs = () => [...logs].sort((a, b) => { const va = sortVal(a), vb = sortVal(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return sortDir === 'asc' ? c : -c; });

      const withLogBody = (id: string, cb: (body: string) => void) => {
        getSfCredentials().then((creds: any) => {
          if (!creds?.instanceUrl || !creds?.sessionId) { flashToast('Session not detected'); return; }
          (globalThis as any).chrome.runtime.sendMessage({ type: 'FETCH_LOG_BODY', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, logId: id }, (resp: any) => {
            if (resp?.success && typeof resp.data === 'string') cb(resp.data);
            else flashToast(resp?.error || 'Could not load log');
          });
        });
      };
      const viewLog = (id: string) => withLogBody(id, (body) => { window.open(URL.createObjectURL(new Blob([body], { type: 'text/plain' })), '_blank'); });
      const copyLog = (id: string) => withLogBody(id, (body) => navigator.clipboard?.writeText(body).then(() => flashToast('Log copied')).catch(() => {}));
      const downloadLog = (id: string) => withLogBody(id, (body) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' })); a.download = `${id}.log`; document.body.appendChild(a); a.click(); a.remove(); });
      const openAnalyzer = (id: string, name: string) => {
        if (debugLiveTimer) { clearInterval(debugLiveTimer); debugLiveTimer = null; }
        resultsContainer.innerHTML = '';
        const loading = document.createElement('div');
        Object.assign(loading.style, { padding: '24px', color: C2.textMuted, fontSize: '13px' });
        loading.textContent = 'Loading log…';
        resultsContainer.appendChild(loading);
        withLogBody(id, (body) => {
          resultsContainer.innerHTML = '';
          renderLogAnalyzerInto(resultsContainer, body, { isDark: currentSpotlightTheme === 'dark', logName: name, onBack: () => performSearch() });
        });
      };

      // Deep-link: opened via ?analyzeLog=<id> — jump straight into the analyzer.
      if (pendingAnalyzeLogId) {
        const id = pendingAnalyzeLogId;
        pendingAnalyzeLogId = null;
        openAnalyzer(id, id);
        return;
      }

      const COLS: { key: string; label: string; sk: string }[] = [
        { key: 'DurationMilliseconds', label: 'Duration (ms)', sk: 'DurationMilliseconds' },
        { key: 'LogLength', label: 'Size (Bytes)', sk: 'LogLength' },
        { key: 'Operation', label: 'Operation', sk: 'Operation' },
        { key: 'Date', label: 'Date', sk: 'StartTime' },
        { key: 'Time', label: 'Time', sk: 'StartTime' },
        { key: 'User', label: 'User', sk: 'User' },
      ];
      const actBtn = (label: string, title: string, onClick: () => void) => {
        const b = document.createElement('button'); b.textContent = label; b.title = title;
        Object.assign(b.style, { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '2px 6px', color: C2.textMuted, borderRadius: '5px' });
        b.addEventListener('mouseover', () => { b.style.color = C2.textPrimary; b.style.background = C2.hover; });
        b.addEventListener('mouseout', () => { b.style.color = C2.textMuted; b.style.background = 'transparent'; });
        b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return b;
      };

      const renderTable = () => {
        tableScroll.innerHTML = '';
        const rows = sortedLogs();
        if (rows.length === 0) {
          const d = document.createElement('div'); d.textContent = 'No debug logs for you yet. Start a debug session (Tools › Debug Sessions) to capture logs.';
          Object.assign(d.style, { padding: '24px', color: C2.textMuted, fontSize: '13px' }); tableScroll.appendChild(d); return;
        }
        const table = document.createElement('table');
        Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', fontSize: '13px' });
        const thStyle = { position: 'sticky', top: '0', textAlign: 'left', padding: '8px 12px', background: currentSpotlightTheme === 'dark' ? '#1e293b' : '#ffffff', color: C2.textPrimary, fontWeight: '700', whiteSpace: 'nowrap', border: `1px solid ${C2.border}` } as Partial<CSSStyleDeclaration>;
        const thead = document.createElement('thead'); const htr = document.createElement('tr');
        const selTh = document.createElement('th'); Object.assign(selTh.style, thStyle);
        const selAll = document.createElement('input'); selAll.type = 'checkbox'; selAll.style.cursor = 'pointer';
        selAll.checked = rows.every((l) => selected.has(l.Id));
        selAll.addEventListener('change', () => { rows.forEach((l) => { if (selAll.checked) selected.add(l.Id); else selected.delete(l.Id); }); renderTable(); updateFooter(); });
        const selLbl = document.createElement('span'); selLbl.textContent = ' Select All'; selLbl.style.fontWeight = '700';
        selTh.appendChild(selAll); selTh.appendChild(selLbl); htr.appendChild(selTh);
        COLS.forEach((c) => {
          const th = document.createElement('th'); Object.assign(th.style, thStyle); th.style.cursor = 'pointer';
          const active = sortKey === c.sk;
          th.innerHTML = `${c.label} <span style="color:${active ? C2.accent : C2.textFaint};font-size:11px">${active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>`;
          th.addEventListener('click', () => { if (sortKey === c.sk) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = c.sk; sortDir = 'asc'; } renderTable(); });
          htr.appendChild(th);
        });
        const actTh = document.createElement('th'); Object.assign(actTh.style, thStyle); actTh.textContent = 'Actions'; htr.appendChild(actTh);
        thead.appendChild(htr); table.appendChild(thead);
        const tbody = document.createElement('tbody');
        const tdStyle = { padding: '6px 12px', color: C2.textPrimary, whiteSpace: 'nowrap', border: `1px solid ${C2.divider}` } as Partial<CSSStyleDeclaration>;
        rows.forEach((l, ri) => {
          const tr = document.createElement('tr'); if (ri % 2 === 1) tr.style.background = C2.zebra;
          const cbTd = document.createElement('td'); Object.assign(cbTd.style, tdStyle);
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.style.cursor = 'pointer'; cb.checked = selected.has(l.Id);
          cb.addEventListener('change', () => { if (cb.checked) selected.add(l.Id); else selected.delete(l.Id); updateFooter(); });
          cbTd.appendChild(cb); tr.appendChild(cbTd);
          [String(l.DurationMilliseconds ?? ''), (l.LogLength ?? 0).toLocaleString(), l.Operation || '', dateOf(l.StartTime), timeOf(l.StartTime), l.LogUser?.Name || ''].forEach((v) => { const td = document.createElement('td'); Object.assign(td.style, tdStyle); td.textContent = v; tr.appendChild(td); });
          const aTd = document.createElement('td'); Object.assign(aTd.style, tdStyle);
          const anBtn = document.createElement('button');
          anBtn.textContent = 'Analyze';
          Object.assign(anBtn.style, { fontSize: '12px', fontWeight: '700', padding: '3px 10px', borderRadius: '6px', border: `1px solid ${C2.accent}`, background: 'transparent', color: C2.accent, cursor: 'pointer', marginRight: '6px', fontFamily: 'inherit' });
          anBtn.addEventListener('mouseover', () => { anBtn.style.background = C2.accent; anBtn.style.color = '#fff'; });
          anBtn.addEventListener('mouseout', () => { anBtn.style.background = 'transparent'; anBtn.style.color = C2.accent; });
          anBtn.addEventListener('click', (e) => { e.stopPropagation(); openAnalyzer(l.Id, l.Operation || l.Id); });
          aTd.appendChild(anBtn);
          aTd.appendChild(actBtn('↗', 'Open in new tab', () => viewLog(l.Id)));
          aTd.appendChild(actBtn('📄', 'Copy log body', () => copyLog(l.Id)));
          aTd.appendChild(actBtn('⬇', 'Download', () => downloadLog(l.Id)));
          tr.appendChild(aTd);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); tableScroll.appendChild(table);
      };

      // ── Footer ──
      const liveBtn = document.createElement('button');
      const refreshBtn = document.createElement('button'); refreshBtn.textContent = '↻'; refreshBtn.title = 'Refresh';
      const delBtn = document.createElement('button'); delBtn.textContent = '🗑'; delBtn.title = 'Delete selected';
      const dlSelBtn = document.createElement('button'); dlSelBtn.textContent = 'Download Selected ⬇';
      const fstatus = document.createElement('span'); Object.assign(fstatus.style, { marginLeft: 'auto', fontSize: '12px', color: C2.textMuted });
      const baseBtn = { fontSize: '13px', fontWeight: '600', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C2.border}`, background: 'transparent', color: C2.textPrimary } as Partial<CSSStyleDeclaration>;
      Object.assign(refreshBtn.style, baseBtn); Object.assign(dlSelBtn.style, baseBtn);
      Object.assign(delBtn.style, { ...baseBtn, border: '1px solid #ef4444', color: '#ef4444' });
      const paintLive = () => { liveBtn.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${live ? '#22c55e' : C2.textFaint};margin-right:6px"></span>LIVE`; Object.assign(liveBtn.style, { ...baseBtn, borderColor: live ? '#22c55e' : C2.border, color: live ? '#16a34a' : C2.textPrimary }); };
      paintLive();
      const updateFooter = () => { fstatus.textContent = `${selected.size} selected · ${logs.length} log${logs.length === 1 ? '' : 's'}`; };

      const refresh = (loading: boolean) => { if (loading) fstatus.textContent = 'Loading…'; fetchDebugLogs().then((l) => { cachedDebugLogs = l; logs = l; [...selected].forEach((id) => { if (!logs.some((x) => x.Id === id)) selected.delete(id); }); renderTable(); updateFooter(); }); };
      liveBtn.addEventListener('click', () => { live = !live; if (live) { debugLiveTimer = setInterval(() => refresh(false), 4000); } else if (debugLiveTimer) { clearInterval(debugLiveTimer); debugLiveTimer = null; } paintLive(); });
      refreshBtn.addEventListener('click', () => refresh(true));
      delBtn.addEventListener('click', () => {
        if (selected.size === 0) { flashToast('Select logs to delete'); return; }
        if (!window.confirm(`Delete ${selected.size} log(s)? This can't be undone.`)) return;
        getSfCredentials().then((creds: any) => {
          if (!creds?.instanceUrl) return;
          const ids = [...selected]; let done = 0;
          ids.forEach((id) => (globalThis as any).chrome.runtime.sendMessage({ type: 'DELETE_APEX_LOG', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, logId: id }, () => { done++; if (done === ids.length) { selected.clear(); flashToast('Deleted'); refresh(true); } }));
        });
      });
      dlSelBtn.addEventListener('click', () => { if (selected.size === 0) { flashToast('Select logs to download'); return; } [...selected].forEach((id) => downloadLog(id)); });
      [liveBtn, refreshBtn, delBtn, dlSelBtn, fstatus].forEach((el) => footer.appendChild(el));

      renderTable(); updateFooter();
      refresh(logs.length === 0);
      return;

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
      // The search bar is dead weight inside the query editor — hide it for Export/Builder.
      inputContainer.style.display = (toolView === 'export' || toolView === 'querybuilder' || toolView === 'permcompare' || toolView === 'accessmap' || toolView === 'dataimport' || toolView === 'sampledata' || toolView === 'magicfill' || toolView === 'orglimits' || toolView === 'shortcuts' || toolView === 'objectmanager' || toolView === 'executeanonymous' || toolView === 'automationmap') ? 'none' : 'flex';
      if (toolView) {
        const isDark = currentSpotlightTheme === 'dark';
        const onBack = () => { inputContainer.style.display = 'flex'; toolView = null; performSearch(); };
        if (toolView === 'export') { renderExportInto(resultsContainer, isDark, onBack, () => { toolView = 'querybuilder'; performSearch(); }); return; }
        if (toolView === 'querybuilder') { renderQueryBuilderInto(resultsContainer, isDark, () => { toolView = 'export'; performSearch(); }, (query, run) => { pendingExportQuery = query; pendingExportRun = run; toolView = 'export'; performSearch(); }); return; }
        if (toolView === 'orgdetails') { renderOrgDetailsInto(resultsContainer, isDark, onBack); return; }
        if (toolView === 'release') { renderReleaseInfoInto(resultsContainer, isDark, onBack); return; }
        if (toolView === 'apiusage') { renderOrgLimitsInto(resultsContainer, isDark, onBack, { title: '📊  API Usage', fields: API_FIELDS }); return; }
        if (toolView === 'storage') { renderOrgLimitsInto(resultsContainer, isDark, onBack, { title: '💾  Storage Insights', fields: STORAGE_FIELDS }); return; }
        const dataQuery = (soql: string) => new Promise<{ records: any[]; error?: string }>((resolve) => {
          getSfCredentials().then((creds: any) => {
            if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ records: [], error: 'Salesforce session not detected' }); return; }
            (globalThis as any).chrome.runtime.sendMessage(
              { type: 'METADATA_QUERY', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, query: soql, tooling: false },
              (resp: any) => resolve(resp?.success ? { records: resp.data || [] } : { records: [], error: resp?.error || 'Query failed' }),
            );
          });
        });
        if (toolView === 'permcompare') {
          renderPermissionCompareInto(resultsContainer, { isDark, onBack, flashToast, runQuery: dataQuery });
          return;
        }
        if (toolView === 'accessmap') {
          renderAccessExplorerInto(resultsContainer, { isDark, onBack, flashToast, runQuery: dataQuery });
          return;
        }
        if (toolView === 'dataimport') {
          const sendImport = (extra: any) => new Promise<any>((resolve) => {
            getSfCredentials().then((creds: any) => {
              if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ success: false, error: 'Salesforce session not detected' }); return; }
              (globalThis as any).chrome.runtime.sendMessage({ instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, ...extra }, (resp: any) => resolve(resp || { success: false, error: 'No response' }));
            });
          });
          renderDataImportInto(resultsContainer, {
            isDark, onBack, flashToast,
            recordUrl: (id: string) => `${lightningOrigin()}/${id}`,
            listObjects: () => new Promise((res) => getSoqlObjects((list) => res(list))),
            describeObject: (name: string) => sendImport({ type: 'DESCRIBE_SOBJECT_IMPORT', objectApiName: name }).then((r) => (r.success ? { fields: r.data || [] } : { fields: [], error: r.error })),
            runImport: (payload: any) => sendImport({ type: 'DATA_IMPORT', ...payload }).then((r) => (r.success ? { results: r.results } : { error: r.error })),
            fetchRecord: (id: string, objectApiName?: string) => sendImport({ type: 'GET_RECORD_DETAIL', recordId: id, objectApiName }).then((r) => (r.success ? { data: r.data } : { error: r.error })),
          });
          return;
        }
        if (toolView === 'sampledata') {
          const sendBg = (extra: any) => new Promise<any>((resolve) => {
            getSfCredentials().then((creds: any) => {
              if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ success: false, error: 'Salesforce session not detected' }); return; }
              (globalThis as any).chrome.runtime.sendMessage({ instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, ...extra }, (resp: any) => resolve(resp || { success: false, error: 'No response' }));
            });
          });
          renderSampleDataInto(resultsContainer, {
            isDark, onBack, flashToast,
            recordUrl: (id: string) => `${lightningOrigin()}/${id}`,
            listObjects: () => new Promise((res) => getSoqlObjects((list) => res(list))),
            describeObject: (name: string) => sendBg({ type: 'DESCRIBE_FOR_SAMPLE', objectApiName: name }).then((r) => (r.success ? r.data : { error: r.error })),
            orgInfo: () => sendBg({ type: 'GET_ORG_INFO' }).then((r) => (r.success && r.data ? { isSandbox: r.data.IsSandbox === true, orgType: r.data.OrganizationType || '', trialExpiration: r.data.TrialExpirationDate || null, name: r.data.Name } : null)),
            queryRecords: dataQuery,
            insertRecords: (_obj: string, records: any[]) => sendBg({ type: 'DATA_IMPORT', operation: 'insert', allOrNone: false, records }).then((r) => (r.success ? { results: r.results } : { error: r.error })),
            deleteRecords: (ids: string[]) => sendBg({ type: 'DATA_IMPORT', operation: 'delete', ids, allOrNone: false }).then((r) => (r.success ? { results: r.results } : { error: r.error })),
          });
          return;
        }
        if (toolView === 'magicfill') {
          renderMagicFillSettingsInto(resultsContainer, isDark, onBack);
          return;
        }
        if (toolView === 'shortcuts') {
          renderCustomShortcutsInto(resultsContainer, { isDark, onBack, flashToast });
          return;
        }
        if (toolView === 'orglimits') {
          const fetchLimits = () => new Promise<{ data?: Record<string, { Max: number; Remaining: number }>; error?: string }>((resolve) => {
            getSfCredentials().then((creds: any) => {
              if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ error: 'Salesforce session not detected' }); return; }
              (globalThis as any).chrome.runtime.sendMessage(
                { type: 'GET_ORG_LIMITS', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId },
                (resp: any) => resolve(resp?.success && resp.data ? { data: resp.data } : { error: resp?.error || 'Could not load limits.' }),
              );
            });
          });
          renderOrgLimitsExplorerInto(resultsContainer, { isDark, onBack, flashToast, fetchLimits });
          return;
        }
        if (toolView === 'objectmanager') {
          // Generic background bridge: attaches org credentials to every message
          // so the Object Manager feature stays chrome-free.
          const sendBg = <T,>(msg: Record<string, unknown>): Promise<T> => new Promise((resolve) => {
            getSfCredentials().then((creds: any) => {
              if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ success: false, error: 'Salesforce session not detected' } as T); return; }
              (globalThis as any).chrome.runtime.sendMessage(
                { instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, ...msg },
                (resp: any) => resolve((resp ?? { success: false, error: 'No response from extension' }) as T),
              );
            });
          });
          renderObjectManagerInto(resultsContainer, {
            isDark, onBack, flashToast,
            setupOrigin,
            listObjects: () => sendBg<{ success: boolean; data?: any[]; error?: string }>({ type: 'GET_ALL_OBJECTS' })
              .then((r) => (r.success && r.data
                ? { data: r.data.map((o: any): SfObjectRef => ({ apiName: o.QualifiedApiName, label: o.Label || o.QualifiedApiName, custom: /__c$/i.test(o.QualifiedApiName) })).sort((a: SfObjectRef, b: SfObjectRef) => a.label.localeCompare(b.label)) }
                : { error: r.error || 'Could not load objects.' })),
            createObject: (fullName, metadata) => sendBg({ type: 'CREATE_CUSTOM_OBJECT', fullName, metadata }),
            createField: (fullName, metadata) => sendBg({ type: 'CREATE_CUSTOM_FIELD', fullName, metadata }),
            listFlsTargets: () => sendBg<{ success: boolean; data?: FlsTarget[]; error?: string }>({ type: 'GET_FLS_TARGETS' })
              .then((r) => (r.success && r.data ? { data: r.data } : { error: r.error || 'Could not load permission sets.' })),
            grantFls: (grants) => sendBg({ type: 'GRANT_FIELD_PERMISSIONS', grants }),
          });
          return;
        }
        if (toolView === 'executeanonymous') {
          const sendBg = <T,>(msg: Record<string, unknown>): Promise<T> => new Promise((resolve) => {
            getSfCredentials().then((creds: any) => {
              if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ success: false, error: 'Salesforce session not detected' } as T); return; }
              (globalThis as any).chrome.runtime.sendMessage(
                { instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, ...msg },
                (resp: any) => resolve((resp ?? { success: false, error: 'No response from extension' }) as T),
              );
            });
          });
          renderExecuteAnonymousInto(resultsContainer, {
            isDark, flashToast, onBack,
            execute: (apexBody, logLevel) => sendBg({ type: 'EXECUTE_ANONYMOUS', apexBody, logLevel }),
            renderAnalyzer: (analyzerHost, logBody, name, backToTool) => {
              analyzerHost.innerHTML = '';
              renderLogAnalyzerInto(analyzerHost, logBody, { isDark, logName: name, onBack: backToTool });
            },
          });
          return;
        }
        if (toolView === 'automationmap') {
          const sendBg = <T,>(msg: Record<string, unknown>): Promise<T> => new Promise((resolve) => {
            getSfCredentials().then((creds: any) => {
              if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ success: false, error: 'Salesforce session not detected' } as T); return; }
              (globalThis as any).chrome.runtime.sendMessage(
                { instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, ...msg },
                (resp: any) => resolve((resp ?? { success: false, error: 'No response from extension' }) as T),
              );
            });
          });
          renderAutomationMapInto(resultsContainer, {
            isDark, onBack, flashToast,
            lightningOrigin,
            openUrl: (url) => { (globalThis as any).chrome.runtime.sendMessage({ type: 'OPEN_TAB', url }); },
            listObjects: () => sendBg<{ success: boolean; data?: any[]; error?: string }>({ type: 'GET_ALL_OBJECTS' })
              .then((r) => (r.success && r.data
                ? { data: r.data.map((o: any): SfObjectRef => ({ apiName: o.QualifiedApiName, label: o.Label || o.QualifiedApiName, custom: /__c$/i.test(o.QualifiedApiName) })).sort((a: SfObjectRef, b: SfObjectRef) => a.label.localeCompare(b.label)) }
                : { error: r.error || 'Could not load objects.' })),
            fetchAutomation: (objectApiName) => sendBg<{ success: boolean; data?: AutomationData; error?: string }>({ type: 'GET_OBJECT_AUTOMATION', objectApiName })
              .then((r) => (r.success && r.data ? { data: r.data } : { error: r.error || 'Could not load automation.' })),
          });
          return;
        }
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
          id: 'sfhome', icon: '🏠', label: 'Salesforce Home', desc: 'Open Lightning home',
          run: () => {
            const url = `${lightningOrigin()}/lightning/page/home`;
            recordRecent({ kind: 'tool', icon: '🏠', title: 'Salesforce Home', subtitle: 'Lightning home', meta: 'Tool', url });
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
          id: 'export', icon: '📤', label: 'Export Data', desc: 'Run SOQL & export CSV',
          run: () => { searchInput.value = ''; toolView = 'export'; performSearch(); },
        },
        {
          id: 'querybuilder', icon: '🧱', label: 'Query Builder', desc: 'Build SOQL visually',
          run: () => { searchInput.value = ''; toolView = 'querybuilder'; performSearch(); },
        },
        {
          id: 'orgdetails', icon: '🏢', label: 'Org Details', desc: 'View this org’s info',
          run: () => { searchInput.value = ''; toolView = 'orgdetails'; performSearch(); },
        },
        {
          id: 'objectmanager', icon: '🛠️', label: 'Object Manager', desc: 'Create objects & fields with FLS',
          run: () => { searchInput.value = ''; toolView = 'objectmanager'; performSearch(); },
        },
        {
          id: 'automationmap', icon: '🧭', label: 'Automation Map', desc: 'What fires on save, in order',
          run: () => { searchInput.value = ''; toolView = 'automationmap'; performSearch(); },
        },
        {
          id: 'executeanonymous', icon: '⚡', label: 'Execute Anonymous', desc: 'Run Apex & analyze the debug log',
          run: () => { searchInput.value = ''; toolView = 'executeanonymous'; performSearch(); },
        },
        {
          id: 'permcompare', icon: '🔐', label: 'Permission Comparison', desc: 'Compare profiles & permission sets',
          run: () => { searchInput.value = ''; toolView = 'permcompare'; performSearch(); },
        },
        {
          id: 'accessmap', icon: '🗺️', label: 'Access Explorer', desc: 'Object, field & user access map',
          run: () => { searchInput.value = ''; toolView = 'accessmap'; performSearch(); },
        },
        {
          id: 'dataimport', icon: '⬆️', label: 'Data Import', desc: 'Insert / update / upsert / delete from CSV',
          run: () => { searchInput.value = ''; toolView = 'dataimport'; performSearch(); },
        },
        {
          id: 'sampledata', icon: '🧪', label: 'Sample Data', desc: 'Generate test records (sandbox & scratch only)',
          run: () => { searchInput.value = ''; toolView = 'sampledata'; performSearch(); },
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
          id: 'orglimits', icon: '📈', label: 'Org Limits', desc: 'All org limits & usage',
          run: () => { searchInput.value = ''; toolView = 'orglimits'; performSearch(); },
        },
        {
          id: 'shortcuts', icon: '🔖', label: 'Custom Shortcuts', desc: 'Save your own Setup links',
          run: () => { searchInput.value = ''; toolView = 'shortcuts'; performSearch(); },
        },
        {
          id: 'inspectlwc', icon: '🔍', label: 'Inspect Components', desc: 'Highlight LWCs on this page (Alt/⌥+Z)',
          run: () => { searchInput.value = ''; launchComponentInspector(); },
        },
        {
          id: 'clearsession', icon: '🧹', label: 'Clear Cache', desc: 'Clear cached session & reload',
          run: () => {
            const cr = (globalThis as any).chrome?.runtime;
            flashToast('Clearing cache & reloading…');
            cr?.sendMessage({ type: 'CLEAR_SESSION_CACHE', hostname: cleanSfDomain(sfHostname()) }, () => {
              setTimeout(() => window.location.reload(), 300);
            });
            hideSpotlightSearch();
          },
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
        { id: 'magicfill', icon: '✨', label: 'Magic Fill', desc: 'Auto-fill new-record modals', run: () => { searchInput.value = ''; toolView = 'magicfill'; performSearch(); } },
        {
          id: 'whatsnew', icon: '✨', label: "What's New", desc: 'See the latest features',
          run: () => {
            const version = (globalThis as any).chrome?.runtime?.getManifest?.().version || '';
            hideSpotlightSearch();
            showWhatsNew(version, currentSpotlightTheme === 'dark');
          },
        },
      ];

      // Apply the user's saved drag order: known ids first (in saved order),
      // then any tools not yet in the saved list, in their declared order.
      const orderIndex = new Map(currentToolsOrder.map((id, i) => [id, i]));
      const orderedTools = tools
        .map((t, i) => ({ t, i }))
        .sort((a, b) => {
          const ai = orderIndex.has(a.t.id) ? (orderIndex.get(a.t.id) as number) : Infinity;
          const bi = orderIndex.has(b.t.id) ? (orderIndex.get(b.t.id) as number) : Infinity;
          return ai !== bi ? ai - bi : a.i - b.i;
        })
        .map(({ t }) => t);

      // Reordering is only offered on the full, unfiltered grid — dragging a
      // filtered subset would give a confusing partial order.
      const canReorder = query.length === 0;
      const filtered = query.length > 0
        ? orderedTools.filter(t => t.label.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query))
        : orderedTools;

      if (filtered.length === 0) { showMessage('No tools match your search.'); return; }

      const strongBorder = currentSpotlightTheme === 'dark' ? 'rgba(148,163,184,0.35)' : 'rgba(31,41,55,0.18)';

      const grid = document.createElement('div');
      Object.assign(grid.style, {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: '12px', padding: '20px 28px 24px',
      });

      // Persist the current visual order of the grid's tiles.
      const commitOrder = () => {
        const ids = Array.from(grid.children)
          .map((el) => (el as HTMLElement).dataset.toolId)
          .filter((id): id is string => !!id);
        saveToolsOrder(ids);
      };

      let dragEl: HTMLElement | null = null;

      // Standout tools get an animated moving-highlight border.
      const FEATURED_TOOLS = new Set(['inspectlwc', 'automationmap', 'accessmap']);

      filtered.forEach((t) => {
        const isToggle = !!t.toggleKey;
        const isOn = isToggle && toolsState[t.toggleKey as keyof ToolsState];

        const tile = document.createElement('button');
        tile.dataset.toolId = t.id;
        if (FEATURED_TOOLS.has(t.id)) tile.classList.add('sf-tool-featured');
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

        // Drag-handle grip (top-left) — signals the tile can be reordered.
        // Faint by default, brightens when the tile is hovered.
        let grip: HTMLElement | null = null;
        if (canReorder) {
          grip = document.createElement('span');
          grip.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
          Object.assign(grip.style, {
            position: 'absolute', top: '8px', left: '8px', display: 'inline-flex',
            color: T.textMuted, opacity: '0.4', transition: 'opacity 0.15s', pointerEvents: 'none',
          });
          tile.appendChild(grip);
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

        // Magic Fill gets the animated gradient border to stand out.
        if (t.id === 'magicfill') { ensureMagicStyles(); tile.classList.add('sfsl-magic-tile'); tile.style.border = 'none'; }

        tile.addEventListener('mouseover', () => { tile.style.transform = 'translateY(-2px)'; if (!isOn) tile.style.background = T.surfaceHover; if (grip) grip.style.opacity = '0.9'; });
        tile.addEventListener('mouseout', () => { tile.style.transform = 'none'; tile.style.background = baseBg; if (grip) grip.style.opacity = '0.4'; });

        // Drag-to-reorder (only on the unfiltered grid).
        if (canReorder) {
          tile.draggable = true;
          tile.style.cursor = 'grab';
          tile.title = 'Drag to reorder';
          let dragged = false;

          tile.addEventListener('dragstart', (e) => {
            dragEl = tile;
            dragged = true;
            (e as DragEvent).dataTransfer?.setData('text/plain', t.id);
            if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.effectAllowed = 'move';
            // Defer so the browser captures the drag image before we dim it.
            setTimeout(() => { tile.style.opacity = '0.4'; }, 0);
          });
          tile.addEventListener('dragend', () => {
            tile.style.opacity = '1';
            dragEl = null;
            // dragover already reorders the DOM live; persist the final order
            // here so a drop landing on a grid gap still sticks.
            commitOrder();
            // Swallow the click the browser fires after a drag ends.
            setTimeout(() => { dragged = false; }, 0);
          });
          tile.addEventListener('dragover', (e) => {
            e.preventDefault();
            if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'move';
            if (!dragEl || dragEl === tile) return;
            const rect = tile.getBoundingClientRect();
            const after = (e as DragEvent).clientY > rect.top + rect.height / 2
              || (e as DragEvent).clientX > rect.left + rect.width / 2;
            grid.insertBefore(dragEl, after ? tile.nextSibling : tile);
          });
          tile.addEventListener('drop', (e) => {
            e.preventDefault();
            commitOrder();
          });
          // Prevent the post-drag click from triggering the tool.
          tile.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
        }

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
    metadataType = null;
    if (debugLiveTimer) { clearInterval(debugLiveTimer); debugLiveTimer = null; }
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
  const MAX_VISIBLE_TABS = 5;

  const renderTabBar = () => {
    tabsContainer.innerHTML = '';
    Object.keys(tabButtons).forEach(k => delete tabButtons[k]);

    const visibleIds = tabConfig.order.filter(id => !tabConfig.hidden.includes(id) && ALL_SPOTLIGHT_TABS.some(t => t.id === id));

    // The full-page tab has room for every tab; the overlay collapses extras.
    const maxVisible = fullPage ? visibleIds.length : MAX_VISIBLE_TABS;
    let primary = visibleIds;
    let overflow: string[] = [];
    if (visibleIds.length > maxVisible) {
      primary = visibleIds.slice(0, maxVisible);
      overflow = visibleIds.slice(maxVisible);
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

    const gear = makeTabButton('Settings', '⚙');
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
    const rootS = document.createElement('div');
    Object.assign(rootS.style, { display: 'flex', height: '100%', minHeight: '0' });
    resultsContainer.appendChild(rootS);

    // Sidebar: categories grouped by feature.
    const sidebar = document.createElement('div');
    Object.assign(sidebar.style, { width: '168px', flexShrink: '0', borderRight: `1px solid ${T.divider}`, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: '4px' });
    rootS.appendChild(sidebar);
    const navItem = (id: 'general' | 'export', icon: string, label: string) => {
      const on = settingsCat === id;
      const b = document.createElement('button');
      b.innerHTML = `<span style="margin-right:8px">${icon}</span>${label}`;
      Object.assign(b.style, { display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: on ? '700' : '600', background: on ? T.surface : 'transparent', color: on ? T.textPrimary : T.textMuted });
      b.addEventListener('mouseover', () => { if (settingsCat !== id) b.style.background = T.surface; });
      b.addEventListener('mouseout', () => { if (settingsCat !== id) b.style.background = 'transparent'; });
      b.addEventListener('click', () => { settingsCat = id; renderSettingsPanel(); });
      sidebar.appendChild(b);
    };
    navItem('general', '🧩', 'General');
    navItem('export', '📤', 'Data Export');

    // Content for the selected category.
    const content = document.createElement('div');
    Object.assign(content.style, { flex: '1', minWidth: '0', minHeight: '0', overflow: 'auto', padding: '20px 28px' });
    rootS.appendChild(content);

    if (settingsCat === 'export') {
      const exHeading = document.createElement('div');
      exHeading.textContent = 'Data Export';
      Object.assign(exHeading.style, { fontSize: '16px', fontWeight: '700', color: T.textPrimary, marginBottom: '4px' });
      content.appendChild(exHeading);
      const exSub = document.createElement('div');
      exSub.textContent = 'Preferences for the Export Data & Query Builder tools';
      Object.assign(exSub.style, { fontSize: '13px', color: T.textMuted, marginBottom: '10px' });
      content.appendChild(exSub);
      const exBody = document.createElement('div');
      Object.assign(exBody.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
      content.appendChild(exBody);
      appendExportSettings(exBody, {
        border: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(31,41,55,0.2)',
        divider: T.divider,
        inputBg: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
        textPrimary: T.textPrimary, textMuted: T.textMuted, accent: T.accent,
      });
      return;
    }

    // ── General: appearance (light / dark) ──
    const wrap = content;
    const apHeading = document.createElement('div');
    apHeading.textContent = 'Appearance';
    Object.assign(apHeading.style, { fontSize: '16px', fontWeight: '700', color: T.textPrimary, marginBottom: '4px' });
    wrap.appendChild(apHeading);
    const apSub = document.createElement('div');
    apSub.textContent = 'Switch Spotlight between light and dark mode';
    Object.assign(apSub.style, { fontSize: '13px', color: T.textMuted, marginBottom: '12px' });
    wrap.appendChild(apSub);

    const themeSeg = document.createElement('div');
    Object.assign(themeSeg.style, { display: 'inline-flex', border: `1px solid ${T.chipBorder}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '26px' });
    ([['light', '☀️ Light'], ['dark', '🌙 Dark']] as const).forEach(([val, label]) => {
      const on = currentSpotlightTheme === val;
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, { background: on ? T.accent : 'transparent', color: on ? '#fff' : T.textMuted, border: 'none', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: on ? '700' : '600', fontFamily: 'inherit' });
      b.addEventListener('click', () => {
        if (currentSpotlightTheme === val) return;
        currentSpotlightTheme = val;
        saveSpotlightTheme(val);
        if (SPOTLIGHT_PAGE) document.body.style.background = val === 'dark' ? '#0f172a' : '#ffffff';
        // Rebuild so every token re-colors, then land back on this settings page.
        reopenSettingsAfterBuild = true;
        showSpotlightSearch();
      });
      themeSeg.appendChild(b);
    });
    wrap.appendChild(themeSeg);

    // Object Explorer header-icon toggle
    const oeRow = document.createElement('label');
    Object.assign(oeRow.style, { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '26px', padding: '10px 12px', border: `1px solid ${T.chipBorder}`, borderRadius: '10px', maxWidth: '440px' });
    const oeChk = document.createElement('input'); oeChk.type = 'checkbox'; oeChk.checked = objectExplorerEnabled; oeChk.style.cursor = 'pointer';
    oeChk.addEventListener('change', () => { objectExplorerEnabled = oeChk.checked; persistSettings({ showObjectExplorer: oeChk.checked }); });
    const oeText = document.createElement('div');
    oeText.innerHTML = `<div style="font-size:13px;font-weight:700;color:${T.textPrimary}">Object Explorer icon</div><div style="font-size:12px;color:${T.textMuted}">Show the Object Explorer icon in the Salesforce global header on record pages</div>`;
    oeRow.appendChild(oeChk); oeRow.appendChild(oeText);
    wrap.appendChild(oeRow);

    // ── General: customize tabs ──
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
  };

  // ─── Input + keyboard wiring ───────────────────────────────
  searchInput.addEventListener('input', async () => {
    await performSearch();
  });

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    const buttons = resultsContainer.querySelectorAll('button, div[style*="cursor: pointer"]');

    if (e.key === 'Escape') {
      e.preventDefault();
      if (fullPage) { searchInput.value = ''; performSearch(); }
      else hideSpotlightSearch();
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
  if (reopenSettingsAfterBuild) { reopenSettingsAfterBuild = false; activateTab('__settings'); }
  else activateTab((SPOTLIGHT_PAGE && pageAnalyzeLog) ? 'debug' : tabConfig.defaultTab);
  searchInput.focus();
}

function hideSpotlightSearch() {
  // In the full-page tab the spotlight IS the page — hiding it would blank the
  // tab, so keep it visible when a result opens something in a new tab.
  if (SPOTLIGHT_PAGE) return;
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

// Component Inspector launcher — shared by the Tools entry and the Alt/Option+Z
// shortcut. Toggles: a second invocation while inspecting exits the overlay.
function launchComponentInspector(): void {
  if (isInspecting()) { exitInspectMode(); return; }
  const isDark = currentSpotlightTheme === 'dark';
  const listBundles = () => new Promise<{ bundles?: BundleInfo[]; error?: string }>((resolve) => {
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ error: 'Salesforce session not detected' }); return; }
      (globalThis as any).chrome.runtime.sendMessage(
        { type: 'METADATA_QUERY', tooling: true, instanceUrl: creds.instanceUrl, sessionId: creds.sessionId,
          query: 'SELECT Id, DeveloperName, NamespacePrefix, MasterLabel FROM LightningComponentBundle ORDER BY DeveloperName LIMIT 2000' },
        (resp: any) => resolve(resp?.success
          ? { bundles: (resp.data || []).map((r: any) => ({ id: r.Id, developerName: r.DeveloperName, namespace: r.NamespacePrefix ?? null, masterLabel: r.MasterLabel })) }
          : { error: resp?.error || 'Could not load components.' }),
      );
    });
  });
  const fetchSource = (bundleId: string) => new Promise<{ files?: LwcFile[]; error?: string }>((resolve) => {
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ error: 'Salesforce session not detected' }); return; }
      (globalThis as any).chrome.runtime.sendMessage(
        { type: 'GET_LWC_SOURCE', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, bundleId },
        (resp: any) => resolve(resp?.success ? { files: resp.files || [] } : { error: resp?.error || 'Could not load source.' }),
      );
    });
  });
  const saveSource = (resourceId: string, source: string) => new Promise<{ success?: boolean; error?: string; verified?: boolean | null }>((resolve) => {
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) { resolve({ error: 'Salesforce session not detected' }); return; }
      (globalThis as any).chrome.runtime.sendMessage(
        { type: 'SAVE_LWC_SOURCE', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, resourceId, source },
        (resp: any) => resolve(resp?.success ? { success: true, verified: resp.verified ?? null } : { error: resp?.error || 'Save failed.' }),
      );
    });
  });
  const getIsSandbox = () => new Promise<boolean | null>((resolve) => {
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) { resolve(null); return; }
      (globalThis as any).chrome.runtime.sendMessage(
        { type: 'GET_ORG_INFO', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId },
        (resp: any) => resolve(resp?.success && resp.data ? !!resp.data.IsSandbox : null),
      );
    });
  });
  hideSpotlightSearch();
  enterInspectMode({ isDark, flashToast, listBundles, fetchSource, saveSource, getIsSandbox, setupUrl: `${lightningOrigin()}/lightning/setup/LightningComponentBundles/home` });
}

// ─── Sidebar Injection ───────────────────────────────────────────────────────

function injectSidebar() {
  if (!isSalesforcePage()) {
    //console.log('[SF Spotlight] Not a Salesforce page, skipping injection');
    return;
  }

  if (document.getElementById('sf-log-analyzer-iframe')) {
    //console.log('[SF Spotlight] Already injected, skipping');
    return;
  }

  //console.log('[SF Spotlight] Injecting sidebar on Salesforce page');

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
            setTimeout(() => showWhatsNew(manifestVersion, currentSpotlightTheme === 'dark'), 600);
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

      // Alt+Z / Option+Z to toggle the Component Inspector overlay.
      // event.code avoids Mac Option char remap (Option+Z → Ω); altKey covers Alt & Option.
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyZ') {
        event.preventDefault();
        event.stopPropagation();
        launchComponentInspector();
        return false;
      }

      // ✅ Alt+T / Option+T to open spotlight — use event.code to avoid Mac special chars (†)
      if (event.altKey && event.code === 'KeyT') {
        event.preventDefault();
        event.stopPropagation();
        //console.log('[SF Spotlight] Alt/Option+T pressed on main page');
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
    //console.log('[SF Spotlight] Keyboard shortcut listener attached to document');
  });
}

// Full-page tab: render the Spotlight directly. Otherwise inject the overlay.
function bootFullPageSpotlight() {
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  document.body.style.height = '100%';
  document.title = 'Spotlight for Salesforce';
  // Load the saved theme + tab config before building so colors are correct.
  loadSettings((s) => {
    currentSpotlightTheme = s.spotlightTheme;
    document.body.style.background = currentSpotlightTheme === 'dark' ? '#0f172a' : '#ffffff';
    loadTabConfig();
    setTimeout(() => buildSpotlight(currentTabConfig), 50);
  });
}

function init() {
  if (SPOTLIGHT_PAGE) bootFullPageSpotlight();
  else {
    injectSidebar();
    initObjectExplorer({
      isEnabled: () => objectExplorerEnabled,
      getTheme: () => currentSpotlightTheme,
      lightningOrigin,
      detectPageObject,
      iconUrl: () => { try { return (globalThis as any).chrome?.runtime?.getURL?.('icons/Spotlite-Icon.svg') || ''; } catch { return ''; } },
    });
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
