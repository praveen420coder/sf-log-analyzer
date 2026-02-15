// Apex Log Parser - Parses Salesforce debug logs into structured data
export interface LogLine {
  timestamp: string;
  duration: number;
  event: string;
  details: string;
  lineNumber?: string;
  raw: string;
}

export interface MethodNode {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  children: MethodNode[];
  parent?: MethodNode;
  depth: number;
  type: 'METHOD' | 'CODE_UNIT' | 'SOQL' | 'DML';
  details?: string;
}

export interface ParsedLog {
  methodTree: MethodNode[];
  timeline: TimelineEvent[];
  soqlQueries: SoqlQuery[];
  dmlOperations: DmlOperation[];
  limits: LimitUsage;
}

export interface TimelineEvent {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  type: 'METHOD' | 'CODE_UNIT' | 'SOQL' | 'DML';
  depth: number;
  details?: string;
}

export interface SoqlQuery {
  query: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  rows?: number;
  aggregations?: number;
}

export interface DmlOperation {
  operation: string;
  startTime: number;
  endTime?: number;
  rows?: number;
}

export interface LimitUsage {
  soqlQueries?: { used: number; total: number };
  queryRows?: { used: number; total: number };
  cpuTime?: { used: number; total: number };
  heapSize?: { used: number; total: number };
  dmlStatements?: { used: number; total: number };
  dmlRows?: { used: number; total: number };
}

export class ApexLogParser {
  private lines: string[];
  private methodStack: MethodNode[] = [];
  private rootNodes: MethodNode[] = [];
  private timeline: TimelineEvent[] = [];
  private soqlQueries: SoqlQuery[] = [];
  private dmlOperations: DmlOperation[] = [];
  private limits: LimitUsage = {};
  private nodeIdCounter = 0;

  constructor(logText: string) {
    this.lines = logText.split('\n').filter(line => line.trim());
  }

  parse(): ParsedLog {
    this.lines.forEach((line) => {
      this.parseLine(line);
    });

    // Close any unclosed method nodes
    this.methodStack.forEach(node => {
      if (!node.endTime) {
        node.endTime = this.extractDuration(this.lines[this.lines.length - 1]);
        node.duration = node.endTime - node.startTime;
      }
    });

    return {
      methodTree: this.rootNodes,
      timeline: this.timeline,
      soqlQueries: this.soqlQueries,
      dmlOperations: this.dmlOperations,
      limits: this.limits
    };
  }

