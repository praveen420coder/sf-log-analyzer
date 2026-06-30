// Component detection: walk the page DOM (including shadow roots) for custom
// LWC elements, then reconcile them against the org's real LightningComponentBundle
// list so we only surface components we can actually open. Read-only; no writes.

export interface BundleInfo {
  id: string;
  developerName: string;       // as stored, e.g. "myComponent"
  namespace: string | null;    // NamespacePrefix; null = org's own (default "c")
  masterLabel?: string;
}

export interface DetectedComponent {
  tag: string;                 // rendered tag, e.g. "c-my-component"
  developerName: string;       // resolved bundle DeveloperName
  namespace: string | null;
  bundleId: string;
  masterLabel?: string;
  editable: boolean;           // true when org-owned (namespace null)
  elements: Element[];         // live instances on the page
}

// Platform / framework namespaces that are never editable org components.
const SKIP_NS = new Set([
  'lightning', 'force', 'forcegenerated', 'lightningsnapin', 'aura', 'one',
  'flowruntime', 'interop', 'flexipage', 'analytics', 'wave', 'omnistudio',
  'slds', 'webruntime', 'lwr', 'instrumentation', 'builder', 'clients',
  'runtime', 'ui', 'forcechatter', 'forcecommunity', 'forcegenerated',
  'lightningcomponentdemo', 'lwc',
]);

/**
 * Whether an element is actually rendered right now. Salesforce's Lightning SPA
 * keeps previously-visited pages in the DOM (display:none / hidden containers)
 * for fast back-navigation, so a plain DOM scan would otherwise count stale
 * components from earlier pages. checkVisibility() accounts for display:none,
 * visibility, and content-visibility on the element and its ancestors.
 */
export function isElementVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const anyEl = el as any;
  if (typeof anyEl.checkVisibility === 'function') {
    return anyEl.checkVisibility({ checkVisibilityCSS: true });
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/** "c-my-component" → { ns: "c", name: "myComponent" }. First segment is the namespace. */
export function tagToName(tag: string): { ns: string; name: string } | null {
  const t = tag.toLowerCase();
  if (!t.includes('-')) return null;
  const idx = t.indexOf('-');
  const ns = t.slice(0, idx);
  const rest = t.slice(idx + 1);
  if (!rest) return null;
  // kebab → camelCase for the component name portion
  const name = rest.replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase());
  return { ns, name };
}

/** Recursively collect custom elements, descending into (synthetic & open) shadow roots. */
function collectCustomElements(root: Document | ShadowRoot | Element, out: Map<string, Element[]>, seen: Set<Element>, depth = 0): void {
  if (depth > 200) return; // guard against pathological trees
  const els = (root as Element).querySelectorAll ? (root as Element).querySelectorAll('*') : [];
  els.forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const tag = el.localName;
    if (tag && tag.includes('-')) {
      const list = out.get(tag) || [];
      list.push(el);
      out.set(tag, list);
    }
    const sr = (el as any).shadowRoot as ShadowRoot | null;
    if (sr) collectCustomElements(sr, out, seen, depth + 1);
  });
}

/** All distinct custom-element tags currently rendered, with their live instances. */
export function scanCustomElements(): Map<string, Element[]> {
  const out = new Map<string, Element[]>();
  collectCustomElements(document, out, new Set<Element>());
  return out;
}

/**
 * Reconcile rendered tags against the org's bundle list. Only tags that map to a
 * real bundle are returned (keeps base/Aura/managed noise out). `editable` marks
 * org-owned (default-namespace) components; managed packages come back view-only.
 */
export function resolveComponents(tags: Map<string, Element[]>, bundles: BundleInfo[]): DetectedComponent[] {
  // index bundles by lowercased "ns|name" and by name for default namespace
  const byKey = new Map<string, BundleInfo>();
  bundles.forEach((b) => {
    const ns = (b.namespace || 'c').toLowerCase();
    byKey.set(`${ns}|${b.developerName.toLowerCase()}`, b);
  });

  const result: DetectedComponent[] = [];
  tags.forEach((elements, tag) => {
    const parsed = tagToName(tag);
    if (!parsed) return;
    if (SKIP_NS.has(parsed.ns)) return;
    const b = byKey.get(`${parsed.ns}|${parsed.name.toLowerCase()}`);
    if (!b) return; // not a known org bundle → skip
    // Drop instances cached/hidden by Lightning navigation; skip the component
    // entirely if none of its instances are currently visible.
    const visible = elements.filter(isElementVisible);
    if (visible.length === 0) return;
    result.push({
      tag,
      developerName: b.developerName,
      namespace: b.namespace,
      bundleId: b.id,
      masterLabel: b.masterLabel,
      editable: b.namespace == null,
      elements: visible,
    });
  });
  result.sort((a, b) => a.developerName.localeCompare(b.developerName));
  return result;
}
