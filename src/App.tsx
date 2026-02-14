import { useState } from 'react';
import Header from './components/LogKit/Header';
import DashboardView from './components/LogKit/DashboardView';
import DetailView from './components/LogKit/DetailView';
import SidebarTrigger from './components/LogKit/SidebarTrigger';
import type { Log, Metric } from './types';

export default function App() {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [logs, setLogs] = useState<Log[]>([]);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [view, setView] = useState<'dashboard' | 'detail'>('dashboard');
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);

  const metrics: Metric[] = [
    { label: 'total logs', value: '1,284' },
    { label: 'avg. size', value: '42kb' },
    { label: 'errors', value: '12' },
    { label: 'uptime', value: '99.9%' }
  ];

  const fetchLogs = () => {
    setIsFetching(true);
    setTimeout(() => {
      const mock: Log[] = Array.from({ length: 10 }).map((_, i) => ({
        id: `LOG-${1000 + i}`,
        startTime: new Date().toLocaleString(),
        status: Math.random() > 0.2 ? 'Success' : 'Error',
        size: `${(Math.random() * 50 + 10).toFixed(1)} KB`,
        details: "GET /api/v1/resource HTTP/1.1\nHost: salesforce.com\nUser-Agent: Mozilla/5.0..."
      }));
      setLogs(mock);
      setIsFetching(false);
    }, 1000);
  };

  const handleExplore = (log: Log) => {
    setSelectedLog(log);
    setView('detail');
  };

  return (
    <div className="font-sans antialiased text-black min-h-screen relative overflow-hidden">
      <SidebarTrigger onClick={() => setIsOpen(true)} />
      
      <div 
        className={`
          fixed inset-y-0 right-0 z-50 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.1)] transition-all duration-500 ease-in-out border-l border-gray-200
          ${isOpen ? 'translate-x-0 w-full md:w-1/2 lg:w-[45%]' : 'translate-x-full w-0'}
        `}
      >
        <div className="h-full overflow-y-auto relative flex flex-col bg-white">
          <Header onClose={() => setIsOpen(false)} />

          <main className="flex-1 px-8 py-10">
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
            <p className="text-[9px] font-black uppercase tracking-[0.4em] text-gray-300">LOG-KIT PRO • 2024</p>
            <div className="flex space-x-4">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-[9px] font-black uppercase text-gray-400">System Live</span>
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