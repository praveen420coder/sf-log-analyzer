// Storage layer for the in-panel settings screen. Reads/writes the same
// chrome.storage.local keys the extension already uses, plus a prefs bag +
// usage counters. Falls back to localStorage when chrome.storage is absent.

export const KEYS = {
  settings: 'sf_log_analyzer_settings',   // ExtensionSettings (panel appearance)
  tools: 'sf_spotlight_tools_state',      // ToolsState toggles
  sessions: 'sf_spotlight_sessions',      // VisitedOrg[]
  recents: 'sf_spotlight_recents',        // RecentItem[]
  favorites: 'sf_spotlight_favorites',
  prefs: 'sf_spotlight_prefs',            // this page's own prefs bag
  usage: 'sf_spotlight_usage',            // usage counters
  tabConfig: 'sf_spotlight_tab_config',   // spotlight tab order / hidden / default
  exportSettings: 'sf_export_settings',   // Data Export tool preferences
} as const;

// Mirrors content-ui's ExportSettings — Data Export tool preferences. Kept here
// so the settings screen can edit them; content-ui reads the same key.
export interface ExportSettings {
  separator: ',' | ';' | '\t';
  wrap: boolean;
  hideRelations: boolean;
  defaultTooling: boolean;
  maxRows: number;
  showExecTime: boolean;
  localTime: boolean;
  sobjectContext: boolean;
  showButtons: boolean;
  includeFormula: boolean;
  disableAutofocus: boolean;
  historyLimit: number;
  savedLimit: number;
  templates: string[];
  typoFix: boolean;
  promptTemplateName: boolean;
  showStop: boolean;
}
export const DEFAULT_EXPORT: ExportSettings = {
  separator: ',', wrap: false, hideRelations: false, defaultTooling: false, maxRows: 1000,
  showExecTime: true, localTime: false, sobjectContext: false, showButtons: true, includeFormula: true,
  disableAutofocus: false, historyLimit: 30, savedLimit: 50, templates: [], typoFix: false, promptTemplateName: true, showStop: true,
};

// Mirror of content-ui's ALL_SPOTLIGHT_TABS (id + label + emoji) so the settings
// page can manage tab order/visibility. Keep in sync if tabs change there.
export const SPOTLIGHT_TABS: { id: string; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'tools', label: 'Tools', icon: '🛠️' },
  { id: 'setup', label: 'Setup', icon: '🏠' },
  { id: 'users', label: 'Users', icon: '👤' },
  { id: 'flows', label: 'Flows', icon: '⚡' },
  { id: 'metadata', label: 'Metadata Explorer', icon: '🧩' },
  { id: 'security', label: 'Security', icon: '🔑' },
  { id: 'debug', label: 'Log Explorer', icon: '🐞' },
  { id: 'objects', label: 'Objects', icon: '📦' },
  { id: 'apextests', label: 'Apex Tests', icon: '🧪' },
  { id: 'access', label: 'Access Explorer', icon: '🗺️' },
  { id: 'recent', label: 'Recent', icon: '🕘' },
  { id: 'apps', label: 'Apps & Tabs', icon: '🚀' },
];
export const TAB_HIDDEN_BY_DEFAULT = ['apps'];

export interface TabConfig { order: string[]; hidden: string[]; defaultTab: string }
export function defaultTabConfig(): TabConfig {
  return { order: SPOTLIGHT_TABS.map((t) => t.id), hidden: [...TAB_HIDDEN_BY_DEFAULT], defaultTab: 'setup' };
}
// Ensure every known tab appears exactly once in order, drop unknowns, and keep
// the default tab valid + visible.
export function normalizeTabConfig(raw: Partial<TabConfig> | null | undefined): TabConfig {
  const known = SPOTLIGHT_TABS.map((t) => t.id);
  const cfg: TabConfig = { ...defaultTabConfig(), ...(raw || {}) };
  const seen = new Set<string>();
  cfg.order = (cfg.order || []).filter((id) => known.includes(id) && !seen.has(id) && seen.add(id));
  known.forEach((id) => { if (!cfg.order.includes(id)) cfg.order.push(id); });
  cfg.hidden = (cfg.hidden || []).filter((id) => known.includes(id));
  const firstVisible = cfg.order.find((id) => !cfg.hidden.includes(id)) || cfg.order[0];
  if (!known.includes(cfg.defaultTab) || cfg.hidden.includes(cfg.defaultTab)) cfg.defaultTab = firstVisible;
  return cfg;
}

