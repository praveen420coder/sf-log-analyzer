// Footer session switcher: a small pill + dropdown that lists the Salesforce
// orgs you've visited and lets you retarget the panel to another one in place.
// Switching sets the active host override (lib/sfUrls); getSfCredentials then
// resolves that org's live session from cookies for all subsequent API calls.

import { getVisitedOrgs, removeVisitedOrg } from '../state/sessions';
import { getSessionOverrideHost, setSessionOverrideHost, activeSfHost, cleanSfDomain, sfHostname, getSfCredentials } from '../lib/sfUrls';
import { getTheme } from '../lib/theme';

export interface SessionSwitcherDeps {
  isDark: boolean;
  flashToast: (m: string) => void;
  onSwitched: () => void;   // re-render the panel/footer after a switch
}

export interface SessionSwitcherControl { refresh: () => void }

/** "mycompany.my.salesforce.com" → "mycompany". Falls back to the full host. */
function shortLabel(host: string): string {
  if (!host) return 'org';
  return host
    .replace(/\.my\.salesforce\.com$/, '')
    .replace(/\.lightning\.force\.com$/, '')
    .replace(/\.my\.salesforce-setup\.com$/, '')
    .replace(/\.salesforce\.com$/, '')
    .split('.')[0] || host;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

export function renderSessionSwitcherInto(host: HTMLElement, deps: SessionSwitcherDeps): SessionSwitcherControl {
  const isDark = deps.isDark;
  const C = getTheme(isDark);

  host.innerHTML = '';
  const pill = el('button', {
    display: 'inline-flex', alignItems: 'center', gap: '7px', maxWidth: '220px',
    padding: '4px 10px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: '12px', fontWeight: '700', color: C.text, background: C.chipBg,
    border: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  });
  host.appendChild(pill);

  let menu: HTMLElement | null = null;

  function activeHost(): string { return activeSfHost(); }

  function labelForHost(h: string): string {
    const o = getVisitedOrgs().find((v) => v.host === h);
    return o?.label || shortLabel(h);
  }

  function paintPill(): void {
    const overridden = !!getSessionOverrideHost();
    pill.innerHTML = '';
    const dot = el('span', { width: '8px', height: '8px', borderRadius: '50%', flexShrink: '0', background: overridden ? '#f59e0b' : '#22c55e' });
    const lbl = el('span', { overflow: 'hidden', textOverflow: 'ellipsis' }, labelForHost(activeHost()));
    const caret = el('span', { fontSize: '9px', color: C.muted, flexShrink: '0' }, '▾');
    pill.appendChild(dot); pill.appendChild(lbl); pill.appendChild(caret);
    pill.title = overridden ? `Panel is targeting ${labelForHost(activeHost())} (switched)` : 'Active Salesforce session — click to switch';
  }

  function closeMenu(): void {
    if (menu) { menu.remove(); menu = null; }
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  const onOutside = (e: MouseEvent) => { if (menu && !menu.contains(e.target as Node) && e.target !== pill && !pill.contains(e.target as Node)) closeMenu(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } };

  function pick(targetHost: string | null): void {
    closeMenu();
    const prev = getSessionOverrideHost();
    setSessionOverrideHost(targetHost);
    // Switching back to the page org always works.
    if (targetHost === null) { paintPill(); deps.flashToast(`Back to this page's org`); deps.onSwitched(); return; }
    // Otherwise confirm a live session token actually exists for the target org
    // (tokens live in session storage — only orgs opened this browser session have one).
    getSfCredentials().then((creds: any) => {
      if (!creds?.instanceUrl || !creds?.sessionId) {
        setSessionOverrideHost(prev); // revert — no usable session
        paintPill();
        deps.flashToast(`No active session for ${labelForHost(cleanSfDomain(targetHost))} — open that org in a tab first.`);
        return;
      }
      paintPill();
      deps.flashToast(`Switched to ${labelForHost(cleanSfDomain(targetHost))}`);
      deps.onSwitched();
    });
  }

  function openMenu(): void {
    if (menu) { closeMenu(); return; }
    const pageHost = cleanSfDomain(sfHostname());
    const cur = activeHost();
    const others = getVisitedOrgs().filter((o) => o.host !== pageHost);

    menu = el('div', {
      position: 'fixed', zIndex: '2147483649', minWidth: '240px', maxWidth: '320px',
      maxHeight: '320px', overflowY: 'auto', background: C.panel, color: C.text,
      border: `1px solid ${C.border}`, borderRadius: '12px', boxShadow: '0 12px 32px rgba(0,0,0,0.32)',
      padding: '6px', fontFamily: 'inherit',
    });
    menu.appendChild(el('div', { fontSize: '10.5px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: C.muted, padding: '6px 10px 4px' }, 'Switch session'));

    const addRow = (h: string, label: string, sub: string | undefined, isCurrentPage: boolean) => {
      const active = h === cur;
      const row = el('button', { display: 'flex', alignItems: 'center', gap: '9px', width: '100%', textAlign: 'left', background: active ? C.hover : 'transparent', border: 'none', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit', color: C.text });
      row.addEventListener('mouseenter', () => { if (!active) row.style.background = C.hover; });
      row.addEventListener('mouseleave', () => { if (!active) row.style.background = 'transparent'; });
      const check = el('span', { width: '14px', flexShrink: '0', color: C.accent, fontWeight: '800' }, active ? '✓' : '');
      const col = el('div', { display: 'flex', flexDirection: 'column', minWidth: '0', flex: '1' });
      col.appendChild(el('div', { fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, label + (isCurrentPage ? '  · this page' : '')));
      if (sub) col.appendChild(el('div', { fontSize: '11px', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, sub));
      row.appendChild(check); row.appendChild(col);
      // Remove-from-list "×" (not shown for the current page org, which always reappears).
      if (!isCurrentPage) {
        const x = el('span', { flexShrink: '0', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', color: C.muted, fontSize: '15px', lineHeight: '1' }, '×');
        x.title = 'Remove from list';
        x.addEventListener('mouseenter', () => { x.style.background = 'rgba(239,68,68,0.16)'; x.style.color = '#ef4444'; });
        x.addEventListener('mouseleave', () => { x.style.background = 'transparent'; x.style.color = C.muted; });
        x.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          removeVisitedOrg(h);
          closeMenu(); openMenu();  // rebuild the list
        });
        row.appendChild(x);
      }
      row.addEventListener('click', () => pick(isCurrentPage ? null : h));
      menu!.appendChild(row);
    };

    // current page org always first (clears override)
    addRow(pageHost, labelForHost(pageHost), undefined, true);
    if (others.length === 0) {
      menu.appendChild(el('div', { fontSize: '11.5px', color: C.muted, padding: '6px 10px 8px' }, 'Open another org once and it will appear here to switch to.'));
    } else {
      others.forEach((o) => addRow(o.host, o.label || shortLabel(o.host), o.instanceUrl.replace(/^https?:\/\//, ''), false));
    }

    document.body.appendChild(menu);
    const r = pill.getBoundingClientRect();
    const mh = menu.getBoundingClientRect().height;
    // open upward (footer sits at the bottom); clamp to viewport
    let top = r.top - mh - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - mh - 8);
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.getBoundingClientRect().width - 8))}px`;

    setTimeout(() => { document.addEventListener('click', onOutside, true); document.addEventListener('keydown', onKey, true); }, 0);
  }

  pill.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });

  paintPill();
  return { refresh: () => { paintPill(); } };
}
