// background.ts - Salesforce Debug Log Chrome Extension

interface SalesforceData {
  instanceUrl: string;
  sessionId: string | null;
  timestamp: number;
  isAuthenticated: boolean;
}

const chromeAPI = (globalThis as any).chrome;

// Allow iframe (untrusted context) to access session storage
if (chromeAPI?.storage?.session?.setAccessLevel) {
  chromeAPI.storage.session.setAccessLevel({ 
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' 
  });
}

// Keep service worker alive with periodic heartbeat
let keepAliveInterval: any = null;
const startKeepAlive = () => {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {}, 20000);
};

startKeepAlive();

// Helper: Clean and transform Salesforce domain for API calls
const cleanDomain = (domain: string): string => {
  const cleaned = domain.startsWith('.') ? domain.substring(1) : domain;
  return cleaned
    .replace(/\.lightning\.force\./, '.my.salesforce.') // Avoid HTTP redirects
    .replace(/\.mcas\.ms$/, ''); // Remove Microsoft Defender suffix
};

// Helper: Save session data to storage with hostname-specific key
const saveSessionData = (data: SalesforceData) => {
  const hostname = data.instanceUrl.split('//')[1];
  const storageKey = `sfData_${hostname}`;
  chromeAPI.storage.session.set({ [storageKey]: data });
};

// Helper: Get hostname from URL
const getHostnameFromUrl = (url: string): string | null => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
};

