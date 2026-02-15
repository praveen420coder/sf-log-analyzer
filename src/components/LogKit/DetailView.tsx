import React, { useState, useEffect } from 'react';
import { ChevronRight, Info, Activity, Copy, Download } from 'lucide-react';
import type { Log } from '../../types';
import { ApexLogParser, formatDuration } from '../../utils/apexLogParser';
import type { ParsedLog } from '../../utils/apexLogParser';
import TreeView from './TreeView';
import TimelineView from './TimelineView';

const DetailView: React.FC<{ log: Log; onBack: () => void; instanceUrl?: string | null; sessionId?: string | null }> = ({ log, onBack, instanceUrl, sessionId }) => {
  const [logBody, setLogBody] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'complete' | 'tree' | 'timeline' | 'soql'>('tree');
  const [parsedLog, setParsedLog] = useState<ParsedLog | null>(null);

  const logId = log.id || log.Id || 'N/A';
  const logStatus = log.status || log.Status || 'Unknown';
  const logTime = log.startTime || log.StartTime || 'N/A';
  const logSize = log.size || ((log.LogLength || 0) / 1024).toFixed(2) + ' KB';
  const logOperation = log.Operation || 'N/A';

  const filters = [
    { id: 'debug', label: 'Debug Only', pattern: /\|(USER_INFO|EXECUTION|CODE_UNIT|METHOD|STATEMENT|HEAP_ALLOCATE|DML_BEGIN|DML_END)\|/i },
    { id: 'errors', label: 'Errors & Exceptions', pattern: /\|(ERROR|EXCEPTION|FATAL_ERROR|FATAL)\|/i },
    { id: 'soql', label: 'SOQL', pattern: /\|SOQL_|LIMIT_USAGE.*SOQL|Number of SOQL/i },
    { id: 'limits', label: 'Governor Limits', pattern: /(LIMIT_USAGE|CUMULATIVE_LIMIT_USAGE|Number of |Maximum CPU)/i }
  ];

  // Parse method timeline from log
  const parseMethodTimeline = (body: string): string => {
    const lines = body.split('\n');
    const methodLines = lines.filter(line => /METHOD_(ENTRY|EXIT)/.test(line));
    return methodLines.length > 0 ? methodLines.join('\n') : 'No method calls found in log';
  };

  // Parse SOQL queries from log
  const parseSoqlQueries = (body: string): string => {
    const lines = body.split('\n');
    const soqlLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      if (/SOQL_EXECUTE_BEGIN/.test(lines[i])) {
        // Extract the SOQL query from the line
        const match = lines[i].match(/SELECT.*(?=\s*$)/i);
        if (match) {
          soqlLines.push(match[0]);
        }
      }
    }
    
    return soqlLines.length > 0 ? soqlLines.join('\n\n') : 'No SOQL queries found in log';
  };

  const filterLogBody = (body: string): string => {
    const lines = body.split('\n');
    
    return lines.filter(line => {
      // Apply search filter
      if (searchText && !line.toLowerCase().includes(searchText.toLowerCase())) {
        return false;
      }
      
      // Apply category filters
      if (selectedFilters.size === 0) return true;
      
      for (const filter of filters) {
        if (selectedFilters.has(filter.id) && filter.pattern.test(line)) {
          return true;
        }
      }
      return false;
    }).join('\n');
  };

  const toggleFilter = (filterId: string) => {
    const newFilters = new Set(selectedFilters);
    if (newFilters.has(filterId)) {
      newFilters.delete(filterId);
    } else {
      newFilters.add(filterId);
    }
    setSelectedFilters(newFilters);
  };

  // Fetch full log body from Salesforce
  useEffect(() => {
    const fetchLogBody = async () => {
      if (!instanceUrl || !sessionId) {
        setLogBody('Unable to fetch - session not available');
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(
          `${instanceUrl}/services/data/v58.0/tooling/sobjects/ApexLog/${logId}/Body`,
          {
            headers: {
              'Authorization': `Bearer ${sessionId}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (response) {
          const text = await response.text();
          setLogBody(text || 'No log body available');
          
          // Parse the log
          if (text) {
            try {
              const parser = new ApexLogParser(text);
              const parsed = parser.parse();
              setParsedLog(parsed);
            } catch (parseError) {
              // Failed to parse log
            }
          }
        } else {
          setLogBody('Error fetching log details');
        }
      } catch (error) {
        setLogBody('Error loading log details');
      } finally {
        setIsLoading(false);
      }
    };

    fetchLogBody();
  }, [logId, instanceUrl, sessionId]);

  const copyToClipboard = () => {
    let contentToCopy = '';
    if (activeTab === 'complete') {
      contentToCopy = filterLogBody(logBody);
    } else if (activeTab === 'timeline') {
      if (parsedLog?.timeline) {
        contentToCopy = parsedLog.timeline.map(e => 
          `${e.name} - ${formatDuration(e.duration)} (${e.type})`
        ).join('\n');
      } else {
        contentToCopy = parseMethodTimeline(logBody);
      }
    } else if (activeTab === 'tree') {
      contentToCopy = 'Use download to export tree structure';
    } else if (activeTab === 'soql') {
      contentToCopy = parseSoqlQueries(logBody);
    }
    
    navigator.clipboard.writeText(contentToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadLog = () => {
    const element = document.createElement('a');
    let content = '';
    let filename = `${logId}_debug_log.txt`;
    
    if (activeTab === 'complete') {
      content = filterLogBody(logBody);
      if (searchText) {
        const cleanSearch = searchText.replace(/\s+/g, '_').substring(0, 20);
        filename = `${logId}_search_${cleanSearch}_log.txt`;
      } else if (selectedFilters.size > 0) {
        filename = `${logId}_${Array.from(selectedFilters).join('_')}_log.txt`;
      }
    } else if (activeTab === 'tree') {
      if (parsedLog?.methodTree) {
        content = JSON.stringify(parsedLog.methodTree, null, 2);
        filename = `${logId}_call_tree.json`;
      }
    } else if (activeTab === 'timeline') {
      if (parsedLog?.timeline) {
        content = parsedLog.timeline.map(e => 
          `${e.name}\t${formatDuration(e.duration)}\t${e.type}`
        ).join('\n');
      } else {
        content = parseMethodTimeline(logBody);
      }
      filename = `${logId}_timeline_log.txt`;
    } else if (activeTab === 'soql') {
      content = parseSoqlQueries(logBody);
      filename = `${logId}_soql_queries.txt`;
    }
    
    const file = new Blob([content], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
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
          <h2 className="text-4xl font-black uppercase tracking-tighter text-black">{logId}</h2>
          <div className={`px-5 py-2 rounded-2xl text-xs font-black uppercase tracking-widest border-2 border-black ${
            logStatus.includes('Error') ? 'bg-black text-white' : 'bg-transparent text-black'
          }`}>
            {logStatus}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="border-[3px] border-black rounded-[2rem] p-8 space-y-6">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center border-b-2 border-black/10 pb-4 text-black">
              <Info size={16} className="mr-2" /> Attributes
            </h3>
            <div className="grid grid-cols-2 gap-y-6 gap-x-12 text-black">
              {[
                { l: 'Timestamp', v: logTime },
                { l: 'Payload Size', v: logSize },
                { l: 'Operation', v: logOperation },
                { l: 'Status', v: logStatus }
              ].map((item, i) => (
                <div key={i} className="flex flex-col space-y-1">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{item.l}</span>
                  <span className="text-sm font-black">{item.v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900 rounded-[2rem] p-8 space-y-6 shadow-xl text-zinc-300">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center text-white/60">
                  <Activity size={16} className="mr-2" /> Log Analysis
                </h3>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 border-b border-zinc-700 overflow-x-auto">
                {[
                  { id: 'tree', label: 'Call Tree' },
                  { id: 'timeline', label: 'Timeline' },
                  { id: 'soql', label: 'SOQL Queries' },
                  { id: 'complete', label: 'Raw Log' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as 'complete' | 'tree' | 'timeline' | 'soql')}
                    className={`px-4 py-2 text-[9px] font-black uppercase tracking-[0.15em] border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search Input - only show for complete log tab */}
              {activeTab === 'complete' && (
                <div className="flex items-center">
                  <input
                    type="text"
                    placeholder="Search log..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="flex-1 px-3 py-2 text-[9px] bg-zinc-800 border border-zinc-700 rounded text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  {searchText && (
                    <button
                      onClick={() => setSearchText('')}
                      className="ml-2 px-2 py-1 text-[9px] font-black uppercase tracking-[0.15em] bg-zinc-800 border border-zinc-700 text-zinc-400 rounded hover:border-zinc-600 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Filter Buttons - only show for complete log tab */}
              {activeTab === 'complete' && (
                <div className="flex flex-wrap gap-2">
                  {filters.map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => toggleFilter(filter.id)}
                      className={`px-3 py-1 text-[9px] font-black uppercase tracking-[0.15em] rounded border transition-colors ${
                        selectedFilters.has(filter.id)
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Copy and Download Buttons */}
              <div className="flex items-center justify-between border-t border-white/10 pt-4">
                <span className="text-[9px] text-zinc-500">
                  {activeTab === 'complete' && (searchText || selectedFilters.size > 0) 
                    ? `Filtered view` 
                    : activeTab === 'tree' 
                    ? 'Call Tree' 
                    : activeTab === 'timeline' 
                    ? 'Timeline View' 
                    : activeTab === 'soql' 
                    ? 'SOQL Queries' 
                    : 'Full log'}
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={copyToClipboard}
                    className="p-2 hover:bg-white/10 rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy size={14} className={copied ? 'text-green-400' : 'text-white/60'} />
                  </button>
                  <button
                    onClick={downloadLog}
                    className="p-2 hover:bg-white/10 rounded transition-colors"
                    title="Download log"
                  >
                    <Download size={14} className="text-white/60" />
                  </button>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-8">
                <p className="text-zinc-500">Loading log details...</p>
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">
                {activeTab === 'tree' && parsedLog && (
                  <TreeView nodes={parsedLog.methodTree} />
                )}
                {activeTab === 'timeline' && parsedLog && (
                  <TimelineView events={parsedLog.timeline} />
                )}
                {activeTab === 'soql' && (
                  <pre className="text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed text-zinc-300 bg-zinc-950 p-4 rounded border border-zinc-700">
                    {parseSoqlQueries(logBody)}
                  </pre>
                )}
                {activeTab === 'complete' && (
                  <pre className="text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed text-zinc-300 bg-zinc-950 p-4 rounded border border-zinc-700">
                    {filterLogBody(logBody) || 'No log body available'}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DetailView;