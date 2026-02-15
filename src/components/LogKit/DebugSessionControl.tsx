/**
 * Debug Session Control Component
 * Enhanced debug session management with custom levels, presets, and multi-user support
 */

import { useState, useEffect, useCallback } from 'react';
import { Settings, User, Clock, Trash2, Play, X, Search } from 'lucide-react';
import { DEBUG_PRESETS, SESSION_DURATIONS, formatRemainingTime } from '../../types/debugSession';
import type { LogLevel, DebugLevelSettings } from '../../types/debugSession';

// Chrome extension API type declaration
declare const chrome: {
  runtime: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendMessage: (message: any) => Promise<any>;
  };
};

interface DebugSessionControlProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  currentUserName: string;
  instanceUrl: string | null;
  sessionId: string | null;
}

interface UserSearchResult {
  Id: string;
  Name: string;
  Username: string;
  Email: string;
}

interface ActiveSession {
  Id: string;
  TracedEntityId: string;
  DebugLevelId: string;
  StartDate: string;
  ExpirationDate: string;
  LogType: string;
  TracedEntity?: { Name: string };
  DebugLevel?: { DeveloperName: string };
}

const LOG_LEVELS: LogLevel[] = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'];

const LOG_CATEGORIES = [
  { key: 'ApexCode', label: 'Apex Code' },
  { key: 'ApexProfiling', label: 'Apex Profiling' },
  { key: 'Callout', label: 'Callout' },
  { key: 'Database', label: 'Database' },
  { key: 'System', label: 'System' },
  { key: 'Validation', label: 'Validation' },
  { key: 'Visualforce', label: 'Visualforce' },
  { key: 'Workflow', label: 'Workflow' },
];

