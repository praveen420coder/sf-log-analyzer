// Shared UI kit for the Object Manager tool — palette + small form-control
// factories so objectForm.ts and fieldWizard.ts stay declarative. Follows the
// same inline-style, no-framework approach as the other Tools-drawer apps.

import { getTheme, type Theme } from '../../lib/theme';

// Palette is a subset of the shared Theme; delegate so Object Manager (and
// Automation Map, which reuses this) pick up the shared design layer + SLDS skin.
export type Palette = Theme;

export function palette(isDark: boolean): Palette {
  return getTheme(isDark);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

/** Section heading with a subtle divider — mirrors Setup's section headers. */
export function section(C: Palette, title: string): HTMLElement {
  const h = el('div', { margin: '22px 0 10px', paddingBottom: '6px', borderBottom: `1px solid ${C.divider}`, fontSize: '12px', fontWeight: '800', letterSpacing: '0.06em', textTransform: 'uppercase', color: C.faint }, title);
  return h;
}

export interface FieldRowOpts { help?: string; required?: boolean }

/** Label + control on one responsive row. */
export function row(C: Palette, label: string, control: HTMLElement, opts?: FieldRowOpts): HTMLElement {
  const wrap = el('div', { display: 'flex', gap: '14px', alignItems: 'flex-start', padding: '7px 0' });
  const lab = el('div', { width: '210px', flexShrink: '0', paddingTop: '7px', fontSize: '12.5px', fontWeight: '700', color: C.muted });
  lab.textContent = label;
  if (opts?.required) lab.appendChild(el('span', { color: C.danger, marginLeft: '3px' }, '*'));
  const right = el('div', { flex: '1', minWidth: '0' });
  right.appendChild(control);
  if (opts?.help) right.appendChild(el('div', { fontSize: '11px', color: C.faint, marginTop: '4px', lineHeight: '1.4' }, opts.help));
  wrap.appendChild(lab); wrap.appendChild(right);
  return wrap;
}

export function textInput(C: Palette, placeholder = '', value = ''): HTMLInputElement {
  const i = el('input', { width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit' }) as HTMLInputElement;
  i.placeholder = placeholder; i.value = value;
  return i;
}

export function numberInput(C: Palette, value = '', min?: number, max?: number): HTMLInputElement {
  const i = textInput(C, '', value);
  i.type = 'number';
  if (min != null) i.min = String(min);
  if (max != null) i.max = String(max);
  i.style.maxWidth = '140px';
  return i;
}

export function textArea(C: Palette, placeholder = '', rows = 3): HTMLTextAreaElement {
  const t = el('textarea', { width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', resize: 'vertical' }) as HTMLTextAreaElement;
  t.placeholder = placeholder; t.rows = rows;
  return t;
}

export function select(C: Palette, options: Array<{ value: string; label: string }>, selected?: string): HTMLSelectElement {
  const s = el('select', { padding: '7px 10px', fontSize: '13px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.inputBg, color: C.text, fontFamily: 'inherit', maxWidth: '100%' }) as HTMLSelectElement;
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === selected) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}

export function checkbox(C: Palette, label: string, checked = false): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: C.text, padding: '4px 0', userSelect: 'none' });
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox'; input.checked = checked;
  Object.assign(input.style, { width: '15px', height: '15px', accentColor: C.accent, cursor: 'pointer' });
  wrap.appendChild(input);
  wrap.appendChild(document.createTextNode(label));
  return { wrap, input };
}

export function button(C: Palette, label: string, kind: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement {
  const b = el('button', {
    padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit',
    border: kind === 'ghost' ? `1px solid ${C.border}` : 'none',
    background: kind === 'primary' ? C.accent : kind === 'danger' ? C.danger : 'transparent',
    color: kind === 'ghost' ? C.muted : '#ffffff',
  }, label) as HTMLButtonElement;
  return b;
}

/** Inline validation / status banner. Hidden until shown. */
export function banner(C: Palette): { node: HTMLElement; show: (msg: string, kind: 'error' | 'success' | 'info') => void; hide: () => void } {
  const node = el('div', { display: 'none', padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '600', margin: '10px 0', whiteSpace: 'pre-wrap', lineHeight: '1.5' });
  return {
    node,
    show(msg, kind) {
      node.textContent = msg;
      node.style.display = 'block';
      node.style.background = kind === 'error' ? 'rgba(239,68,68,0.12)' : kind === 'success' ? 'rgba(22,163,74,0.12)' : C.accentSoft;
      node.style.color = kind === 'error' ? C.danger : kind === 'success' ? C.success : C.accent;
      node.style.border = `1px solid ${kind === 'error' ? 'rgba(239,68,68,0.3)' : kind === 'success' ? 'rgba(22,163,74,0.3)' : 'rgba(59,130,246,0.3)'}`;
    },
    hide() { node.style.display = 'none'; },
  };
}

/** Standard tool header: "← Tools / 🧩 Title" with optional right-side slot. */
export function toolHeader(C: Palette, title: string, onBack: () => void, backLabel = 'Tools'): { head: HTMLElement; right: HTMLElement } {
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 24px 12px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const back = el('button', { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontFamily: 'inherit', fontSize: '13px', fontWeight: '700' });
  back.innerHTML = `<span style="font-size:15px">←</span> ${backLabel}`;
  back.addEventListener('click', onBack);
  head.appendChild(back);
  head.appendChild(el('span', { color: C.faint }, '/'));
  head.appendChild(el('div', { fontSize: '15px', fontWeight: '800', color: C.text }, title));
  const right = el('div', { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' });
  head.appendChild(right);
  return { head, right };
}

/** Label → API name, matching Setup's autofill (spaces → _, strip invalid). */
export function labelToApiName(label: string): string {
  return label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^([0-9])/, 'X$1');
}

/** Validate a developer name the way Setup does. Returns an error or null. */
export function validateApiName(name: string): string | null {
  if (!name) return 'API name is required.';
  if (!/^[A-Za-z]/.test(name)) return 'API name must begin with a letter.';
  if (/__/.test(name)) return 'API name cannot contain two consecutive underscores.';
  if (/_$/.test(name)) return 'API name cannot end with an underscore.';
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'API name can only contain letters, numbers, and underscores.';
  if (name.length > 40) return 'API name cannot exceed 40 characters.';
  return null;
}
