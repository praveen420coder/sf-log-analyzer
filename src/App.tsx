import { useState, useMemo, useEffect, useRef } from 'react';
import Header from './components/LogKit/Header';
import DashboardView from './components/LogKit/DashboardView';
import DetailView from './components/LogKit/DetailView';
import SidebarTrigger from './components/LogKit/SidebarTrigger';
import Toast from './components/Toast';
import { useExtensionLogAPI } from './hooks/useExtensionLogAPI';
import type { Log } from './types';

export default function App() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [view, setView] = useState<'dashboard' | 'detail'>('dashboard');
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const prevFetchingRef = useRef(false);
  const prevDeletingRef = useRef(false);

  const { 
    logs, isFetching, userInfo, fetchLogs ,instanceUrl, sessionId,
    debugSession, isCreatingDebugSession, createDebugSession,
    stopDebugSession, isStoppingDebugSession,
    deleteAllLogs, isDeletingAllLogs
  } = useExtensionLogAPI();

  const isConnected = !!(sessionId && instanceUrl);

  useEffect(() => {
    // Notify parent window (content-ui.tsx) about panel state
    window.parent.postMessage({ type: 'SF_LOG_ANALYZER_TOGGLE', isOpen }, '*');
  }, [isOpen]);

  useEffect(() => {
    // Listen for messages from parent page
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'CLOSE_PANEL') {
        setIsOpen(false);
      } else if (event.data.type === 'OPEN_PANEL') {
        setIsOpen(true);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    // Handle Escape key to close panel
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Show toast after fetch completes
  useEffect(() => {
    if (prevFetchingRef.current && !isFetching) {
      setTimeout(() => {
        if (logs.length > 0) {
          setToast({ message: `Successfully fetched ${logs.length} log record${logs.length === 1 ? '' : 's'}`, type: 'success' });
        } else {
          setToast({ message: 'No log records found', type: 'info' });
        }
      }, 0);
    }
    prevFetchingRef.current = isFetching;
  }, [isFetching, logs.length]);

  // Show toast after delete completes
  useEffect(() => {
    if (prevDeletingRef.current && !isDeletingAllLogs) {
      setTimeout(() => {
        setToast({ message: 'All log records deleted successfully', type: 'success' });
      }, 0);
    }
    prevDeletingRef.current = isDeletingAllLogs;
  }, [isDeletingAllLogs]);

  // Compute metrics from logs using useMemo
  const metrics = useMemo(() => {
    if (logs && logs.length > 0) {
      const totalLogs = logs.length;
      
      const sizes = logs.map(log => log.LogLength || 0);
      const totalSize = sizes.reduce((a, b) => a + b, 0);
      const totalSizeFormatted = totalSize >= 1024 * 1024
        ? `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
        : `${(totalSize / 1024).toFixed(2)} KB`;

      return [
        { label: 'total logs', value: String(totalLogs) },
        { label: 'total size', value: totalSizeFormatted }
      ];
    }
    return [
      { label: 'total logs', value: '0' },
      { label: 'total size', value: '0 KB' }
    ];
  }, [logs]);

  const handleExplore = (log: Log) => {
    setSelectedLog(log);
    setView('detail');
  };

  return (
    <div className="font-sans antialiased text-black min-h-screen relative overflow-hidden">
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)}
        />
      )}
      <SidebarTrigger onClick={() => setIsOpen(true)} />
      
      <div 
        className={`
          fixed inset-y-0 right-0 z-50 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.1)] 
          transition-transform duration-500 ease-in-out border-l border-gray-200
          w-full overflow-hidden
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="h-full overflow-y-auto relative flex flex-col bg-white">
          <Header onClose={() => setIsOpen(false)} hideClose={false} />

          <main className="flex-1 px-8 py-10 overflow-y-auto">
            {view === 'dashboard' ? (
              <DashboardView 
                logs={logs} 
                metrics={metrics} 
                isFetching={isFetching} 
                onFetch={fetchLogs} 
                onExplore={handleExplore}
                instanceUrl={instanceUrl}
                userInfo={userInfo}
                debugSession={debugSession}
                isCreatingDebugSession={isCreatingDebugSession}
                onCreateDebugSession={createDebugSession}
                onStopDebugSession={stopDebugSession}
                isStoppingDebugSession={isStoppingDebugSession}
                onDeleteAllLogs={deleteAllLogs}
                isDeletingAllLogs={isDeletingAllLogs}
              />
            ) : (
              selectedLog && (
                <DetailView 
                  log={selectedLog} 
                  onBack={() => setView('dashboard')} 
                  instanceUrl={instanceUrl}
                  sessionId={sessionId}
                />
              )
            )}
          </main>

          <footer className="p-8 bg-white border-t border-gray-100 flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-[0.4em] text-gray-300">
              © 2026 Praveen Kumar
            </p>
            {isConnected && (
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 rounded-full animate-pulse bg-blue-500"></div>
                <span className="text-[9px] font-black uppercase text-gray-400">
                  Connected as {userInfo?.name || 'User'}
                </span>
              </div>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}