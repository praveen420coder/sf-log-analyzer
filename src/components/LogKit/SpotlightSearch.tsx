import React, { useState, useEffect, useRef } from 'react';
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

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />

      {/* Search Modal */}
      <div className="relative w-full max-w-2xl mx-4 pointer-events-auto">
        <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center px-6 py-4 border-b border-gray-100">
            <Search size={20} className="text-gray-400 mr-3" />
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
              className="flex-1 bg-transparent text-lg text-black placeholder-gray-400 focus:outline-none font-medium"
            />
            <button
              onClick={onClose}
              className="ml-2 p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-400" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="px-6 py-12 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-3" />
                <p className="text-gray-500 font-medium">Loading setup items...</p>
              </div>
            ) : filteredItems.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {filteredItems.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full px-6 py-4 flex items-start gap-4 transition-all text-left group ${
                      index === selectedIndex
                        ? 'bg-gradient-to-r from-black/5 to-black/0'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-blue-50 flex items-center justify-center text-blue-600 mt-1">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-black text-sm flex items-center gap-2">
                        {item.title}
                        <ExternalLink size={14} className="text-gray-300 group-hover:text-gray-400 transition-colors" />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{item.description}</div>
                    </div>
                    <div className="flex-shrink-0 text-xs font-bold text-gray-300 uppercase tracking-wider">
                      {item.category}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-6 py-12 text-center">
                <Search size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">No results found</p>
                <p className="text-gray-400 text-sm mt-1">Try searching for something else</p>
              </div>
            )}
          </div>

          {/* Footer */}
          {filteredItems.length > 0 && (
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-500 flex items-center justify-between">
              <div>
                {filteredItems.length} result{filteredItems.length !== 1 ? 's' : ''}
              </div>
              <div className="flex gap-2 items-center">
                <kbd className="px-2 py-1 rounded bg-white border border-gray-200 text-xs font-semibold">
                  ↑↓
                </kbd>
                <span>Navigate</span>
                <kbd className="px-2 py-1 rounded bg-white border border-gray-200 text-xs font-semibold">
                  Enter
                </kbd>
                <span>Select</span>
                <kbd className="px-2 py-1 rounded bg-white border border-gray-200 text-xs font-semibold">
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
};

export default SpotlightSearch;
