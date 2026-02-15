// background.ts

console.log('[SF-LOG-ANALYZER-BG] Background script loading...');

interface SalesforceData {
  instanceUrl: string;
  sessionId: string | null;
  timestamp: number;
  isAuthenticated: boolean;
}

// CRITICAL: Allow the Iframe (untrusted context) to access session storage
const chromeAPI = (globalThis as any).chrome;
if (chromeAPI?.storage?.session?.setAccessLevel) {
  chromeAPI.storage.session.setAccessLevel({ 
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' 
  });
  console.log('[SF-LOG-ANALYZER-BG] Storage access level set');
}

// Keep service worker alive with periodic heartbeat
let keepAliveInterval: any = null;
const startKeepAlive = () => {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    console.log('[SF-LOG-ANALYZER-BG] Keepalive ping');
  }, 20000); // Every 20 seconds
};

const stopKeepAlive = () => {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
};

// Start keepalive on startup
startKeepAlive();

const chromeRuntime = (globalThis as any).chrome?.runtime;
if (chromeRuntime) {
  console.log('[SF-LOG-ANALYZER-BG] Setting up message listeners...');
  
  chromeRuntime.onMessage.addListener(
    (request: any, sender: any, sendResponse: (response?: any) => void) => {
      console.log('[SF-LOG-ANALYZER-BG] Message received:', request.type);
      
      // Keep service worker alive during message handling
      startKeepAlive();
      
      if (request.type === 'PAGE_LOADED_ON_SF') {
        console.log('[SF-LOG-ANALYZER-BG] Received PAGE_LOADED_ON_SF message');
        const senderTab = sender.tab;
        const chromeAPI = (globalThis as any).chrome;
        
        if (!chromeAPI?.cookies) {
          console.error('[SF-LOG-ANALYZER-BG] Chrome cookies API not available');
          return;
        }
        if (!senderTab?.url) {
          console.error('[SF-LOG-ANALYZER-BG] Sender tab URL not available');
          return;
        }

        const requestUrl = senderTab.url;
        const cookieStoreId = senderTab.cookieStoreId;
        console.log('[SF-LOG-ANALYZER-BG] Page URL:', requestUrl);
        console.log('[SF-LOG-ANALYZER-BG] Cookie Store ID:', cookieStoreId);

        // Helper function to fetch and save credentials
        // Uses Salesforce Inspector Reloaded's proven two-step cookie lookup:
        // 1. Get sid cookie from current page to extract OrgID
        // 2. Search across multiple domains for cookie with same OrgID
        const fetchAndSaveCredentials = (retryCount = 0) => {
          try {
            const pageUrl = new URL(requestUrl);
            const currentDomain = pageUrl.hostname;
            console.log('[SF-LOG-ANALYZER-BG] Current domain:', currentDomain);

            // STEP 1: Get the sid cookie from current page to extract OrgID
            console.log('[SF-LOG-ANALYZER-BG] Step 1: Fetching sid cookie from current page (attempt ' + (retryCount + 1) + ')...');
            chromeAPI.cookies.get(
              { url: requestUrl, name: 'sid', storeId: cookieStoreId },
              (currentCookie: any) => {
                if (chromeAPI.runtime.lastError) {
                  console.error('[SF-LOG-ANALYZER-BG] Cookie fetch error:', chromeAPI.runtime.lastError);
                  return;
                }

                // If on *.mcas.ms (Microsoft Defender) or no cookie found
                if (!currentCookie || currentDomain.endsWith('.mcas.ms')) {
                  console.warn('[SF-LOG-ANALYZER-BG] No sid cookie or on special domain');
                  
                  // Retry up to 3 times
                  if (retryCount < 2) {
                    console.log('[SF-LOG-ANALYZER-BG] Retrying in ' + ((retryCount + 1) * 500) + 'ms...');
                    setTimeout(() => fetchAndSaveCredentials(retryCount + 1), (retryCount + 1) * 500);
                    return;
                  }
                  
                  // Save fallback data with current domain
                  const sfData: SalesforceData = {
                    instanceUrl: pageUrl.origin,
                    sessionId: null,
                    timestamp: Date.now(),
                    isAuthenticated: false,
                  };
                  console.log('[SF-LOG-ANALYZER-BG] Saving fallback session data');
                  chromeAPI.storage.session.set({ sfData });
                  return;
                }

                // Extract OrgID (first part before "!" in session ID)
                const [orgId] = currentCookie.value.split('!');
                console.log('[SF-LOG-ANALYZER-BG] ✓ Extracted OrgID:', orgId);
                console.log('[SF-LOG-ANALYZER-BG] Current cookie domain:', currentCookie.domain);

                // STEP 2: Search across Salesforce domains for cookie with same OrgID
                // This handles visualforce/lightning/my domain variations
                const orderedDomains = [
                  'salesforce.com',
                  'cloudforce.com', 
                  'salesforce.mil',
                  'cloudforce.mil',
                  'sfcrmproducts.cn',
                  'force.com'
                ];

                console.log('[SF-LOG-ANALYZER-BG] Step 2: Searching across domains for matching OrgID...');
                
                let foundSession = false;
                let domainsChecked = 0;
                
                orderedDomains.forEach((domain) => {
                  chromeAPI.cookies.getAll(
                    { name: 'sid', domain: domain, secure: true, storeId: cookieStoreId },
                    (cookies: any[]) => {
                      domainsChecked++;
                      
                      if (!foundSession && cookies && cookies.length > 0) {
                        console.log('[SF-LOG-ANALYZER-BG] Found', cookies.length, 'cookie(s) on', domain);
                        
                        // Find cookie with matching OrgID (exclude help.salesforce.com)
                        const sessionCookie = cookies.find((c: any) => 
                          c.value.startsWith(orgId + '!') && c.domain !== 'help.salesforce.com'
                        );
                        
                        if (sessionCookie && !foundSession) {
                          foundSession = true;
                          console.log('[SF-LOG-ANALYZER-BG] ✓ Found matching session cookie!');
                          console.log('[SF-LOG-ANALYZER-BG] Cookie domain:', sessionCookie.domain);
                          console.log('[SF-LOG-ANALYZER-BG] Session ID (first 20 chars):', sessionCookie.value.substring(0, 20) + '...');

                          // Remove leading dot from cookie domain
                          const cleanDomain = sessionCookie.domain.startsWith('.')
                            ? sessionCookie.domain.substring(1)
                            : sessionCookie.domain;
                          
                          // Transform domain: .lightning.force. -> .my.salesforce.
                          // This avoids HTTP redirects that would drop Authorization header
                          let instanceHostname = cleanDomain
                            .replace(/\.lightning\.force\./, '.my.salesforce.')
                            .replace(/\.mcas\.ms$/, '');
                          
                          console.log('[SF-LOG-ANALYZER-BG] Instance hostname:', instanceHostname);

                          const sfData: SalesforceData = {
                            instanceUrl: `https://${instanceHostname}`,
                            sessionId: sessionCookie.value,
                            timestamp: Date.now(),
                            isAuthenticated: true,
                          };

                          console.log('[SF-LOG-ANALYZER-BG] ✓ Saving complete session data:', {
                            instanceUrl: sfData.instanceUrl,
                            hasSessionId: true,
                            sessionIdPrefix: sfData.sessionId?.substring(0, 10) + '...',
                            isAuthenticated: true
                          });

                          chromeAPI.storage.session.set({ sfData }, () => {
                            if (chromeAPI.runtime.lastError) {
                              console.error('[SF-LOG-ANALYZER-BG] Storage set error:', chromeAPI.runtime.lastError);
                            } else {
                              console.log('[SF-LOG-ANALYZER-BG] ✓ Session data saved successfully');
                            }
                          });
                        }
                      }
                      
                      // If all domains checked and nothing found, save fallback
                      if (domainsChecked === orderedDomains.length && !foundSession) {
                        console.warn('[SF-LOG-ANALYZER-BG] No matching session cookie found across all domains');
                        console.warn('[SF-LOG-ANALYZER-BG] Using current cookie as fallback');
                        
                        const cleanDomain = currentCookie.domain.startsWith('.')
                          ? currentCookie.domain.substring(1)
                          : currentCookie.domain;
                        
                        const sfData: SalesforceData = {
                          instanceUrl: `https://${cleanDomain}`,
                          sessionId: currentCookie.value,
                          timestamp: Date.now(),
                          isAuthenticated: true,
                        };
                        
                        chromeAPI.storage.session.set({ sfData });
                      }
                    }
                  );
                });
              }
            );
          } catch (error) {
            console.error('[SF-LOG-ANALYZER-BG] Error processing Salesforce page:', error);
          }
        };

        // Start the fetch process
        fetchAndSaveCredentials();
        return false;
      }

      if (request.type === 'GET_SF_CREDENTIALS') {
        console.log('[SF-LOG-ANALYZER-BG] GET_SF_CREDENTIALS request received');
        const chromeAPI = (globalThis as any).chrome;
        chromeAPI.storage.session.get(['sfData'], (result: any) => {
          console.log('[SF-LOG-ANALYZER-BG] Credentials retrieved from storage:', {
            hasData: !!result.sfData,
            instanceUrl: result.sfData?.instanceUrl,
            hasSessionId: !!result.sfData?.sessionId,
            isAuthenticated: result.sfData?.isAuthenticated
          });
          sendResponse({ success: true, data: result.sfData || null });
        });
        return true; // Keep channel open
      }

      if (request.type === 'FORCE_REFRESH_CREDENTIALS') {
        console.log('[SF-LOG-ANALYZER-BG] FORCE_REFRESH_CREDENTIALS request received');
        // Query for active Salesforce tabs and re-fetch credentials
        const chromeAPI = (globalThis as any).chrome;
        chromeAPI.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
          if (tabs && tabs[0]) {
            const tab = tabs[0];
            console.log('[SF-LOG-ANALYZER-BG] Forcing credential refresh for tab:', tab.url);
            // Simulate the PAGE_LOADED_ON_SF flow
            chromeAPI.runtime.sendMessage({ type: 'PAGE_LOADED_ON_SF' }, { tab });
          }
          sendResponse({ success: true });
        });
        return true;
      }

      if (request.type === 'FETCH_USER_INFO') {
        const apiUrl = `${request.instanceUrl}/services/data/v65.0/chatter/users/me`;
        console.log('[SF-LOG-ANALYZER-BG] FETCH_USER_INFO request');
        console.log('[SF-LOG-ANALYZER-BG] API URL:', apiUrl);
        console.log('[SF-LOG-ANALYZER-BG] Session ID (first 15 chars):', request.sessionId?.substring(0, 15) + '...');
        
        fetch(apiUrl, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`,
            'Accept': 'application/json'
          }
        })
        .then(res => {
          console.log('[SF-LOG-ANALYZER-BG] User info response status:', res.status);
          if (!res.ok) {
            return res.text().then(text => {
              console.error('[SF-LOG-ANALYZER-BG] User info error response:', text?.substring(0, 200));
              throw new Error(`HTTP ${res.status}: ${text?.substring(0, 100) || 'Unknown error'}`);
            });
          }
          return res.json();
        })
        .then(data => {
          console.log('[SF-LOG-ANALYZER-BG] ✓ User info fetched:', data.name);
          sendResponse({ success: true, data });
        })
        .catch(err => {
          console.error('[SF-LOG-ANALYZER-BG] User info fetch error:', err.message);
          sendResponse({ success: false, error: err.message });
        });
        
        return true; // Keep channel open
      }

      if (request.type === 'FETCH_LOGS') {
        const soqlQuery = 'SELECT Id, LogLength, Operation, Status, StartTime FROM ApexLog ORDER BY StartTime DESC LIMIT 100';
        const apiUrl = `${request.instanceUrl}/services/data/v58.0/tooling/query/?q=${encodeURIComponent(soqlQuery)}`;
        console.log('[SF-LOG-ANALYZER-BG] FETCH_LOGS request');
        console.log('[SF-LOG-ANALYZER-BG] API URL:', apiUrl);

        fetch(apiUrl, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`,
            'Accept': 'application/json'
          }
        })
        .then(res => {
          console.log('[SF-LOG-ANALYZER-BG] Logs response status:', res.status);
          if (!res.ok) {
            return res.text().then(text => {
              console.error('[SF-LOG-ANALYZER-BG] Logs error response:', text?.substring(0, 200));
              throw new Error(`HTTP ${res.status}: ${text?.substring(0, 100) || 'Unknown error'}`);
            });
          }
          return res.json();
        })
        .then(data => {
          console.log('[SF-LOG-ANALYZER-BG] ✓ Logs fetched:', data.records?.length || 0, 'records');
          sendResponse({ success: true, data });
        })
        .catch(err => {
          console.error('[SF-LOG-ANALYZER-BG] Logs fetch error:', err.message);
          sendResponse({ success: false, error: err.message });
        });
        
        return true; // Keep channel open
      }
    }
  );
  
  // Ensure service worker is ready on install/update
  chromeRuntime.onInstalled.addListener(() => {
    console.log('[SF-LOG-ANALYZER-BG] Extension installed/updated - service worker ready');
    startKeepAlive();
  });
  
  // Wake up on startup
  chromeRuntime.onStartup.addListener(() => {
    console.log('[SF-LOG-ANALYZER-BG] Browser started - service worker ready');
    startKeepAlive();
  });
}

console.log('[SF-LOG-ANALYZER-BG] ✓ All listeners registered');