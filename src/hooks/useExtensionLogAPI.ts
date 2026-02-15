import { useState, useCallback, useEffect } from 'react';

export interface Log {
  Id?: string;
  id?: string;
  StartTime?: string;
  startTime?: string;
  Status?: string;
  status?: string;
  LogLength?: number;
  size?: string;
  Operation?: string;
  details?: string;
}

export interface Metric {
  label: string;
  value: string;
}

export function useExtensionLogAPI() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceUrl, setInstanceUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const handleCredentials = useCallback((data: any) => {
    console.log('[SF-LOG-ANALYZER-UI] handleCredentials called:', {
      hasData: !!data,
      hasSessionId: !!data?.sessionId,
      instanceUrl: data?.instanceUrl,
      isAuthenticated: data?.isAuthenticated
    });
    if (data?.sessionId) {
      console.log('[SF-LOG-ANALYZER-UI] ✓ Valid credentials received');
      setInstanceUrl(data.instanceUrl);
      setSessionId(data.sessionId);
      setError(null);
      setIsLoading(false);
    } else {
      // Don't immediately set a hard error if data is just null; 
      // the background script might still be searching for cookies.
      console.log('[SF-LOG-ANALYZER-UI] ✗ No session ID found in credentials');
      setInstanceUrl(null);
      setSessionId(null);
      setUserInfo(null);
    }
  }, []);

  useEffect(() => {
    console.log('[SF-LOG-ANALYZER-UI] Extension API hook initializing...');
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage) {
      console.error('[SF-LOG-ANALYZER-UI] ✗ Chrome runtime not available');
      return;
    }

    const onSessionValid = (instUrl: string, sessId: string) => {
      console.log('[SF-LOG-ANALYZER-UI] Session valid, fetching user info...');
      chrome.runtime.sendMessage(
        { type: 'FETCH_USER_INFO', instanceUrl: instUrl, sessionId: sessId },
        (response: any) => {
          if (response?.success) {
            console.log('[SF-LOG-ANALYZER-UI] ✓ User info received:', response.data?.name);
            setUserInfo(response.data);
          } else {
            console.warn('[SF-LOG-ANALYZER-UI] ⚠ User info fetch failed (non-critical):', response?.error);
            // Don't set error - user info is optional, credentials are what matter
          }
        }
      );
    };

    const checkCredentials = (attempt = 1, maxAttempts = 10) => {
      console.log(`[SF-LOG-ANALYZER-UI] Checking credentials (attempt ${attempt}/${maxAttempts})...`);
      
      chrome.runtime.sendMessage({ type: 'GET_SF_CREDENTIALS' }, (response: any) => {
        if (chrome.runtime.lastError) {
          console.error('[SF-LOG-ANALYZER-UI] Runtime error:', chrome.runtime.lastError);
          if (attempt < maxAttempts) {
            setTimeout(() => checkCredentials(attempt + 1, maxAttempts), attempt * 200);
          } else {
            setIsLoading(false);
            setError('Extension communication error. Try reloading the page.');
          }
          return;
        }
        
        console.log('[SF-LOG-ANALYZER-UI] Credentials response:', {
          success: response?.success,
          hasData: !!response?.data,
          hasSessionId: !!response?.data?.sessionId,
          attempt
        });
        
        if (response?.success && response.data?.sessionId) {
          // Success! We have credentials
          console.log('[SF-LOG-ANALYZER-UI] ✓ Credentials found on attempt', attempt);
          handleCredentials(response.data);
          onSessionValid(response.data.instanceUrl, response.data.sessionId);
        } else if (attempt < maxAttempts) {
          // Retry after a delay
          console.log(`[SF-LOG-ANALYZER-UI] No credentials yet, retrying in ${attempt * 200}ms...`);
          setTimeout(() => checkCredentials(attempt + 1, maxAttempts), attempt * 200);
        } else {
          console.warn('[SF-LOG-ANALYZER-UI] ✗ Max retry attempts reached, no credentials found');
          setIsLoading(false);
          setError('Unable to detect Salesforce session. Click "Retry" or refresh the page.');
        }
      });
    };

    // Start credential check with retry logic
    checkCredentials();

    // 2. Listen for changes - This is the primary driver
    console.log('[SF-LOG-ANALYZER-UI] Setting up storage change listener...');
    const storageListener = (changes: any) => {
      console.log('[SF-LOG-ANALYZER-UI] Storage changed:', Object.keys(changes));
      if (changes.sfData) {
        console.log('[SF-LOG-ANALYZER-UI] sfData updated:', {
          hasNewValue: !!changes.sfData.newValue,
          hasOldValue: !!changes.sfData.oldValue
        });
        const newData = changes.sfData.newValue;
        handleCredentials(newData);
        if (newData?.sessionId) {
          onSessionValid(newData.instanceUrl, newData.sessionId);
        }
      }
    };

    chrome.storage.onChanged.addListener(storageListener);
    return () => chrome.storage.onChanged.removeListener(storageListener);
  }, [handleCredentials]);

  // Manual refresh function to force re-fetch of credentials
  const refreshCredentials = useCallback(() => {
    console.log('[SF-LOG-ANALYZER-UI] Manual refresh triggered');
    setIsLoading(true);
    setError(null);
    
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage) {
      setError('Chrome extension API not available');
      setIsLoading(false);
      return;
    }

    // Trigger background to re-fetch from current page
    chrome.runtime.sendMessage({ type: 'FORCE_REFRESH_CREDENTIALS' }, (response: any) => {
      console.log('[SF-LOG-ANALYZER-UI] Force refresh response:', response);
      // Wait a bit then check for credentials
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'GET_SF_CREDENTIALS' }, (resp: any) => {
          if (resp?.success && resp.data?.sessionId) {
            handleCredentials(resp.data);
            setIsLoading(false);
          } else {
            setError('Still unable to detect session. Make sure you are logged into Salesforce.');
            setIsLoading(false);
          }
        });
      }, 1000);
    });
  }, [handleCredentials]);

  const fetchLogs = useCallback(() => {
    console.log('[SF-LOG-ANALYZER-UI] fetchLogs called');
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage) {
      console.error('[SF-LOG-ANALYZER-UI] Chrome API not available');
      setError('Chrome extension API not available');
      return;
    }

    if (!instanceUrl || !sessionId) {
      console.warn('[SF-LOG-ANALYZER-UI] Missing credentials:', { instanceUrl, hasSessionId: !!sessionId });
      setError('Waiting for Salesforce session...');
      return;
    }

    console.log('[SF-LOG-ANALYZER-UI] Fetching logs from:', instanceUrl);
    setIsFetching(true);
    setError(null);

    chrome.runtime.sendMessage(
      { type: 'FETCH_LOGS', instanceUrl, sessionId },
      (response: any) => {
        if (chrome.runtime.lastError) {
          console.error('[SF-LOG-ANALYZER-UI] Runtime error:', chrome.runtime.lastError.message);
          setError(`Communication error: ${chrome.runtime.lastError.message}`);
          setIsFetching(false);
          return;
        }

        console.log('[SF-LOG-ANALYZER-UI] Logs response:', {
          success: response?.success,
          recordCount: response?.data?.records?.length || 0
        });

        // ALWAYS finish fetching state inside the callback
        if (response?.success && response.data?.records) {
          const formattedLogs: Log[] = response.data.records.map((log: any) => ({
             id: log.Id,
             startTime: log.StartTime,
             status: log.Status,
             size: `${(log.LogLength / 1024).toFixed(2)} KB`,
             details: `Operation: ${log.Operation}\nSize: ${log.LogLength}`,
             Operation: log.Operation,
             LogLength: log.LogLength
          }));
          console.log('[SF-LOG-ANALYZER-UI] ✓ Logs formatted:', formattedLogs.length);
          setLogs(formattedLogs);
        } else {
          console.error('[SF-LOG-ANALYZER-UI] ✗ Logs fetch failed:', response?.error);
          setError(response?.error || 'Failed to fetch logs.');
        }
        setIsFetching(false);
      }
    );
  }, [instanceUrl, sessionId]);

  return { logs, isFetching, error, instanceUrl, sessionId, userInfo, fetchLogs, refreshCredentials, isLoading };
}
