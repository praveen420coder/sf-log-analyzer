// Custom Shortcuts manager: add/edit/delete user-defined Setup links. Saved
// shortcuts surface in the Spotlight "Setup" search. Decoupled from content-ui;
// owns its data through the state/customShortcuts module.

import { getCustomShortcuts, addCustomShortcut, updateCustomShortcut, deleteCustomShortcut, normalizeUrl, type CustomShortcut } from '../state/customShortcuts';
import { sfProtocol, sfHostname } from '../lib/sfUrls';
import { getTheme } from '../lib/theme';

export interface CustomShortcutsDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast: (msg: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

/** Resolve a stored shortcut URL to an absolute URL for opening. */
export function resolveShortcutUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith('/') ? url : '/' + url;
  return `${sfProtocol()}//${sfHostname()}${path}`;
}

export function renderCustomShortcutsInto(host: HTMLElement, deps: CustomShortcutsDeps): void {
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
  head.appendChild(el('div', { fontSize: '15px', fontWeight: '800', color: C.text }, '🔖 Custom Shortcuts'));
  root.appendChild(head);

  // form
  const form = el('div', { display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  root.appendChild(form);

  const mkInput = (placeholder: string) => {
    const i = el('input', { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit' }) as HTMLInputElement;
    i.placeholder = placeholder;
    return i;
  };
  const labelInput = mkInput('Label  (e.g. My Flows Dashboard)');
  const urlInput = mkInput('URL or Setup path  (e.g. /lightning/setup/Flows/home or https://…)');
  form.appendChild(labelInput);
  form.appendChild(urlInput);
  form.appendChild(el('div', { fontSize: '11px', color: C.faint }, 'Use a full URL (https://…) or a relative Setup path. Relative paths open in your current org. Saved shortcuts appear in Setup search.'));

  let editingId: string | null = null;
  const actionRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  const addBtn = el('button', { background: C.accent, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '700', fontSize: '13px' }, 'Add shortcut');
  const cancelBtn = el('button', { display: 'none', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '600', fontSize: '13px' }, 'Cancel');
  actionRow.appendChild(addBtn);
  actionRow.appendChild(cancelBtn);
  form.appendChild(actionRow);

  const err = el('div', { display: 'none', fontSize: '12px', color: C.danger, fontWeight: '600' });
  form.appendChild(err);
  const showErr = (m: string) => { err.textContent = m; err.style.display = 'block'; };
  const clearErr = () => { err.style.display = 'none'; };

  function resetForm(): void {
    editingId = null;
    labelInput.value = ''; urlInput.value = '';
    addBtn.textContent = 'Add shortcut';
    cancelBtn.style.display = 'none';
    clearErr();
  }

  function submit(): void {
    const label = labelInput.value.trim();
    const url = urlInput.value.trim();
    if (!label) { showErr('Please enter a label.'); labelInput.focus(); return; }
    if (!url) { showErr('Please enter a URL or Setup path.'); urlInput.focus(); return; }
    if (editingId) {
      updateCustomShortcut(editingId, label, url);
      deps.flashToast('Shortcut updated');
    } else {
      addCustomShortcut(label, url);
      deps.flashToast('Shortcut added');
    }
    resetForm();
    renderList();
  }
  addBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', resetForm);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  [labelInput, urlInput].forEach((i) => i.addEventListener('input', clearErr));

  // list
  const listWrap = el('div', { flex: '1', minHeight: '0', overflowY: 'auto', padding: '8px 16px 20px' });
  root.appendChild(listWrap);

  function startEdit(s: CustomShortcut): void {
    editingId = s.id;
    labelInput.value = s.label; urlInput.value = s.url;
    addBtn.textContent = 'Save changes';
    cancelBtn.style.display = 'inline-block';
    clearErr();
    labelInput.focus();
  }

  function renderList(): void {
    listWrap.innerHTML = '';
    const items = getCustomShortcuts();
    listWrap.appendChild(el('div', { fontSize: '11px', color: C.faint, fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 8px 6px' }, `${items.length} shortcut${items.length === 1 ? '' : 's'}`));
    if (items.length === 0) {
      listWrap.appendChild(el('div', { padding: '24px 8px', color: C.muted, fontSize: '13px' }, 'No shortcuts yet. Add one above — it will show up in the Setup search.'));
      return;
    }
    items.forEach((s, idx) => {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 10px', borderRadius: '8px', background: idx % 2 ? C.zebra : 'transparent' });
      const txt = el('div', { display: 'flex', flexDirection: 'column', minWidth: '0', flex: '1' });
      txt.appendChild(el('div', { fontSize: '13px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, s.label));
      txt.appendChild(el('div', { fontSize: '11.5px', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, normalizeUrl(s.url)));
      row.appendChild(txt);

      const mkIconBtn = (glyph: string, title: string, color: string) => {
        const b = el('button', { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: '7px', width: '30px', height: '30px', cursor: 'pointer', color, fontSize: '14px', lineHeight: '1', flexShrink: '0', fontFamily: 'inherit' }, glyph);
        b.title = title;
        return b;
      };
      const openBtn = mkIconBtn('↗', 'Open', C.muted);
      openBtn.addEventListener('click', () => window.open(resolveShortcutUrl(s.url), '_blank'));
      const editBtn = mkIconBtn('✎', 'Edit', C.accent);
      editBtn.addEventListener('click', () => startEdit(s));
      const delBtn = mkIconBtn('🗑', 'Delete', C.danger);
      delBtn.addEventListener('click', () => {
        deleteCustomShortcut(s.id);
        if (editingId === s.id) resetForm();
        deps.flashToast('Shortcut removed');
        renderList();
      });
      row.appendChild(openBtn); row.appendChild(editBtn); row.appendChild(delBtn);
      listWrap.appendChild(row);
    });
  }

  renderList();
  setTimeout(() => labelInput.focus(), 30);
}
