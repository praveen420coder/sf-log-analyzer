// "What's New" update card — shown once per version, and from the What's New tool.

export const WHATS_NEW_VERSION_KEY = 'sf_log_analyzer_last_seen_version';

const WHATS_NEW: { icon: string; title: string; desc: string }[] = [
  { icon: '🔎', title: 'Log Explorer', desc: 'Your debug logs in a sortable table — open, copy, download, delete in bulk, or live-refresh.' },
  { icon: '📊', title: 'Apex Log Analyzer', desc: 'Click Analyze on any log for a full breakdown across five tabs.' },
  { icon: '🔥', title: 'Timeline flame chart', desc: 'A zoomable, pannable canvas timeline with an overview strip and rich hover tooltips.' },
  { icon: '🌳', title: 'Call Tree, Analysis & Database', desc: 'Sortable call tree, bottom-up method aggregation, and grouped SOQL/DML views.' },
  { icon: '📄', title: 'Raw Log tab', desc: 'Read and filter the unparsed log line-by-line, then copy or download it.' },
];

export function showWhatsNew(version: string, isDark: boolean): void {
  const existing = document.getElementById('sf-log-analyzer-whatsnew');
  if (existing) existing.remove();
  if (!document.body) return;

  // Persist immediately so the card only appears once across page loads.
  try { (globalThis as any).chrome?.storage?.local?.set({ [WHATS_NEW_VERSION_KEY]: version }); } catch { /* ignore */ }

  const C = {
    backdrop: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)',
    modalBg: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.98)',
    border: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(31,41,55,0.12)',
    divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(31,41,55,0.08)',
    textPrimary: isDark ? '#f1f5f9' : '#1f2937',
    textMuted: isDark ? 'rgba(203,213,225,0.75)' : 'rgba(31,41,55,0.65)',
    accent: '#2563eb',
    chip: isDark ? 'rgba(37,99,235,0.2)' : 'rgba(37,99,235,0.1)',
  };

  const container = document.createElement('div');
  container.id = 'sf-log-analyzer-whatsnew';
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', zIndex: '2147483648',
    display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
  });
  document.body.appendChild(container);

  const close = () => { document.removeEventListener('keydown', onKey, true); container.remove(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', background: C.backdrop, pointerEvents: 'auto', cursor: 'pointer' });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  container.appendChild(backdrop);

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position: 'relative', width: '92%', maxWidth: '520px', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
    background: C.modalBg, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '18px',
    border: `1px solid ${C.border}`, boxShadow: '0 25px 60px rgba(0,0,0,0.45)', overflow: 'hidden', pointerEvents: 'auto', zIndex: '2',
  });
  container.appendChild(modal);

  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 24px 14px' });
  const hTitle = document.createElement('div');
  hTitle.textContent = "What's new";
  Object.assign(hTitle.style, { fontSize: '20px', fontWeight: '800', color: C.textPrimary, flex: '1' });
  const vChip = document.createElement('span');
  vChip.textContent = `v${version}`;
  Object.assign(vChip.style, { fontSize: '12px', fontWeight: '700', color: C.accent, background: C.chip, padding: '3px 10px', borderRadius: '999px' });
  header.appendChild(hTitle);
  header.appendChild(vChip);
  modal.appendChild(header);

  const list = document.createElement('div');
  Object.assign(list.style, { padding: '0 24px', overflow: 'auto', flex: '1' });
  WHATS_NEW.forEach((item) => {
    const r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', gap: '14px', padding: '12px 0', borderTop: `1px solid ${C.divider}` });
    const ic = document.createElement('div');
    ic.textContent = item.icon; Object.assign(ic.style, { fontSize: '22px', flexShrink: '0', lineHeight: '1.2' });
    const tx = document.createElement('div');
    const t = document.createElement('div');
    t.textContent = item.title; Object.assign(t.style, { fontSize: '15px', fontWeight: '700', color: C.textPrimary });
    const d = document.createElement('div');
    d.textContent = item.desc; Object.assign(d.style, { fontSize: '13px', color: C.textMuted, marginTop: '2px', lineHeight: '1.5' });
    tx.appendChild(t); tx.appendChild(d);
    r.appendChild(ic); r.appendChild(tx);
    list.appendChild(r);
  });
  modal.appendChild(list);

  const footer = document.createElement('div');
  Object.assign(footer.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 24px', borderTop: `1px solid ${C.divider}` });
  const docsLink = document.createElement('a');
  docsLink.textContent = 'View docs ↗';
  docsLink.href = 'https://sfspotlight.vercel.app/docs.html';
  docsLink.target = '_blank'; docsLink.rel = 'noopener noreferrer';
  Object.assign(docsLink.style, { fontSize: '13px', fontWeight: '600', color: C.textMuted, textDecoration: 'none' });
  const gotIt = document.createElement('button');
  gotIt.textContent = 'Got it';
  Object.assign(gotIt.style, { fontSize: '13px', fontWeight: '700', padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: C.accent, color: '#fff', fontFamily: 'inherit' });
  gotIt.addEventListener('click', close);
  footer.appendChild(docsLink);
  footer.appendChild(gotIt);
  modal.appendChild(footer);

  container.style.pointerEvents = 'auto';
}
