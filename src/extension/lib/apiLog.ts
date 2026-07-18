// Shared TYPES ONLY for the API-activity console.
//
// This file must stay type-only: it's referenced by both the background service
// worker and the content script, which are built as separate self-contained
// bundles (no Rollup code-splitting allowed — see vite.config.ts). Runtime
// constants live inline in each consumer so nothing here emits a shared chunk.

export type ApiKind = 'query' | 'apex' | 'rest' | 'session' | 'other';

export interface ApiLogEntry {
  id: number;          // monotonic per-session id
  ts: number;          // epoch ms when the call completed
  kind: ApiKind;
  method: string;      // GET/POST/DELETE, or COOKIE for session lookups
  label: string;       // SOQL text, or a friendly endpoint description
  status: number;      // HTTP status (0 when not an HTTP call)
  ok: boolean;         // success
  durationMs: number;
  bytes?: number;      // response Content-Length when known
  error?: string;
}

export interface ApiLogSnapshot {
  entries: ApiLogEntry[];      // newest first
  counts: Record<ApiKind, number>;
  total: number;
}

// The runtime port name is duplicated as a literal in both consumers; keep this
// in sync if it ever changes.
export const API_LOG_PORT_NAME = 'api-log';
