// Extension settings: shape, defaults, and chrome.storage / localStorage persistence.

export interface ExtensionSettings {
  position: 'right' | 'left';
  opacity: number;
  width: number;
  verticalPosition: number;
  spotlightTheme: 'light' | 'dark';
  showObjectExplorer: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  position: 'right',
  opacity: 100,
  width: 50,
  verticalPosition: 50,
  spotlightTheme: 'light',
  showObjectExplorer: true,
};

export const STORAGE_KEY = 'sf_log_analyzer_settings';

export function loadSettings(callback: (settings: ExtensionSettings) => void): void {
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

export function persistSettings(patch: Partial<ExtensionSettings>): void {
  loadSettings((s) => {
    const merged = { ...s, ...patch };
    if ((globalThis as any).chrome?.storage?.local) (globalThis as any).chrome.storage.local.set({ [STORAGE_KEY]: merged });
    else try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  });
}

export function saveSpotlightTheme(theme: 'light' | 'dark'): void { persistSettings({ spotlightTheme: theme }); }
