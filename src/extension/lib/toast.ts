// Global toast notification system. Stacked cards in the bottom-right corner,
// used everywhere in the panel for lightweight feedback ("20 flows fetched",
// "Flow activated", "Query failed", …).
//
// Each card has two parts: a soft-tinted header (type title · timestamp · close)
// and a solid, colour-filled body (ringed icon · message) — matching the shared
// notification design. One container is appended to <body> with a max z-index so
// toasts float above the panel and the underlying Salesforce page alike. The
// module is content-script-only (imports ./theme) so it stays inside the
// content-ui bundle — see the note in lib/theme.ts.

import { getTheme } from './theme';

export type ToastType = 'success' | 'info' | 'error' | 'loading';

export interface ToastOptions {
  type?: ToastType;
  duration?: number;   // ms before auto-dismiss; 0 = sticky (default for 'loading')
  id?: string;         // reuse an existing toast (e.g. loading → success)
}

const CONTAINER_ID = 'sf-toast-container';
let dark = true;
let seq = 0;
let enabled = true;   // gated by Settings → Notification → In-extension notifications

// Callers set this whenever the panel theme changes so toasts match.
export function setToastTheme(isDark: boolean): void { dark = isDark; }
// Turn in-extension toasts on/off (Settings). Loading toasts still work so
// callers relying on the returned id don't break; they just aren't shown.
export function setToastEnabled(on: boolean): void { enabled = on; }

interface TypeCfg { title: string; solid: string; ring: string; spin?: boolean }

// Lucide-style ringed glyphs, drawn with currentColor (white on the solid body).
const SVG = {
  check: '<circle cx="12" cy="12" r="9"/><path d="M8.4 12.4l2.4 2.4 4.8-5.2"/>',
  cross: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  spin: '<path d="M12 3a9 9 0 1 0 9 9" />',
};

