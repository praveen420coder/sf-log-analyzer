/**
 * Debug Session Manager
 * Manages debug levels, trace flags, and debug sessions in Salesforce
 */

import type {
  DebugLevel,
  DebugLevelSettings,
  TraceFlag,
  ActiveDebugSession,
  DebugPreset,
} from '../types/debugSession';
import { calculateExpirationDate } from '../types/debugSession';

export class DebugSessionManager {
  /**
   * Create or update a debug level with the given settings
   */
  async createDebugLevel(
    name: string,
    settings: DebugLevelSettings,
    instanceUrl: string,
    accessToken: string
  ): Promise<DebugLevel> {
    // First, check if a debug level with this name already exists
    const existingLevel = await this.findDebugLevelByName(name, instanceUrl, accessToken);
    
    if (existingLevel) {
      // Update existing
      return this.updateDebugLevel(existingLevel.Id!, settings, instanceUrl, accessToken);
    }
    
    // Create new debug level
    const debugLevel: Partial<DebugLevel> = {
      DeveloperName: name.replace(/[^a-zA-Z0-9_]/g, '_'),
      MasterLabel: name,
      ...settings,
    };
    
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/sobjects/DebugLevel`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(debugLevel),
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create debug level: ${error.message || response.statusText}`);
    }
    
    const result = await response.json();
    return { Id: result.id, ...debugLevel } as DebugLevel;
  }
  
  /**
   * Update an existing debug level
   */
  private async updateDebugLevel(
    debugLevelId: string,
    settings: DebugLevelSettings,
    instanceUrl: string,
    accessToken: string
  ): Promise<DebugLevel> {
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/sobjects/DebugLevel/${debugLevelId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to update debug level: ${response.statusText}`);
    }
    
    // Fetch the updated record
    return this.getDebugLevel(debugLevelId, instanceUrl, accessToken);
  }
  
  /**
   * Find debug level by name
   */
  async findDebugLevelByName(
    name: string,
    instanceUrl: string,
    accessToken: string
  ): Promise<DebugLevel | null> {
    const developerName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    const query = `SELECT Id, DeveloperName, MasterLabel, ApexCode, ApexProfiling, Callout, Database, System, Validation, Visualforce, Workflow FROM DebugLevel WHERE DeveloperName = '${developerName}' LIMIT 1`;
    
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/query?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to query debug level: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.records.length > 0 ? result.records[0] : null;
  }
  
  /**
   * Get debug level by ID
   */
  async getDebugLevel(
    debugLevelId: string,
    instanceUrl: string,
    accessToken: string
  ): Promise<DebugLevel> {
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/sobjects/DebugLevel/${debugLevelId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get debug level: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * Create a trace flag for a user with the specified debug level
   */
  async createTraceFlag(
    userId: string,
    debugLevelId: string,
    durationHours: number,
    instanceUrl: string,
    accessToken: string
  ): Promise<TraceFlag> {
    const now = new Date();
    const expirationDate = calculateExpirationDate(durationHours);
    
    // Check if there's already an active trace flag for this user
    const existingFlag = await this.getActiveTraceFlagForUser(userId, instanceUrl, accessToken);
    if (existingFlag) {
      // Update existing trace flag
      return this.updateTraceFlag(
        existingFlag.Id!,
        debugLevelId,
        expirationDate,
        instanceUrl,
        accessToken
      );
    }
    
    const traceFlag: Partial<TraceFlag> = {
      TracedEntityId: userId,
      DebugLevelId: debugLevelId,
      StartDate: now.toISOString(),
      ExpirationDate: expirationDate.toISOString(),
      LogType: 'USER_DEBUG',
    };
    
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(traceFlag),
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create trace flag: ${error.message || response.statusText}`);
    }
    
    const result = await response.json();
    return { Id: result.id, ...traceFlag } as TraceFlag;
  }
  
  /**
   * Update an existing trace flag
   */
  private async updateTraceFlag(
    traceFlagId: string,
    debugLevelId: string,
    expirationDate: Date,
    instanceUrl: string,
    accessToken: string
  ): Promise<TraceFlag> {
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag/${traceFlagId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          DebugLevelId: debugLevelId,
          ExpirationDate: expirationDate.toISOString(),
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to update trace flag: ${response.statusText}`);
    }
    
    return this.getTraceFlag(traceFlagId, instanceUrl, accessToken);
  }
  
  /**
   * Get active trace flag for a user
   */
  async getActiveTraceFlagForUser(
    userId: string,
    instanceUrl: string,
    accessToken: string
  ): Promise<TraceFlag | null> {
    const now = new Date().toISOString();
    const query = `SELECT Id, TracedEntityId, DebugLevelId, StartDate, ExpirationDate, LogType FROM TraceFlag WHERE TracedEntityId = '${userId}' AND ExpirationDate > ${now} ORDER BY ExpirationDate DESC LIMIT 1`;
    
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/query?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to query trace flag: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.records.length > 0 ? result.records[0] : null;
  }
  
  /**
   * Get trace flag by ID
   */
  async getTraceFlag(
    traceFlagId: string,
    instanceUrl: string,
    accessToken: string
  ): Promise<TraceFlag> {
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag/${traceFlagId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get trace flag: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * Delete a trace flag
   */
  async deleteTraceFlag(
    traceFlagId: string,
    instanceUrl: string,
    accessToken: string
  ): Promise<void> {
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/sobjects/TraceFlag/${traceFlagId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to delete trace flag: ${response.statusText}`);
    }
  }
  
  /**
   * Get all active debug sessions
   */
  async getActiveDebugSessions(
    instanceUrl: string,
    accessToken: string
  ): Promise<ActiveDebugSession[]> {
    const now = new Date().toISOString();
    const query = `
      SELECT Id, TracedEntityId, DebugLevelId, StartDate, ExpirationDate, LogType,
             TracedEntity.Name, DebugLevel.DeveloperName
      FROM TraceFlag 
      WHERE ExpirationDate > ${now}
      ORDER BY ExpirationDate DESC
    `;
    
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/tooling/query?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to query active sessions: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    // Fetch full debug level details for each trace flag
    const sessions: ActiveDebugSession[] = [];
    for (const record of result.records) {
      try {
        const debugLevel = await this.getDebugLevel(
          record.DebugLevelId,
          instanceUrl,
          accessToken
        );
        
        sessions.push({
          traceFlag: {
            Id: record.Id,
            TracedEntityId: record.TracedEntityId,
            DebugLevelId: record.DebugLevelId,
            StartDate: record.StartDate,
            ExpirationDate: record.ExpirationDate,
            LogType: record.LogType,
          },
          debugLevel,
          userName: record.TracedEntity?.Name || 'Unknown',
          userId: record.TracedEntityId,
          expiresAt: new Date(record.ExpirationDate),
        });
      } catch (error) {
        console.error(`Failed to fetch debug level for trace flag ${record.Id}:`, error);
      }
    }
    
    return sessions;
  }
  
  /**
   * Create a complete debug session (debug level + trace flag) from a preset
   */
  async createDebugSession(
    userId: string,
    preset: DebugPreset,
    durationHours: number,
    instanceUrl: string,
    accessToken: string
  ): Promise<{ debugLevel: DebugLevel; traceFlag: TraceFlag }> {
    // Create or get debug level with preset settings
    const debugLevel = await this.createDebugLevel(
      preset.name,
      preset.settings,
      instanceUrl,
      accessToken
    );
    
    // Create trace flag for the user
    const traceFlag = await this.createTraceFlag(
      userId,
      debugLevel.Id!,
      durationHours,
      instanceUrl,
      accessToken
    );
    
    return { debugLevel, traceFlag };
  }
  
  /**
   * Search for users by name or email
   */
  async searchUsers(
    searchTerm: string,
    instanceUrl: string,
    accessToken: string
  ): Promise<Array<{ Id: string; Name: string; Username: string; Email: string }>> {
    const query = `
      SELECT Id, Name, Username, Email 
      FROM User 
      WHERE IsActive = true 
      AND (Name LIKE '%${searchTerm}%' OR Username LIKE '%${searchTerm}%' OR Email LIKE '%${searchTerm}%')
      ORDER BY Name 
      LIMIT 10
    `;
    
    const response = await fetch(
      `${instanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to search users: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.records;
  }
}
