// Source viewer + editor. Phase 1: read-only file tabs (html/js/css/js-meta.xml).
// Phase 2: for org-owned (editable) components, an inline editor that deploys the
// changed file via the injected saveSource (SAVE_LWC_SOURCE → Tooling PATCH).
// Guardrails: deploy requires an explicit confirm, with a stronger gate on
// production orgs (getIsSandbox === false).

import type { DetectedComponent } from './detect';

export interface LwcFile { id?: string; filePath: string; format: string; source: string }

export interface ViewerDeps {
  isDark: boolean;
  fetchSource: (bundleId: string) => Promise<{ files?: LwcFile[]; error?: string }>;
  saveSource?: (resourceId: string, source: string) => Promise<{ success?: boolean; error?: string; verified?: boolean | null }>;
  getIsSandbox?: () => Promise<boolean | null>;
  flashToast?: (msg: string) => void;
  setupUrl?: string;
}

export interface ViewerController { destroy: () => void }

const Z = '2147483601';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, txt?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (txt != null) n.textContent = txt;
  return n;
}

const ORDER: Record<string, number> = { html: 0, js: 1, css: 2, 'js-meta.xml': 3 };
const basename = (p: string) => p.split('/').pop() || p;

export function openSourceViewer(component: DetectedComponent, deps: ViewerDeps): ViewerController {
  const isDark = deps.isDark;
  const C = {
    bg: isDark ? '#0e1626' : '#ffffff',
    text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? '#94a3b8' : '#64748b',
    border: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,0,0,0.12)',
    accent: '#3b82f6',
    danger: '#ef4444',
    ok: '#16a34a',
    code: isDark ? '#0b1220' : '#ffffff',
  };
  const canEdit = component.editable && !!deps.saveSource;

  const panel = el('div', {
    position: 'fixed', top: '0', right: '0', height: '100%', width: 'min(620px, 94vw)',
    zIndex: Z, display: 'flex', flexDirection: 'column', background: C.bg, color: C.text,
    borderLeft: `1px solid ${C.border}`, boxShadow: '-12px 0 32px rgba(0,0,0,0.28)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  panel.className = 'sf-lwc-viewer';
  // Thin scrollbars inside the panel; hide the file-tab strip's scrollbar entirely.
  const style = document.createElement('style');
  style.textContent = `
    .sf-lwc-viewer { scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.45) transparent; }
    .sf-lwc-viewer ::-webkit-scrollbar { width: 9px; height: 9px; }
    .sf-lwc-viewer ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.4); border-radius: 6px; }
    .sf-lwc-viewer ::-webkit-scrollbar-track { background: transparent; }
    .sf-lwc-viewer ::-webkit-scrollbar-corner { background: transparent; }
    .sf-lwc-tabs { scrollbar-width: none; }
    .sf-lwc-tabs::-webkit-scrollbar { display: none; height: 0; }
  `;
  panel.appendChild(style);

  // header
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: `1px solid ${C.border}`, flexShrink: '0' });
  head.appendChild(el('span', { fontSize: '15px' }, component.editable ? '🔆' : '🔒'));
  const titles = el('div', { display: 'flex', flexDirection: 'column', minWidth: '0' });
  titles.appendChild(el('div', { fontSize: '14px', fontWeight: '800', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, component.masterLabel || component.developerName));
  titles.appendChild(el('div', { fontSize: '11px', color: C.muted }, `${component.tag}${component.editable ? '' : ' · managed package (read-only)'}`));
  head.appendChild(titles);
  const close = el('button', { marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontSize: '20px', lineHeight: '1', fontFamily: 'inherit' }, '×');
  head.appendChild(close);
  panel.appendChild(head);

  // status banner (sandbox/prod + errors)
  const banner = el('div', { display: 'none', padding: '8px 18px', fontSize: '12px', fontWeight: '600', flexShrink: '0' });
  panel.appendChild(banner);
  const showBanner = (msg: string, kind: 'info' | 'warn' | 'error') => {
    banner.textContent = msg;
    const bg = kind === 'error' ? 'rgba(239,68,68,0.14)' : kind === 'warn' ? 'rgba(245,158,11,0.16)' : 'rgba(59,130,246,0.12)';
    const fg = kind === 'error' ? C.danger : kind === 'warn' ? '#b45309' : C.accent;
    Object.assign(banner.style, { display: 'block', background: bg, color: isDark ? (kind === 'warn' ? '#fbbf24' : fg) : fg });
  };
  const hideBanner = () => { banner.style.display = 'none'; };

  // tab strip
  const tabs = el('div', { display: 'flex', gap: '2px', padding: '8px 12px 0', flexShrink: '0', overflowX: 'auto', overflowY: 'hidden', borderBottom: `1px solid ${C.border}` });
  tabs.className = 'sf-lwc-tabs';
  panel.appendChild(tabs);

  // code area: line-number gutter + stacked read-only <pre> / editable <textarea>
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const codeWrap = el('div', { flex: '1', minHeight: '0', display: 'flex', background: C.code });
  const gutter = el('div', {
    flexShrink: '0', minWidth: '46px', textAlign: 'right', padding: '16px 10px 16px 14px', boxSizing: 'border-box',
    overflow: 'hidden', userSelect: 'none', color: C.muted, fontSize: '12.5px', lineHeight: '1.6', fontFamily: MONO,
    whiteSpace: 'pre', background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderRight: `1px solid ${C.border}`,
  });
  const codeArea = el('div', { position: 'relative', flex: '1', minHeight: '0' });
  const pre = el('pre', {
    margin: '0', padding: '16px 18px', position: 'absolute', inset: '0', overflow: 'auto',
    fontSize: '12.5px', lineHeight: '1.6', fontFamily: MONO, whiteSpace: 'pre', color: C.text,
  });
  const editor = el('textarea', {
    display: 'none', position: 'absolute', inset: '0', width: '100%', height: '100%', boxSizing: 'border-box',
    margin: '0', padding: '16px 18px', border: 'none', outline: 'none', resize: 'none', background: C.code, color: C.text,
    fontSize: '12.5px', lineHeight: '1.6', fontFamily: MONO, whiteSpace: 'pre', tabSize: '2' as any,
  }) as HTMLTextAreaElement;
  editor.spellcheck = false;
  codeArea.appendChild(pre);
  codeArea.appendChild(editor);
  codeWrap.appendChild(gutter);
  codeWrap.appendChild(codeArea);
  panel.appendChild(codeWrap);

  // status bar (format · lines · chars · dirty)
  const status = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '5px 16px', flexShrink: '0', borderTop: `1px solid ${C.border}`, fontSize: '11px', color: C.muted, fontFamily: MONO });
  panel.appendChild(status);

  let gutterLines = 0;
  function updateGutter(text: string): void {
    const n = Math.max(1, text.split('\n').length);
    if (n !== gutterLines) {
      gutterLines = n;
      let s = '';
      for (let i = 1; i <= n; i++) s += (i === 1 ? '' : '\n') + i;
      gutter.textContent = s;
    }
  }
  function updateStatus(text: string): void {
    const lines = text.split('\n').length;
    const fmt = files[active]?.format || '';
    status.textContent = `${fmt}  ·  ${lines} line${lines === 1 ? '' : 's'}  ·  ${text.length} chars${isDirty(active) ? '  ·  ● unsaved' : ''}`;
  }
  pre.addEventListener('scroll', () => { gutter.scrollTop = pre.scrollTop; });
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });

  // footer with mode-dependent actions
  const foot = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderTop: `1px solid ${C.border}`, flexShrink: '0', fontSize: '12px' });
  panel.appendChild(foot);

  document.body.appendChild(panel);

  let files: LwcFile[] = [];
  let active = 0;
  let editing = false;
  const edited: Record<number, string> = {};   // index → current textarea value
  let isSandbox: boolean | null | undefined;     // undefined = not yet resolved

  const isDirty = (i: number) => edited[i] != null && edited[i] !== files[i]?.source;
  const anyDirty = () => files.some((_, i) => isDirty(i));

  function paintTabs(): void {
    tabs.innerHTML = '';
    files.forEach((f, i) => {
      const t = el('button', {
        background: i === active ? C.code : 'transparent', color: i === active ? C.text : C.muted,
        border: `1px solid ${C.border}`, borderBottom: i === active ? `1px solid ${C.code}` : `1px solid ${C.border}`,
        borderRadius: '6px 6px 0 0', padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: '12px', fontWeight: i === active ? '700' : '500', whiteSpace: 'nowrap',
      }, basename(f.filePath) + (isDirty(i) ? ' •' : ''));
      t.addEventListener('click', () => { active = i; paintTabs(); paintCode(); });
      tabs.appendChild(t);
    });
  }

  function paintCode(): void {
    const f = files[active];
    const text = edited[active] ?? f?.source ?? '';
    if (editing) {
      pre.style.display = 'none';
      editor.style.display = 'block';
      editor.value = text;
      editor.focus();
    } else {
      editor.style.display = 'none';
      pre.style.display = 'block';
      pre.textContent = text;
      pre.scrollTop = 0;
    }
    gutter.scrollTop = 0;
    updateGutter(text);
    updateStatus(text);
  }

  editor.addEventListener('input', () => {
    edited[active] = editor.value;
    paintTabs();
    updateGutter(editor.value);
    updateStatus(editor.value);
  });

  // Editor keybindings: Tab/Shift+Tab to (un)indent, Cmd/Ctrl+S to save.
  editor.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      triggerSave();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const INDENT = '  ';
      const start = editor.selectionStart, end = editor.selectionEnd;
      const val = editor.value;
      if (!e.shiftKey && start === end) {
        editor.value = val.slice(0, start) + INDENT + val.slice(end);
        editor.selectionStart = editor.selectionEnd = start + INDENT.length;
      } else {
        // (un)indent every line the selection touches
        const ls = val.lastIndexOf('\n', start - 1) + 1;
        const before = val.slice(0, ls);
        const block = val.slice(ls, end);
        const rest = val.slice(end);
        let delta = 0, firstDelta = 0, first = true;
        const lines = block.split('\n').map((ln) => {
          if (e.shiftKey) {
            const rm = ln.startsWith('  ') ? 2 : ln.startsWith(' ') ? 1 : 0;
            delta -= rm; if (first) firstDelta = -rm;
            first = false;
            return ln.slice(rm);
          }
          delta += INDENT.length; if (first) firstDelta = INDENT.length;
          first = false;
          return INDENT + ln;
        });
        editor.value = before + lines.join('\n') + rest;
        editor.selectionStart = Math.max(ls, start + firstDelta);
        editor.selectionEnd = end + delta;
      }
      edited[active] = editor.value;
      paintTabs(); updateGutter(editor.value); updateStatus(editor.value);
    }
  });

  function paintFoot(): void {
    foot.innerHTML = '';
    if (!editing) {
      const copyBtn = btn('Copy file', 'plain');
      copyBtn.addEventListener('click', () => {
        const src = edited[active] ?? files[active]?.source ?? '';
        navigator.clipboard?.writeText(src).then(() => deps.flashToast?.('Copied ' + basename(files[active]?.filePath || 'file')));
      });
      foot.appendChild(copyBtn);
      if (canEdit) {
        const editBtn = btn('Edit', 'accent');
        editBtn.addEventListener('click', enterEdit);
        foot.appendChild(editBtn);
      }
      if (deps.setupUrl) {
        const link = el('a', { color: C.accent, textDecoration: 'none', fontWeight: '600' }, 'Open in Setup ↗') as HTMLAnchorElement;
        link.href = deps.setupUrl; link.target = '_blank'; link.rel = 'noopener';
        foot.appendChild(link);
      }
      foot.appendChild(el('span', { marginLeft: 'auto', color: C.muted, fontSize: '11px' }, component.bundleId));
    } else {
      const saveBtn = btn('Save & Deploy', 'accent');
      saveBtnRef = saveBtn;
      saveBtn.addEventListener('click', () => doSave(saveBtn));
      foot.appendChild(saveBtn);
      const cancelBtn = btn('Cancel', 'plain');
      cancelBtn.addEventListener('click', cancelEdit);
      foot.appendChild(cancelBtn);
      foot.appendChild(el('span', { marginLeft: 'auto', color: C.muted, fontSize: '11px' }, '⌘/Ctrl+S to save · Tab to indent'));
    }
  }

  let saveBtnRef: HTMLButtonElement | null = null;
  function triggerSave(): void {
    if (editing && saveBtnRef) doSave(saveBtnRef);
  }

  function btn(label: string, kind: 'accent' | 'plain' | 'danger'): HTMLButtonElement {
    const base: Partial<CSSStyleDeclaration> = { borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '700', fontSize: '12px', border: 'none' };
    const styled = kind === 'accent' ? { background: C.accent, color: '#fff' }
      : kind === 'danger' ? { background: C.danger, color: '#fff' }
      : { background: 'transparent', color: C.muted, border: `1px solid ${C.border}` };
    return el('button', { ...base, ...styled }, label);
  }

  function enterEdit(): void {
    editing = true;
    hideBanner();
    paintFoot(); paintCode();
    // resolve sandbox state once to warn on production
    if (isSandbox === undefined && deps.getIsSandbox) {
      deps.getIsSandbox().then((v) => {
        isSandbox = v;
        if (v === false) showBanner('⚠ Production org — saving deploys this change live to all users.', 'warn');
        else if (v === true) showBanner('Sandbox org — safe to experiment. Saving compiles & deploys the file.', 'info');
      });
    } else if (isSandbox === false) {
      showBanner('⚠ Production org — saving deploys this change live to all users.', 'warn');
    }
  }

  function cancelEdit(): void {
    if (anyDirty() && !window.confirm('Discard unsaved changes?')) return;
    editing = false;
    for (const k of Object.keys(edited)) delete edited[+k];
    hideBanner();
    paintFoot(); paintTabs(); paintCode();
  }

  function doSave(saveBtn: HTMLButtonElement): void {
    const f = files[active];
    if (!f) return;
    if (!isDirty(active)) { deps.flashToast?.('No changes to save'); return; }
    if (!f.id) { showBanner('This file has no resource id — cannot save.', 'error'); return; }
    showConfirm(basename(f.filePath), isSandbox === false, () => {
      saveBtn.disabled = true; saveBtn.textContent = 'Deploying…';
      deps.saveSource!(f.id!, edited[active]!).then((resp) => {
        saveBtn.disabled = false; saveBtn.textContent = 'Save & Deploy';
        if (resp.success) {
          files[active].source = edited[active]!;
          delete edited[active];
          deps.flashToast?.('Deployed ' + basename(f.filePath));
          if (resp.verified === false) {
            showBanner('Saved, but the org reports different source than was sent — please re-open and verify the change applied.', 'warn');
          } else {
            showBanner(resp.verified === true ? '✓ Deployed and verified in the org.' : '✓ Deployed successfully.', 'info');
          }
          paintTabs(); paintFoot(); updateStatus(files[active].source);
        } else {
          showBanner(resp.error || 'Save failed.', 'error');
        }
      });
    });
  }

  // in-panel confirmation overlay
  function showConfirm(fileName: string, production: boolean, onYes: () => void): void {
    const back = el('div', { position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '5', padding: '20px' });
    const card = el('div', { width: '100%', maxWidth: '360px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '18px', boxShadow: '0 12px 32px rgba(0,0,0,0.4)' });
    card.appendChild(el('div', { fontSize: '14px', fontWeight: '800', marginBottom: '8px' }, production ? '⚠ Deploy to PRODUCTION?' : 'Deploy this change?'));
    card.appendChild(el('div', { fontSize: '12.5px', color: C.muted, lineHeight: '1.5', marginBottom: '14px' },
      `Saving "${fileName}" compiles and deploys it to ${component.developerName} immediately.` + (production ? ' This is a production org — the change goes live to all users.' : '')));

    let okToGo = !production;
    const actions = el('div', { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' });
    if (production) {
      const lbl = el('label', { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: C.text, marginBottom: '14px', cursor: 'pointer', marginRight: 'auto' });
      const cb = el('input') as HTMLInputElement; cb.type = 'checkbox';
      lbl.appendChild(cb); lbl.appendChild(el('span', undefined, 'I understand this edits production'));
      card.appendChild(lbl);
      cb.addEventListener('change', () => { okToGo = cb.checked; (yes as HTMLButtonElement).disabled = !okToGo; (yes as HTMLButtonElement).style.opacity = okToGo ? '1' : '0.5'; });
    }
    const cancel = btn('Cancel', 'plain');
    const yes = btn(production ? 'Deploy to production' : 'Deploy', production ? 'danger' : 'accent');
    if (production) { (yes as HTMLButtonElement).disabled = true; yes.style.opacity = '0.5'; }
    cancel.addEventListener('click', () => back.remove());
    yes.addEventListener('click', () => { if (!okToGo) return; back.remove(); onYes(); });
    actions.appendChild(cancel); actions.appendChild(yes);
    card.appendChild(actions);
    back.appendChild(card);
    panel.appendChild(back);
  }

  // load source
  pre.textContent = 'Loading source…';
  deps.fetchSource(component.bundleId).then((resp) => {
    if (resp.error || !resp.files) { pre.textContent = resp.error || 'Could not load source.'; return; }
    files = resp.files.slice().sort((a, b) => (ORDER[a.format] ?? 9) - (ORDER[b.format] ?? 9) || a.filePath.localeCompare(b.filePath));
    if (files.length === 0) { pre.textContent = 'No source files returned for this bundle.'; return; }
    active = 0;
    paintTabs(); paintCode(); paintFoot();
  });

  function destroy(): void {
    if (anyDirty() && !window.confirm('Discard unsaved changes and close?')) return;
    panel.remove();
  }
  close.addEventListener('click', destroy);

  return { destroy };
}
