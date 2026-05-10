// Content script - injects iframe to load the React app

interface ExtensionSettings {
  position: 'right' | 'left';
  opacity: number;
  width: number;
  verticalPosition: number;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  position: 'right',
  opacity: 100,
  width: 50,
  verticalPosition: 50,
};

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
    // Fallback to localStorage
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
  // sfdcBody: normal Salesforce page
  // ApexCSIPage: Developer Console
  // auraLoadingBox: Lightning / Salesforce1
  // studioBody: Experience Builder
  // flowContainer: Flow Debugger
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
    // OPEN STATE
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
    
    // Update backdrop
    if (isRightPosition) {
      backdrop.style.left = '0';
      backdrop.style.right = `${settings.width}vw`;
    } else {
      backdrop.style.right = '0';
      backdrop.style.left = `${settings.width}vw`;
    }
    backdrop.style.display = 'block';
  } else {
    // CLOSED STATE: Narrow trigger only
    iframe.style.width = '60px';
    iframe.style.height = '120px';
    iframe.style[isRightPosition ? 'right' : 'left'] = '0';
    if (isRightPosition) {
      iframe.style.left = 'auto';
    } else {
      iframe.style.right = 'auto';
    }
    
    // Apply vertical position
    if (settings.verticalPosition === 0) {
      // Top position
      iframe.style.top = '10px';
      iframe.style.bottom = 'auto';
      iframe.style.transform = 'none';
    } else if (settings.verticalPosition === 100) {
      // Bottom position
      iframe.style.bottom = '10px';
      iframe.style.top = 'auto';
      iframe.style.transform = 'none';
    } else {
      // Custom position (0-100)
      iframe.style.top = `${settings.verticalPosition}%`;
      iframe.style.bottom = 'auto';
      iframe.style.transform = 'translateY(-50%)';
    }
    
    iframe.style.background = 'transparent';
    iframe.style.opacity = '1';
    backdrop.style.display = 'none';
  }
}

function injectSidebar() {
  // Only inject on actual Salesforce pages
  if (!isSalesforcePage()) {
    return;
  }

  if (document.getElementById('sf-log-analyzer-iframe')) {
    return;
  }

  // Load settings and then inject
  loadSettings((settings) => {
    // Track panel state
    let isPanelOpen = false;

    const iframe = document.createElement('iframe');
    iframe.id = 'sf-log-analyzer-iframe';
    iframe.style.position = 'fixed';
    iframe.style.zIndex = '2147483647'; // Max z-index
    iframe.style.border = 'none';
    
    // INITIAL STATE: Narrow for the trigger, transparent background
    iframe.style.width = '60px'; 
    iframe.style.background = 'transparent';

    const chromeRuntime = (globalThis as any).chrome?.runtime;
    if (!chromeRuntime) {
      return;
    }
    
    // Clean domain to match background.ts transformation
    const cleanDomain = (domain: string): string => {
      return domain
        .replace(/\.lightning\.force\./, '.my.salesforce.') // Match background.ts transformation
        .replace(/\.mcas\.ms$/, ''); // Remove Microsoft Defender suffix
    };
    
    // Pass the cleaned parent page hostname to the iframe via URL hash
    const parentHostname = cleanDomain(window.location.hostname);
    iframe.src = chromeRuntime.getURL('index.html') + '#hostname=' + encodeURIComponent(parentHostname);
    document.body.appendChild(iframe);

    // Create backdrop element for clicking outside
    const backdrop = document.createElement('div');
    backdrop.id = 'sf-log-analyzer-backdrop';
    backdrop.style.position = 'fixed';
    backdrop.style.top = '0';
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
    backdrop.style.zIndex = '2147483646'; // Just below iframe
    backdrop.style.display = 'none'; // Hidden by default
    backdrop.style.cursor = 'pointer';
    
    document.body.appendChild(backdrop);

    // Apply initial settings to iframe (closed state)
    applySettingsToIframe(iframe, backdrop, settings, false);

    // Function to open the panel
    const openPanel = () => {
      isPanelOpen = true;
      iframe.contentWindow?.postMessage({ type: 'OPEN_PANEL' }, '*');
      applySettingsToIframe(iframe, backdrop, settings, true);
    };

    // Function to close the panel
    const closePanel = () => {
      isPanelOpen = false;
      iframe.contentWindow?.postMessage({ type: 'CLOSE_PANEL' }, '*');
      applySettingsToIframe(iframe, backdrop, settings, false);
    };

    backdrop.addEventListener('click', () => {
      closePanel();
    });

    // LISTEN for toggle messages from the React app
    window.addEventListener('message', (event) => {
      if (event.data.type === 'SF_LOG_ANALYZER_TOGGLE') {
        isPanelOpen = event.data.isOpen;
        applySettingsToIframe(iframe, backdrop, settings, event.data.isOpen);
      } else if (event.data.type === 'SF_LOG_ANALYZER_SETTINGS_CHANGED') {
        // Update settings when changed in the React app
        Object.assign(settings, event.data.settings);
        applySettingsToIframe(iframe, backdrop, settings, isPanelOpen);
      }
    });

    // Keyboard shortcuts - listen on document
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Alt+D to open panel
      if (event.ctrlKey && event.altKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
        return false;
      }
      
      // Alt+S to open panel
      if (event.altKey && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
        return false;
      }
      
      // Escape to close panel
      if (event.key === 'Escape' && isPanelOpen) {
        event.preventDefault();
        closePanel();
      }
    };
    
    // Wait for iframe to load before setting up keyboard listener
    iframe.addEventListener('load', () => {
      document.addEventListener('keydown', handleKeyDown, true);
    });
  });
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSidebar);
} else {
  injectSidebar();
}
