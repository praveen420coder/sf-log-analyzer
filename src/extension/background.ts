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

// Clicking the toolbar icon opens the analyzer panel on the active tab.
if (chromeAPI?.action?.onClicked) {
  chromeAPI.action.onClicked.addListener((tab: any) => {
    if (tab?.id) {
      chromeAPI.tabs.sendMessage(tab.id, { type: 'SF_TOOLBAR_OPEN' }, () => {
        // Swallow "no receiving end" errors on non-Salesforce tabs.
        void chromeAPI.runtime?.lastError;
      });
    }
  });
}

// Helper: Clean and transform Salesforce domain for API calls
const cleanDomain = (domain: string): string => {
  const cleaned = domain.startsWith('.') ? domain.substring(1) : domain;
  return cleaned
    .replace(/\.lightning\.force\./, '.my.salesforce.') // Avoid HTTP redirects
    .replace(/\.mcas\.ms$/, ''); // Remove Microsoft Defender suffix
};

// Helper: Save session data to storage with hostname-specific key
const saveSessionData = (data: SalesforceData, pageHostname?: string) => {
  // Use the provided page hostname if available, otherwise extract from instanceUrl
  const hostname = pageHostname || data.instanceUrl.split('//')[1];
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
            const cleanedPageHostname = cleanDomain(currentDomain);
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
                  }, cleanedPageHostname);
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
                          }, cleanedPageHostname);
                        }
                      }
                      
                      // Fallback: use current page cookie if no match found
                      if (domainsChecked === orderedDomains.length && !foundSession) {
                        saveSessionData({
                          instanceUrl: `https://${cleanDomain(currentCookie.domain)}`,
                          sessionId: currentCookie.value,
                          timestamp: Date.now(),
                          isAuthenticated: true,
                        }, cleanedPageHostname);
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

      // Enhanced Debug Session Control handlers

      if (request.type === 'CREATE_CUSTOM_DEBUG_LEVEL') {
        // Create a custom debug level with specific settings
        const debugLevel = {
          DeveloperName: request.developerName,
          MasterLabel: request.masterLabel,
          ApexCode: request.settings.ApexCode,
          ApexProfiling: request.settings.ApexProfiling,
          Callout: request.settings.Callout,
          Database: request.settings.Database,
          System: request.settings.System,
          Validation: request.settings.Validation,
          Visualforce: request.settings.Visualforce,
          Workflow: request.settings.Workflow,
        };

        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/DebugLevel`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(debugLevel),
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'FIND_DEBUG_LEVEL_BY_NAME') {
        const query = `SELECT Id, DeveloperName, MasterLabel, ApexCode, ApexProfiling, Callout, Database, System, Validation, Visualforce, Workflow FROM DebugLevel WHERE DeveloperName = '${request.developerName}' LIMIT 1`;

        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/query?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
          },
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data: data.records.length > 0 ? data.records[0] : null }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'UPDATE_DEBUG_LEVEL') {
        const updates = {
          ApexCode: request.settings.ApexCode,
          ApexProfiling: request.settings.ApexProfiling,
          Callout: request.settings.Callout,
          Database: request.settings.Database,
          System: request.settings.System,
          Validation: request.settings.Validation,
          Visualforce: request.settings.Visualforce,
          Workflow: request.settings.Workflow,
        };

        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/DebugLevel/${request.debugLevelId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
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

      if (request.type === 'CREATE_TRACE_FLAG') {
        const traceFlag = {
          TracedEntityId: request.userId,
          DebugLevelId: request.debugLevelId,
          StartDate: new Date().toISOString(),
          ExpirationDate: request.expirationDate,
          LogType: 'USER_DEBUG',
        };

        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(traceFlag),
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'UPDATE_TRACE_FLAG') {
        const updates = {
          DebugLevelId: request.debugLevelId,
          ExpirationDate: request.expirationDate,
        };

        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag/${request.traceFlagId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
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

      if (request.type === 'GET_ALL_ACTIVE_DEBUG_SESSIONS') {
        const now = new Date().toISOString();
        const query = `SELECT Id, TracedEntityId, DebugLevelId, StartDate, ExpirationDate, LogType, TracedEntity.Name, DebugLevel.DeveloperName FROM TraceFlag WHERE ExpirationDate > ${now} ORDER BY ExpirationDate DESC`;

        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/query?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
          },
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data: data.records }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'GET_ALL_ACTIVE_USERS') {
        const query = `SELECT Id, Name, Username, Email FROM User WHERE IsActive = true ORDER BY Name LIMIT 100`;

        fetch(`${request.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
          },
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data: data.records }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'GET_ALL_FLOWS') {
        // FlowDefinitionView lists every flow/process in the org and exposes the
        // version ids needed to open the flow in Flow Builder.
        const query = `SELECT DurableId, ApiName, Label, ProcessType, IsActive, VersionNumber, ManageableState, NamespacePrefix, ActiveVersionId, LatestVersionId FROM FlowDefinitionView ORDER BY Label LIMIT 500`;

        fetch(`${request.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
          },
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data: data.records }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'GET_ALL_APPS') {
        // AppMenuItem.StartUrl for Lightning apps is the generic /one/one.app
        // launcher URL, so every app lands on the default home. Instead we pull
        // AppDefinition (navigable via /lightning/app/<DurableId>) for apps and
        // TabDefinition (its Url is a real, redirectable nav target) for tabs.
        const headers = { 'Authorization': `Bearer ${request.sessionId}` };
        const q = (soql: string) =>
          fetch(`${request.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, { headers })
            .then(res => (res.ok ? res.json() : null))
            .then(data => (data?.records || []))
            .catch(() => []);

        Promise.all([
          q(`SELECT DurableId, Label, DeveloperName, NamespacePrefix, UiType FROM AppDefinition ORDER BY Label LIMIT 1000`),
          q(`SELECT DurableId, Label, Name, Url FROM TabDefinition ORDER BY Label LIMIT 1000`),
        ])
          .then(([apps, tabs]) => {
            const data = [
              ...apps
                .filter((a: any) => a.UiType === 'Lightning')
                .map((a: any) => ({
                  id: a.DurableId,
                  label: a.Label,
                  name: a.DeveloperName,
                  type: 'app',
                  url: `/lightning?appContextId=${a.DurableId}`,
                })),
              ...tabs.map((t: any) => ({
                id: t.DurableId,
                label: t.Label,
                name: t.Name,
                type: 'tab',
                url: t.Url || '',
              })),
            ];
            sendResponse({ success: true, data });
          })
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'GET_ALL_OBJECTS') {
        // EntityDefinition lists every sObject, but the Object Manager only shows
        // customizable standard + custom objects. We pull IsCustomizable /
        // IsDeprecatedAndHidden so we can filter out the system objects (share,
        // history, feed, change-event, tag tables, etc.) that Object Manager hides.
        // ORDER BY QualifiedApiName is the only reliably sortable field; we sort by
        // label on the client.
        const query = `SELECT QualifiedApiName, Label, DurableId, KeyPrefix, IsCustomizable, IsDeprecatedAndHidden FROM EntityDefinition ORDER BY QualifiedApiName LIMIT 2000`;

        // System-object suffixes that never appear in Object Manager.
        const systemSuffixes = ['__Share', '__History', '__Feed', '__ChangeEvent', '__Tag', '__ViewStat', '__VoteStat', '__OwnerShareRule', '__HistoryArchive'];
        const isObjectManagerObject = (r: any): boolean => {
          if (r.IsDeprecatedAndHidden) return false;
          if (r.IsCustomizable === false) return false;
          const api: string = r.QualifiedApiName || '';
          if (systemSuffixes.some(s => api.endsWith(s))) return false;
          return true;
        };

        fetch(`${request.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
          },
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data: (data.records || []).filter(isObjectManagerObject) }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'GET_RECORD_DETAIL') {
        // Returns every field the current user can access for a record, with
        // label, type and value. FLS/sharing are enforced by Salesforce: the
        // sObject row resource only returns readable fields.
        const V = 'v60.0';
        const headers = { 'Authorization': `Bearer ${request.sessionId}` };
        const recordId: string = request.recordId;

        const resolveType = async (): Promise<string | null> => {
          if (request.objectApiName) return request.objectApiName;
          const prefix = (recordId || '').substring(0, 3);
          const q = `SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix = '${prefix}' LIMIT 1`;
          try {
            const res = await fetch(`${request.instanceUrl}/services/data/${V}/query?q=${encodeURIComponent(q)}`, { headers });
            if (!res.ok) return null;
            const d = await res.json();
            return d.records?.[0]?.QualifiedApiName || null;
          } catch {
            return null;
          }
        };

        (async () => {
          try {
            const objectApiName = await resolveType();
            if (!objectApiName) {
              sendResponse({ success: false, error: 'Could not determine the object type for this Id.' });
              return;
            }

            const [descRes, recRes] = await Promise.all([
              fetch(`${request.instanceUrl}/services/data/${V}/sobjects/${objectApiName}/describe`, { headers }),
              fetch(`${request.instanceUrl}/services/data/${V}/sobjects/${objectApiName}/${recordId}`, { headers }),
            ]);

            if (recRes.status === 404) {
              sendResponse({ success: false, error: 'Record not found, or you do not have access to it.' });
              return;
            }
            if (!recRes.ok) {
              const t = await recRes.text();
              sendResponse({ success: false, error: `HTTP ${recRes.status}: ${t.substring(0, 140) || 'Unknown error'}` });
              return;
            }

            const record = await recRes.json();
            const describe = descRes.ok ? await descRes.json() : { fields: [], label: objectApiName };

            // A field present as a key in the row response is readable by the user
            // (FLS read). Fields defined on the object but absent ⇒ no read access.
            const isReadable = (name: string) => Object.prototype.hasOwnProperty.call(record, name);

            const describeFields: any[] = describe.fields || [];
            const nameField = describeFields.find((f: any) => f.nameField)?.name || 'Name';

            const fromDescribe = describeFields.map((f: any) => {
              const accessible = isReadable(f.name);
              return {
                apiName: f.name,
                label: f.label || f.name,
                type: f.type || 'string',
                value: accessible ? record[f.name] : null,
                accessible,
                isReference: f.type === 'reference',
                referenceTo: f.referenceTo || [],
                updateable: f.updateable === true,
                picklistValues: (f.picklistValues || []).filter((p: any) => p.active !== false).map((p: any) => ({ label: p.label, value: p.value })),
              };
            });

            // Fallback if describe was unavailable: show the readable fields only.
            const fromRecord = Object.keys(record)
              .filter((k) => k !== 'attributes')
              .map((k) => ({
                apiName: k, label: k, type: 'string', value: record[k], accessible: true,
                isReference: false, referenceTo: [], updateable: false, picklistValues: [],
              }));

            const fields = (fromDescribe.length ? fromDescribe : fromRecord)
              .sort((a, b) => (a.label || '').localeCompare(b.label || ''));

            const recordName = record[nameField] || record['Name'] || recordId;

            sendResponse({
              success: true,
              data: { objectApiName, objectLabel: describe.label || objectApiName, recordId, recordName, fields },
            });
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || 'Failed to load record detail.' });
          }
        })();

        return true;
      }

      if (request.type === 'GET_ALL_METADATA') {
        // Custom Metadata Types (__mdt) and Custom Settings, for the Metadata tab.
        // Global describe gives the customSetting flag + labels; EntityDefinition
        // gives the DurableId needed to deep-link to "Manage Records".
        const V = 'v60.0';
        const headers = { 'Authorization': `Bearer ${request.sessionId}` };

        (async () => {
          try {
            const gd = await fetch(`${request.instanceUrl}/services/data/${V}/sobjects/`, { headers })
              .then((r) => (r.ok ? r.json() : { sobjects: [] }));
            const sobjects: any[] = gd.sobjects || [];

            const info: Record<string, { label: string; kind: 'mdt' | 'setting' }> = {};
            sobjects.forEach((s) => {
              const name: string = s.name || '';
              const isMdt = name.endsWith('__mdt');
              const isSetting = s.customSetting === true;
              if (isMdt || isSetting) info[name] = { label: s.label || name, kind: isMdt ? 'mdt' : 'setting' };
            });

            const names = Object.keys(info);
            if (names.length === 0) { sendResponse({ success: true, data: [] }); return; }

            // DurableId per object (chunk the IN clause to keep the query small).
            const durable: Record<string, string> = {};
            for (let i = 0; i < names.length; i += 100) {
              const chunk = names.slice(i, i + 100);
              const inClause = chunk.map((n) => `'${n.replace(/'/g, "\\'")}'`).join(',');
              const q = `SELECT QualifiedApiName, DurableId FROM EntityDefinition WHERE QualifiedApiName IN (${inClause})`;
              try {
                const ed = await fetch(`${request.instanceUrl}/services/data/${V}/query?q=${encodeURIComponent(q)}`, { headers })
                  .then((r) => (r.ok ? r.json() : { records: [] }));
                (ed.records || []).forEach((r: any) => { durable[r.QualifiedApiName] = r.DurableId; });
              } catch { /* leave durableId undefined → falls back to list home */ }
            }

            const data = names
              .map((name) => ({ apiName: name, label: info[name].label, kind: info[name].kind, durableId: durable[name] || null }))
              .sort((a, b) => a.label.localeCompare(b.label));

            sendResponse({ success: true, data });
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || 'Failed to load metadata.' });
          }
        })();

        return true;
      }

      if (request.type === 'UPDATE_RECORD_FIELD') {
        // PATCH a single field on a record. Salesforce enforces FLS/validation;
        // any failure (no edit access, validation rule, required field) returns
        // a descriptive message that we surface to the user.
        const V = 'v60.0';
        const headers = {
          'Authorization': `Bearer ${request.sessionId}`,
          'Content-Type': 'application/json',
        };
        const body = JSON.stringify({ [request.fieldApiName]: request.value });

        fetch(`${request.instanceUrl}/services/data/${V}/sobjects/${request.objectApiName}/${request.recordId}`, {
          method: 'PATCH',
          headers,
          body,
        })
          .then(async (res) => {
            if (res.status === 204) {
              sendResponse({ success: true });
              return;
            }
            const text = await res.text();
            let msg = `HTTP ${res.status}`;
            try {
              const j = JSON.parse(text);
              if (Array.isArray(j) && j[0]?.message) msg = j[0].message;
              else if (j?.message) msg = j.message;
            } catch { /* keep status message */ }
            sendResponse({ success: false, error: msg });
          })
          .catch((err) => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'GET_ALL_SECURITY') {
        // Permission sets, permission set groups, and profiles in one shot.
        const headers = { 'Authorization': `Bearer ${request.sessionId}` };
        const q = (soql: string) =>
          fetch(`${request.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, { headers })
            .then(res => (res.ok ? res.json() : null))
            .then(data => (data?.records || []))
            .catch(() => []);

        Promise.all([
          q(`SELECT Id, Label, Name, Type FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label`),
          q(`SELECT Id, MasterLabel, DeveloperName FROM PermissionSetGroup ORDER BY MasterLabel`),
          q(`SELECT Id, Name FROM Profile ORDER BY Name`),
        ])
          .then(([permSets, groups, profiles]) => {
            const data = [
              ...permSets.map((r: any) => ({ id: r.Id, label: r.Label || r.Name, name: r.Name, type: 'Permission Set' })),
              ...groups.map((r: any) => ({ id: r.Id, label: r.MasterLabel || r.DeveloperName, name: r.DeveloperName, type: 'Permission Set Group' })),
              ...profiles.map((r: any) => ({ id: r.Id, label: r.Name, name: r.Name, type: 'Profile' })),
            ];
            sendResponse({ success: true, data });
          })
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'SEARCH_USERS') {
        const query = `SELECT Id, Name, Username, Email FROM User WHERE IsActive = true AND (Name LIKE '%${request.searchTerm}%' OR Username LIKE '%${request.searchTerm}%' OR Email LIKE '%${request.searchTerm}%') ORDER BY Name LIMIT 10`;

        fetch(`${request.instanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`, {
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
          },
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data: data.records }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'GET_DEBUG_LEVEL') {
        fetch(`${request.instanceUrl}/services/data/v58.0/tooling/sobjects/DebugLevel/${request.debugLevelId}`, {
          headers: {
            'Authorization': `Bearer ${request.sessionId}`,
          },
        })
          .then(res => res.ok ? res.json() : res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 100) || 'Unknown error'}`);
          }))
          .then(data => sendResponse({ success: true, data }))
          .catch(err => sendResponse({ success: false, error: err.message }));

        return true;
      }

      if (request.type === 'OPEN_INCOGNITO_TAB') {
        chromeAPI.windows.create({
          url: request.url,
          incognito: true,
        }, () => {
          sendResponse({ success: true });
        });
        return true;
      }

      if (request.type === 'NAVIGATE_CURRENT_TAB') {
        // Navigate current tab — session cookie carried automatically ✅
        chromeAPI.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
          if (tabs?.[0]?.id) {
            chromeAPI.tabs.update(tabs[0].id, { url: request.url });
          }
          sendResponse({ success: true });
      });
  return true;
}

if (request.type === 'OPEN_INCOGNITO_TAB') {
  // Step 1: Create incognito window
  chromeAPI.windows.create({ incognito: true }, (win: any) => {
    const tabId = win.tabs[0].id;
    const domain = new URL(request.instanceUrl).hostname;

    // Step 2: Inject session cookie into incognito window
    chromeAPI.cookies.set({
      url: request.instanceUrl,
      name: 'sid',
      value: request.sessionId,
      domain: domain,
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction',
    }, () => {
      // Step 3: Navigate to Login As URL
      chromeAPI.tabs.update(tabId, { url: request.url });
      sendResponse({ success: true });
    });
  });
  return true;
}
    }
  );
  
  chromeRuntime.onInstalled.addListener(startKeepAlive);
  chromeRuntime.onStartup.addListener(startKeepAlive);
}