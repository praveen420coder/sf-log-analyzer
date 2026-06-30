// Highlight overlay: draws a border box + name badge over every detected
// component instance and keeps them aligned as the page scrolls/resizes.
// Clicking a badge calls onPick(component). Esc / the toolbar Exit tears down.

import type { DetectedComponent } from './detect';

export interface OverlayController {
  reposition: () => void;
  destroy: () => void;
}

export interface OverlayOpts {
  isDark: boolean;
  onPick: (c: DetectedComponent) => void;
  onExit: () => void;
}

const Z = '2147483600';

export function createHighlightOverlay(components: DetectedComponent[], opts: OverlayOpts): OverlayController {
  const editColor = '#3b82f6';
  const viewColor = opts.isDark ? '#94a3b8' : '#64748b';

  const layer = document.createElement('div');
  Object.assign(layer.style, {
    position: 'fixed', inset: '0', zIndex: Z, pointerEvents: 'none',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  document.body.appendChild(layer);

  // toolbar (interactive)
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed', top: '14px', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 14px',
    background: opts.isDark ? '#0e1626' : '#ffffff', color: opts.isDark ? '#e2e8f0' : '#1f2937',
    border: `1px solid ${opts.isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0.12)'}`,
    borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', pointerEvents: 'auto',
    fontSize: '13px', fontWeight: '600',
  });
  const editable = components.filter((c) => c.editable).length;
  const total = components.length;
  bar.appendChild(text('🔍 ' + `${total} component${total === 1 ? '' : 's'} on this page` + (total ? ` · ${editable} editable` : '')));
  const exitBtn = document.createElement('button');
  Object.assign(exitBtn.style, {
    background: editColor, color: '#fff', border: 'none', borderRadius: '8px',
    padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: '700',
  });
  exitBtn.textContent = 'Exit (Esc)';
  exitBtn.addEventListener('click', opts.onExit);
  bar.appendChild(exitBtn);
  layer.appendChild(bar);

  if (total === 0) {
    bar.insertBefore(text('No editable custom LWCs detected here.'), exitBtn);
  }

  // one box + badge per element instance
  interface Mark { el: Element; box: HTMLDivElement; comp: DetectedComponent }
  const marks: Mark[] = [];
  components.forEach((c) => {
    c.elements.forEach((el) => {
      const box = document.createElement('div');
      const color = c.editable ? editColor : viewColor;
      Object.assign(box.style, {
        position: 'fixed', boxSizing: 'border-box', pointerEvents: 'none',
        border: `1.5px solid ${color}`, borderRadius: '4px',
        background: c.editable ? 'rgba(59,130,246,0.06)' : 'transparent',
        display: 'none',
      });
      const badge = document.createElement('button');
      Object.assign(badge.style, {
        position: 'absolute', top: '-1px', left: '-1px', transform: 'translateY(-100%)',
        background: color, color: '#fff', border: 'none', borderRadius: '4px 4px 4px 0',
        padding: '2px 7px', font: '600 11px/1.4 inherit', cursor: 'pointer', pointerEvents: 'auto',
        whiteSpace: 'nowrap', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis',
      });
      badge.textContent = `${c.tag}${c.editable ? '' : ' · managed'}`;
      badge.title = c.editable ? 'View source' : 'Managed package — view source';
      badge.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); opts.onPick(c); });
      box.appendChild(badge);
      layer.appendChild(box);
      marks.push({ el, box, comp: c });
    });
  });

  function reposition(): void {
    for (const m of marks) {
      const r = m.el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) {
        m.box.style.display = 'none';
        continue;
      }
      Object.assign(m.box.style, {
        display: 'block', left: `${r.left}px`, top: `${r.top}px`,
        width: `${r.width}px`, height: `${r.height}px`,
      });
    }
  }

  // throttle scroll/resize through rAF; periodic catch-all for async re-renders
  let raf = 0;
  const onScrollResize = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; reposition(); }); };
  window.addEventListener('scroll', onScrollResize, true);
  window.addEventListener('resize', onScrollResize, true);
  const interval = window.setInterval(reposition, 500);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); opts.onExit(); } };
  window.addEventListener('keydown', onKey, true);

  reposition();

  function destroy(): void {
    window.removeEventListener('scroll', onScrollResize, true);
    window.removeEventListener('resize', onScrollResize, true);
    window.removeEventListener('keydown', onKey, true);
    if (raf) cancelAnimationFrame(raf);
    clearInterval(interval);
    layer.remove();
  }

  return { reposition, destroy };
}

function text(s: string): HTMLSpanElement {
  const n = document.createElement('span');
  n.textContent = s;
  return n;
}
