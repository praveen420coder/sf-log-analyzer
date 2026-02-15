import React from 'react';
import { AlertTriangle, CheckCircle, Info, Zap, Database, Activity, AlertCircle } from 'lucide-react';
import type { PerformanceInsight, LogMetrics } from '../../utils/logAnalyzer';
import { formatDuration } from '../../utils/apexLogParser';

interface InsightsViewProps {
  insights: PerformanceInsight[];
  metrics: LogMetrics;
  isAnalyzing: boolean;
}

const InsightsView: React.FC<InsightsViewProps> = ({ insights, metrics, isAnalyzing }) => {
  if (isAnalyzing) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Activity className="animate-spin mx-auto mb-4 text-gray-400" size={48} />
          <p className="text-sm font-bold text-gray-500">Analyzing log...</p>
        </div>
      </div>
    );
  }

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'error': return <AlertCircle size={20} className="text-red-600" />;
      case 'warning': return <AlertTriangle size={20} className="text-yellow-600" />;
      case 'success': return <CheckCircle size={20} className="text-green-600" />;
      default: return <Info size={20} className="text-blue-600" />;
    }
  };

  const getInsightBgColor = (type: string) => {
    switch (type) {
      case 'error': return 'bg-red-50 border-red-200';
      case 'warning': return 'bg-yellow-50 border-yellow-200';
      case 'success': return 'bg-green-50 border-green-200';
      default: return 'bg-blue-50 border-blue-200';
    }
  };

  const renderLimitCard = (
    label: string,
    icon: React.ReactNode,
    limit: { used: number; total: number; percentage: number } | undefined,
    formatter?: (val: number) => string
  ) => {
    if (!limit) return null;

    const format = formatter || ((v) => v.toString());
    const colorClass = limit.percentage > 80 ? 'text-red-500' : 
                      limit.percentage > 50 ? 'text-yellow-500' : 'text-green-500';
    const bgClass = limit.percentage > 80 ? 'bg-red-500' : 
                   limit.percentage > 50 ? 'bg-yellow-500' : 'bg-green-500';

    return (
      <div className="border-2 border-black rounded-2xl p-4 bg-white hover:shadow-lg transition-shadow">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
          <span className={colorClass}>{icon}</span>
        </div>
        <p className="text-2xl font-black text-black">{format(limit.used)}</p>
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-gray-600 mb-1">
            <span>{limit.percentage.toFixed(0)}%</span>
            <span>{format(limit.total)} limit</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all ${bgClass}`}
              style={{ width: `${Math.min(limit.percentage, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Governor Limits */}
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-4 text-black">Governor Limits</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {renderLimitCard(
            'CPU Time',
            <Zap size={16} />,
            metrics.cpuTime,
            (v) => `${(v / 1000).toFixed(0)} ms`
          )}
          {renderLimitCard(
            'Heap Size',
            <Activity size={16} />,
            metrics.heapSize,
            (v) => `${(v / 1024).toFixed(0)} KB`
          )}
          {renderLimitCard(
            'SOQL Queries',
            <Database size={16} />,
            metrics.soqlQueries
          )}
          {renderLimitCard(
            'DML Statements',
            <Database size={16} />,
            metrics.dmlStatements
          )}

          {metrics.slowestSoql && (
            <div className="border-2 border-black rounded-2xl p-4 bg-white hover:shadow-lg transition-shadow col-span-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Slowest SOQL</span>
                <Database size={16} className="text-orange-500" />
              </div>
              <p className="text-2xl font-black text-black">{formatDuration(metrics.slowestSoql.duration)}</p>
              <p className="text-[10px] text-gray-600 mt-1 truncate">{metrics.slowestSoql.query}</p>
              {metrics.slowestSoql.rows !== undefined && (
                <p className="text-[10px] text-gray-500 mt-1">{metrics.slowestSoql.rows} rows returned</p>
              )}
            </div>
          )}

          {metrics.slowestMethod && (
            <div className="border-2 border-black rounded-2xl p-4 bg-white hover:shadow-lg transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Slowest Method</span>
                <Activity size={16} className="text-purple-500" />
              </div>
              <p className="text-2xl font-black text-black">{formatDuration(metrics.slowestMethod.duration)}</p>
              <p className="text-[10px] text-gray-600 mt-1 truncate">{metrics.slowestMethod.name}</p>
            </div>
          )}
        </div>
      </div>

      {/* Insights */}
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-4 text-black">Insights & Recommendations</h2>
        <div className="space-y-3">
          {insights.map((insight, index) => (
            <div
              key={index}
              className={`border-2 rounded-2xl p-5 ${getInsightBgColor(insight.type)} transition-all hover:shadow-md`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getInsightIcon(insight.type)}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-black uppercase tracking-tight text-black">{insight.title}</h3>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      insight.severity === 'high' ? 'bg-red-600 text-white' :
                      insight.severity === 'medium' ? 'bg-yellow-600 text-white' :
                      'bg-gray-400 text-white'
                    }`}>
                      {insight.severity}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{insight.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InsightsView;
