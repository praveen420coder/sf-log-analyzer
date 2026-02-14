import React from 'react';
import { X } from 'lucide-react';

const Header: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <nav className="sticky top-0 bg-white/95 backdrop-blur-md z-20 flex items-center justify-between px-8 py-6 border-b border-gray-100">
    <div className="flex items-center space-x-3">
      <div className="w-10 h-5 border-2 border-black rounded-full flex items-center justify-center relative overflow-hidden text-black">
        <div className="w-5 h-5 bg-black rounded-full absolute -left-1"></div>
      </div>
      <div>
        <span className="block font-black tracking-widest text-xs uppercase leading-none text-black">Log Kit</span>
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Enterprise Debugger</span>
      </div>
    </div>
    <button onClick={onClose} className="p-2 hover:bg-black rounded-full transition-all group border border-transparent hover:border-black text-black">
      <X size={20} className="group-hover:text-white" />
    </button>
  </nav>
);
export default Header;