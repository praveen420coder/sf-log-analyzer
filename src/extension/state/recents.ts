// Persisted Recent destinations + Pinned favorites for Spotlight.
// State is private; readers use getRecents() / getFavorites() (live arrays).

export interface RecentItem {
  kind: string;        // setup | object | user | security | flow
  icon: string;
  title: string;
  subtitle?: string;
  meta?: string;
  url: string;         // where to (re)open it
  ts: number;          // last-opened timestamp
}

const RECENTS_KEY = 'sf_spotlight_recents';
let MAX_RECENTS = 15;            // configurable via Settings → History
const FAVORITES_KEY = 'sf_spotlight_favorites';
const MAX_FAVORITES = 50;

let recentItems: RecentItem[] = [];
let favoriteItems: RecentItem[] = [];
let recentsEnabled = true;      // Settings → History → History retention

// ── History settings (driven by the Settings screen) ────────────────────────
export function setRecentsEnabled(on: boolean): void { recentsEnabled = on; }
export function setRecentsLimit(n: number): void {
  MAX_RECENTS = Math.max(1, n | 0);
  if (recentItems.length > MAX_RECENTS) { recentItems.length = MAX_RECENTS; saveRecents(); }
}
// Drop recents older than `days` (0 = disabled).
export function pruneRecentsOlderThan(days: number): void {
  if (!days || days <= 0) return;
  const cutoff = Date.now() - days * 86400000;
  const next = recentItems.filter((r) => (r.ts || 0) >= cutoff);
  if (next.length !== recentItems.length) { recentItems = next; saveRecents(); }
}

const hasChromeStorage = () => !!(globalThis as any).chrome?.storage?.local;

export function getRecents(): RecentItem[] { return recentItems; }
export function getFavorites(): RecentItem[] { return favoriteItems; }

function saveRecents(): void {
  if (hasChromeStorage()) (globalThis as any).chrome.storage.local.set({ [RECENTS_KEY]: recentItems });
  else try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recentItems)); } catch { /* ignore */ }
}
function saveFavorites(): void {
  if (hasChromeStorage()) (globalThis as any).chrome.storage.local.set({ [FAVORITES_KEY]: favoriteItems });
  else try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteItems)); } catch { /* ignore */ }
}

// Load both lists from storage. Call once at startup.
export function loadRecentsAndFavorites(): void {
  if (hasChromeStorage()) {
    (globalThis as any).chrome.storage.local.get([RECENTS_KEY, FAVORITES_KEY], (res: any) => {
      recentItems = Array.isArray(res?.[RECENTS_KEY]) ? res[RECENTS_KEY] : [];
      favoriteItems = Array.isArray(res?.[FAVORITES_KEY]) ? res[FAVORITES_KEY] : [];
    });
  } else {
    try { recentItems = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { recentItems = []; }
    try { favoriteItems = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { favoriteItems = []; }
  }
}

// Push an item to the top of the recents list, de-duping by url + kind.
export function recordRecent(entry: Omit<RecentItem, 'ts'>): void {
  if (!entry.url || !recentsEnabled) return;
  recentItems = recentItems.filter((r) => !(r.url === entry.url && r.kind === entry.kind));
  recentItems.unshift({ ...entry, ts: Date.now() });
  if (recentItems.length > MAX_RECENTS) recentItems.length = MAX_RECENTS;
  saveRecents();
}

export function clearRecents(): void {
  recentItems = [];
  saveRecents();
}

export function isFavorite(url: string, kind: string): boolean {
  return favoriteItems.some((f) => f.url === url && f.kind === kind);
}

// Returns the new state (true = now pinned).
export function toggleFavorite(entry: Omit<RecentItem, 'ts'>): boolean {
  if (!entry.url) return false;
  if (isFavorite(entry.url, entry.kind)) {
    favoriteItems = favoriteItems.filter((f) => !(f.url === entry.url && f.kind === entry.kind));
    saveFavorites();
    return false;
  }
  favoriteItems.unshift({ ...entry, ts: Date.now() });
  if (favoriteItems.length > MAX_FAVORITES) favoriteItems.length = MAX_FAVORITES;
  saveFavorites();
  return true;
}
