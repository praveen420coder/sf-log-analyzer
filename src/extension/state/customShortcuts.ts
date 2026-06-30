// Persisted user-defined Setup shortcuts. Each is a label + URL the user adds;
// matching shortcuts surface in the Spotlight "Setup" search alongside the
// built-in links. State is private; readers use getCustomShortcuts() (live array).

export interface CustomShortcut {
  id: string;
  label: string;
  url: string;   // absolute (https://…) or a relative Setup path (/lightning/…)
  ts: number;    // created/updated timestamp
}

const KEY = 'sf_spotlight_custom_shortcuts';
const MAX = 200;

let items: CustomShortcut[] = [];

const hasChromeStorage = () => !!(globalThis as any).chrome?.storage?.local;

export function getCustomShortcuts(): CustomShortcut[] { return items; }

function persist(): void {
  if (hasChromeStorage()) (globalThis as any).chrome.storage.local.set({ [KEY]: items });
  else try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

/** Load from storage. Call once at startup. */
export function loadCustomShortcuts(cb?: () => void): void {
  if (hasChromeStorage()) {
    (globalThis as any).chrome.storage.local.get([KEY], (res: any) => {
      items = Array.isArray(res?.[KEY]) ? res[KEY] : [];
      cb?.();
    });
  } else {
    try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { items = []; }
    cb?.();
  }
}

const genId = () => {
  try { return (globalThis as any).crypto?.randomUUID?.() || ''; } catch { /* ignore */ }
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

/** Normalize a user-entered link: trim; relative paths get a leading slash. */
export function normalizeUrl(raw: string): string {
  let u = (raw || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (!u.startsWith('/')) u = '/' + u;
  return u;
}

/** Add a shortcut. Returns the created item, or null if label/url missing. */
export function addCustomShortcut(label: string, url: string): CustomShortcut | null {
  label = (label || '').trim();
  url = normalizeUrl(url);
  if (!label || !url) return null;
  const item: CustomShortcut = { id: genId(), label, url, ts: Date.now() };
  items.unshift(item);
  if (items.length > MAX) items.length = MAX;
  persist();
  return item;
}

export function updateCustomShortcut(id: string, label: string, url: string): boolean {
  const it = items.find((i) => i.id === id);
  if (!it) return false;
  label = (label || '').trim();
  url = normalizeUrl(url);
  if (!label || !url) return false;
  it.label = label; it.url = url; it.ts = Date.now();
  persist();
  return true;
}

export function deleteCustomShortcut(id: string): void {
  items = items.filter((i) => i.id !== id);
  persist();
}
