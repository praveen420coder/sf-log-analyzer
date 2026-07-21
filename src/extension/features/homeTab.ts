// Home tab — the panel's front door. A dashboard that ties the toolkit together:
// org identity, health at a glance (API + storage + near-limit warnings), the
// current debug-session status, quick actions, and your recent items.
//
// Backend-agnostic via injected deps (sendBg attaches org credentials).

import { getTheme } from '../lib/theme';

export interface HomeRecent { kind: string; icon?: string; title: string; subtitle?: string; meta?: string; url: string }

export interface HomeDeps {
  isDark: boolean;
  sendBg: (msg: Record<string, unknown>) => Promise<any>;
  getRecents: () => HomeRecent[];
  openUrl: (url: string) => void;
  goToTab: (tabId: string) => void;
  openTool: (toolId: string) => void;
  flashToast: (m: string) => void;
  lightningOrigin: () => string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

const pctColor = (p: number) => (p >= 80 ? '#ef4444' : p >= 50 ? '#f59e0b' : '#16a34a');
const fmtStorage = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`);

export function renderHomeInto(host: HTMLElement, deps: HomeDeps): void {
  const isDark = deps.isDark;
  const C = getTheme(isDark);

  host.innerHTML = '';
  const root = el('div', { padding: '20px 28px 32px', overflow: 'auto', height: '100%', minHeight: '0', boxSizing: 'border-box' });
  host.appendChild(root);

  const card = (): HTMLElement => el('div', { background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px 18px' });
  const sectionTitle = (t: string) => el('div', { fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em', color: C.faint, margin: '18px 2px 10px' }, t);

  // ── org header ──
  const header = card();
  Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '14px' });
  const avatar = el('div', { width: '46px', height: '46px', borderRadius: '12px', background: 'linear-gradient(135deg,#4f8cff,#2563eb)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '800', flexShrink: '0' }, '⚡');
  const hText = el('div', { minWidth: '0', flex: '1' });
  const orgName = el('div', { fontSize: '17px', fontWeight: '800', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, 'Loading org…');
  const orgSub = el('div', { fontSize: '12.5px', color: C.muted, marginTop: '2px' }, '');
  hText.appendChild(orgName); hText.appendChild(orgSub);
  const envBadge = el('span', { fontSize: '11px', fontWeight: '800', padding: '4px 10px', borderRadius: '999px', flexShrink: '0', display: 'none' });
  header.appendChild(avatar); header.appendChild(hText); header.appendChild(envBadge);
  root.appendChild(header);

  // ── health ──
  root.appendChild(sectionTitle('Org health'));
  const health = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' });
  root.appendChild(health);
  const healthMsg = el('div', { fontSize: '12.5px', color: C.muted, padding: '6px 2px' }, 'Loading limits…');
  health.appendChild(healthMsg);

  const gauge = (label: string, used: number, max: number, fmt: (n: number) => string) => {
    const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
    const col = pctColor(pct);
    const c = el('div', { background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px 14px' });
    const top = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' });
    top.appendChild(el('span', { fontSize: '12px', fontWeight: '700', color: C.muted }, label));
    top.appendChild(el('span', { fontSize: '12px', fontWeight: '800', color: col }, `${pct}%`));
    c.appendChild(top);
    const track = el('div', { height: '7px', borderRadius: '999px', background: C.track, overflow: 'hidden' });
    track.appendChild(el('div', { width: `${pct}%`, height: '7px', background: col, borderRadius: '999px' }));
    c.appendChild(track);
    c.appendChild(el('div', { fontSize: '11.5px', color: C.faint, marginTop: '7px' }, `${fmt(used)} / ${fmt(max)}`));
    return c;
  };

  // ── debug status ──
  root.appendChild(sectionTitle('Debug logging'));
  const debugCard = card();
  Object.assign(debugCard.style, { display: 'flex', alignItems: 'center', gap: '12px' });
  const debugDot = el('span', { width: '10px', height: '10px', borderRadius: '50%', background: C.faint, flexShrink: '0' });
  const debugText = el('div', { flex: '1', fontSize: '13px', fontWeight: '600', color: C.muted }, 'Checking…');
  const debugBtn = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '7px 13px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '700', fontFamily: 'inherit' }, 'Log Explorer →');
  debugBtn.addEventListener('click', () => deps.goToTab('debug'));
  debugCard.appendChild(debugDot); debugCard.appendChild(debugText); debugCard.appendChild(debugBtn);
  root.appendChild(debugCard);

  // ── quick actions ──
  root.appendChild(sectionTitle('Quick actions'));
  const actions = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '10px' });
  root.appendChild(actions);
  const action = (icon: string, label: string, run: () => void) => {
    const b = el('button', { display: 'flex', alignItems: 'center', gap: '9px', padding: '13px 14px', background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit', color: C.text, textAlign: 'left' });
    b.appendChild(el('span', { fontSize: '18px', flexShrink: '0' }, icon));
    b.appendChild(el('span', { fontSize: '13px', fontWeight: '700' }, label));
    b.addEventListener('mouseover', () => { b.style.background = C.hover; });
    b.addEventListener('mouseout', () => { b.style.background = C.card; });
    b.addEventListener('click', run);
    actions.appendChild(b);
  };
  action('🐞', 'Fetch logs', () => deps.goToTab('debug'));
  action('🧪', 'Sample data', () => deps.openTool('sampledata'));
  action('⚡', 'Run Apex', () => deps.openTool('executeanonymous'));
  action('📈', 'Org limits', () => deps.openTool('orglimits'));
  action('🧭', 'Automation map', () => deps.openTool('automationmap'));
  action('🛠️', 'All tools', () => deps.goToTab('tools'));

  // ── recents ──
  root.appendChild(sectionTitle('Recent'));
  const recentsWrap = el('div', { border: `1px solid ${C.border}`, borderRadius: '14px', overflow: 'hidden' });
  root.appendChild(recentsWrap);
  const recents = deps.getRecents().slice(0, 6);
  if (!recents.length) {
    recentsWrap.appendChild(el('div', { padding: '18px', fontSize: '12.5px', color: C.muted, textAlign: 'center' }, 'Nothing yet — records and tools you open will show up here.'));
  } else {
    recents.forEach((r, i) => {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '11px', padding: '11px 15px', cursor: 'pointer', borderTop: i === 0 ? 'none' : `1px solid ${C.border}` });
      row.appendChild(el('span', { fontSize: '16px', flexShrink: '0' }, r.icon || '🔗'));
      const t = el('div', { minWidth: '0', flex: '1' });
      t.appendChild(el('div', { fontSize: '13px', fontWeight: '600', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, r.title));
      if (r.subtitle) t.appendChild(el('div', { fontSize: '11.5px', color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, r.subtitle));
      row.appendChild(t);
      if (r.meta) row.appendChild(el('span', { fontSize: '10.5px', fontWeight: '700', color: C.faint, flexShrink: '0' }, r.meta));
      row.addEventListener('mouseover', () => { row.style.background = C.hover; });
      row.addEventListener('mouseout', () => { row.style.background = ''; });
      row.addEventListener('click', () => deps.openUrl(r.url));
      recentsWrap.appendChild(row);
    });
  }

  // ── data loads ──
  deps.sendBg({ type: 'GET_ORG_INFO' }).then((r) => {
    if (!r?.success || !r.data) { orgName.textContent = 'Salesforce org'; return; }
    const o = r.data;
    orgName.textContent = o.Name || 'Salesforce org';
    orgSub.textContent = [o.OrganizationType, o.InstanceName].filter(Boolean).join(' · ');
    const isProd = o.IsSandbox === false && !o.TrialExpirationDate;
    const label = o.IsSandbox ? 'Sandbox' : (o.TrialExpirationDate ? 'Scratch / Trial' : 'Production');
    envBadge.textContent = label;
    envBadge.style.display = 'inline-block';
    envBadge.style.background = isProd ? 'rgba(239,68,68,0.14)' : 'rgba(22,163,74,0.14)';
    envBadge.style.color = isProd ? '#ef4444' : '#16a34a';
  });

  // User → greeting + debug status (needs userId).
  deps.sendBg({ type: 'FETCH_USER_INFO' }).then((r) => {
    const user = r?.success ? r.data : null;
    const name = user?.displayName || user?.name || user?.username;
    if (name) avatar.textContent = String(name).trim().charAt(0).toUpperCase();
    const userId = user?.id || user?.userId;
    if (!userId) { debugText.textContent = 'Sign-in not detected'; return; }
    deps.sendBg({ type: 'CHECK_DEBUG_SESSION', userId }).then((d) => {
      const active = d?.success ? d.data : null;
      if (active?.ExpirationDate) {
        const mins = Math.max(0, Math.round((new Date(active.ExpirationDate).getTime() - Date.now()) / 60000));
        debugDot.style.background = '#16a34a';
        debugText.textContent = `Active — about ${mins} min left`;
        debugText.style.color = C.text;
      } else {
        debugText.textContent = 'No active debug session';
      }
    });
  });

  deps.sendBg({ type: 'GET_ORG_LIMITS' }).then((r) => {
    if (!r?.success || !r.data) { healthMsg.textContent = 'Limits unavailable.'; return; }
    const d = r.data;
    health.innerHTML = '';
    const add = (key: string, label: string, storage = false) => {
      const lim = d[key];
      if (!lim || typeof lim.Max !== 'number') return;
      const used = Math.max(0, lim.Max - (lim.Remaining ?? lim.Max));
      health.appendChild(gauge(label, used, lim.Max, storage ? fmtStorage : (n) => n.toLocaleString()));
    };
    add('DailyApiRequests', 'API requests (today)');
    add('DataStorageMB', 'Data storage', true);
    add('FileStorageMB', 'File storage', true);
    add('DailyAsyncApexExecutions', 'Async Apex (today)');
    if (!health.children.length) health.appendChild(el('div', { fontSize: '12.5px', color: C.muted, padding: '6px 2px' }, 'No limit data for this org.'));
  });
}
