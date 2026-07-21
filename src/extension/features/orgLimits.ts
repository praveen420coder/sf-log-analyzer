import { getTheme } from '../lib/theme';
// Org Limits: a full, searchable view of every limit the Salesforce
// /limits REST endpoint returns (Max / Remaining per limit). The Tools drawer
// already ships curated subsets (API Usage, Storage Insights); this surfaces
// the complete set so developers can spot anything approaching its ceiling.
//
// Backend-agnostic: all data arrives through the injected `fetchLimits`
// (GET_ORG_LIMITS), so this module never touches chrome.* or credentials
// directly — see [[file-structure-convention]].

export interface OrgLimitRaw { Max: number; Remaining: number }

export interface OrgLimitsDeps {
  isDark: boolean;
  onBack: () => void;
  fetchLimits: () => Promise<{ data?: Record<string, OrgLimitRaw>; error?: string }>;
  flashToast?: (msg: string) => void;
}

type SortMode = 'usage' | 'name';

// Friendly labels for the common limit keys. Anything not listed falls back to
// a humanized version of the API key (e.g. "DailyApiRequests" → "Daily Api Requests").
const LABELS: Record<string, string> = {
  ActiveScratchOrgs: 'Active scratch orgs',
  AnalyticsExternalDataSizeMB: 'Analytics external data',
  ConcurrentAsyncGetReportInstances: 'Concurrent async report instances',
  ConcurrentEinsteinDataInsightsStoryCreation: 'Concurrent Einstein story creation',
  ConcurrentEinsteinDiscoveryStoryCreation: 'Concurrent Einstein Discovery stories',
  ConcurrentSyncReportRuns: 'Concurrent sync report runs',
  DailyAnalyticsDataflowJobExecutions: 'Analytics dataflow jobs (daily)',
  DailyAnalyticsUploadedFilesSizeMB: 'Analytics uploaded files (daily)',
  DailyApiRequests: 'REST / SOAP API requests (daily)',
  DailyAsyncApexExecutions: 'Async Apex executions (daily)',
  DailyAsyncApexTests: 'Async Apex tests (daily)',
  DailyBulkApiBatches: 'Bulk API batches (daily)',
  DailyBulkV2QueryFileStorageMB: 'Bulk API v2 query file storage (daily)',
  DailyBulkV2QueryJobs: 'Bulk API v2 query jobs (daily)',
  DailyDeliveredPlatformEvents: 'Delivered platform events (daily)',
  DailyDurableGenericStreamingApiEvents: 'Durable generic streaming events (daily)',
  DailyDurableStreamingApiEvents: 'Durable streaming events (daily)',
  DailyEinsteinDataInsightsStoryCreation: 'Einstein Data Insights stories (daily)',
  DailyEinsteinDiscoveryPredictAPICalls: 'Einstein Discovery predict API calls (daily)',
  DailyEinsteinDiscoveryPredictionsByCDC: 'Einstein Discovery predictions by CDC (daily)',
  DailyEinsteinDiscoveryStoryCreation: 'Einstein Discovery stories (daily)',
  DailyFunctionsApiCallLimit: 'Functions API calls (daily)',
  DailyGenericStreamingApiEvents: 'Generic streaming events (daily)',
  DailyScratchOrgs: 'Scratch orgs (daily)',
  DailyStandardVolumePlatformEvents: 'Standard-volume platform events (daily)',
  DailyStreamingApiEvents: 'Streaming API events (daily)',
  DailyWorkflowEmails: 'Workflow emails (daily)',
  DataStorageMB: 'Data storage',
  DurableStreamingApiConcurrentClients: 'Durable streaming concurrent clients',
  FileStorageMB: 'File storage',
  HourlyAsyncReportRuns: 'Async report runs (hourly)',
  HourlyDashboardRefreshes: 'Dashboard refreshes (hourly)',
  HourlyDashboardResults: 'Dashboard results (hourly)',
  HourlyDashboardStatuses: 'Dashboard statuses (hourly)',
  HourlyLongTermIdMapping: 'Long-term ID mapping (hourly)',
  HourlyManagedContentPublicRequests: 'Managed content public requests (hourly)',
  HourlyODataCallout: 'OData callouts (hourly)',
  HourlyPublishedPlatformEvents: 'Published platform events (hourly)',
  HourlyPublishedStandardVolumePlatformEvents: 'Published standard-volume events (hourly)',
  HourlyShortTermIdMapping: 'Short-term ID mapping (hourly)',
  HourlySyncReportRuns: 'Sync report runs (hourly)',
  HourlyTimeBasedWorkflow: 'Time-based workflow (hourly)',
  MassEmail: 'Mass email (daily)',
  MonthlyPlatformEventsUsageEntitlement: 'Platform events (monthly)',
  Package2VersionCreates: 'Package2 version creates',
  Package2VersionCreatesWithoutValidation: 'Package2 version creates (no validation)',
  PermissionSets: 'Permission sets',
  PrivateConnectOutboundCalloutHourlyLimitMB: 'Private Connect outbound callouts (hourly)',
  SingleEmail: 'Single email (daily)',
  StreamingApiConcurrentClients: 'Streaming API concurrent clients',
};

