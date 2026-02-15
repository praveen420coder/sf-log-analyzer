import React, { useState, useEffect } from 'react';
import { Terminal, RotateCcw, ChevronRight, Database, User, Play, Clock, X, Trash2, Settings } from 'lucide-react';
import type { Log, Metric } from '../../types';

const DashboardView: React.FC<{
  logs: Log[];
  metrics: Metric[];
  isFetching: boolean;
  onFetch: () => void;
  onExplore: (log: Log) => void;
  instanceUrl?: string | null;
  userInfo?: any;
  debugSession?: any;
  isCreatingDebugSession?: boolean;
  onCreateDebugSession?: () => void;
  onStopDebugSession?: () => void;
  isStoppingDebugSession?: boolean;
  onDeleteAllLogs?: () => void;
  isDeletingAllLogs?: boolean;
  onOpenDebugSessionControl?: () => void;
}> = ({ logs, metrics, isFetching, onFetch, onExplore, instanceUrl, userInfo, debugSession, isCreatingDebugSession, onCreateDebugSession, onStopDebugSession, isStoppingDebugSession, onDeleteAllLogs, isDeletingAllLogs, onOpenDebugSessionControl }) => {
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Update timer every second
  useEffect(() => {
    if (!debugSession?.ExpirationDate) {
      return;
    }

    const updateTimer = () => {
      const expiration = new Date(debugSession.ExpirationDate).getTime();
      const now = Date.now();
      const diff = expiration - now;

      if (diff <= 0) {
        setTimeRemaining('Expired');
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => {
      clearInterval(interval);
      setTimeRemaining('');
    };
  }, [debugSession]);
  // Detect org type from instance URL
  const getOrgType = () => {
    if (!instanceUrl) return 'NOT CONNECTED';
    const url = instanceUrl.toLowerCase();
    if (url.includes('sandbox') || url.includes('.cs')) return 'SANDBOX';
    if (url.includes('scratch')) return 'SCRATCH ORG';
    if (url.includes('develop')) return 'DEVELOPER';
    return 'PRODUCTION';
  };

  const orgType = getOrgType();

  return (
  <div className="space-y-12 max-w-2xl mx-auto text-black">
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-500">
          <Terminal size={12} />
          <span>{orgType}</span>
        </div>
        {userInfo?.name && (
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 text-[9px] font-black uppercase tracking-widest text-blue-700">
            <User size={12} />
            <span>{userInfo.name}</span>
          </div>
        )}
      </div>
      <h1 className="text-5xl font-black tracking-tighter uppercase leading-[0.9] text-black">Analyze<br/>Salesforce Logs</h1>
    </div>

    <div className="flex gap-3 flex-wrap">
      <button 
        onClick={onFetch}
        disabled={isFetching}
        className="flex items-center justify-center min-w-[200px] h-14 bg-black text-white rounded-full text-xs font-bold tracking-[0.2em] uppercase transition-all hover:scale-[1.02] active:scale-[0.98] group disabled:opacity-50"
      >
        {isFetching ? <RotateCcw className="animate-spin mr-2" size={16} /> : (
          <>
            <span>Fetch Logs</span>
            <ChevronRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
          </>
        )}
      </button>

      {debugSession ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center space-x-3 px-6 h-14 border-2 border-green-500 bg-green-50 rounded-full flex-1">
            <Clock size={16} className="text-green-600" />
            <div className="flex flex-col">
              <span className="text-[9px] font-black uppercase tracking-widest text-green-600">Debug Active</span>
              <span className="text-sm font-black text-green-700">{timeRemaining}</span>
            </div>
          </div>
          <button 
            onClick={onStopDebugSession}
            disabled={isStoppingDebugSession}
            className="flex items-center justify-center w-14 h-14 bg-red-600 text-white rounded-full text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            title="Stop debug session"
          >
            {isStoppingDebugSession ? <RotateCcw className="animate-spin" size={16} /> : <X size={16} />}
          </button>
        </div>
      ) : (
        <button 
          onClick={onCreateDebugSession}
          disabled={isCreatingDebugSession || !userInfo}
          className="flex items-center justify-center min-w-[200px] h-14 bg-green-600 text-white rounded-full text-xs font-bold tracking-[0.2em] uppercase transition-all hover:scale-[1.02] active:scale-[0.98] group disabled:opacity-50"
        >
          {isCreatingDebugSession ? <RotateCcw className="animate-spin mr-2" size={16} /> : (
            <>
              <Play size={16} className="mr-2" />
              <span>Enable Debug (30m)</span>
            </>
          )}
        </button>
      )}

      {onOpenDebugSessionControl && (
        <button 
          onClick={onOpenDebugSessionControl}
          disabled={!userInfo}
          className="flex items-center justify-center min-w-[200px] h-14 bg-blue-600 text-white rounded-full text-xs font-bold tracking-[0.2em] uppercase transition-all hover:scale-[1.02] active:scale-[0.98] group disabled:opacity-50 disabled:cursor-not-allowed"
          title="Enhanced debug session control with custom levels and presets"
        >
          <Settings size={16} className="mr-2" />
          <span>Debug Settings</span>
        </button>
      )}
    </div>

    <div className="grid grid-cols-2 gap-4">
      {metrics.map((m, i) => (
        <div key={i} className="border-2 border-black rounded-2xl p-5 flex flex-col space-y-1 hover:bg-black hover:text-white transition-all duration-300 group cursor-default">
          <span className="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-60 transition-opacity">{m.label}</span>
          <span className="text-2xl font-black text-black group-hover:text-white">{m.value}</span>
        </div>
      ))}
    </div>

    {logs.length > 0 ? (
      <div className="space-y-6 pt-4 text-black">
        <div className="flex items-center justify-between border-b-2 border-black pb-4">
          <h2 className="text-xl font-black uppercase tracking-tight">Records</h2>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold border border-black px-3 py-1 rounded-full uppercase">{logs.length} Total</span>
            {onDeleteAllLogs && (
              <button 
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete all ${logs.length} log record${logs.length === 1 ? '' : 's'}? This action cannot be undone.`)) {
                    onDeleteAllLogs();
                  }
                }}
                disabled={isDeletingAllLogs || isFetching}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-full text-[10px] font-bold tracking-wider uppercase transition-all hover:bg-red-700 active:scale-95 disabled:opacity-50"
                title="Delete all log records using Bulk API"
              >
                {isDeletingAllLogs ? (
                  <RotateCcw className="animate-spin" size={14} />
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Delete All</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        
        <div className="overflow-x-auto pb-20">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 border-b border-gray-100">
                <th className="py-4">Time</th>
                <th className="py-4">Status</th>
                <th className="py-4">Size</th>
                <th className="py-4 text-right">Explore</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => {
                const logId = log.id || log.Id || '';
                const logTime = log.startTime || log.StartTime || '';
                const logStatus = log.status || log.Status || 'Unknown';
                const logSize = log.size || ((log.LogLength || 0) / 1024).toFixed(2) + ' KB';
                
                return (
                  <tr key={logId} className="group hover:bg-zinc-50 transition-colors">
                    <td className="py-6 text-xs font-bold text-black">{logTime.split(',')[1] || logTime}</td>
                    <td className="py-6">
                      <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-md border-2 border-black ${
                        logStatus === 'Error' || logStatus.includes('Error') ? 'bg-black text-white' : 'bg-transparent text-black'
                      }`}>
                        {logStatus}
                      </span>
                    </td>
                    <td className="py-6 text-xs font-black text-gray-500">{logSize}</td>
                    <td className="py-6 text-right">
                      <button 
                        onClick={() => onExplore(log)}
                        className="inline-flex items-center justify-center w-10 h-10 rounded-xl border-2 border-black text-black hover:bg-black hover:text-white transition-all shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    ) : (
      <div className="border-2 border-dashed border-gray-200 rounded-[2.5rem] p-16 text-center">
        <Database className="mx-auto mb-4 text-gray-200" size={48} />
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-300">Awaiting Log Stream</p>
      </div>
    )}
  </div>
  );
};

export default DashboardView;