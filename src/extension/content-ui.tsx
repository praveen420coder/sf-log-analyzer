// Content script - injects iframe to load the React app
function injectSidebar() {
  console.log('[SF-LOG-ANALYZER-INJECT] Injecting sidebar iframe...');
  if (document.getElementById('sf-log-analyzer-iframe')) {
    console.log('[SF-LOG-ANALYZER-INJECT] Iframe already exists');
    return;
  }

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
    console.error('[SF-LOG-ANALYZER-INJECT] Chrome runtime not available');
    return;
  }
  
  iframe.src = chromeRuntime.getURL('index.html');
  console.log('[SF-LOG-ANALYZER-INJECT] Iframe src:', iframe.src);
  document.body.appendChild(iframe);
  console.log('[SF-LOG-ANALYZER-INJECT] ✓ Iframe injected successfully');

  // LISTEN for toggle messages from the React app
  window.addEventListener('message', (event) => {
    if (event.data.type === 'SF_LOG_ANALYZER_TOGGLE') {
      console.log('[SF-LOG-ANALYZER-INJECT] Toggle message received:', event.data.isOpen);
      if (event.data.isOpen) {
        // OPEN STATE: Wide panel with white background (or shadow)
        iframe.style.width = '450px';
        iframe.style.height = '100vh';
        iframe.style.top = '0';
        iframe.style.transform = 'none';
        iframe.style.background = 'none';
        iframe.style.boxShadow = 'none';
      } else {
        // CLOSED STATE: Narrow trigger only, transparent background
        iframe.style.width = '60px';
        iframe.style.height = '120px';
        iframe.style.top = '50%';
        iframe.style.transform = 'translateY(-50%)';
        iframe.style.background = 'none';
        iframe.style.boxShadow = 'none';
      }
    }
  });
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSidebar);
} else {
  injectSidebar();
}
