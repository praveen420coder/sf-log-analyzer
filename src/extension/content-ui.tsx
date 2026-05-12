// Content script - injects iframe to load the React app
import { setupLinks } from './links';

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

      // Alt+T to open spotlight search on main page
      if (event.altKey && (event.key === 't' || event.key === 'T')) {
        event.preventDefault();
        event.stopPropagation();
        showSpotlightSearch(iframe);
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

// Spotlight Search Injector - runs on main page
function showSpotlightSearch(_iframe: HTMLIFrameElement) {
  let spotlightContainer = document.getElementById('sf-log-analyzer-spotlight-container');
  
  if (!spotlightContainer) {
    spotlightContainer = document.createElement('div');
    spotlightContainer.id = 'sf-log-analyzer-spotlight-container';
    spotlightContainer.style.position = 'fixed';
    spotlightContainer.style.top = '0';
    spotlightContainer.style.left = '0';
    spotlightContainer.style.width = '100%';
    spotlightContainer.style.height = '100%';
    spotlightContainer.style.zIndex = '2147483648'; // Higher than iframe
    spotlightContainer.style.pointerEvents = 'none';
    document.body.appendChild(spotlightContainer);

    const modalContent = document.createElement('div');
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
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
    backdrop.style.zIndex = '1';
    backdrop.style.cursor = 'pointer';
    backdrop.style.pointerEvents = 'auto';

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        hideSpotlightSearch();
      }
    });

    // Modal box
    const modal = document.createElement('div');
    modal.style.position = 'relative';
    modal.style.width = '100%';
    modal.style.maxWidth = '768px';
    modal.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
    modal.style.backdropFilter = 'blur(25px)';
    modal.style.borderRadius = '24px';
    modal.style.boxShadow = '0 25px 50px rgba(0, 0, 0, 0.5)';
    modal.style.border = '1px solid rgba(255, 255, 255, 0.3)';
    modal.style.overflow = 'hidden';
    modal.style.zIndex = '2';
    modal.style.pointerEvents = 'auto';

    // Search input container
    const inputContainer = document.createElement('div');
    inputContainer.style.display = 'flex';
    inputContainer.style.alignItems = 'center';
    inputContainer.style.padding = '24px 32px';
    inputContainer.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';

    // Search icon SVG
    const searchSvg = document.createElement('div');
    searchSvg.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>';
    searchSvg.style.marginRight = '16px';
    searchSvg.style.flexShrink = '0';

    // Search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search Salesforce setup...';
    searchInput.style.flex = '1';
    searchInput.style.backgroundColor = 'transparent';
    searchInput.style.fontSize = '22px';
    searchInput.style.color = '#1f2937';
    searchInput.style.border = 'none';
    searchInput.style.outline = 'none';
    searchInput.style.fontWeight = '600';
    searchInput.style.fontFamily = 'inherit';
    searchInput.style.caretColor = '#1f2937';
    searchInput.style.textShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
    searchInput.style.setProperty('--placeholder-opacity', '0.8');
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.style.marginLeft = '16px';
    closeBtn.style.padding = '8px';
    closeBtn.style.backgroundColor = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.borderRadius = '8px';
    closeBtn.style.transition = 'background-color 0.2s';
    closeBtn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.addEventListener('mouseover', () => {
      closeBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
    });
    closeBtn.addEventListener('mouseout', () => {
      closeBtn.style.backgroundColor = 'transparent';
    });
    closeBtn.addEventListener('click', () => {
      hideSpotlightSearch();
    });

    inputContainer.appendChild(searchSvg);
    inputContainer.appendChild(searchInput);
    inputContainer.appendChild(closeBtn);

    // Results container
    const resultsContainer = document.createElement('div');
    resultsContainer.style.maxHeight = '400px';
    resultsContainer.style.overflowY = 'auto';

    // No results message
    const noResults = document.createElement('div');
    noResults.style.padding = '64px 32px';
    noResults.style.textAlign = 'center';
    noResults.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.4)" stroke-width="2" style="margin: 0 auto 16px"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg><p style="color: #ffffff; font-weight: 600; margin: 0; font-size: 16px">No results found</p><p style="color: rgba(255, 255, 255, 0.7); font-size: 14px; margin: 8px 0 0 0">Try searching for something else</p>';
    resultsContainer.appendChild(noResults);

    modal.appendChild(inputContainer);
    modal.appendChild(resultsContainer);

    modalContent.appendChild(backdrop);
    modalContent.appendChild(modal);
    spotlightContainer.appendChild(modalContent);

    // Handle search input
    searchInput.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value.toLowerCase();
      resultsContainer.innerHTML = '';
      
      if (query.length === 0) {
        resultsContainer.appendChild(noResults.cloneNode(true));
        return;
      }

      // Filter setupLinks based on query
      const filtered = setupLinks.filter(link => 
        link.label.toLowerCase().includes(query) ||
        link.section.toLowerCase().includes(query) ||
        link.link.toLowerCase().includes(query)
      );

      if (filtered.length === 0) {
        resultsContainer.appendChild(noResults.cloneNode(true));
        return;
      }

      // Display results
      const resultsList = document.createElement('div');

      filtered.forEach((link, index) => {
        const resultItem = document.createElement('button');
        resultItem.style.width = '100%';
        resultItem.style.padding = '20px 32px';
        resultItem.style.display = 'flex';
        resultItem.style.alignItems = 'flex-start';
        resultItem.style.gap = '16px';
        resultItem.style.transition = 'all 0.2s';
        resultItem.style.textAlign = 'left';
        resultItem.style.backgroundColor = index === 0 ? 'rgba(255, 255, 255, 0.1)' : 'transparent';
        resultItem.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
        resultItem.style.border = 'none';
        resultItem.style.cursor = 'pointer';
        resultItem.style.fontFamily = 'inherit';
        resultItem.style.color = 'white';

        // Icon container
        const iconContainer = document.createElement('div');
        iconContainer.style.flexShrink = '0';
        iconContainer.style.width = '48px';
        iconContainer.style.height = '48px';
        iconContainer.style.borderRadius = '12px';
        iconContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        iconContainer.style.display = 'flex';
        iconContainer.style.alignItems = 'center';
        iconContainer.style.justifyContent = 'center';
        iconContainer.style.fontSize = '24px';
        iconContainer.style.marginTop = '4px';
        iconContainer.innerHTML = '🔗';

        // Content container
        const contentContainer = document.createElement('div');
        contentContainer.style.flex = '1';
        contentContainer.style.minWidth = '0';

        // Title
        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.style.fontSize = '17px';
        title.style.color = '#1f2937';
        title.style.marginBottom = '6px';
        title.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.1)';
        title.textContent = link.label;

        // Section
        const section = document.createElement('div');
        section.style.fontSize = '14px';
        section.style.color = 'rgba(31, 41, 55, 0.8)'; // #1f2937 with 80% opacity
        section.style.marginBottom = '4px';
        section.textContent = link.section;

        // Link preview
        const linkPreview = document.createElement('div');
        linkPreview.style.fontSize = '13px';
        linkPreview.style.color = 'rgba(31, 41, 55, 0.6)'; // #1f2937 with 60% opacity
        linkPreview.style.wordBreak = 'break-all';
        linkPreview.textContent = link.link;

        contentContainer.appendChild(title);
        contentContainer.appendChild(section);
        contentContainer.appendChild(linkPreview);

        // External link icon
        const externalLink = document.createElement('div');
        externalLink.style.flexShrink = '0';
        externalLink.style.color = 'rgba(31, 41, 55, 0.6)';
        externalLink.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';

        resultItem.appendChild(iconContainer);
        resultItem.appendChild(contentContainer);
        resultItem.appendChild(externalLink);

        resultItem.addEventListener('mouseover', () => {
          resultItem.style.backgroundColor = 'rgba(245, 245, 245, 0.69)';
          iconContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
          externalLink.style.color = '#1f2937';
        });

        resultItem.addEventListener('mouseout', () => {
          resultItem.style.backgroundColor = 'transparent';
          iconContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
          externalLink.style.color = 'rgba(31, 41, 55, 0.6)';
        });

        resultItem.addEventListener('click', () => {
          const protocol = window.location.protocol;
          const hostname = window.location.hostname;
          let fullUrl = `${protocol}//${hostname}${link.link}`;
          if (link.isExternal) {
            fullUrl = link.link;
          }
          window.open(fullUrl, '_blank');
          hideSpotlightSearch();
        });

        resultsList.appendChild(resultItem);
      });

      resultsContainer.appendChild(resultsList);
    });

    // Handle keyboard navigation
    let selectedIndex = -1;
    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
      const buttons = resultsContainer.querySelectorAll('button');
      
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
      buttons.forEach((btn) => {
        (btn as HTMLElement).style.backgroundColor = 'transparent';
      });
      
      if (index >= 0 && index < buttons.length) {
        (buttons[index] as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        (buttons[index] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    searchInput.focus();
  } else {
    spotlightContainer.style.display = 'flex';
    const input = spotlightContainer.querySelector('input') as HTMLInputElement;
    if (input) {
      input.focus();
      input.value = '';
    }
  }
}

function hideSpotlightSearch() {
  const spotlightContainer = document.getElementById('sf-log-analyzer-spotlight-container');
  if (spotlightContainer) {
    spotlightContainer.style.display = 'none';
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSidebar);
} else {
  injectSidebar();
}
