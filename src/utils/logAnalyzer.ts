// Log Analyzer - Analyzes single log to find patterns, issues, and insights
import { ApexLogParser } from './apexLogParser';
import type { ParsedLog } from './apexLogParser';
import type { Log } from '../types';

export interface PerformanceInsight {
  type: 'warning' | 'error' | 'info' | 'success';
  category: 'performance' | 'limits' | 'soql' | 'dml' | 'general';
  title: string;
  description: string;
  affectedLogs?: string[];
  severity: 'high' | 'medium' | 'low';
}

export interface LogMetrics {
  cpuTime?: { used: number; total: number; percentage: number };
  heapSize?: { used: number; total: number; percentage: number };
  soqlQueries?: { used: number; total: number; percentage: number };
  queryRows?: { used: number; total: number; percentage: number };
  dmlStatements?: { used: number; total: number; percentage: number };
  dmlRows?: { used: number; total: number; percentage: number };
  totalSoqlTime: number;
  totalDmlTime: number;
  slowestSoql?: { query: string; duration: number; rows?: number };
  slowestMethod?: { name: string; duration: number };
}

export class LogAnalyzer {
  private log: Log;
  private parsed: ParsedLog | null = null;
  
  constructor(log: Log) {
    this.log = log;
  }

  async analyzeLog(logBody: string): Promise<{
    insights: PerformanceInsight[];
    metrics: LogMetrics;
  }> {
    // Parse the log
    try {
      const parser = new ApexLogParser(logBody);
      this.parsed = parser.parse();
    } catch (e) {
      throw new Error('Failed to parse log');
    }

    const insights = this.generateInsights();
    const metrics = this.calculateMetrics();

    return { insights, metrics };
  }