function humanize(key: string): string {
  return key
    .replace(/MB$/, ' (MB)')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStorageKey(key: string): boolean {
  return /(Storage)?MB$/.test(key) || /SizeMB$/.test(key);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

export function renderOrgLimitsExplorerInto(host: HTMLElement, deps: OrgLimitsDeps): void {
  const isDark = deps.isDark;
  const C = getTheme(isDark);

  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  // header
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 24px 12px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontFamily: 'inherit', fontSize: '13px', fontWeight: '700' });
  back.innerHTML = '<span style="font-size:15px">←</span> Tools';
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  head.appendChild(el('span', { color: C.faint }, '/'));
  head.appendChild(el('div', { fontSize: '15px', fontWeight: '800', color: C.text }, '📈 Org Limits'));
  const reload = el('button', { marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', color: C.muted, fontFamily: 'inherit', fontSize: '12px', fontWeight: '700' }, '↻ Reload');
  head.appendChild(reload);
  root.appendChild(head);

  // controls: search + sort segment + near-limit toggle
  const ctrl = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 24px', flexWrap: 'wrap', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(ctrl);

  const search = el('input', { flex: '1', minWidth: '180px', maxWidth: '320px', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit' }) as HTMLInputElement;
  search.placeholder = 'Filter limits…';
  ctrl.appendChild(search);

  let sort: SortMode = 'usage';
  const seg = el('div', { display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' });
  const segBtns: Record<SortMode, HTMLButtonElement> = {} as any;
  (['usage', 'name'] as SortMode[]).forEach((m) => {
    const b = el('button', { background: 'transparent', border: 'none', padding: '6px 14px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit', color: C.muted }, m === 'usage' ? 'Most used' : 'A–Z');
    b.addEventListener('click', () => { sort = m; paintSeg(); render(); });
    segBtns[m] = b; seg.appendChild(b);
  });
  const paintSeg = () => (Object.keys(segBtns) as SortMode[]).forEach((m) => Object.assign(segBtns[m].style, { background: sort === m ? C.accent : 'transparent', color: sort === m ? '#fff' : C.muted, fontWeight: sort === m ? '700' : '500' }));
  ctrl.appendChild(seg);

  let nearOnly = false;
  const nearBtn = el('button', { display: 'inline-flex', alignItems: 'center', gap: '6px', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit', background: 'transparent', color: C.muted, fontWeight: '600' }, '⚠ Near limit (>50%)');
  nearBtn.addEventListener('click', () => { nearOnly = !nearOnly; Object.assign(nearBtn.style, { background: nearOnly ? '#f59e0b' : 'transparent', color: nearOnly ? '#1f2937' : C.muted, fontWeight: nearOnly ? '700' : '600', borderColor: nearOnly ? '#f59e0b' : C.border }); render(); });
  ctrl.appendChild(nearBtn);

  // count
  const count = el('div', { fontSize: '11.5px', color: C.faint, fontWeight: '600' });
  ctrl.appendChild(count);

  // body
  const body = el('div', { flex: '1', minHeight: '0', overflowY: 'auto', padding: '12px 28px 24px' });
  root.appendChild(body);

  interface Row { key: string; label: string; max: number; used: number; remaining: number; pct: number; storage: boolean }
  let rows: Row[] = [];

  const msg = (t: string) => { body.innerHTML = ''; body.appendChild(el('div', { padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: '14px', fontWeight: '600' }, t)); };

  const fmt = (v: number, storage: boolean) => {
    if (storage) return v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${Math.round(v)} MB`;
    return Math.round(v).toLocaleString();
  };

  function render(): void {
    const q = search.value.trim().toLowerCase();
    let view = rows.filter((r) => !q || r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q));
    if (nearOnly) view = view.filter((r) => r.pct > 50);
    view = view.slice().sort((a, b) => (sort === 'name' ? a.label.localeCompare(b.label) : b.pct - a.pct || b.used - a.used));

    count.textContent = `${view.length} / ${rows.length} limits`;
    body.innerHTML = '';
    if (rows.length === 0) { msg('No matching limits returned for this org.'); return; }
    if (view.length === 0) { msg('No limits match your filter.'); return; }

    view.forEach((r, i) => {
      const color = r.pct > 80 ? '#ef4444' : r.pct > 50 ? '#f59e0b' : '#16a34a';
      const row = el('div', { padding: '12px 12px', marginBottom: '4px', borderRadius: '8px', background: i % 2 ? C.zebra : 'transparent' });

      const top = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', marginBottom: '6px' });
      top.appendChild(el('span', { fontSize: '13px', fontWeight: '700', color: C.text }, r.label));
      top.appendChild(el('span', { fontSize: '12px', color: C.muted, fontWeight: '600', whiteSpace: 'nowrap' }, `${fmt(r.used, r.storage)} / ${fmt(r.max, r.storage)}`));
      row.appendChild(top);

      const trackEl = el('div', { height: '8px', borderRadius: '999px', background: C.track, overflow: 'hidden' });
      trackEl.appendChild(el('div', { height: '100%', width: `${r.pct}%`, background: color, borderRadius: '999px', transition: 'width 0.3s' }));
      row.appendChild(trackEl);

      row.appendChild(el('div', { fontSize: '11px', color: C.faint, marginTop: '4px' }, `${r.pct.toFixed(0)}% used · ${fmt(r.remaining, r.storage)} remaining · ${r.key}`));
      body.appendChild(row);
    });
  }

  function load(): void {
    msg('Loading…');
    rows = [];
    deps.fetchLimits().then((resp) => {
      if (resp.error || !resp.data) { msg(resp.error || 'Could not load limits.'); return; }
      rows = Object.entries(resp.data)
        .filter(([, v]) => v && typeof v.Max === 'number')
        .map(([key, v]) => {
          const max = v.Max || 0;
          const remaining = typeof v.Remaining === 'number' ? v.Remaining : max;
          const used = Math.max(0, max - remaining);
          const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
          return { key, label: LABELS[key] || humanize(key), max, used, remaining, pct, storage: isStorageKey(key) };
        });
      render();
    });
  }

  search.addEventListener('input', render);
  reload.addEventListener('click', () => { deps.flashToast?.('Refreshing org limits…'); load(); });

  paintSeg();
  load();
}
