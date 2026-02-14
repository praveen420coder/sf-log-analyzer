import React from 'react';
import { ChevronRight, Info, Activity } from 'lucide-react';
import type { Log } from '../../types';

const DetailView: React.FC<{ log: Log; onBack: () => void }> = ({ log, onBack }) => (
  <div className="space-y-10 animate-in fade-in slide-in-from-right-8 duration-500 max-w-2xl mx-auto text-black">
    <button 
      onClick={onBack}
      className="group flex items-center space-x-3 text-[10px] font-black uppercase tracking-[0.2em] text-black"
    >
      <div className="w-10 h-10 rounded-full border-2 border-black flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all">
        <ChevronRight size={18} className="rotate-180" />
      </div>
      <span>Back to records</span>
    </button>

    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-black uppercase tracking-tighter text-black">{log.id}</h2>
        <div className={`px-5 py-2 rounded-2xl text-xs font-black uppercase tracking-widest border-2 border-black ${
          log.status === 'Error' ? 'bg-black text-white' : 'bg-transparent text-black'
        }`}>
          {log.status}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="border-[3px] border-black rounded-[2rem] p-8 space-y-6">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center border-b-2 border-black/10 pb-4 text-black">
            <Info size={16} className="mr-2" /> Attributes
          </h3>
          <div className="grid grid-cols-2 gap-y-6 gap-x-12 text-black">
            {[
              { l: 'Timestamp', v: log.startTime },
              { l: 'Payload Size', v: log.size },
              { l: 'Target Domain', v: 'salesforce.com' },
              { l: 'HTTP Method', v: 'POST' }
            ].map((item, i) => (
              <div key={i} className="flex flex-col space-y-1">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{item.l}</span>
                <span className="text-sm font-black">{item.v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900 rounded-[2rem] p-8 space-y-6 shadow-xl text-zinc-300">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center text-white/60 border-b border-white/10 pb-4">
            <Activity size={16} className="mr-2" /> RAW HEADER DATA
          </h3>
          <pre className="text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-64 scrollbar-hide text-zinc-300">
            {log.details}
          </pre>
        </div>
      </div>
    </div>
  </div>
);

export default DetailView;