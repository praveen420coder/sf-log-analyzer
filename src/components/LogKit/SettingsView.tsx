import React from 'react';
import { Settings, RotateCcw } from 'lucide-react';
import type { ExtensionSettings } from '../../hooks/useSettings';

interface SettingsViewProps {
  settings: ExtensionSettings;
  onSettingsChange: (newSettings: Partial<ExtensionSettings>) => void;
  onResetSettings: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSettingsChange,
  onResetSettings,
}) => {
  return (
    <div className="space-y-8 max-w-2xl mx-auto text-black">
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Settings size={24} className="text-black" />
          <h1 className="text-3xl font-black tracking-tighter uppercase">Settings</h1>
        </div>
        <p className="text-sm text-gray-600">Customize the extension appearance and behavior</p>
      </div>

      <div className="space-y-6">
        {/* Position Setting */}
        <div className="border-2 border-black rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-black uppercase tracking-wider text-black mb-3">
              Panel Position
            </label>
            <div className="flex gap-4">
              {(['right', 'left'] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => onSettingsChange({ position: pos })}
                  className={`flex-1 py-3 px-4 rounded-lg font-bold uppercase tracking-wider transition-all border-2 ${
                    settings.position === pos
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-gray-50'
                  }`}
                >
                  {pos.charAt(0).toUpperCase() + pos.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Opacity Setting */}
        <div className="border-2 border-black rounded-2xl p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-black uppercase tracking-wider text-black">
                Panel Opacity
              </label>
              <span className="text-lg font-black text-black bg-gray-100 px-3 py-1 rounded-lg">
                {settings.opacity}%
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={settings.opacity}
              onChange={(e) => onSettingsChange({ opacity: Number(e.target.value) })}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
            />
            <div className="flex justify-between text-xs text-gray-500 font-bold mt-2">
              <span>Transparent</span>
              <span>Opaque</span>
            </div>
          </div>
        </div>

        {/* Panel Width Setting */}
        <div className="border-2 border-black rounded-2xl p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-black uppercase tracking-wider text-black">
                Panel Width
              </label>
              <span className="text-lg font-black text-black bg-gray-100 px-3 py-1 rounded-lg">
                {settings.width}%
              </span>
            </div>
            <input
              type="range"
              min="25"
              max="75"
              step="5"
              value={settings.width}
              onChange={(e) => onSettingsChange({ width: Number(e.target.value) })}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
            />
            <div className="flex justify-between text-xs text-gray-500 font-bold mt-2">
              <span>Narrow</span>
              <span>Wide</span>
            </div>
          </div>
        </div>

        {/* Button Vertical Position Setting */}
        <div className="border-2 border-black rounded-2xl p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-black uppercase tracking-wider text-black">
                Button Vertical Position
              </label>
              <span className="text-lg font-black text-black bg-gray-100 px-3 py-1 rounded-lg">
                {settings.verticalPosition === 0 ? 'Top' : settings.verticalPosition === 50 ? 'Middle' : settings.verticalPosition === 100 ? 'Bottom' : settings.verticalPosition + '%'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={settings.verticalPosition}
              onChange={(e) => onSettingsChange({ verticalPosition: Number(e.target.value) })}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
            />
            <div className="flex justify-between text-xs text-gray-500 font-bold mt-2">
              <span>Top</span>
              <span>Middle</span>
              <span>Bottom</span>
            </div>
          </div>
        </div>

        {/* Info Section */}
        <div className="border-2 border-dashed border-gray-300 rounded-2xl p-6 bg-gray-50">
          <h3 className="text-sm font-black uppercase tracking-wider text-gray-700 mb-3">
            Settings Information
          </h3>
          <ul className="space-y-2 text-xs text-gray-600 font-semibold">
            <li>✓ Changes are saved automatically</li>
            <li>✓ Settings persist across browser sessions</li>
            <li>✓ Position changes take effect immediately when the panel is closed and reopened</li>
          </ul>
        </div>

        {/* Reset Button */}
        <button
          onClick={onResetSettings}
          className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-gray-100 text-black rounded-xl font-bold uppercase tracking-wider border-2 border-gray-300 hover:bg-gray-200 transition-all"
        >
          <RotateCcw size={18} />
          <span>Reset to Default</span>
        </button>
      </div>
    </div>
  );
};

export default SettingsView;
