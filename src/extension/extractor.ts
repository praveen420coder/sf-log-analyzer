// This script runs in the Main World (page context) to access global variables
window.postMessage({
  type: 'SF_LOG_ANALYZER_EXTRACT_VARS',
  sfdcSession: (window as any).sfdcSession,
  __SFDC_TOKEN: (window as any).__SFDC_TOKEN
}, '*');