// This script runs on Salesforce pages and signals the background script to fetch credentials.

/**
 * Checks if the current page is a Salesforce page.
 * @returns {boolean} True if the hostname matches a Salesforce domain pattern.
 */
function isSalesforcePage(): boolean {
  // This regex is designed to match various Salesforce URL formats, including custom domains.
  return /--c\.|[^.]+\.force\.com|[^.]+\.salesforce\.com|[^.]+\.lightning\.force\.com/.test(window.location.hostname);
}

// On page load, if it's a Salesforce page, send a message to the background script.
// This triggers the background script to perform its robust, cookie-based credential fetching.
if (isSalesforcePage()) {
  console.log('[SF-LOG-ANALYZER] ✓ Salesforce page detected:', window.location.hostname);
  const chromeRuntime = (globalThis as any).chrome?.runtime;
  if (chromeRuntime?.sendMessage) {
    // Send message with retry to wake up service worker if needed
    const sendMessageWithRetry = (attempt = 1, maxAttempts = 3) => {
      try {
        console.log(`[SF-LOG-ANALYZER] Sending PAGE_LOADED_ON_SF message (attempt ${attempt})...`);
        chromeRuntime.sendMessage({ type: 'PAGE_LOADED_ON_SF' }, (response: any) => {
          if (chromeRuntime.lastError) {
            console.warn(`[SF-LOG-ANALYZER] Message failed (attempt ${attempt}):`, chromeRuntime.lastError.message);
            if (attempt < maxAttempts) {
              console.log(`[SF-LOG-ANALYZER] Retrying in ${attempt * 500}ms...`);
              setTimeout(() => sendMessageWithRetry(attempt + 1, maxAttempts), attempt * 500);
            } else {
              console.error('[SF-LOG-ANALYZER] All retry attempts failed');
            }
          } else {
            console.log('[SF-LOG-ANALYZER] ✓ Message sent successfully');
          }
        });
      } catch (error) {
        console.error('[SF-LOG-ANALYZER] Message send error:', error);
        if (attempt < maxAttempts) {
          setTimeout(() => sendMessageWithRetry(attempt + 1, maxAttempts), attempt * 500);
        }
      }
    };
    
    sendMessageWithRetry();
  } else {
    console.log('[SF-LOG-ANALYZER] ✗ Chrome runtime not available');
  }
} else {
  console.log('[SF-LOG-ANALYZER] ✗ Not a Salesforce page:', window.location.hostname);
}