export default function DebugSessionControl({
  isOpen,
  onClose,
  currentUserId,
  currentUserName,
  instanceUrl,
  sessionId,
}: DebugSessionControlProps) {
  const [activeTab, setActiveTab] = useState<'new' | 'active'>('new');
  const [selectedPreset, setSelectedPreset] = useState<string>('APEX_ONLY');
  const [customSettings, setCustomSettings] = useState<DebugLevelSettings>(DEBUG_PRESETS.APEX_ONLY.settings);
  const [useCustom, setUseCustom] = useState(false);
  const [duration, setDuration] = useState(1); // hours
  const [selectedUserId, setSelectedUserId] = useState(currentUserId);
  const [selectedUserName, setSelectedUserName] = useState(currentUserName);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Initialize with provided user info
  useEffect(() => {
    if (isOpen && currentUserId) {
      setSelectedUserId(currentUserId);
      setSelectedUserName(currentUserName);
    }
  }, [isOpen, currentUserId, currentUserName]);

  const loadActiveSessions = useCallback(async () => {
    if (!instanceUrl || !sessionId) {
      setError('Not connected to Salesforce');
      return;
    }
    setIsLoadingSessions(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ALL_ACTIVE_DEBUG_SESSIONS',
        instanceUrl,
        sessionId,
      });
      if (response.success) {
        setActiveSessions(response.data || []);
      } else {
        setError(response.error || 'Failed to load active sessions');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [instanceUrl, sessionId]);

  useEffect(() => {
    if (isOpen && activeTab === 'active') {
      loadActiveSessions();
    }
  }, [isOpen, activeTab, loadActiveSessions]);

  useEffect(() => {
    if (selectedPreset && !useCustom) {
      setCustomSettings(DEBUG_PRESETS[selectedPreset].settings);
    }
  }, [selectedPreset, useCustom]);

  const handleUserSearch = async () => {
    if (!searchTerm.trim()) return;
    if (!instanceUrl || !sessionId) {
      setError('Not connected to Salesforce');
      return;
    }
    
    setIsSearching(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEARCH_USERS',
        instanceUrl,
        sessionId,
        searchTerm: searchTerm.trim(),
      });
      if (response.success) {
        setSearchResults(response.data || []);
      } else {
        setError(response.error || 'Failed to search users');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search users');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateSession = async () => {
    if (!instanceUrl || !sessionId) {
      setError('Not connected to Salesforce');
      return;
    }
    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      // Step 1: Create or find debug level
      const settings = useCustom ? customSettings : DEBUG_PRESETS[selectedPreset].settings;
      const presetName = useCustom ? 'Custom_Debug_Level' : DEBUG_PRESETS[selectedPreset].name;
      const developerName = presetName.replace(/[^a-zA-Z0-9_]/g, '_');

      const findResponse = await chrome.runtime.sendMessage({
        type: 'FIND_DEBUG_LEVEL_BY_NAME',
        instanceUrl,
        sessionId,
        developerName,
      });

      let debugLevelId: string;

      if (findResponse.success && findResponse.data) {
        // Update existing debug level
        debugLevelId = findResponse.data.Id;
        const updateResponse = await chrome.runtime.sendMessage({
          type: 'UPDATE_DEBUG_LEVEL',
          instanceUrl,
          sessionId,
          debugLevelId,
          settings,
        });
        if (!updateResponse.success) {
          throw new Error(updateResponse.error || 'Failed to update debug level');
        }
      } else {
        // Create new debug level
        const createResponse = await chrome.runtime.sendMessage({
          type: 'CREATE_CUSTOM_DEBUG_LEVEL',
          instanceUrl,
          sessionId,
          developerName,
          masterLabel: presetName,
          settings,
        });
        if (!createResponse.success) {
          throw new Error(createResponse.error || 'Failed to create debug level');
        }
        debugLevelId = createResponse.data.id;
      }

      // Step 2: Check if trace flag exists for this user
      const checkResponse = await chrome.runtime.sendMessage({
        type: 'CHECK_DEBUG_SESSION',
        instanceUrl,
        sessionId,
        userId: selectedUserId,
      });

      const expirationDate = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString();

      if (checkResponse.success && checkResponse.data) {
        // Update existing trace flag
        const updateFlagResponse = await chrome.runtime.sendMessage({
          type: 'UPDATE_TRACE_FLAG',
          instanceUrl,
          sessionId,
          traceFlagId: checkResponse.data.Id,
          debugLevelId,
          expirationDate,
        });
        if (!updateFlagResponse.success) {
          throw new Error(updateFlagResponse.error || 'Failed to update trace flag');
        }
      } else {
        // Create new trace flag
        const createFlagResponse = await chrome.runtime.sendMessage({
          type: 'CREATE_TRACE_FLAG',
          instanceUrl,
          sessionId,
          userId: selectedUserId,
          debugLevelId,
          expirationDate,
        });
        if (!createFlagResponse.success) {
          throw new Error(createFlagResponse.error || 'Failed to create trace flag');
        }
      }

      setSuccess(`Debug session created for ${selectedUserName}!`);
      setTimeout(() => {
        setActiveTab('active');
        loadActiveSessions();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create debug session');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSession = async (traceFlagId: string) => {
    if (!confirm('Are you sure you want to stop this debug session?')) return;
    if (!instanceUrl || !sessionId) {
      setError('Not connected to Salesforce');
      return;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_DEBUG_SESSION',
        instanceUrl,
        sessionId,
        traceFlagId,
      });
      if (response.success) {
        setSuccess('Debug session stopped successfully');
        loadActiveSessions();
      } else {
        setError(response.error || 'Failed to stop debug session');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop debug session');
    }
  };

  const handleLevelChange = (category: string, value: LogLevel) => {
    setCustomSettings(prev => ({ ...prev, [category]: value }));
  };

  const handleSelectUser = (user: UserSearchResult) => {
    setSelectedUserId(user.Id);
    setSelectedUserName(user.Name);
    setSearchResults([]);
    setSearchTerm('');
  };

  if (!isOpen) return null;

  // Show error if user info is not available
  const isUserInfoAvailable = currentUserId && currentUserId !== '';
  const isConnected = !!(instanceUrl && sessionId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-600" />
            <h2 className="text-2xl font-bold text-gray-900">Debug Session Control</h2>
            {!isConnected && (
              <span className="px-3 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">
                Not Connected
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Show error if user info not available */}
        {!isUserInfoAvailable && (
          <div className="p-8">
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
              <p className="font-medium text-lg mb-2">User information not available</p>
              <p className="text-sm">Please ensure you are connected to Salesforce with an active debug session.</p>
              
              <details className="mt-4 text-left text-sm">
                <summary className="cursor-pointer font-medium hover:text-yellow-800">
                  Debug Information (click to expand)
                </summary>
                <div className="mt-3 space-y-2">
                  <div className="font-mono text-xs bg-white p-3 rounded border border-yellow-300">
                    <div><strong>Connected:</strong> {isConnected ? '✓ Yes' : '✗ No'}</div>
                    <div><strong>Instance URL:</strong> {instanceUrl || '(empty)'}</div>
                    <div><strong>Session ID:</strong> {sessionId ? '(present)' : '(empty)'}</div>
                    <hr className="my-2 border-yellow-200" />
                    <div><strong>Current User ID:</strong> {currentUserId || '(empty)'}</div>
                    <div><strong>Current User Name:</strong> {currentUserName || '(empty)'}</div>
                    <div><strong>Selected User ID:</strong> {selectedUserId || '(empty)'}</div>
                    <div><strong>Selected User Name:</strong> {selectedUserName || '(empty)'}</div>
                  </div>
                  <p className="text-xs text-yellow-600">
                    <strong>Note:</strong> The user ID from Salesforce Chatter API should be automatically populated. 
                    If you see empty values above, try refreshing the Salesforce page or re-enabling debug logging from the main dashboard first.
                  </p>
                </div>
              </details>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        )}

        {/* Main content - only show if user info is available */}
        {isUserInfoAvailable && (
          <>
        {/* Tabs */}
        <div className="flex border-b bg-gray-50">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 px-6 py-3 font-medium transition-colors ${
              activeTab === 'new'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            New Session
          </button>
          <button
            onClick={() => setActiveTab('active')}
            className={`flex-1 px-6 py-3 font-medium transition-colors ${
              activeTab === 'active'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Active Sessions
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {success}
            </div>
          )}

          {activeTab === 'new' && (
            <div className="space-y-6">
              {/* User Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <User className="w-4 h-4 inline mr-2" />
                  Debug For User
                </label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUserSearch()}
                      placeholder="Search by name, username, or email..."
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleUserSearch}
                      disabled={isSearching || !searchTerm.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      <Search className="w-4 h-4" />
                      Search
                    </button>
                  </div>
                  
                  {searchResults.length > 0 && (
                    <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto">
                      {searchResults.map((user) => (
                        <button
                          key={user.Id}
                          onClick={() => handleSelectUser(user)}
                          className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b last:border-b-0 transition-colors"
                        >
                          <div className="font-medium text-gray-900">{user.Name}</div>
                          <div className="text-sm text-gray-600">{user.Username}</div>
                          {user.Email && <div className="text-xs text-gray-500">{user.Email}</div>}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="font-medium text-blue-900">Selected: {selectedUserName}</div>
                    <div className="text-sm text-blue-700">User ID: {selectedUserId}</div>
                  </div>
                </div>
              </div>

              {/* Preset Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Debug Level Preset
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(DEBUG_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setSelectedPreset(key);
                        setUseCustom(false);
                      }}
                      className={`p-4 rounded-lg border-2 transition-all text-left ${
                        selectedPreset === key && !useCustom
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-2xl mb-2">{preset.icon}</div>
                      <div className="font-medium text-gray-900">{preset.name}</div>
                      <div className="text-xs text-gray-600 mt-1">{preset.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Settings Toggle */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustom}
                    onChange={(e) => setUseCustom(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Use Custom Settings</span>
                </label>
              </div>

              {/* Custom Settings Grid */}
              {useCustom && (
                <div className="border border-gray-300 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900 mb-4">Custom Log Levels</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {LOG_CATEGORIES.map(({ key, label }) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {label}
                        </label>
                        <select
                          value={customSettings[key as keyof DebugLevelSettings]}
                          onChange={(e) => handleLevelChange(key, e.target.value as LogLevel)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {LOG_LEVELS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Clock className="w-4 h-4 inline mr-2" />
                  Session Duration
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {SESSION_DURATIONS.map(({ label, hours }) => (
                    <option key={hours} value={hours}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Create Button */}
              <button
                onClick={handleCreateSession}
                disabled={isCreating}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isCreating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating Session...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    Start Debug Session
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === 'active' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Active Debug Sessions</h3>
                <button
                  onClick={loadActiveSessions}
                  disabled={isLoadingSessions}
                  className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isLoadingSessions ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {isLoadingSessions ? (
                <div className="text-center py-12">
                  <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
                  <p className="mt-4 text-gray-600">Loading sessions...</p>
                </div>
              ) : activeSessions.length === 0 ? (
                <div className="text-center py-12">
                  <Settings className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No active debug sessions</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeSessions.map((session) => (
                    <div
                      key={session.Id}
                      className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <User className="w-4 h-4 text-gray-500" />
                            <span className="font-medium text-gray-900">
                              {session.TracedEntity?.Name || 'Unknown User'}
                            </span>
                            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                              Active
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 space-y-1">
                            <div>
                              <span className="font-medium">Debug Level: </span>
                              {session.DebugLevel?.DeveloperName || 'Unknown'}
                            </div>
                            <div className="flex items-center gap-4">
                              <div>
                                <Clock className="w-3 h-3 inline mr-1" />
                                <span className="font-medium">Expires: </span>
                                {formatRemainingTime(new Date(session.ExpirationDate))}
                              </div>
                              <div className="text-xs text-gray-500">
                                {new Date(session.ExpirationDate).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteSession(session.Id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Stop Debug Session"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
