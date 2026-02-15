import { useState, useMemo, useEffect } from 'react';
import Header from './components/LogKit/Header';
import DashboardView from './components/LogKit/DashboardView';
import DetailView from './components/LogKit/DetailView';
import SidebarTrigger from './components/LogKit/SidebarTrigger';
import { useExtensionLogAPI } from './hooks/useExtensionLogAPI';
import type { Log } from './types';

export default function App() {
  // Start closed by default - user clicks to open
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [view, setView] = useState<'dashboard' | 'detail'>('dashboard');
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);

  // Extension API hook
  const { logs, isFetching, error, userInfo, fetchLogs, refreshCredentials, isLoading, instanceUrl, sessionId } = useExtensionLogAPI();

  useEffect(() => {
    // Notify parent window (content-ui.tsx) about panel state
    window.parent.postMessage({ type: 'SF_LOG_ANALYZER_TOGGLE', isOpen }, '*');
  }, [isOpen]);

  // Compute metrics from logs using useMemo
  const metrics = useMemo(() => {
    if (logs && logs.length > 0) {
      const totalLogs = logs.length;
      const errorLogs = logs.filter(log => 
        (log.status || log.Status || '').toLowerCase().includes('error')
      ).length;
      
      const sizes = logs.map(log => log.LogLength || 0);
      const avgSize = sizes.length > 0 
        ? `${(sizes.reduce((a, b) => a + b, 0) / sizes.length / 1024).toFixed(2)} KB`
        : '0 KB';

      return [
        { label: 'total logs', value: String(totalLogs) },
        { label: 'avg. size', value: avgSize },
        { label: 'errors', value: String(errorLogs) },
        { label: 'uptime', value: '99.9%' }
      ];
    }
    return [
      { label: 'total logs', value: '0' },
      { label: 'avg. size', value: '0kb' },
      { label: 'errors', value: '0' },
      { label: 'uptime', value: '99.9%' }
    ];
  }, [logs]);

  const handleExplore = (log: Log) => {
    setSelectedLog(log);
    setView('detail');
  };

  return (
    <div className="font-sans antialiased text-black min-h-screen relative overflow-hidden">
      <SidebarTrigger onClick={() => setIsOpen(true)} />
      
      <div 
        className={`
          fixed inset-y-0 right-0 z-50 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.1)] 
          transition-transform duration-500 ease-in-out border-l border-gray-200
          w-full md:w-1/2 lg:w-[45%] overflow-hidden
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="h-full overflow-y-auto relative flex flex-col bg-white">
          <Header onClose={() => setIsOpen(false)} hideClose={false} />

          <main className="flex-1 px-8 py-10 overflow-y-auto">
            {isLoading && !userInfo && (
              <div className="mb-6 p-4 rounded-lg bg-yellow-50 border border-yellow-200">
                <p className="text-sm font-semibold text-yellow-900">
                  ⏳ Detecting Salesforce session...
                </p>
              </div>
            )}

            {userInfo && (
              <div className="mb-6 p-4 rounded-lg bg-blue-50 border border-blue-200">
                <p className="text-sm font-semibold text-blue-900">
                  ✓ Connected: <span className="font-normal">{userInfo.name}</span>
                </p>
              </div>
            )}
            
            {!userInfo && sessionId && instanceUrl && !isLoading && (
              <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200">
                <p className="text-sm font-semibold text-green-900">
                  ✓ Session Active
                </p>
                <p className="text-xs text-green-700 mt-1">
                  {new URL(instanceUrl).hostname}
                </p>
              </div>
            )}
            
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-semibold text-red-800 mb-3">{error}</p>
                <button 
                  onClick={refreshCredentials}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 transition-colors"
                >
                  Retry Connection
                </button>
              </div>
            )}
            {view === 'dashboard' ? (
              <DashboardView 
                logs={logs} 
                metrics={metrics} 
                isFetching={isFetching} 
                onFetch={fetchLogs} 
                onExplore={handleExplore} 
              />
            ) : (
              selectedLog && <DetailView log={selectedLog} onBack={() => setView('dashboard')} />
            )}
          </main>

          <footer className="p-8 bg-white border-t border-gray-100 flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-[0.4em] text-gray-300">
              SF LOG ANALYZER • 2026
            </p>
            <div className="flex space-x-4">
              <div className="w-2 h-2 rounded-full animate-pulse bg-blue-500"></div>
              <span className="text-[9px] font-black uppercase text-gray-400">
                Connected
              </span>
            </div>
          </footer>
        </div>
      </div>

      {isOpen && (
        <div 
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-black/5 z-40 backdrop-blur-sm lg:hidden"
        />
      )}
    </div>
  );
}