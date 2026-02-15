/**
 * Types for Enhanced Debug Session Control
 * Supports custom debug levels, presets, and multi-user trace flags
 */

export type LogCategory = 
  | 'ApexCode'
  | 'ApexProfiling'
  | 'Callout'
  | 'Database'
  | 'System'
  | 'Validation'
  | 'Visualforce'
  | 'Workflow';

export type LogLevel = 'NONE' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'FINE' | 'FINER' | 'FINEST';

export interface DebugLevelSettings {
  ApexCode: LogLevel;
  ApexProfiling: LogLevel;
  Callout: LogLevel;
  Database: LogLevel;
  System: LogLevel;
  Validation: LogLevel;
  Visualforce: LogLevel;
  Workflow: LogLevel;
}

export interface DebugLevel {
  Id?: string;
  DeveloperName: string;
  MasterLabel: string;
  ApexCode: LogLevel;
  ApexProfiling: LogLevel;
  Callout: LogLevel;
  Database: LogLevel;
  System: LogLevel;
  Validation: LogLevel;
  Visualforce: LogLevel;
  Workflow: LogLevel;
}

export interface TraceFlag {
  Id?: string;
  TracedEntityId: string;
  DebugLevelId: string;
  StartDate: string;
  ExpirationDate: string;
  LogType: 'USER_DEBUG' | 'DEVELOPER_LOG' | 'CLASS_TRACING' | 'TRIGGER_TRACING';
}

export interface DebugPreset {
  name: string;
  description: string;
  settings: DebugLevelSettings;
  icon?: string;
}

export interface ActiveDebugSession {
  traceFlag: TraceFlag;
  debugLevel: DebugLevel;
  userName: string;
  userId: string;
  expiresAt: Date;
}

// Predefined debug level presets
export const DEBUG_PRESETS: Record<string, DebugPreset> = {
  APEX_ONLY: {
    name: 'Apex Only',
    description: 'Focus on Apex code execution and profiling',
    icon: '⚡',
    settings: {
      ApexCode: 'FINEST',
      ApexProfiling: 'FINEST',
      Callout: 'INFO',
      Database: 'INFO',
      System: 'INFO',
      Validation: 'WARN',
      Visualforce: 'WARN',
      Workflow: 'WARN',
    },
  },
  FULL_DEBUG: {
    name: 'Full Debug',
    description: 'Maximum logging across all categories',
    icon: '🔍',
    settings: {
      ApexCode: 'FINEST',
      ApexProfiling: 'FINEST',
      Callout: 'FINEST',
      Database: 'FINEST',
      System: 'FINEST',
      Validation: 'FINEST',
      Visualforce: 'FINEST',
      Workflow: 'FINEST',
    },
  },
  PERFORMANCE: {
    name: 'Performance Analysis',
    description: 'Optimized for performance troubleshooting',
    icon: '📊',
    settings: {
      ApexCode: 'FINE',
      ApexProfiling: 'FINEST',
      Callout: 'FINE',
      Database: 'FINEST',
      System: 'FINE',
      Validation: 'WARN',
      Visualforce: 'WARN',
      Workflow: 'INFO',
    },
  },
  DATABASE_FOCUS: {
    name: 'Database & SOQL',
    description: 'Focus on database operations and queries',
    icon: '🗄️',
    settings: {
      ApexCode: 'INFO',
      ApexProfiling: 'INFO',
      Callout: 'WARN',
      Database: 'FINEST',
      System: 'INFO',
      Validation: 'WARN',
      Visualforce: 'WARN',
      Workflow: 'INFO',
    },
  },
  INTEGRATION: {
    name: 'Integration & Callouts',
    description: 'Debug external integrations and callouts',
    icon: '🔗',
    settings: {
      ApexCode: 'FINE',
      ApexProfiling: 'INFO',
      Callout: 'FINEST',
      Database: 'INFO',
      System: 'FINE',
      Validation: 'WARN',
      Visualforce: 'WARN',
      Workflow: 'INFO',
    },
  },
  MINIMAL: {
    name: 'Minimal',
    description: 'Basic logging to reduce log size',
    icon: '📝',
    settings: {
      ApexCode: 'INFO',
      ApexProfiling: 'WARN',
      Callout: 'WARN',
      Database: 'WARN',
      System: 'WARN',
      Validation: 'ERROR',
      Visualforce: 'ERROR',
      Workflow: 'WARN',
    },
  },
};

// Duration options for debug sessions (in hours)
export const SESSION_DURATIONS = [
  { label: '15 minutes', hours: 0.25 },
  { label: '30 minutes', hours: 0.5 },
  { label: '1 hour', hours: 1 },
  { label: '2 hours', hours: 2 },
  { label: '4 hours', hours: 4 },
  { label: '8 hours', hours: 8 },
  { label: '12 hours', hours: 12 },
  { label: '24 hours', hours: 24 },
];

// Helper to calculate expiration date
export function calculateExpirationDate(durationHours: number): Date {
  const now = new Date();
  return new Date(now.getTime() + durationHours * 60 * 60 * 1000);
}

// Helper to format remaining time
export function formatRemainingTime(expiresAt: Date): string {
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  
  if (diffMs <= 0) return 'Expired';
  
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  
  if (diffHours > 0) {
    return `${diffHours}h ${remainingMins}m`;
  }
  return `${diffMins}m`;
}
