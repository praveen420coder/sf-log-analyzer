import { useState, useEffect } from 'react';

export interface ExtensionSettings {
  position: 'right' | 'left';
  opacity: number; // 0-100
  width: number; // percentage of viewport
  verticalPosition: number; // 0-100 (0 = top, 50 = middle, 100 = bottom)
  spotlightTheme: 'light' | 'dark'; // Spotlight modal appearance
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  position: 'right',
  opacity: 100,
  width: 50,
  verticalPosition: 50,
  spotlightTheme: 'light',
};

const STORAGE_KEY = 'sf_log_analyzer_settings';

// Helper to access chrome.storage
function getChromeStorage() {
  return (globalThis as any).chrome?.storage?.local;
}

export function useSettings() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from chrome.storage on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const chromeStorage = getChromeStorage();
        if (chromeStorage) {
          chromeStorage.get([STORAGE_KEY], (result: any) => {
            if (result[STORAGE_KEY]) {
              setSettings({ ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] });
            } else {
              setSettings(DEFAULT_SETTINGS);
            }
            setIsLoading(false);
          });
        } else {
          // Fallback to localStorage if chrome.storage is not available
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            setSettings({ ...DEFAULT_SETTINGS, ...parsed });
          } else {
            setSettings(DEFAULT_SETTINGS);
          }
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
        setSettings(DEFAULT_SETTINGS);
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const updateSettings = (newSettings: Partial<ExtensionSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    try {
      const chromeStorage = getChromeStorage();
      if (chromeStorage) {
        chromeStorage.set({ [STORAGE_KEY]: updated }, () => {
          // Notify the content script about setting changes
          window.parent.postMessage({ type: 'SF_LOG_ANALYZER_SETTINGS_CHANGED', settings: updated }, '*');
        });
      } else {
        // Fallback to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        window.parent.postMessage({ type: 'SF_LOG_ANALYZER_SETTINGS_CHANGED', settings: updated }, '*');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    try {
      const chromeStorage = getChromeStorage();
      if (chromeStorage) {
        chromeStorage.set({ [STORAGE_KEY]: DEFAULT_SETTINGS }, () => {
          window.parent.postMessage({ type: 'SF_LOG_ANALYZER_SETTINGS_CHANGED', settings: DEFAULT_SETTINGS }, '*');
        });
      } else {
        // Fallback to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
        window.parent.postMessage({ type: 'SF_LOG_ANALYZER_SETTINGS_CHANGED', settings: DEFAULT_SETTINGS }, '*');
      }
    } catch (error) {
      console.error('Failed to reset settings:', error);
    }
  };

  return {
    settings,
    isLoading,
    updateSettings,
    resetSettings,
  };
}
