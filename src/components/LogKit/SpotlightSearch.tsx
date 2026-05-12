import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Zap, Settings, Database, Code, ExternalLink } from 'lucide-react';

interface SpotlightItem {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  url?: string;
}

interface SpotlightSearchProps {
  isOpen: boolean;
  onClose: () => void;
  instanceUrl?: string | null;
}

const SpotlightSearch: React.FC<SpotlightSearchProps> = ({ isOpen, onClose, instanceUrl }) => {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allItems, setAllItems] = useState<SpotlightItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Common Salesforce setup URLs
  const defaultItems: SpotlightItem[] = [
    {
      id: 'setup-home',
      title: 'Setup Home',
      description: 'Go to Salesforce Setup home',
      category: 'Setup',
      icon: <Settings size={18} />,
      url: '/setup/forcecomHomepage.apexp',
    },
    {
      id: 'custom-objects',
      title: 'Custom Objects',
      description: 'Manage custom objects',
      category: 'Setup',
      icon: <Database size={18} />,
      url: '/setup/ObjectHome.apexp',
    },
    {
      id: 'custom-fields',
      title: 'Custom Fields',
      description: 'Manage custom fields',
      category: 'Setup',
      icon: <Code size={18} />,
      url: '/setup/FieldManagement/DefaultFieldList.apexp',
    },
    {
      id: 'users',
      title: 'Users',
      description: 'Manage users and permissions',
      category: 'Setup',
      icon: <Settings size={18} />,
      url: '/setup/ManageUsers/home',
    },
    {
      id: 'profiles',
      title: 'Profiles',
      description: 'Manage user profiles',
      category: 'Setup',
      icon: <Settings size={18} />,
      url: '/setup/ProfileListPage.apexp',
    },
    {
      id: 'permission-sets',
      title: 'Permission Sets',
      description: 'Manage permission sets',
      category: 'Setup',
      icon: <Settings size={18} />,
      url: '/setup/PermSets.apexp',
    },
    {
      id: 'api-limits',
      title: 'API Limits',
      description: 'View your organization API limits',
      category: 'Setup',
      icon: <Zap size={18} />,
      url: '/setup/ApiLimits.apexp',
    },
    {
      id: 'org-settings',
      title: 'Organization Settings',
      description: 'View and edit organization settings',
      category: 'Setup',
      icon: <Settings size={18} />,
      url: '/setup/OrgSettings.apexp',
    },
    {
      id: 'integrations',
      title: 'Integrations',
      description: 'Setup integrations and API connections',
      category: 'Setup',
      icon: <Zap size={18} />,
      url: '/setup/ConnectedApps.apexp',
    },
    {
      id: 'custom-metadata',
      title: 'Custom Metadata Types',
      description: 'Create and manage custom metadata types',
      category: 'Setup',
      icon: <Database size={18} />,
      url: '/setup/CustomMetadata.apexp',
    },
  ];

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      // Fetch or use default items
      setAllItems(defaultItems);
      setIsLoading(false);
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const filteredItems = allItems.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase()) ||
    item.description.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          handleSelectItem(filteredItems[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  };

  const handleSelectItem = (item: SpotlightItem) => {
    if (item.url && instanceUrl) {
      // Open in new tab
      const fullUrl = `${instanceUrl}${item.url}`;
      window.open(fullUrl, '_blank');
    }
    onClose();
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-lg pointer-events-auto"
        onClick={onClose}
      />

      {/* Search Modal - Glass Design */}
      <div className="relative w-full max-w-3xl mx-4 pointer-events-auto">
        <div className="bg-white/10 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center px-8 py-6 border-b border-white/20">
            <Search size={24} className="text-white/70 mr-4" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search Salesforce setup..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-xl text-white placeholder-white/50 focus:outline-none font-medium"
            />
            <button
              onClick={onClose}
              className="ml-4 p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={24} className="text-white/70 hover:text-white" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="px-8 py-16 text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/30 border-t-white mx-auto mb-4" />
                <p className="text-white/70 font-medium">Loading setup items...</p>
              </div>
            ) : filteredItems.length > 0 ? (
              <div className="divide-y divide-white/10">
                {filteredItems.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full px-8 py-5 flex items-start gap-4 transition-all text-left group ${
                      index === selectedIndex
                        ? 'bg-white/10 backdrop-blur-md'
                        : 'hover:bg-white/5 backdrop-blur-sm'
                    }`}
                  >
                    <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-white/10 backdrop-blur-md flex items-center justify-center text-white/80 mt-1 group-hover:bg-white/20 transition-all">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white text-base flex items-center gap-2">
                        {item.title}
                        <ExternalLink size={14} className="text-white/40 group-hover:text-white/60 transition-colors" />
                      </div>
                      <div className="text-sm text-white/60 mt-1">{item.description}</div>
                    </div>
                    <div className="flex-shrink-0 text-xs font-bold text-white/50 uppercase tracking-wider">
                      {item.category}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-8 py-16 text-center">
                <Search size={40} className="mx-auto text-white/30 mb-4" />
                <p className="text-white/70 font-medium">No results found</p>
                <p className="text-white/50 text-sm mt-2">Try searching for something else</p>
              </div>
            )}
          </div>

          {/* Footer */}
          {filteredItems.length > 0 && (
            <div className="px-8 py-4 border-t border-white/20 bg-white/5 backdrop-blur-sm text-xs text-white/60 flex items-center justify-between">
              <div>
                {filteredItems.length} result{filteredItems.length !== 1 ? 's' : ''}
              </div>
              <div className="flex gap-3 items-center">
                <kbd className="px-3 py-1 rounded bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold text-white/70">
                  ↑↓
                </kbd>
                <span>Navigate</span>
                <kbd className="px-3 py-1 rounded bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold text-white/70">
                  Enter
                </kbd>
                <span>Select</span>
                <kbd className="px-3 py-1 rounded bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold text-white/70">
                  Esc
                </kbd>
                <span>Close</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default SpotlightSearch;
