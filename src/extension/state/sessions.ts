// Visited Salesforce orgs, used by the footer session switcher. We persist ONLY
// non-secret identifiers (host, instance URL, display label, user). Session
// tokens (sid) are NEVER stored — they're read live from cookies at use time
// via getSfCredentials, which honors the active host override.

export interface VisitedOrg {
  host: string;        // cookie host, e.g. mycompany.my.salesforce.com
  instanceUrl: string; // https://mycompany.my.salesforce.com
  label: string;       // org name / instance / My Domain
  user?: string;       // logged-in user display (secondary line)
  ts: number;          // last seen
}

const KEY = 'sf_spotlight_sessions';
const MAX = 20;

let orgs: VisitedOrg[] = [];

const hasChromeStorage = () => !!(globalThis as any).chrome?.storage?.local;

export function getVisitedOrgs(): VisitedOrg[] { return orgs; }

function persist(): void {
  if (hasChromeStorage()) (globalThis as any).chrome.storage.local.set({ [KEY]: orgs });
  else try { localStorage.setItem(KEY, JSON.stringify(orgs)); } catch { /* ignore */ }
}

export function loadVisitedOrgs(cb?: () => void): void {
  if (hasChromeStorage()) {
    (globalThis as any).chrome.storage.local.get([KEY], (res: any) => {
      orgs = Array.isArray(res?.[KEY]) ? res[KEY] : [];
      cb?.();
    });
  } else {
    try { orgs = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { orgs = []; }
    cb?.();
  }
}

/** Record/refresh an org we've seen. De-duped by host. */
export function recordVisitedOrg(entry: Omit<VisitedOrg, 'ts'>): void {
  if (!entry.host || !entry.instanceUrl) return;
  orgs = orgs.filter((o) => o.host !== entry.host);
  orgs.unshift({ ...entry, ts: Date.now() });
  if (orgs.length > MAX) orgs.length = MAX;
  persist();
}

export function removeVisitedOrg(host: string): void {
  orgs = orgs.filter((o) => o.host !== host);
  persist();
}
