// Salesforce page detection and credential trigger script

// Use hostname-based detection since this runs at document_start (DOM not ready yet)
function isSalesforcePage(): boolean {
  const hostname = window.location.hostname;
  const salesforcePatterns = [
    /\.salesforce\.com$/,
    /\.salesforce-setup\.com$/,
    /\.force\.com$/,
    /\.cloudforce\.com$/,
    /\.visualforce\.com$/,
    /\.vf\.force\.com$/,
    /\.lightning\.force\.com$/,
    /\.salesforce\.mil$/,
    /\.force\.mil$/,
    /\.cloudforce\.mil$/,
    /\.visualforce\.mil$/,
    /\.crmforce\.mil$/,
    /\.sfcrmapps\.cn$/,
    /\.sfcrmproducts\.cn$/,
    /\.builder\.salesforce-experience\.com$/,
    /\.force\.com\.mcas\.ms$/
  ];
  
  return salesforcePatterns.some(pattern => pattern.test(hostname));
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