  private generateInsights(): PerformanceInsight[] {
    if (!this.parsed) return [];
    
    const insights: PerformanceInsight[] = [];
    const limits = this.parsed.limits;

    // Check for high CPU usage
    if (limits.cpuTime) {
      const percentage = (limits.cpuTime.used / limits.cpuTime.total) * 100;
      if (percentage > 80) {
        insights.push({
          type: 'error',
          category: 'performance',
          title: `Critical CPU Usage`,
          description: `Using ${percentage.toFixed(0)}% of CPU limit. Optimize loops, reduce complexity, or consider async processing.`,
          severity: 'high'
        });
      } else if (percentage > 50) {
        insights.push({
          type: 'warning',
          category: 'performance',
          title: `High CPU Usage`,
          description: `Using ${percentage.toFixed(0)}% of CPU limit. Consider optimizing loops and reducing computational complexity.`,
          severity: 'medium'
        });
      }
    }

    // Check for high heap usage
    if (limits.heapSize) {
      const percentage = (limits.heapSize.used / limits.heapSize.total) * 100;
      if (percentage > 80) {
        insights.push({
          type: 'error',
          category: 'performance',
          title: `Critical Heap Usage`,
          description: `Using ${percentage.toFixed(0)}% of heap limit. Reduce variable scope, limit collection sizes, or process data in batches.`,
          severity: 'high'
        });
      } else if (percentage > 50) {
        insights.push({
          type: 'warning',
          category: 'performance',
          title: `High Heap Usage`,
          description: `Using ${percentage.toFixed(0)}% of heap limit. Consider reducing variable scope and using SOQL efficiently.`,
          severity: 'medium'
        });
      }
    }

    // Check for SOQL in loops (N+1 pattern)
    if (this.parsed.soqlQueries.length > 10) {
      const queryPatterns = this.parsed.soqlQueries.map(q => 
        q.query.replace(/\s+/g, ' ').substring(0, 50)
      );
      const uniquePatterns = new Set(queryPatterns);
      if (uniquePatterns.size < this.parsed.soqlQueries.length / 2) {
        insights.push({
          type: 'error',
          category: 'soql',
          title: `Potential N+1 Query Pattern`,
          description: `Found ${this.parsed.soqlQueries.length} SOQL queries with ${uniquePatterns.size} unique patterns. Bulk-ify your queries to improve performance.`,
          severity: 'high'
        });
      }
    }

    // Check for slow SOQL queries
    const slowQueries = this.parsed.soqlQueries.filter(q => q.duration && q.duration > 1000000000);
    if (slowQueries.length > 0) {
      insights.push({
        type: 'warning',
        category: 'soql',
        title: `Slow SOQL Queries Found`,
        description: `${slowQueries.length} SOQL queries taking more than 1 second. Consider adding selective indexes or optimizing WHERE clauses.`,
        severity: 'medium'
      });
    }

    // Check for approaching SOQL limit
    if (limits.soqlQueries) {
      const percentage = (limits.soqlQueries.used / limits.soqlQueries.total) * 100;
      if (percentage > 80) {
        insights.push({
          type: 'error',
          category: 'limits',
          title: `Approaching SOQL Query Limit`,
          description: `Using ${limits.soqlQueries.used} of ${limits.soqlQueries.total} SOQL queries (${percentage.toFixed(0)}%). Consolidate queries urgently.`,
          severity: 'high'
        });
      } else if (percentage > 50) {
        insights.push({
          type: 'warning',
          category: 'limits',
          title: `High SOQL Query Usage`,
          description: `Using ${limits.soqlQueries.used} of ${limits.soqlQueries.total} SOQL queries. Consolidate similar queries where possible.`,
          severity: 'medium'
        });
      }
    }

    // Check for large result sets
    const largeResults = this.parsed.soqlQueries.filter(q => q.rows && q.rows > 1000);
    if (largeResults.length > 0) {
      insights.push({
        type: 'warning',
        category: 'soql',
        title: `Large Query Result Sets`,
        description: `${largeResults.length} queries returning more than 1000 rows. Consider using pagination or more selective WHERE clauses.`,
        severity: 'low'
      });
    }

    // Check for DML limits
    if (limits.dmlStatements) {
      const percentage = (limits.dmlStatements.used / limits.dmlStatements.total) * 100;
      if (percentage > 70) {
        insights.push({
          type: 'warning',
          category: 'limits',
          title: `High DML Statement Usage`,
          description: `Using ${limits.dmlStatements.used} of ${limits.dmlStatements.total} DML statements. Bulk-ify DML operations.`,
          severity: 'medium'
        });
      }
    }

    // Check execution status
    const status = this.log.status || this.log.Status || '';
    if (status.toLowerCase().includes('error') || status.toLowerCase().includes('failed')) {
      insights.push({
        type: 'error',
        category: 'general',
        title: `Execution Failed`,
        description: `This log ended with an error status. Review the stack trace and error messages in the log.`,
        severity: 'high'
      });
    }

    // Positive insight if no major issues
    if (insights.length === 0 || insights.every(i => i.severity === 'low')) {
      insights.push({
        type: 'success',
        category: 'general',
        title: `Performance Looks Good`,
        description: `No critical performance issues detected. All governor limits are within acceptable ranges.`,
        severity: 'low'
      });
    }

    return insights.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  private calculateMetrics(): LogMetrics {
    if (!this.parsed) {
      return {
        totalSoqlTime: 0,
        totalDmlTime: 0
      };
    }

    const limits = this.parsed.limits;
    const metrics: LogMetrics = {
      totalSoqlTime: 0,
      totalDmlTime: 0
    };

    // Calculate limit percentages
    if (limits.cpuTime) {
      metrics.cpuTime = {
        used: limits.cpuTime.used,
        total: limits.cpuTime.total,
        percentage: (limits.cpuTime.used / limits.cpuTime.total) * 100
      };
    }

    if (limits.heapSize) {
      metrics.heapSize = {
        used: limits.heapSize.used,
        total: limits.heapSize.total,
        percentage: (limits.heapSize.used / limits.heapSize.total) * 100
      };
    }

    if (limits.soqlQueries) {
      metrics.soqlQueries = {
        used: limits.soqlQueries.used,
        total: limits.soqlQueries.total,
        percentage: (limits.soqlQueries.used / limits.soqlQueries.total) * 100
      };
    }

    if (limits.queryRows) {
      metrics.queryRows = {
        used: limits.queryRows.used,
        total: limits.queryRows.total,
        percentage: (limits.queryRows.used / limits.queryRows.total) * 100
      };
    }

    if (limits.dmlStatements) {
      metrics.dmlStatements = {
        used: limits.dmlStatements.used,
        total: limits.dmlStatements.total,
        percentage: (limits.dmlStatements.used / limits.dmlStatements.total) * 100
      };
    }

    if (limits.dmlRows) {
      metrics.dmlRows = {
        used: limits.dmlRows.used,
        total: limits.dmlRows.total,
        percentage: (limits.dmlRows.used / limits.dmlRows.total) * 100
      };
    }

    // Calculate SOQL metrics
    if (this.parsed.soqlQueries.length > 0) {
      metrics.totalSoqlTime = this.parsed.soqlQueries.reduce((acc, q) => acc + (q.duration || 0), 0);
      
      const slowest = [...this.parsed.soqlQueries]
        .filter(q => q.duration)
        .sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
      
      if (slowest) {
        metrics.slowestSoql = {
          query: slowest.query.substring(0, 100) + (slowest.query.length > 100 ? '...' : ''),
          duration: slowest.duration || 0,
          rows: slowest.rows
        };
      }
    }

    // Calculate DML metrics
    if (this.parsed.dmlOperations.length > 0) {
      metrics.totalDmlTime = this.parsed.dmlOperations.reduce((acc, d) => 
        acc + ((d.endTime || 0) - d.startTime), 0
      );
    }

    // Find slowest method
    const methods = this.parsed.timeline.filter(t => t.type === 'METHOD');
    if (methods.length > 0) {
      const slowest = [...methods].sort((a, b) => b.duration - a.duration)[0];
      metrics.slowestMethod = {
        name: slowest.name,
        duration: slowest.duration
      };
    }

    return metrics;
  }
}
