// REST Explorer (Beta) — make arbitrary Salesforce REST API calls and inspect the
// response, modeled on Salesforce Inspector Reloaded's REST Explore. Choose a
// method, an endpoint path, an optional JSON body, and Send.
//
// Non-GET methods modify data — use with care (especially on production).
//
// Mirrors the Data Export toolbar: Templates, History, Clear, Saved queries and
// a labelled Save Query action, each backed by chrome.storage.local.

import { getTheme } from '../lib/theme';
import { highlightJsonText } from '../lib/jsonHighlight';

export interface RestResult { status?: number; statusText?: string; ok?: boolean; body?: string; durationMs?: number; error?: string }

export interface RestExplorerDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (m: string) => void;
  apiVersion?: string;
  sendRest: (method: string, endpoint: string, body?: string) => Promise<RestResult>;
}

interface RestReq { method: string; endpoint: string; body?: string }
interface RestHist extends RestReq { ts: number }
interface RestSaved extends RestReq { name: string }

const HISTORY_KEY = 'sfx_rest_history';
const SAVED_KEY = 'sfx_rest_saved';
const HISTORY_LIMIT = 40;
const SAVED_LIMIT = 100;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

const fmtBytes = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

export function renderRestExplorerInto(host: HTMLElement, deps: RestExplorerDeps): void {
  const isDark = deps.isDark;
  const C = getTheme(isDark);
  const V = deps.apiVersion || 'v60.0';
  const storage = (globalThis as any).chrome?.storage?.local;

  // ── persisted state ──
  let history: RestHist[] = [];
  let saved: RestSaved[] = [];
  storage?.get?.([HISTORY_KEY, SAVED_KEY], (res: any) => {
    history = Array.isArray(res?.[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
    saved = Array.isArray(res?.[SAVED_KEY]) ? res[SAVED_KEY] : [];
  });
  const persistHistory = () => storage?.set?.({ [HISTORY_KEY]: history });
  const persistSaved = () => storage?.set?.({ [SAVED_KEY]: saved });

  // ── built-in templates ──
  const templates: RestSaved[] = [
    { name: 'Org limits', method: 'GET', endpoint: `/services/data/${V}/limits` },
    { name: 'SOQL query', method: 'GET', endpoint: `/services/data/${V}/query/?q=SELECT+Id,Name+FROM+Account+LIMIT+5` },
    { name: 'Describe Account', method: 'GET', endpoint: `/services/data/${V}/sobjects/Account/describe` },
    { name: 'List sObjects', method: 'GET', endpoint: `/services/data/${V}/sobjects/` },
    { name: 'Recent items', method: 'GET', endpoint: `/services/data/${V}/recent/` },
    { name: 'Me (Chatter)', method: 'GET', endpoint: `/services/data/${V}/chatter/users/me` },
    { name: 'API versions', method: 'GET', endpoint: `/services/data/` },
    { name: 'Create Account', method: 'POST', endpoint: `/services/data/${V}/sobjects/Account/`, body: '{\n  "Name": "SF Spotlight Test"\n}' },
  ];

  host.innerHTML = '';
  const root = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', background: C.bg, color: C.text });
  host.appendChild(root);

  // ── header ──
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', rowGap: '8px', flexWrap: 'wrap', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '← Tools');
  back.addEventListener('click', deps.onBack);
  head.appendChild(back);
  const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
  const titleRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  titleRow.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '🧪 REST Explorer'));
  titleRow.appendChild(el('span', { fontSize: '10px', fontWeight: '800', letterSpacing: '0.06em', color: C.warn, border: `1px solid ${C.warn}`, borderRadius: '999px', padding: '1px 7px' }, 'BETA'));
  titleWrap.appendChild(titleRow);
  titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, 'Call any Salesforce REST endpoint and inspect the response'));
  head.appendChild(titleWrap);
  root.appendChild(head);

  const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '16px 24px 24px' });
  root.appendChild(scroll);

  // ── request row: method + endpoint + send (declared early so menu helpers can reference) ──
  const reqRow = el('div', { display: 'flex', gap: '8px', marginBottom: '12px' });
  const method = el('select', { flexShrink: '0', padding: '9px 10px', fontSize: '13px', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none', fontWeight: '700' }) as HTMLSelectElement;
  ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m; method.appendChild(o); });
  const endpoint = el('input', { flex: '1', boxSizing: 'border-box', padding: '9px 12px', fontSize: '13px', fontFamily: 'monospace', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, outline: 'none' }) as HTMLInputElement;
  endpoint.value = `/services/data/${V}/limits`;
  endpoint.placeholder = `/services/data/${V}/…`;
  const sendBtn = el('button', { flexShrink: '0', background: C.accent, border: 'none', color: '#fff', borderRadius: '10px', padding: '9px 20px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, 'Send');
  reqRow.appendChild(method); reqRow.appendChild(endpoint); reqRow.appendChild(sendBtn);

  // ── body (shown for non-GET/DELETE) ──
  const bodyLabel = el('div', { fontSize: '11.5px', fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 2px 6px' }, 'Request body (JSON)');
  const body = el('textarea', { width: '100%', minHeight: '90px', boxSizing: 'border-box', padding: '10px 12px', fontSize: '12.5px', fontFamily: 'monospace', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, outline: 'none', resize: 'vertical' }) as HTMLTextAreaElement;
  body.spellcheck = false;
  const bodyless = () => method.value === 'GET' || method.value === 'DELETE';
  const syncBody = () => { const show = !bodyless(); bodyLabel.style.display = show ? 'block' : 'none'; body.style.display = show ? 'block' : 'none'; };
  const currentBody = () => (bodyless() ? undefined : (body.value.trim() || undefined));
  const applyReq = (r: RestReq) => {
    method.value = r.method || 'GET';
    endpoint.value = r.endpoint || '';
    body.value = r.body || '';
    syncBody();
  };
  const shortEndpoint = (ep: string) => ep.replace(/^\/services\/data\/[^/]+/, '') || ep;

  // ── dropdown menu helper ──
  let closeMenu: (() => void) | null = null;
  const openMenu = (anchor: HTMLElement, build: (menu: HTMLElement) => void) => {
    closeMenu?.();
    const menu = el('div', { position: 'fixed', minWidth: '300px', maxWidth: '480px', maxHeight: '380px', overflowY: 'auto', background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '12px', boxShadow: '0 18px 45px rgba(0,0,0,0.35)', padding: '6px', zIndex: '2147483649', fontFamily: 'inherit' });
    build(menu);
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menu.offsetHeight - 6);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    const onOut = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node) && ev.target !== anchor) closeMenu?.(); };
    const onEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeMenu?.(); };
    closeMenu = () => { menu.remove(); document.removeEventListener('mousedown', onOut, true); document.removeEventListener('keydown', onEsc, true); closeMenu = null; };
    setTimeout(() => { document.addEventListener('mousedown', onOut, true); document.addEventListener('keydown', onEsc, true); }, 0);
  };
  const menuSection = (menu: HTMLElement, title: string) => {
    menu.appendChild(el('div', { fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.06em', color: C.faint, padding: '8px 10px 4px' }, title));
  };
  const menuItem = (menu: HTMLElement, req: RestReq, primary: string, onDelete?: () => void) => {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px' });
    const btn = el('button', { flex: '1', minWidth: '0', display: 'block', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '8px 10px', fontFamily: 'inherit', color: C.text });
    btn.innerHTML = `<div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${primary.replace(/</g, '&lt;')}</div><div style="font-size:11px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:monospace"><b>${req.method}</b> ${req.endpoint.replace(/</g, '&lt;')}</div>`;
    btn.addEventListener('mouseover', () => { row.style.background = C.hover; });
    btn.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
    btn.addEventListener('click', () => { applyReq(req); closeMenu?.(); endpoint.focus(); });
    row.appendChild(btn);
    if (onDelete) {
      const del = el('button', { flexShrink: '0', background: 'transparent', border: 'none', color: C.faint, cursor: 'pointer', fontSize: '16px', lineHeight: '1', padding: '4px 8px', borderRadius: '6px', fontFamily: 'inherit' }, '×');
      del.title = 'Remove';
      del.addEventListener('mouseover', () => { del.style.color = C.danger; });
      del.addEventListener('mouseout', () => { del.style.color = C.faint; });
      del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
      row.appendChild(del);
    }
    menu.appendChild(row);
  };
  const menuEmpty = (menu: HTMLElement, msg: string) => {
    menu.appendChild(el('div', { padding: '14px', fontSize: '13px', color: C.muted }, msg));
  };

  // ── toolbar (lives in the header, right-aligned to use that space) ──
  const toolbar = el('div', { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginLeft: 'auto' });
  head.appendChild(toolbar);

  const toolBtn = (label: string) => el('button', { display: 'flex', alignItems: 'center', gap: '5px', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit', whiteSpace: 'nowrap' }, label);

  const tplBtn = toolBtn('Templates ▾');
  tplBtn.addEventListener('click', () => openMenu(tplBtn, (menu) => {
    menuSection(menu, 'Templates');
    templates.forEach((t) => menuItem(menu, t, t.name));
  }));

  const histBtn = toolBtn('History ▾');
  histBtn.addEventListener('click', () => openMenu(histBtn, (menu) => {
    if (!history.length) { menuEmpty(menu, 'No request history yet.'); return; }
    menuSection(menu, 'Recent');
    history.forEach((h) => menuItem(menu, h, shortEndpoint(h.endpoint), () => {
      history = history.filter((x) => x !== h); persistHistory(); closeMenu?.();
    }));
  }));

  const clearBtn = toolBtn('Clear');
  clearBtn.addEventListener('click', () => { applyReq({ method: 'GET', endpoint: '', body: '' }); labelInput.value = ''; respWrap.innerHTML = ''; endpoint.focus(); });

  const savedBtn = toolBtn('Saved ▾');
  savedBtn.addEventListener('click', () => openMenu(savedBtn, (menu) => {
    if (!saved.length) { menuEmpty(menu, 'No saved requests yet. Enter a label and Save Query.'); return; }
    menuSection(menu, '★ Saved');
    saved.forEach((s) => menuItem(menu, s, s.name, () => {
      saved = saved.filter((x) => x !== s); persistSaved(); closeMenu?.();
    }));
  }));

  const sep = el('div', { width: '1px', alignSelf: 'stretch', background: C.divider, margin: '2px 4px' });

  const labelWrap = el('div', { display: 'flex', alignItems: 'center', gap: '6px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.panel, padding: '0 8px' });
  labelWrap.appendChild(el('span', { fontSize: '13px', color: C.faint }, '💾'));
  const labelInput = el('input', { border: 'none', background: 'transparent', color: C.text, outline: 'none', fontSize: '12.5px', padding: '6px 2px', width: '120px', fontFamily: 'inherit' }) as HTMLInputElement;
  labelInput.placeholder = 'Query Label';
  labelWrap.appendChild(labelInput);

  const saveBtn = el('button', { background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', fontSize: '12.5px', fontWeight: '700', fontFamily: 'inherit', padding: '6px 4px', whiteSpace: 'nowrap' }, 'Save Query');
  const doSave = () => {
    const ep = endpoint.value.trim();
    if (!ep) { deps.flashToast('Enter an endpoint first'); return; }
    const name = (labelInput.value.trim() || shortEndpoint(ep).slice(0, 40) || ep.slice(0, 40));
    const req: RestSaved = { name, method: method.value, endpoint: ep, body: currentBody() };
    saved = saved.filter((s) => s.name !== name);
    saved.unshift(req);
    if (saved.length > SAVED_LIMIT) saved.length = SAVED_LIMIT;
    persistSaved();
    labelInput.value = '';
    deps.flashToast('Request saved');
  };
  saveBtn.addEventListener('click', doSave);
  labelInput.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') doSave(); });

  toolbar.appendChild(tplBtn);
  toolbar.appendChild(histBtn);
  toolbar.appendChild(clearBtn);
  toolbar.appendChild(savedBtn);
  toolbar.appendChild(sep);
  toolbar.appendChild(labelWrap);
  toolbar.appendChild(saveBtn);

  // request row + body come after the toolbar
  scroll.appendChild(reqRow);
  scroll.appendChild(bodyLabel);
  scroll.appendChild(body);
  method.addEventListener('change', syncBody);
  syncBody();

  // ── response ──
  const respWrap = el('div', { marginTop: '16px' });
  scroll.appendChild(respWrap);

  const showResp = (r: RestResult) => {
    respWrap.innerHTML = '';
    if (r.error) {
      respWrap.appendChild(el('div', { padding: '14px', borderRadius: '10px', border: `1px solid ${C.danger}`, background: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.06)', color: isDark ? '#fca5a5' : '#b91c1c', fontSize: '13px', whiteSpace: 'pre-wrap' }, r.error));
      return;
    }
    const status = r.status || 0;
    const col = r.ok ? C.ok : status >= 500 ? C.danger : status >= 400 ? C.warn : C.muted;
    const bar = el('div', { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' });
    bar.appendChild(el('span', { fontSize: '13px', fontWeight: '800', color: col }, `${status} ${r.statusText || ''}`.trim()));
    bar.appendChild(el('span', { fontSize: '12px', color: C.faint }, `${r.durationMs ?? 0} ms · ${fmtBytes(new Blob([r.body || '']).size)}`));
    const copyBtn = el('button', { marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '7px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: 'inherit' }, '⧉ Copy');
    bar.appendChild(copyBtn);
    respWrap.appendChild(bar);

    let pretty = r.body || '';
    let isJson = false;
    try { pretty = JSON.stringify(JSON.parse(r.body || ''), null, 2); isJson = true; } catch { /* not JSON */ }
    copyBtn.addEventListener('click', () => { navigator.clipboard?.writeText(pretty).then(() => deps.flashToast('Copied response')); });
    const pre = el('pre', { margin: '0', padding: '12px 14px', borderRadius: '10px', background: C.code, border: `1px solid ${C.border}`, color: C.text, fontSize: '12.5px', lineHeight: '1.5', fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: '46vh' });
    if (isJson) pre.innerHTML = highlightJsonText(pretty, isDark);
    else pre.textContent = pretty;
    respWrap.appendChild(pre);
  };

  const recordHistory = (req: RestReq) => {
    history = history.filter((h) => !(h.method === req.method && h.endpoint === req.endpoint && (h.body || '') === (req.body || '')));
    history.unshift({ ...req, ts: Date.now() });
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    persistHistory();
  };

  async function send() {
    const ep = endpoint.value.trim();
    if (!ep) { deps.flashToast('Enter an endpoint'); return; }
    const useBody = currentBody();
    recordHistory({ method: method.value, endpoint: ep, body: useBody });
    sendBtn.textContent = 'Sending…'; sendBtn.style.pointerEvents = 'none'; sendBtn.style.opacity = '0.7';
    respWrap.innerHTML = '';
    respWrap.appendChild(el('div', { padding: '14px 2px', color: C.muted, fontSize: '13px' }, 'Sending request…'));
    const r = await deps.sendRest(method.value, ep, useBody);
    sendBtn.textContent = 'Send'; sendBtn.style.pointerEvents = 'auto'; sendBtn.style.opacity = '1';
    showResp(r);
    // Summarise the outcome as a toast — status + record count (for SOQL/list
    // responses) or payload size. Wording drives the toast colour via inference.
    if (r.error) { deps.flashToast(`Request failed: ${r.error}`); return; }
    const status = r.status || 0;
    let recs: number | undefined;
    try { const j = JSON.parse(r.body || ''); if (Array.isArray(j?.records)) recs = j.records.length; else if (typeof j?.totalSize === 'number') recs = j.totalSize; else if (Array.isArray(j)) recs = j.length; } catch { /* not JSON */ }
    const detail = recs != null ? `${recs} record${recs === 1 ? '' : 's'}` : fmtBytes(new Blob([r.body || '']).size);
    const summary = `${status} ${r.statusText || ''}`.trim() + ` · ${detail}`;
    deps.flashToast(status >= 400 ? `Request failed — ${summary}` : summary);
  }

  sendBtn.addEventListener('click', send);
  endpoint.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') send(); });
}
