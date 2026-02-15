// Salesforce page detection and credential trigger script

function isSalesforcePage(): boolean {
  return /--c\.|[^.]+\.force\.com|[^.]+\.salesforce\.com|[^.]+\.lightning\.force\.com/.test(window.location.hostname);
}

if (isSalesforcePage()) {
  const chromeRuntime = (globalThis as any).chrome?.runtime;
  if (chromeRuntime?.sendMessage) {
    const sendMessageWithRetry = (attempt = 1, maxAttempts = 2) => {
      try {
        chromeRuntime.sendMessage({ type: 'PAGE_LOADED_ON_SF' }, () => {
          if (chromeRuntime.lastError && attempt < maxAttempts) {
            setTimeout(() => sendMessageWithRetry(attempt + 1, maxAttempts), attempt * 500);
          }
        });
      } catch {
        if (attempt < maxAttempts) {
          setTimeout(() => sendMessageWithRetry(attempt + 1, maxAttempts), attempt * 500);
        }
      }
    };
    
    sendMessageWithRetry();
  }
}