const TYPES: Record<ToastType, TypeCfg> = {
  success: { title: 'Success', solid: '#22a35a', ring: SVG.check },
  info: { title: 'Info', solid: '#3b82f6', ring: SVG.info },
  error: { title: 'Error', solid: '#e0483d', ring: SVG.cross },
  loading: { title: 'Working…', solid: '#64748b', ring: SVG.spin, spin: true },
};

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3600, info: 3600, error: 6500, loading: 0,
};

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function ringSvg(paths: string, spin: boolean): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${spin ? ' style="animation:sfToastSpin 0.9s linear infinite;transform-origin:center"' : ''}>${paths}</svg>`;
}

function nowLabel(): string {
  try { return new Date().toLocaleTimeString(); } catch { return ''; }
}

function ensureContainer(): HTMLElement | null {
  if (!document.body) return null;
  let c = document.getElementById(CONTAINER_ID);
  if (!c) {
    c = document.createElement('div');
    c.id = CONTAINER_ID;
    Object.assign(c.style, {
      position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-end',
      pointerEvents: 'none', fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '380px',
    });
    if (!document.getElementById('sf-toast-styles')) {
      const st = document.createElement('style');
      st.id = 'sf-toast-styles';
      st.textContent = '@keyframes sfToastIn{from{opacity:0;transform:translateX(28px) scale(.98)}to{opacity:1;transform:translateX(0) scale(1)}}@keyframes sfToastSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(st);
    }
    document.body.appendChild(c);
  }
  return c;
}

// Paint a card's visuals for a given type/message (used on create and on update).
function applyType(card: HTMLElement, type: ToastType, message: string): void {
  const C = getTheme(dark);
  const cfg = TYPES[type];
  const q = <T extends HTMLElement>(role: string) => card.querySelector<T>(`[data-role="${role}"]`);

  const header = q<HTMLElement>('header');
  if (header) header.style.background = hexToRgba(cfg.solid, dark ? 0.24 : 0.14);
  const title = q<HTMLElement>('title');
  if (title) { title.textContent = cfg.title; title.style.color = dark ? '#fff' : '#1f2937'; }
  const time = q<HTMLElement>('time');
  if (time) { time.textContent = nowLabel(); time.style.color = dark ? 'rgba(255,255,255,0.55)' : 'rgba(31,41,55,0.55)'; }
  const close = q<HTMLElement>('close');
  if (close) close.style.color = dark ? 'rgba(255,255,255,0.7)' : 'rgba(31,41,55,0.6)';

  const body = q<HTMLElement>('body');
  if (body) body.style.background = cfg.solid;
  const icon = q<HTMLElement>('icon');
  if (icon) icon.innerHTML = ringSvg(cfg.ring, !!cfg.spin);
  const msg = q<HTMLElement>('msg');
  if (msg) msg.textContent = message;
  card.style.background = dark ? 'rgba(15,23,42,0.98)' : '#ffffff';
  card.style.border = `1px solid ${C.border}`;
}

function buildCard(id: string): HTMLElement {
  const card = document.createElement('div');
  card.dataset.toastId = id;
  Object.assign(card.style, {
    pointerEvents: 'auto', display: 'flex', flexDirection: 'column',
    minWidth: '260px', maxWidth: '380px', boxSizing: 'border-box',
    borderRadius: '14px', overflow: 'hidden',
    boxShadow: '0 16px 40px rgba(0,0,0,0.22)',
    animation: 'sfToastIn .24s cubic-bezier(.2,.8,.2,1)',
  });

  // header: title · spacer · time · close
  const header = document.createElement('div');
  header.dataset.role = 'header';
  Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px 9px 16px' });
  const title = document.createElement('span');
  title.dataset.role = 'title';
  Object.assign(title.style, { fontSize: '13px', fontWeight: '800', letterSpacing: '0.01em' });
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  const time = document.createElement('span');
  time.dataset.role = 'time';
  Object.assign(time.style, { fontSize: '11.5px', fontWeight: '600', whiteSpace: 'nowrap' });
  const close = document.createElement('button');
  close.dataset.role = 'close';
  close.textContent = '✕';
  Object.assign(close.style, { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '13px', lineHeight: '1', padding: '2px 4px', fontFamily: 'inherit' });
  close.addEventListener('click', (e) => { e.stopPropagation(); dismissToast(id); });
  header.append(title, spacer, time, close);

  // body: ringed icon · message
  const body = document.createElement('div');
  body.dataset.role = 'body';
  Object.assign(body.style, { display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 16px', color: '#fff' });
  const icon = document.createElement('span');
  icon.dataset.role = 'icon';
  Object.assign(icon.style, { display: 'inline-flex', flexShrink: '0' });
  const msg = document.createElement('span');
  msg.dataset.role = 'msg';
  Object.assign(msg.style, { flex: '1', fontSize: '13.5px', fontWeight: '700', lineHeight: '1.35', wordBreak: 'break-word' });
  body.append(icon, msg);

  card.append(header, body);
  return card;
}

function dismiss(card: HTMLElement) {
  if (!card.isConnected) return;
  card.style.transition = 'opacity .2s, transform .2s';
  card.style.opacity = '0';
  card.style.transform = 'translateX(28px)';
  setTimeout(() => card.remove(), 220);
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function schedule(id: string, card: HTMLElement, duration: number) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  if (duration > 0) timers.set(id, setTimeout(() => { dismiss(card); timers.delete(id); }, duration));
}

/**
 * Show (or update) a toast. Returns its id so it can be updated or dismissed —
 * e.g. show a 'loading' toast, then call showToast(msg,{id,type:'success'}).
 */
export function showToast(message: string, opts: ToastOptions = {}): string {
  const type = opts.type || 'info';
  const duration = opts.duration ?? DEFAULT_DURATION[type];
  const id = opts.id || `t${++seq}`;
  // When toasts are disabled, still honor updates to an already-shown toast
  // (e.g. a loading toast turning into success) but don't create new ones.
  const existingWhenDisabled = document.getElementById(CONTAINER_ID)?.querySelector(`[data-toast-id="${id}"]`);
  if (!enabled && !(opts.id && existingWhenDisabled)) return id;
  const container = ensureContainer();
  if (!container) return id;

  let card = container.querySelector<HTMLElement>(`[data-toast-id="${id}"]`);
  if (!card) {
    card = buildCard(id);
    container.appendChild(card);
  }
  applyType(card, type, message);
  schedule(id, card, duration);
  return id;
}

export function dismissToast(id: string): void {
  const card = document.querySelector<HTMLElement>(`[data-toast-id="${id}"]`);
  if (card) dismiss(card);
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
}
