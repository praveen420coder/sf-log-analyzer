import React, { useState, useEffect } from 'react';
import { ChevronRight, Copy, Download, WrapText } from 'lucide-react';
import type { Log } from '../../types';
import { ApexLogParser, formatDuration } from '../../utils/apexLogParser';
import type { ParsedLog } from '../../utils/apexLogParser';
import { LogAnalyzer, type PerformanceInsight, type LogMetrics } from '../../utils/logAnalyzer';
import TreeView from './TreeView';
import TimelineView from './TimelineView';
import InsightsView from './InsightsView';

const DetailView: React.FC<{ log: Log; onBack: () => void; instanceUrl?: string | null; sessionId?: string | null }> = ({ log, onBack, instanceUrl, sessionId }) => {
  const [logBody, setLogBody] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'complete' | 'tree' | 'timeline' | 'soql' | 'insights'>('complete');
  const [wrapLines, setWrapLines] = useState<boolean>(false);
  const [parsedLog, setParsedLog] = useState<ParsedLog | null>(null);
  const [insights, setInsights] = useState<PerformanceInsight[]>([]);
  const [metrics, setMetrics] = useState<LogMetrics | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
              
              // Analyze the log for insights
              setIsAnalyzing(true);
              try {
                const analyzer = new LogAnalyzer(log);
                const result = await analyzer.analyzeLog(text);
                setInsights(result.insights);
                setMetrics(result.metrics);
              } catch (analyzeError) {
                // Analysis failed, but continue
              } finally {
                setIsAnalyzing(false);
              }
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
    } else if (activeTab === 'insights') {
      contentToCopy = insights.map(i => `[${i.severity.toUpperCase()}] ${i.title}: ${i.description}`).join('\n\n');
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
    } else if (activeTab === 'insights') {
      if (metrics) {
        content = JSON.stringify({ insights, metrics }, null, 2);
        filename = `${logId}_insights.json`;
      }
    }
    
    const file = new Blob([content], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const tabs = [
    { id: 'complete', label: 'Raw Log' },
    { id: 'insights', label: '⚡ Insights' },
    { id: 'tree', label: 'Call Tree' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'soql', label: 'SOQL' },
  ] as const;

  return (
    <div className="flex flex-col h-full text-black animate-in fade-in duration-300">
      {/* Compact header */}
      <div className="flex items-center gap-3 mb-2 flex-shrink-0">
        <button
          onClick={onBack}
          title="Back to records"
          className="group flex items-center justify-center w-8 h-8 rounded-full border-2 border-black hover:bg-black hover:text-white transition-all flex-shrink-0"
        >
          <ChevronRight size={16} className="rotate-180" />
        </button>
        <h2 className="text-xl font-black uppercase tracking-tight truncate flex-1 min-w-0">{logId}</h2>
        <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 border-black whitespace-nowrap ${
          logStatus.includes('Error') ? 'bg-black text-white' : 'bg-transparent text-black'
        }`}>
          {logStatus}
        </span>
      </div>

      {/* Compact metadata bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-[11px] flex-shrink-0">
        <span><span className="font-bold text-gray-400 uppercase tracking-wider mr-1.5">Time</span><span className="font-bold text-black">{logTime}</span></span>
        <span className="text-gray-300">·</span>
        <span><span className="font-bold text-gray-400 uppercase tracking-wider mr-1.5">Size</span><span className="font-bold text-black">{logSize}</span></span>
        <span className="text-gray-300">·</span>
        <span><span className="font-bold text-gray-400 uppercase tracking-wider mr-1.5">Op</span><span className="font-bold text-black">{logOperation}</span></span>
      </div>

      {/* Log / analysis panel — fills the remaining height */}
      <div className="flex-1 min-h-0 flex flex-col bg-zinc-900 rounded-xl overflow-hidden shadow-lg">
        {/* Sticky toolbar */}
        <div className="flex-shrink-0 border-b border-zinc-700">
          {/* Tabs */}
          <div className="flex gap-1 px-3 pt-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-[11px] font-black uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2 px-3 py-2">
            {activeTab === 'complete' ? (
              <>
                <input
                  type="text"
                  placeholder="Search log..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-1.5 text-[11px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText('')}
                    className="px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-zinc-800 border border-zinc-700 text-zinc-400 rounded hover:border-zinc-600 transition-colors whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setWrapLines((w) => !w)}
                  title={wrapLines ? 'Disable line wrap' : 'Enable line wrap'}
                  className={`p-1.5 rounded border transition-colors flex-shrink-0 ${
                    wrapLines ? 'bg-blue-600 border-blue-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <WrapText size={14} />
                </button>
              </>
            ) : (
              <span className="flex-1 text-[10px] uppercase tracking-wider text-zinc-500">
                {activeTab === 'tree' ? 'Call Tree' : activeTab === 'timeline' ? 'Timeline View' : activeTab === 'soql' ? 'SOQL Queries' : 'Performance Insights'}
              </span>
            )}
            <button onClick={copyToClipboard} className="p-1.5 hover:bg-white/10 rounded transition-colors flex-shrink-0" title="Copy to clipboard">
              <Copy size={14} className={copied ? 'text-green-400' : 'text-white/60'} />
            </button>
            <button onClick={downloadLog} className="p-1.5 hover:bg-white/10 rounded transition-colors flex-shrink-0" title="Download">
              <Download size={14} className="text-white/60" />
            </button>
          </div>

          {/* Filters — Raw Log only */}
          {activeTab === 'complete' && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {filters.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => toggleFilter(filter.id)}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded border transition-colors ${
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
        </div>

        {/* Content — scrolls, fills available height */}
        <div className="flex-1 min-h-0 overflow-auto">
          {isLoading ? (
            <div className="text-center py-12 text-zinc-500 text-sm">Loading log details...</div>
          ) : (
            <>
              {activeTab === 'insights' && (
                <div className="bg-white m-3 p-4 rounded-lg">
                  <InsightsView
                    insights={insights}
                    metrics={metrics || { totalSoqlTime: 0, totalDmlTime: 0 }}
                    isAnalyzing={isAnalyzing}
                  />
                </div>
              )}
              {activeTab === 'tree' && parsedLog && (
                <div className="p-3"><TreeView nodes={parsedLog.methodTree} /></div>
              )}
              {activeTab === 'timeline' && parsedLog && (
                <div className="p-3"><TimelineView events={parsedLog.timeline} /></div>
              )}
              {activeTab === 'soql' && (
                <pre className="text-[12px] font-mono whitespace-pre-wrap leading-relaxed text-zinc-200 p-4">
                  {parseSoqlQueries(logBody)}
                </pre>
              )}
              {activeTab === 'complete' && (
                <pre className={`text-[13px] font-mono leading-relaxed text-zinc-200 p-4 ${wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}>
                  {filterLogBody(logBody) || 'No log body available'}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DetailView;