  private parseLine(line: string): void {
    // Extract timestamp/duration in nanoseconds (number in parentheses)
    const duration = this.extractDuration(line);

    // METHOD_ENTRY
    if (line.includes('METHOD_ENTRY')) {
      const methodName = this.extractMethodName(line);
      const node: MethodNode = {
        id: `method-${this.nodeIdCounter++}`,
        name: methodName,
        startTime: duration,
        children: [],
        depth: this.methodStack.length,
        type: 'METHOD'
      };

      if (this.methodStack.length > 0) {
        const parent = this.methodStack[this.methodStack.length - 1];
        parent.children.push(node);
        node.parent = parent;
      } else {
        this.rootNodes.push(node);
      }

      this.methodStack.push(node);
    }
    // METHOD_EXIT
    else if (line.includes('METHOD_EXIT')) {
      if (this.methodStack.length > 0) {
        const node = this.methodStack.pop()!;
        node.endTime = duration;
        node.duration = node.endTime - node.startTime;

        // Add to timeline
        this.timeline.push({
          id: node.id,
          name: node.name,
          startTime: node.startTime,
          endTime: node.endTime,
          duration: node.duration,
          type: 'METHOD',
          depth: node.depth
        });
      }
    }
    // CODE_UNIT_STARTED
    else if (line.includes('CODE_UNIT_STARTED')) {
      const unitName = this.extractCodeUnitName(line);
      const node: MethodNode = {
        id: `unit-${this.nodeIdCounter++}`,
        name: unitName,
        startTime: duration,
        children: [],
        depth: this.methodStack.length,
        type: 'CODE_UNIT'
      };

      if (this.methodStack.length > 0) {
        const parent = this.methodStack[this.methodStack.length - 1];
        parent.children.push(node);
        node.parent = parent;
      } else {
        this.rootNodes.push(node);
      }

      this.methodStack.push(node);
    }
    // CODE_UNIT_FINISHED
    else if (line.includes('CODE_UNIT_FINISHED')) {
      if (this.methodStack.length > 0) {
        const node = this.methodStack.pop()!;
        node.endTime = duration;
        node.duration = node.endTime - node.startTime;

        this.timeline.push({
          id: node.id,
          name: node.name,
          startTime: node.startTime,
          endTime: node.endTime,
          duration: node.duration,
          type: 'CODE_UNIT',
          depth: node.depth
        });
      }
    }
    // SOQL_EXECUTE_BEGIN
    else if (line.includes('SOQL_EXECUTE_BEGIN')) {
      const query = this.extractSoqlQuery(line);
      const aggregations = this.extractNumber(line, 'Aggregations:');
      const soql: SoqlQuery = {
        query,
        startTime: duration,
        aggregations
      };
      this.soqlQueries.push(soql);
    }
    // SOQL_EXECUTE_END
    else if (line.includes('SOQL_EXECUTE_END')) {
      const rows = this.extractNumber(line, 'Rows:');
      if (this.soqlQueries.length > 0) {
        const lastQuery = this.soqlQueries[this.soqlQueries.length - 1];
        if (!lastQuery.endTime) {
          lastQuery.endTime = duration;
          lastQuery.duration = duration - lastQuery.startTime;
          lastQuery.rows = rows;

          // Add to timeline
          this.timeline.push({
            id: `soql-${this.timeline.length}`,
            name: lastQuery.query.substring(0, 50) + '...',
            startTime: lastQuery.startTime,
            endTime: lastQuery.endTime,
            duration: lastQuery.duration,
            type: 'SOQL',
            depth: this.methodStack.length,
            details: `Rows: ${rows || 0}`
          });
        }
      }
    }
    // DML_BEGIN
    else if (line.includes('DML_BEGIN')) {
      const operation = this.extractDmlOperation(line);
      const dml: DmlOperation = {
        operation,
        startTime: duration
      };
      this.dmlOperations.push(dml);
    }
    // DML_END
    else if (line.includes('DML_END')) {
      if (this.dmlOperations.length > 0) {
        const lastDml = this.dmlOperations[this.dmlOperations.length - 1];
        if (!lastDml.endTime) {
          lastDml.endTime = duration;
          const rows = this.extractNumber(line, 'Rows:');
          lastDml.rows = rows;

          // Add to timeline
          this.timeline.push({
            id: `dml-${this.timeline.length}`,
            name: lastDml.operation,
            startTime: lastDml.startTime,
            endTime: lastDml.endTime,
            duration: lastDml.endTime - lastDml.startTime,
            type: 'DML',
            depth: this.methodStack.length,
            details: `Rows: ${rows || 0}`
          });
        }
      }
    }
    // CUMULATIVE_LIMIT_USAGE
    else if (line.includes('Number of SOQL queries:')) {
      const match = line.match(/Number of SOQL queries: (\d+) out of (\d+)/);
      if (match) {
        this.limits.soqlQueries = { used: parseInt(match[1]), total: parseInt(match[2]) };
      }
    } else if (line.includes('Number of query rows:')) {
      const match = line.match(/Number of query rows: (\d+) out of (\d+)/);
      if (match) {
        this.limits.queryRows = { used: parseInt(match[1]), total: parseInt(match[2]) };
      }
    } else if (line.includes('Maximum CPU time:')) {
      const match = line.match(/Maximum CPU time: (\d+) out of (\d+)/);
      if (match) {
        this.limits.cpuTime = { used: parseInt(match[1]), total: parseInt(match[2]) };
      }
    } else if (line.includes('Maximum heap size:')) {
      const match = line.match(/Maximum heap size: (\d+) out of (\d+)/);
      if (match) {
        this.limits.heapSize = { used: parseInt(match[1]), total: parseInt(match[2]) };
      }
    } else if (line.includes('Number of DML statements:')) {
      const match = line.match(/Number of DML statements: (\d+) out of (\d+)/);
      if (match) {
        this.limits.dmlStatements = { used: parseInt(match[1]), total: parseInt(match[2]) };
      }
    } else if (line.includes('Number of DML rows:')) {
      const match = line.match(/Number of DML rows: (\d+) out of (\d+)/);
      if (match) {
        this.limits.dmlRows = { used: parseInt(match[1]), total: parseInt(match[2]) };
      }
    }
  }

  private extractDuration(line: string): number {
    const match = line.match(/\((\d+)\)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractMethodName(line: string): string {
    const match = line.match(/\|METHOD_ENTRY\|\[(\d+)\]\|([^|]+)\|(.+)/);
    if (match) {
      return match[3] || match[2];
    }
    // Fallback
    const parts = line.split('|');
    return parts[parts.length - 1] || 'Unknown Method';
  }

  private extractCodeUnitName(line: string): string {
    const match = line.match(/\|CODE_UNIT_STARTED\|\[EXTERNAL\]\|(.+)/);
    if (match) {
      return match[1];
    }
    const parts = line.split('|');
    return parts[parts.length - 1] || 'Unknown Code Unit';
  }

  private extractSoqlQuery(line: string): string {
    const match = line.match(/SELECT[^|]*/i);
    return match ? match[0].trim() : 'Unknown Query';
  }

  private extractDmlOperation(line: string): string {
    const match = line.match(/\|DML_BEGIN\|\[(\d+)\]\|Op:([^|]+)/);
    return match ? match[2].trim() : 'Unknown DML';
  }

  private extractNumber(line: string, prefix: string): number | undefined {
    const regex = new RegExp(prefix + '(\\d+)');
    const match = line.match(regex);
    return match ? parseInt(match[1]) : undefined;
  }
}

// Helper function to format duration in ms
export function formatDuration(nanoseconds: number): string {
  const ms = nanoseconds / 1000000;
  if (ms < 1) return `${nanoseconds} ns`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// Helper function to calculate percentage
export function calculatePercentage(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}