export interface AppearanceSettings {
  position: 'right' | 'left';
  opacity: number;
  width: number;
  verticalPosition: number;
  spotlightTheme: 'light' | 'dark';
  showObjectExplorer: boolean;
  uiSkin: 'default' | 'slds';
  minimalView: boolean;
}
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  position: 'right', opacity: 100, width: 50, verticalPosition: 50,
  spotlightTheme: 'light', showObjectExplorer: true, uiSkin: 'default', minimalView: false,
};

export interface ToolsToggles {
  showFieldApi: boolean; hideDevBar: boolean; hideLoginAd: boolean;
  magicFill: boolean; magicFillNormal: boolean; magicFillPicklist: boolean;
}
export const DEFAULT_TOOLS: ToolsToggles = {
  showFieldApi: false, hideDevBar: false, hideLoginAd: false,
  magicFill: false, magicFillNormal: true, magicFillPicklist: true,
};

export interface Prefs {
  cacheEnabled: boolean;
  cacheAutoUpdate: boolean;
  historyEnabled: boolean;
  historyLimit: boolean;
  historyMax: number;
  historyAutoDelete: boolean;
  historyMaxDays: number;
  notifToast: boolean;
  notifSpinner: boolean;
  analyticsEnabled: boolean;
  apiVersion: string;
  defaultHost: string;
  nicknames: Record<string, string>;
}
export const DEFAULT_PREFS: Prefs = {
  cacheEnabled: true, cacheAutoUpdate: false,
  historyEnabled: true, historyLimit: true, historyMax: 50, historyAutoDelete: true, historyMaxDays: 10,
  notifToast: true, notifSpinner: true,
  analyticsEnabled: true, apiVersion: '60.0', defaultHost: '', nicknames: {},
};

export interface Usage {
  soql: number; debugLogs: number; rulesUpdated: number; apexTests: number;
}
export const DEFAULT_USAGE: Usage = { soql: 0, debugLogs: 0, rulesUpdated: 0, apexTests: 0 };

// Increment a usage counter (read-modify-write). Serialized through a promise
// chain so rapid successive bumps don't clobber each other's read.
let usageChain: Promise<void> = Promise.resolve();
export function bumpUsage(key: keyof Usage, by = 1): void {
  usageChain = usageChain.then(async () => {
    const u = await get<Partial<Usage>>(KEYS.usage, {});
    const cur = { ...DEFAULT_USAGE, ...u };
    cur[key] = (cur[key] || 0) + by;
    await set(KEYS.usage, cur);
  }).catch(() => { /* keep the chain alive */ });
}

export interface VisitedOrg { host: string; instanceUrl: string; label: string; user?: string; ts: number }

const chromeStore = () => (globalThis as any).chrome?.storage?.local;

export function get<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const cs = chromeStore();
    if (cs) { cs.get([key], (r: any) => resolve(r?.[key] != null ? r[key] : fallback)); return; }
    try { const s = localStorage.getItem(key); resolve(s ? JSON.parse(s) : fallback); } catch { resolve(fallback); }
  });
}

export function set(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    const cs = chromeStore();
    if (cs) { cs.set({ [key]: value }, () => resolve()); return; }
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    resolve();
  });
}

export function remove(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    const cs = chromeStore();
    if (cs) { cs.remove(keys, () => resolve()); return; }
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    resolve();
  });
}

// Open a URL in a new tab (via the background) or fall back to window.open.
export function openTab(url: string): void {
  const cr = (globalThis as any).chrome?.runtime;
  if (cr?.sendMessage) { try { cr.sendMessage({ type: 'OPEN_TAB', url }); return; } catch { /* fall through */ } }
  window.open(url, '_blank');
}
