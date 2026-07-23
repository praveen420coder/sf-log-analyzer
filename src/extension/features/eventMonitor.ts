// Event Monitor — subscribe to a streaming channel (Platform Events, Change Data
// Capture, PushTopics, generic channels) and watch messages arrive live, modeled
// on Salesforce Inspector Reloaded's Event Monitor. The CometD/Bayeux plumbing
// runs in the background over a Port (see background.ts); this file is the UI.

import { getTheme } from '../lib/theme';
import { highlightJson } from '../lib/jsonHighlight';

export interface EventStream {
  post: (msg: Record<string, unknown>) => void;
  close: () => void;
}

export interface EventMonitorDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (m: string) => void;
  // Standard SOQL for the channel pickers.
  runQuery: (soql: string) => Promise<{ records: any[]; error?: string }>;
  // Global describe filtered to platform events (name, label, custom flag).
  describeEvents: () => Promise<{ data?: { name: string; label: string; custom: boolean }[]; error?: string }>;
  // Live org credentials for the streaming subscription.
  getCreds: () => Promise<{ instanceUrl?: string; sessionId?: string; error?: string }>;
  // Open a background streaming port; messages arrive via onMessage.
  openStream: (onMessage: (m: any) => void) => EventStream;
}

interface StreamEvent { ts: number; channel: string; replayId?: number; data: any }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

const CHANNEL_TYPES: { id: string; label: string; prefix: string }[] = [
  { id: 'platform-standard', label: 'Standard Platform Event', prefix: '/event/' },
  { id: 'platform-custom', label: 'Custom Platform Event', prefix: '/event/' },
  { id: 'cdc', label: 'Change Data Capture', prefix: '/data/' },
  { id: 'pushtopic', label: 'PushTopic', prefix: '/topic/' },
  { id: 'generic', label: 'Generic Streaming Channel', prefix: '' },
];

