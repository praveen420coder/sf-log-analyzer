import React from 'react';
import { Play, Search } from 'lucide-react';

interface SidebarTriggerProps {
  onOpenLogs: () => void;
  onOpenSpotlight: () => void;
}

const SidebarTrigger: React.FC<SidebarTriggerProps> = ({ onOpenLogs, onOpenSpotlight }) => (
  <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex flex-col w-7 rounded-l-2xl overflow-hidden border-y border-l border-white/20">
    {/* Top: open Spotlite search */}
    <button
      onClick={onOpenSpotlight}
      title="Open Spotlite search (Alt/Option + T)"
      className="bg-black opacity-40 hover:opacity-100 transition-all flex flex-col items-center justify-center w-full h-14 group"
    >
      <Search size={11} className="text-white mb-1 transform group-hover:scale-110 transition-transform" />
      <span className="[writing-mode:vertical-lr] text-[6px] font-black uppercase tracking-[0.25em] text-white">Search</span>
    </button>

    <div className="h-px bg-white/25" />

    {/* Bottom: open Logs panel */}
    <button
      onClick={onOpenLogs}
      title="Open logs"
      className="bg-black opacity-40 hover:opacity-100 transition-all flex flex-col items-center justify-center w-full h-14 group"
    >
      <Play size={11} fill="white" className="text-white transform group-hover:translate-x-[-2px] transition-transform mb-1" />
      <span className="[writing-mode:vertical-lr] text-[6px] font-black uppercase tracking-[0.3em] text-white">Logs</span>
    </button>
  </div>
);

export default SidebarTrigger;
