import React from 'react';
import { X, FileText } from 'lucide-react';

const Header: React.FC<{ onClose: () => void; hideClose?: boolean }> = ({ onClose, hideClose = false }) => (
  <nav className="sticky top-0 bg-white/95 backdrop-blur-md z-20 flex items-center justify-between px-8 py-6 border-b border-gray-100">
    <div className="flex items-center space-x-3">
      <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-md">
        <FileText size={20} className="text-white" strokeWidth={2.5} />
      </div>
      <div>
        <span className="block font-black tracking-widest text-xs uppercase leading-none text-black">SF Log Analyzer</span>
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Enterprise Debugger</span>
      </div>
    </div>
    {!hideClose && (
      <button onClick={onClose} className="p-2 hover:bg-black rounded-full transition-all group border border-transparent hover:border-black text-black">
        <X size={20} className="group-hover:text-white" />
      </button>
    )}
  </nav>
);
export default Header;