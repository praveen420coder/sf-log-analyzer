// Content script - injects iframe to load the React app

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

function injectSidebar() {
  // Only inject on actual Salesforce pages
  if (!isSalesforcePage()) {
    return;
  }

  if (document.getElementById('sf-log-analyzer-iframe')) {
    return;
  }

  // Track panel state
  let isPanelOpen = false;

  const iframe = document.createElement('iframe');
  iframe.id = 'sf-log-analyzer-iframe';
  iframe.style.position = 'fixed';
  iframe.style.top = '50%';
  iframe.style.right = '0';
  iframe.style.height = '120px';
  iframe.style.transform = 'translateY(-50%)';
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
  backdrop.style.left = '0';
  backdrop.style.right = '50vw'; // Only cover left side, not the panel
  backdrop.style.bottom = '0';
  backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
  backdrop.style.zIndex = '2147483646'; // Just below iframe
  backdrop.style.display = 'none'; // Hidden by default
  backdrop.style.cursor = 'pointer';
  
  document.body.appendChild(backdrop);

  // Function to open the panel
  const openPanel = () => {
    isPanelOpen = true;
    iframe.contentWindow?.postMessage({ type: 'OPEN_PANEL' }, '*');
  };

  // Function to close the panel
  const closePanel = () => {
    isPanelOpen = false;
    iframe.contentWindow?.postMessage({ type: 'CLOSE_PANEL' }, '*');
  };

  backdrop.addEventListener('click', () => {
    closePanel();
  });

  // LISTEN for toggle messages from the React app
  window.addEventListener('message', (event) => {
    if (event.data.type === 'SF_LOG_ANALYZER_TOGGLE') {
      isPanelOpen = event.data.isOpen;
      
      if (event.data.isOpen) {
        // OPEN STATE: Wide panel with white background (or shadow)
        iframe.style.width = '50vw';
        iframe.style.height = '100vh';
        iframe.style.top = '0';
        iframe.style.transform = 'none';
        iframe.style.background = 'none';
        iframe.style.boxShadow = 'none';
        backdrop.style.display = 'block'; // Show backdrop
      } else {
        // CLOSED STATE: Narrow trigger only, transparent background
        iframe.style.width = '60px';
        iframe.style.height = '120px';
        iframe.style.top = '50%';
        iframe.style.transform = 'translateY(-50%)';
        iframe.style.background = 'none';
        iframe.style.boxShadow = 'none';
        backdrop.style.display = 'none'; // Hide backdrop
      }
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
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSidebar);
} else {
  injectSidebar();
}
