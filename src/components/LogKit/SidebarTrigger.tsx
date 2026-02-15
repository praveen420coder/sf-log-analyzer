import React from 'react';
import { Play } from 'lucide-react';

const SidebarTrigger: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-black hover:bg-zinc-800 transition-all flex flex-col items-center justify-center w-12 h-32 rounded-l-2xl group border-y border-l border-white/20"
  >
    <Play size={18} fill="white" className="text-white transform group-hover:translate-x-[-2px] transition-transform mb-2" />
    <span className="[writing-mode:vertical-lr] text-[10px] font-black uppercase tracking-[0.3em] text-white">Logs</span>
  </button>
);

export default SidebarTrigger;