const chromeRuntime = (globalThis as any).chrome?.runtime;
if (chromeRuntime) {
  chromeRuntime.onMessage.addListener(
    (request: any, sender: any, sendResponse: (response?: any) => void) => {
      startKeepAlive();
      
      if (request.type === 'PAGE_LOADED_ON_SF') {
        const senderTab = sender.tab;
        if (!chromeAPI?.cookies || !senderTab?.url) return false;

        const requestUrl = senderTab.url;
        const cookieStoreId = senderTab.cookieStoreId;

        // Two-step cookie lookup (inspired by Salesforce Inspector Reloaded):
        // 1. Extract OrgID from current page cookie
        // 2. Search all Salesforce domains for matching session
        const fetchAndSaveCredentials = (retryCount = 0) => {
          try {
            const pageUrl = new URL(requestUrl);
            const currentDomain = pageUrl.hostname;
            chromeAPI.cookies.get(
              { url: requestUrl, name: 'sid', storeId: cookieStoreId },
              (currentCookie: any) => {
                if (chromeAPI.runtime.lastError || !currentCookie || currentDomain.endsWith('.mcas.ms')) {
                  if (retryCount < 2) {
                    setTimeout(() => fetchAndSaveCredentials(retryCount + 1), (retryCount + 1) * 500);
                    return;
                  }
                  saveSessionData({
                    instanceUrl: pageUrl.origin,
                    sessionId: null,
                    timestamp: Date.now(),
                    isAuthenticated: false,
                  });
                  return;
                }

                // Extract OrgID (first part before "!" in session ID)
                const [orgId] = currentCookie.value.split('!');

                // Search across all Salesforce domains for matching session
                const orderedDomains = [
                  'salesforce.com', 'cloudforce.com', 'salesforce.mil',
                  'cloudforce.mil', 'sfcrmproducts.cn', 'force.com'
                ];
                
                let foundSession = false;
                let domainsChecked = 0;
                
                orderedDomains.forEach((domain) => {
                  chromeAPI.cookies.getAll(
                    { name: 'sid', domain, secure: true, storeId: cookieStoreId },
                    (cookies: any[]) => {
                      domainsChecked++;
                      
                      if (!foundSession && cookies?.length) {
                        const sessionCookie = cookies.find((c: any) => 
                          c.value.startsWith(orgId + '!') && c.domain !== 'help.salesforce.com'
                        );
                        
                        if (sessionCookie && !foundSession) {
                          foundSession = true;
                          const instanceHostname = cleanDomain(sessionCookie.domain);

                          saveSessionData({
                            instanceUrl: `https://${instanceHostname}`,
                            sessionId: sessionCookie.value,
                            timestamp: Date.now(),
                            isAuthenticated: true,
                          });
                        }
                      }
                      
                      // Fallback: use current page cookie if no match found
                      if (domainsChecked === orderedDomains.length && !foundSession) {
                        saveSessionData({
                          instanceUrl: `https://${cleanDomain(currentCookie.domain)}`,
                          sessionId: currentCookie.value,
                          timestamp: Date.now(),
                          isAuthenticated: true,
                        });
                      }
                    }
                  );
                });
              }
            );
          } catch (error) {
            // Error processing Salesforce page
          }
        };

        // Start the fetch process
        fetchAndSaveCredentials();
        return false;
      }

      if (request.type === 'GET_SF_CREDENTIALS') {
        const hostname = request.hostname || getHostnameFromUrl(sender?.tab?.url || '');
        
        if (!hostname) {
          sendResponse({ success: true, data: null });
          return true;
        }
        
        // Look for session data for this specific hostname
        const storageKey = `sfData_${hostname}`;
        chromeAPI.storage.session.get([storageKey], (result: any) => {
          sendResponse({ success: true, data: result[storageKey] || null });
        });
        return true;
      }

      if (request.type === 'FORCE_REFRESH_CREDENTIALS') {
        chromeAPI.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
          if (tabs?.[0]?.url) {
            // Re-inject content script to trigger credential fetch
            chromeAPI.tabs.reload(tabs[0].id);
          }
          sendResponse({ success: true });
        });
        return true;
      }

      if (request.type === 'FETCH_USER_INFO') {
        fetch(`${request.instanceUrl}/services/data/v65.0/chatter/users/me`, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`,
            'Accept': 'application/json'
          }
        })
        .then(res => res.ok ? res.json() : res.text().then(text => {
          throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
        }))
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true;
      }

      if (request.type === 'FETCH_LOGS') {
        const query = 'SELECT Id, LogLength, Operation, Status, StartTime FROM ApexLog ORDER BY StartTime DESC LIMIT 100';
        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/query/?q=${encodeURIComponent(query)}`, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`,
            'Accept': 'application/json'
          }
        })
        .then(res => res.ok ? res.json() : res.text().then(text => {
          throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
        }))
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true;
      }

      if (request.type === 'FETCH_LOG_BODY') {
        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/ApexLog/${request.logId}/Body`, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`
          }
        })
        .then(res => res.ok ? res.text() : res.text().then(text => {
          throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
        }))
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true;
      }

      if (request.type === 'CHECK_DEBUG_SESSION') {
        // Check for active TraceFlag for the current user
        const query = `SELECT Id, ExpirationDate, DebugLevelId, TracedEntityId FROM TraceFlag WHERE TracedEntityId = '${request.userId}' AND ExpirationDate > ${new Date().toISOString()} ORDER BY ExpirationDate DESC LIMIT 1`;
        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/query/?q=${encodeURIComponent(query)}`, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`,
            'Accept': 'application/json'
          }
        })
        .then(res => res.ok ? res.json() : res.text().then(text => {
          throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
        }))
        .then(data => {
          const activeSession = data.records && data.records.length > 0 ? data.records[0] : null;
          sendResponse({ success: true, data: activeSession });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true;
      }

      if (request.type === 'CREATE_DEBUG_SESSION') {
        // Step 1: Check if a DebugLevel exists, or create one
        const checkDebugLevel = fetch(`${request.instanceUrl}/services/data/v58.0/tooling/query/?q=${encodeURIComponent("SELECT Id FROM DebugLevel WHERE DeveloperName = 'SF_LOG_ANALYZER_DEBUG' LIMIT 1")}`, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`,
            'Accept': 'application/json'
          }
        })
        .then(res => res.json())
        .then(data => {
          if (data.records && data.records.length > 0) {
            return data.records[0].Id;
          }
          // Create a new DebugLevel
          return fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/DebugLevel`, {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${request.sessionId}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              DeveloperName: 'SF_LOG_ANALYZER_DEBUG',
              MasterLabel: 'SF Log Analyzer Debug',
              ApexCode: 'FINEST',
              ApexProfiling: 'FINEST',
              Callout: 'INFO',
              Database: 'INFO',
              System: 'DEBUG',
              Validation: 'INFO',
              Visualforce: 'INFO',
              Workflow: 'INFO'
            })
          })
          .then(res => res.json())
          .then(result => result.id);
        });

        // Step 2: Create TraceFlag with 30-minute expiration
        checkDebugLevel
          .then(debugLevelId => {
            const expirationDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            return fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag`, {
              method: 'POST',
              headers: { 
                'Authorization': `Bearer ${request.sessionId}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                TracedEntityId: request.userId,
                DebugLevelId: debugLevelId,
                ExpirationDate: expirationDate,
                LogType: 'USER_DEBUG'
              })
            });
          })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true;
      }

      if (request.type === 'DELETE_DEBUG_SESSION') {
        // Delete the TraceFlag to stop the debug session
        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag/${request.traceFlagId}`, {
          method: 'DELETE',
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`
          }
        })
        .then(res => {
          if (res.status === 204) {
            sendResponse({ success: true });
          } else {
            return res.text().then(text => {
              throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
            });
          }
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true;
      }

      if (request.type === 'DELETE_ALL_LOGS') {
        // Use Bulk API v2 for efficient mass deletion
        // Step 1: Fetch all log IDs
        const query = 'SELECT Id FROM ApexLog';
        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/query/?q=${encodeURIComponent(query)}`, {
          headers: { 
            'Authorization': `Bearer ${request.sessionId}`,
            'Accept': 'application/json'
          }
        })
        .then(res => res.ok ? res.json() : res.text().then(text => {
          throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
        }))
        .then(data => {
          if (!data.records || data.records.length === 0) {
            sendResponse({ success: true, deletedCount: 0 });
            return Promise.resolve();
          }
          
          const ids = data.records.map((r: any) => r.Id);
          
          // Step 2: Create Bulk API v2 delete job
          return fetch(`${request.instanceUrl}/services/data/v58.0/jobs/ingest`, {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${request.sessionId}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              operation: 'delete',
              object: 'ApexLog',
              contentType: 'CSV',
              lineEnding: 'LF'
            })
          })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`Create job failed: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(job => {
            // Step 3: Upload CSV data with IDs to delete
            const csvData = 'Id\n' + ids.join('\n');
            
            return fetch(`${request.instanceUrl}/services/data/v58.0/jobs/ingest/${job.id}/batches`, {
              method: 'PUT',
              headers: { 
                'Authorization': `Bearer ${request.sessionId}`,
                'Content-Type': 'text/csv'
              },
              body: csvData
            })
            .then(res => {
              if (!res.ok) {
                return res.text().then(text => {
                  throw new Error(`Upload CSV failed: ${text.substring(0, 100) || 'Unknown error'}`);
                });
              }
              return job;
            })
            .then(job => {
              // Step 4: Close the job to start processing
              return fetch(`${request.instanceUrl}/services/data/v58.0/jobs/ingest/${job.id}`, {
                method: 'PATCH',
                headers: { 
                  'Authorization': `Bearer ${request.sessionId}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ state: 'UploadComplete' })
              })
              .then(res => res.ok ? res.json() : res.text().then(text => {
                throw new Error(`Close job failed: ${text.substring(0, 100) || 'Unknown error'}`);
              }))
              .then(() => ({ jobId: job.id, totalRecords: ids.length }));
            });
          })
          .then(({ jobId, totalRecords }) => {
            // Step 5: Poll for job completion (max 30 seconds)
            const pollJob = (attempt = 0): Promise<any> => {
              if (attempt > 30) {
                throw new Error('Bulk delete job timed out');
              }
              
              return fetch(`${request.instanceUrl}/services/data/v58.0/jobs/ingest/${jobId}`, {
                headers: { 
                  'Authorization': `Bearer ${request.sessionId}`,
                  'Accept': 'application/json'
                }
              })
              .then(res => res.ok ? res.json() : res.text().then(text => {
                throw new Error(`Poll job failed: ${text.substring(0, 100) || 'Unknown error'}`);
              }))
              .then(jobStatus => {
                if (jobStatus.state === 'JobComplete') {
                  return { 
                    success: true, 
                    deletedCount: totalRecords,
                    processedRecords: jobStatus.numberRecordsProcessed,
                    failedRecords: jobStatus.numberRecordsFailed
                  };
                } else if (jobStatus.state === 'Failed' || jobStatus.state === 'Aborted') {
                  throw new Error(`Bulk job ${jobStatus.state.toLowerCase()}: ${jobStatus.errorMessage || 'Unknown error'}`);
                } else {
                  // Job still processing, wait and retry
                  return new Promise(resolve => setTimeout(resolve, 1000))
                    .then(() => pollJob(attempt + 1));
                }
              });
            };
            
            return pollJob();
          })
          .then(result => sendResponse(result));
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
        
        return true;
      }
    }
  );
  
  chromeRuntime.onInstalled.addListener(startKeepAlive);
  chromeRuntime.onStartup.addListener(startKeepAlive);
}