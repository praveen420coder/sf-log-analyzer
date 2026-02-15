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
  const [debugSession, setDebugSession] = useState<any>(null);
  const [isCreatingDebugSession, setIsCreatingDebugSession] = useState(false);
  const [isStoppingDebugSession, setIsStoppingDebugSession] = useState(false);
  const [isDeletingAllLogs, setIsDeletingAllLogs] = useState(false);
  
  // Get hostname from URL hash (passed by content-ui.tsx)
  const [currentHostname, setCurrentHostname] = useState<string>(() => {
    try {
      const hash = window.location.hash;
      if (hash && hash.includes('hostname=')) {
        const hostnameParam = hash.split('hostname=')[1]?.split('&')[0];
        if (hostnameParam) {
          const decoded = decodeURIComponent(hostnameParam);
          return decoded;
        }
      }
    } catch (e) {
      // Failed to extract hostname
    }
    return '';
  });

  const handleCredentials = useCallback((data: any) => {
    if (data?.sessionId) {
      setInstanceUrl(data.instanceUrl);
      setSessionId(data.sessionId);
      setError(null);
      setIsLoading(false);
      
      // Only set hostname from instanceUrl if we don't already have it
      if (!currentHostname) {
        try {
          const url = new URL(data.instanceUrl);
          setCurrentHostname(url.hostname);
        } catch (e) {
          // Failed to extract hostname
        }
      }
    } else {
      setInstanceUrl(null);
      setSessionId(null);
      setUserInfo(null);
    }
  }, [currentHostname]);

  useEffect(() => {
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage) return;

    const onSessionValid = (instUrl: string, sessId: string) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_USER_INFO', instanceUrl: instUrl, sessionId: sessId },
        (response: any) => {
          if (response?.success) {
            console.log('User info fetched successfully:', response.data);
            setUserInfo(response.data);
          } else {
            console.error('Failed to fetch user info:', response?.error);
          }
        }
      );
    };

    const checkCredentials = (attempt = 1, maxAttempts = 5) => {
      if (!currentHostname) {
        setIsLoading(false);
        setError('Configuration error: hostname not available');
        return;
      }
      
      chrome.runtime.sendMessage(
        { type: 'GET_SF_CREDENTIALS', hostname: currentHostname },
        (response: any) => {
        if (chrome.runtime.lastError) {
          if (attempt < maxAttempts) {
            setTimeout(() => checkCredentials(attempt + 1, maxAttempts), attempt * 200);
          } else {
            setIsLoading(false);
            setError('Extension communication error. Try reloading the page.');
          }
          return;
        }
        
        if (response?.success && response.data?.sessionId) {
          handleCredentials(response.data);
          onSessionValid(response.data.instanceUrl, response.data.sessionId);
        } else if (attempt < maxAttempts) {
          setTimeout(() => checkCredentials(attempt + 1, maxAttempts), attempt * 300);
        } else {
          setIsLoading(false);
          setError('Unable to detect Salesforce session. Click "Retry" or refresh the page.');
        }
      });
    };

    // Start credential check
    checkCredentials();

    // Listen for session storage changes ONLY for this specific hostname
    const storageListener = (changes: any) => {
      if (!currentHostname) {
        return;
      }
      
      const storageKey = `sfData_${currentHostname}`;
      if (changes[storageKey]?.newValue) {
        const newData = changes[storageKey].newValue;
        handleCredentials(newData);
        if (newData?.sessionId) {
          onSessionValid(newData.instanceUrl, newData.sessionId);
        }
      }
    };

    chrome.storage.onChanged.addListener(storageListener);
    return () => chrome.storage.onChanged.removeListener(storageListener);
  }, [handleCredentials, currentHostname]);

  const refreshCredentials = useCallback(() => {
    setIsLoading(true);
    setError(null);
    
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage) {
      setError('Chrome extension API not available');
      setIsLoading(false);
      return;
    }

    if (!currentHostname) {
      setError('Configuration error: hostname not available');
      setIsLoading(false);
      return;
    }

    chrome.runtime.sendMessage({ type: 'FORCE_REFRESH_CREDENTIALS' });
    
    // Wait for page reload to complete
    setTimeout(() => {
      chrome.runtime.sendMessage(
        { type: 'GET_SF_CREDENTIALS', hostname: currentHostname },
        (resp: any) => {
        if (resp?.success && resp.data?.sessionId) {
          handleCredentials(resp.data);
        } else {
          setError('Unable to detect session. Make sure you are logged into Salesforce.');
        }
        setIsLoading(false);
      });
    }, 1500);
  }, [handleCredentials, currentHostname]);

  const fetchLogs = useCallback(() => {
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage) {
      setError('Chrome extension API not available');
      return;
    }

    if (!instanceUrl || !sessionId) {
      setError('Waiting for Salesforce session...');
      return;
    }

    setIsFetching(true);
    setError(null);

    chrome.runtime.sendMessage(
      { type: 'FETCH_LOGS', instanceUrl, sessionId },
      (response: any) => {
        if (chrome.runtime.lastError) {
          setError(`Communication error: ${chrome.runtime.lastError.message}`);
          setIsFetching(false);
          return;
        }

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
          setLogs(formattedLogs);
        } else {
          setError(response?.error || 'Failed to fetch logs.');
        }
        setIsFetching(false);
      }
    );
  }, [instanceUrl, sessionId]);

  const checkDebugSession = useCallback(() => {
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage || !instanceUrl || !sessionId || !userInfo?.id) {
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'CHECK_DEBUG_SESSION', instanceUrl, sessionId, userId: userInfo.id },
      (response: any) => {
        if (response?.success && response.data) {
          setDebugSession(response.data);
        } else {
          setDebugSession(null);
        }
      }
    );
  }, [instanceUrl, sessionId, userInfo]);

  const createDebugSession = useCallback(() => {
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage || !instanceUrl || !sessionId || !userInfo?.id) {
      setError('Cannot create debug session: missing credentials');
      return;
    }

    setIsCreatingDebugSession(true);
    setError(null);

    chrome.runtime.sendMessage(
      { type: 'CREATE_DEBUG_SESSION', instanceUrl, sessionId, userId: userInfo.id },
      (response: any) => {
        setIsCreatingDebugSession(false);
        
        if (response?.success) {
          // Immediately check for the new session
          setTimeout(() => checkDebugSession(), 1000);
        } else {
          setError(response?.error || 'Failed to create debug session');
        }
      }
    );
  }, [instanceUrl, sessionId, userInfo, checkDebugSession]);

  // Check for existing debug session when userInfo is available
  useEffect(() => {
    if (userInfo?.id && instanceUrl && sessionId) {
      checkDebugSession();
      
      // Periodically check debug session status (every 30 seconds)
      const interval = setInterval(checkDebugSession, 30000);
      return () => clearInterval(interval);
    }
  }, [userInfo, instanceUrl, sessionId, checkDebugSession]);

  const stopDebugSession = useCallback(() => {
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage || !instanceUrl || !sessionId || !debugSession?.Id) {
      setError('Cannot stop debug session: missing credentials or session');
      return;
    }

    setIsStoppingDebugSession(true);
    setError(null);

    chrome.runtime.sendMessage(
      { type: 'DELETE_DEBUG_SESSION', instanceUrl, sessionId, traceFlagId: debugSession.Id },
      (response: any) => {
        setIsStoppingDebugSession(false);
        
        if (response?.success) {
          // Clear the debug session and check status
          setDebugSession(null);
          setTimeout(() => checkDebugSession(), 1000);
        } else {
          setError(response?.error || 'Failed to stop debug session');
        }
      }
    );
  }, [instanceUrl, sessionId, debugSession, checkDebugSession]);

  const deleteAllLogs = useCallback(() => {
    const { chrome } = (globalThis as any);
    if (!chrome?.runtime?.sendMessage || !instanceUrl || !sessionId) {
      setError('Cannot delete logs: missing credentials');
      return;
    }

    setIsDeletingAllLogs(true);
    setError(null);

    chrome.runtime.sendMessage(
      { type: 'DELETE_ALL_LOGS', instanceUrl, sessionId },
      (response: any) => {
        setIsDeletingAllLogs(false);
        
        if (response?.success) {
          // Clear logs and refresh
          setLogs([]);
          setTimeout(() => fetchLogs(), 500);
        } else {
          setError(response?.error || 'Failed to delete logs');
        }
      }
    );
  }, [instanceUrl, sessionId, fetchLogs]);

  return { 
    logs, 
    isFetching, 
    error, 
    instanceUrl, 
    sessionId, 
    userInfo, 
    fetchLogs, 
    refreshCredentials, 
    isLoading,
    debugSession,
    isCreatingDebugSession,
    createDebugSession,
    checkDebugSession,
    stopDebugSession,
    isStoppingDebugSession,
    deleteAllLogs,
    isDeletingAllLogs
  };
}
