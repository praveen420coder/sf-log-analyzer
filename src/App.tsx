import { useState, useMemo, useEffect, useRef } from 'react';
import Header from './components/LogKit/Header';
import DashboardView from './components/LogKit/DashboardView';
import SettingsView from './components/LogKit/SettingsView';
import SidebarTrigger from './components/LogKit/SidebarTrigger';
import Toast from './components/Toast';
import DebugSessionControl from './components/LogKit/DebugSessionControl';
import { useExtensionLogAPI } from './hooks/useExtensionLogAPI';
import { useSettings } from './hooks/useSettings';
import type { Log } from './types';

export default function App() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isDebugSessionControlOpen, setIsDebugSessionControlOpen] = useState(false);
  const prevFetchingRef = useRef(false);
  const prevDeletingRef = useRef(false);

  const { 
    logs, isFetching, userInfo, fetchLogs ,instanceUrl, sessionId, currentHostname,
    debugSession, isCreatingDebugSession, createDebugSession,
    stopDebugSession, isStoppingDebugSession,
    deleteAllLogs, isDeletingAllLogs
  } = useExtensionLogAPI();

  const { settings, updateSettings, resetSettings } = useSettings();

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
    // Open the new full-page Log Explorer and jump straight into the analyzer.
    const logId = (log as any).id || (log as any).Id;
    const cr = (globalThis as any).chrome?.runtime;
    // Use the hostname that actually resolved this session (same value content-ui
    // passes when opening the full-page tab); fall back to the instance URL host.
    let host = currentHostname || '';
    if (!host) { try { host = instanceUrl ? new URL(instanceUrl).hostname : ''; } catch { host = ''; } }
    if (cr?.getURL && logId && host) {
      const url = `${cr.getURL('spotlight.html')}?host=${encodeURIComponent(host)}&analyzeLog=${encodeURIComponent(logId)}`;
      if (cr.sendMessage) cr.sendMessage({ type: 'OPEN_TAB', url });
      else window.open(url, '_blank');
    }
  };

  const handleNavigate = (newView: 'dashboard' | 'detail' | 'settings') => {
    if (newView !== 'detail') setView(newView);
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
      <SidebarTrigger
        onOpenLogs={() => setIsOpen(true)}
        onOpenSpotlight={() => window.parent.postMessage({ type: 'SF_SPOTLIGHT_SHORTCUT' }, '*')}
      />
      
      {/* Enhanced Debug Session Control Modal */}
      <DebugSessionControl
        isOpen={isDebugSessionControlOpen}
        onClose={() => setIsDebugSessionControlOpen(false)}
        currentUserId={userInfo?.id || userInfo?.userId || ''}
        currentUserName={userInfo?.name || userInfo?.displayName || 'Current User'}
        instanceUrl={instanceUrl}
        sessionId={sessionId}
      />
      
      <div 
        className={`
          fixed inset-y-0 right-0 z-50 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.1)] 
          transition-transform duration-500 ease-in-out border-l border-gray-200
          w-full overflow-hidden
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="h-full overflow-y-auto relative flex flex-col bg-white">
          <Header 
            onClose={() => setIsOpen(false)} 
            hideClose={false} 
            currentView={view}
            onNavigate={handleNavigate}
          />

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
                onOpenDebugSessionControl={() => setIsDebugSessionControlOpen(true)}
              />
            ) : view === 'settings' ? (
              <SettingsView
                settings={settings}
                onSettingsChange={updateSettings}
                onResetSettings={resetSettings}
              />
            ) : null}
          </main>

          <footer className="p-8 bg-white border-t border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-5">
              <p className="text-[9px] font-black uppercase tracking-[0.4em] text-gray-300">
                © 2026 Praveen Kumar
              </p>
              <a
                href="https://sfspotlight.vercel.app/docs.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-blue-500 transition-colors"
              >
                Docs
              </a>
              <a
                href="https://forms.gle/ed2VcwQTJXTDaMUv6"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-blue-500 transition-colors"
              >
                Report Issue
              </a>
            </div>
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