export function renderEventMonitorInto(host: HTMLElement, deps: EventMonitorDeps): void {
  const C = getTheme(deps.isDark);

  let stream: EventStream | null = null;
  let subscribed = false;
  let events: StreamEvent[] = [];
  let filterText = '';

  host.innerHTML = '';
  const root = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', background: C.bg, color: C.text });
  host.appendChild(root);

  // ── header ─────────────────────────────────────────────────────────────────
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '← Tools');
  back.addEventListener('click', () => { teardown(); deps.onBack(); });
  head.appendChild(back);
  const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
  titleWrap.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '📡 Event Monitor'));
  titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, 'Subscribe to a streaming channel and watch events live'));
  head.appendChild(titleWrap);
  const statusChip = el('div', { marginLeft: 'auto', fontSize: '12px', fontWeight: '700', color: C.muted });
  head.appendChild(statusChip);
  root.appendChild(head);

  // ── subscribe card ───────────────────────────────────────────────────────────
  const bar = el('div', { display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', padding: '16px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const field = (label: string, w: string): { wrap: HTMLElement } => {
    const wrap = el('div', { display: 'flex', flexDirection: 'column', gap: '5px', flex: w });
    wrap.appendChild(el('div', { fontSize: '11.5px', fontWeight: '700', color: C.muted }, label));
    return { wrap };
  };
  const inputStyle: Partial<CSSStyleDeclaration> = { boxSizing: 'border-box', padding: '9px 11px', fontSize: '13px', borderRadius: '9px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', outline: 'none', width: '100%' };

  const chWrap = field('Channel', '2 1 220px');
  const channelInput = el('input', inputStyle) as HTMLInputElement;
  channelInput.placeholder = '/event/My_Event__e';
  chWrap.wrap.appendChild(channelInput);

  const typeWrap = field('Channel Type', '1 1 170px');
  const typeSel = el('select', { ...inputStyle, cursor: 'pointer' }) as HTMLSelectElement;
  CHANNEL_TYPES.forEach((t) => { const o = el('option', undefined, t.label); o.value = t.id; typeSel.appendChild(o); });
  typeWrap.wrap.appendChild(typeSel);

  const listWrap = field('Channel', '2 1 220px');
  const listSel = el('select', { ...inputStyle, cursor: 'pointer' }) as HTMLSelectElement;
  listWrap.wrap.appendChild(listSel);

  const replayWrap = field('Replay From', '0 1 110px');
  const replayInput = el('input', inputStyle) as HTMLInputElement;
  replayInput.value = '-1'; replayInput.title = '-1 = new events only · -2 = all retained · or a specific replay id';
  replayWrap.wrap.appendChild(replayInput);

  const subBtn = el('button', { background: C.accent, border: 'none', color: '#fff', borderRadius: '9px', padding: '10px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, 'Subscribe');
  const unsubBtn = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '9px', padding: '10px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, 'Unsubscribe');

  bar.append(chWrap.wrap, typeWrap.wrap, listWrap.wrap, replayWrap.wrap, subBtn, unsubBtn);
  root.appendChild(bar);

  // ── event result toolbar ─────────────────────────────────────────────────────
  const toolbar = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  toolbar.appendChild(el('div', { fontSize: '13.5px', fontWeight: '800' }, 'Event Result'));
  const copyBtn = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: 'inherit' }, '⧉ Copy');
  toolbar.appendChild(copyBtn);
  const filterInput = el('input', { flex: '1', maxWidth: '360px', boxSizing: 'border-box', padding: '7px 11px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
  filterInput.placeholder = 'Filter events…';
  filterInput.addEventListener('input', () => { filterText = filterInput.value.trim().toLowerCase(); renderEvents(); });
  toolbar.appendChild(filterInput);
  const countEl = el('div', { marginLeft: 'auto', fontSize: '12.5px', fontWeight: '700', color: C.muted }, '0 events');
  toolbar.appendChild(countEl);
  const clearBtn = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: 'inherit' }, 'Clear');
  clearBtn.addEventListener('click', () => { events = []; renderEvents(); });
  toolbar.appendChild(clearBtn);
  root.appendChild(toolbar);

  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '10px 24px 24px' });
  root.appendChild(scroll);

  // ── channel picker ────────────────────────────────────────────────────────────
  let eventCache: { name: string; label: string; custom: boolean }[] | null = null;
  async function loadChannels() {
    const type = CHANNEL_TYPES.find((t) => t.id === typeSel.value)!;
    listSel.innerHTML = '';
    listSel.appendChild(Object.assign(el('option', undefined, 'Loading…'), { value: '' }));
    // Platform events (standard + custom) come from the global describe, split by
    // the `custom` flag; other channel types come from SOQL.
    let items: { channel: string; label: string }[] = [];
    let error: string | undefined;
    if (type.id === 'platform-standard' || type.id === 'platform-custom') {
      if (!eventCache) { const r = await deps.describeEvents(); if (r.error) error = r.error; eventCache = r.data || []; }
      const wantCustom = type.id === 'platform-custom';
      items = eventCache
        .filter((e) => e.custom === wantCustom)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ channel: `/event/${e.name}`, label: e.label && e.label !== e.name ? `${e.label} (${e.name})` : e.name }));
    } else {
      const soql = type.id === 'cdc' ? "SELECT QualifiedApiName, Label FROM EntityDefinition WHERE QualifiedApiName LIKE '%ChangeEvent' ORDER BY QualifiedApiName LIMIT 500"
        : type.id === 'pushtopic' ? 'SELECT Name FROM PushTopic ORDER BY Name LIMIT 500'
          : 'SELECT Name FROM StreamingChannel ORDER BY Name LIMIT 500';
      const r = await deps.runQuery(soql);
      error = r.error;
      items = (r.records || []).map((rec: any) => {
        const name = rec.QualifiedApiName || rec.Name || '';
        const channel = type.id === 'generic' ? (name.startsWith('/') ? name : `/u/${name}`) : `${type.prefix}${name}`;
        return { channel, label: rec.Label && rec.Label !== name ? `${rec.Label} (${name})` : name };
      }).filter((i: any) => i.channel);
    }
    listSel.innerHTML = '';
    const first = el('option', undefined, error ? `— ${error} —` : items.length ? '— pick a channel —' : '— none found —'); first.value = ''; listSel.appendChild(first);
    items.forEach((i) => { const o = el('option', undefined, i.label); o.value = i.channel; listSel.appendChild(o); });
  }
  typeSel.addEventListener('change', loadChannels);
  listSel.addEventListener('change', () => { if (listSel.value) channelInput.value = listSel.value; });

  // ── subscribe / unsubscribe ────────────────────────────────────────────────────
  function setStatus(text: string, color: string) { statusChip.textContent = text; statusChip.style.color = color; }
  function syncButtons() {
    subBtn.style.display = subscribed ? 'none' : 'inline-block';
    unsubBtn.style.opacity = subscribed ? '1' : '0.5';
    unsubBtn.style.pointerEvents = subscribed ? 'auto' : 'none';
    channelInput.disabled = subscribed; typeSel.disabled = subscribed; listSel.disabled = subscribed; replayInput.disabled = subscribed;
  }

  async function subscribe() {
    const channel = channelInput.value.trim();
    if (!channel) { deps.flashToast('Enter or pick a channel'); return; }
    const replayId = Number(replayInput.value);
    setStatus('Connecting…', C.warn);
    subBtn.style.pointerEvents = 'none'; subBtn.style.opacity = '0.6';
    const creds = await deps.getCreds();
    subBtn.style.pointerEvents = 'auto'; subBtn.style.opacity = '1';
    if (!creds.instanceUrl || !creds.sessionId) { setStatus('No session', C.danger); deps.flashToast(creds.error || 'Salesforce session not detected'); return; }
    if (!stream) stream = deps.openStream(onStreamMessage);
    stream.post({ type: 'subscribe', instanceUrl: creds.instanceUrl, sessionId: creds.sessionId, channel, replayId: Number.isFinite(replayId) ? replayId : -1 });
  }

  function unsubscribe() {
    if (stream) { stream.post({ type: 'unsubscribe' }); stream.close(); stream = null; }
    subscribed = false; setStatus('Not subscribed', C.muted); syncButtons();
  }

  function onStreamMessage(m: any) {
    if (m?.type === 'subscribed') { subscribed = true; setStatus(`● Subscribed · ${m.channel}`, C.success); syncButtons(); deps.flashToast(`Subscribed to ${m.channel}`); }
    else if (m?.type === 'unsubscribed') { subscribed = false; setStatus('Not subscribed', C.muted); syncButtons(); }
    else if (m?.type === 'error') { setStatus('Error', C.danger); deps.flashToast(m.error || 'Streaming error'); subscribed = false; syncButtons(); }
    else if (m?.type === 'event') {
      const replayId = m.data?.event?.replayId;
      events.unshift({ ts: m.ts || Date.now(), channel: m.channel, replayId, data: m.data });
      if (events.length > 500) events.length = 500;
      renderEvents();
    }
  }

  subBtn.addEventListener('click', subscribe);
  unsubBtn.addEventListener('click', unsubscribe);

  // ── event rendering ────────────────────────────────────────────────────────────
  function matches(e: StreamEvent): boolean {
    if (!filterText) return true;
    return JSON.stringify(e.data).toLowerCase().includes(filterText) || e.channel.toLowerCase().includes(filterText);
  }
  function renderEvents() {
    const shown = events.filter(matches);
    countEl.textContent = `${shown.length} event${shown.length === 1 ? '' : 's'}${filterText && shown.length !== events.length ? ` / ${events.length}` : ''}`;
    scroll.innerHTML = '';
    if (!events.length) { scroll.appendChild(el('div', { padding: '40px 6px', textAlign: 'center', fontSize: '13px', color: C.muted }, subscribed ? 'Waiting for events…' : 'Subscribe to a channel to see events here.')); return; }
    if (!shown.length) { scroll.appendChild(el('div', { padding: '40px 6px', textAlign: 'center', fontSize: '13px', color: C.muted }, 'No events match the filter.')); return; }
    shown.forEach((e) => {
      const cardEl = el('div', { border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '10px' });
      const hdr = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: C.headerBg, borderBottom: `1px solid ${C.divider}` });
      hdr.appendChild(el('span', { fontSize: '12px', fontWeight: '700', color: C.text, fontFamily: 'Fira Code, monospace' }, e.channel));
      if (e.replayId != null) hdr.appendChild(el('span', { fontSize: '11px', fontWeight: '700', color: C.accent, background: C.accentSoft, padding: '1px 7px', borderRadius: '999px' }, `replay ${e.replayId}`));
      hdr.appendChild(el('span', { marginLeft: 'auto', fontSize: '11px', color: C.faint }, new Date(e.ts).toLocaleTimeString()));
      cardEl.appendChild(hdr);
      const pre = el('pre', { margin: '0', padding: '10px 12px', fontSize: '12px', lineHeight: '1.5', fontFamily: 'Fira Code, monospace', color: C.text, background: C.code, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '320px', overflow: 'auto' });
      pre.innerHTML = highlightJson(e.data, deps.isDark);
      cardEl.appendChild(pre);
      scroll.appendChild(cardEl);
    });
  }

  copyBtn.addEventListener('click', () => {
    if (!events.length) { deps.flashToast('No events to copy'); return; }
    navigator.clipboard?.writeText(JSON.stringify(events.filter(matches).map((e) => e.data), null, 2)).then(() => deps.flashToast('Copied events'));
  });

  function teardown() { if (stream) { try { stream.post({ type: 'unsubscribe' }); } catch { /* ignore */ } stream.close(); stream = null; } subscribed = false; }

  // init
  setStatus('Not subscribed', C.muted);
  syncButtons();
  renderEvents();
  loadChannels();
}
