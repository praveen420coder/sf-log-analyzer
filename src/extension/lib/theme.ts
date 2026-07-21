// Shared design layer. One source of truth for the panel's colors so features
// don't each re-declare a palette. getTheme(isDark) returns the token set; the
// property names are a superset of what the features historically used, so
// migrating a feature is just `const C = getTheme(isDark)`.
//
// Structured so a future "SLDS" skin can be layered in by switching palettes
// inside getTheme without touching any feature code.
//
// NOTE: keep this module content-script-only (imported by features/ + content-ui,
// never by background.ts) so Rollup keeps it inside the content-ui bundle rather
// than emitting a shared chunk — see vite.config.ts.

export interface Theme {
  // surfaces
  bg: string;          // panel background
  panel: string;       // raised input / control background
  card: string;        // card surface
  subtle: string;      // subtle inset background
  headerBg: string;    // table / section header background
  side: string;        // side/inset panel background
  code: string;        // code editor background
  hover: string;       // row / control hover
  zebra: string;       // alternating row tint
  track: string;       // progress / gauge track
  // text
  text: string;
  muted: string;
  faint: string;
  // lines
  border: string;
  borderStrong: string;
  divider: string;
  // semantic
  accent: string;
  accentSoft: string;  // accent tint (soft fill)
  inputBg: string;     // form control background
  ok: string;
  success: string;     // alias of ok
  pass: string;
  warn: string;
  warning: string;     // alias of warn
  danger: string;
  fail: string;        // alias of danger
  grant: string;       // access/permission granted (green)
  chipBg: string;      // accent-tinted chip background
  diff: string;        // difference highlight (amber tint)
  // legacy aliases used by content-ui render helpers
  textPrimary: string; // = text
  textSecondary: string;
  textMuted: string;   // = muted
  textFaint: string;   // = faint
  surface: string;     // control/surface fill
  rowHover: string;    // = hover
}

const DARK: Theme = {
  bg: '#0e1626',
  panel: '#111c30',
  card: 'rgba(255,255,255,0.04)',
  subtle: '#0c1322',
  headerBg: '#16223b',
  side: '#0c1424',
  code: '#0b1220',
  hover: 'rgba(255,255,255,0.05)',
  zebra: 'rgba(255,255,255,0.025)',
  track: 'rgba(148,163,184,0.2)',
  text: '#e2e8f0',
  muted: '#94a3b8',
  faint: 'rgba(148,163,184,0.5)',
  border: 'rgba(148,163,184,0.22)',
  borderStrong: 'rgba(148,163,184,0.35)',
  divider: 'rgba(148,163,184,0.12)',
  accent: '#3b82f6',
  accentSoft: 'rgba(59,130,246,0.15)',
  inputBg: '#0b1220',
  ok: '#16a34a',
  success: '#16a34a',
  pass: '#22c55e',
  warn: '#f59e0b',
  warning: '#f59e0b',
  danger: '#ef4444',
  fail: '#ef4444',
  grant: '#4ade80',
  chipBg: 'rgba(59,130,246,0.14)',
  diff: 'rgba(245,158,11,0.14)',
  textPrimary: '#e2e8f0',
  textSecondary: 'rgba(226,232,240,0.85)',
  textMuted: '#94a3b8',
  textFaint: 'rgba(148,163,184,0.5)',
  surface: 'rgba(255,255,255,0.06)',
  rowHover: 'rgba(255,255,255,0.05)',
};

const LIGHT: Theme = {
  bg: '#ffffff',
  panel: '#ffffff',
  card: '#ffffff',
  subtle: '#f8fafc',
  headerBg: '#eef2f7',
  side: '#f8fafc',
  code: '#ffffff',
  hover: 'rgba(0,0,0,0.03)',
  zebra: 'rgba(0,0,0,0.02)',
  track: 'rgba(31,41,55,0.1)',
  text: '#1f2937',
  muted: '#64748b',
  faint: 'rgba(31,41,55,0.4)',
  border: 'rgba(0,0,0,0.12)',
  borderStrong: 'rgba(0,0,0,0.2)',
  divider: 'rgba(0,0,0,0.07)',
  accent: '#3b82f6',
  accentSoft: 'rgba(59,130,246,0.08)',
  inputBg: '#ffffff',
  ok: '#16a34a',
  success: '#16a34a',
  pass: '#16a34a',
  warn: '#f59e0b',
  warning: '#f59e0b',
  danger: '#ef4444',
  fail: '#ef4444',
  grant: '#16a34a',
  chipBg: 'rgba(59,130,246,0.10)',
  diff: 'rgba(245,158,11,0.12)',
  textPrimary: '#1f2937',
  textSecondary: 'rgba(31,41,55,0.8)',
  textMuted: '#64748b',
  textFaint: 'rgba(31,41,55,0.4)',
  surface: 'rgba(0,0,0,0.04)',
  rowHover: 'rgba(0,0,0,0.03)',
};

// ── Optional SLDS skin ───────────────────────────────────────────────────────
// An approximation of the Salesforce Lightning Design System palette. Enabling
// it re-colors every surface that uses getTheme(), with no feature-code changes.
const SLDS_LIGHT: Theme = {
  bg: '#ffffff', panel: '#ffffff', card: '#ffffff', subtle: '#f3f3f3', headerBg: '#f3f3f3',
  side: '#f3f3f3', code: '#ffffff',
  hover: '#f3f3f3', zebra: '#fafaf9', track: '#e5e5e5',
  text: '#181818', muted: '#5c5c5c', faint: '#747474',
  border: '#c9c9c9', borderStrong: '#939393', divider: '#e5e5e5',
  accent: '#0176d3', accentSoft: 'rgba(1,118,211,0.08)', inputBg: '#ffffff', ok: '#2e844a', success: '#2e844a', pass: '#2e844a',
  warn: '#fe9339', warning: '#fe9339', danger: '#ea001e', fail: '#ea001e',
  grant: '#2e844a', chipBg: '#eef4ff', diff: '#fef5e7',
  textPrimary: '#181818', textSecondary: '#444444', textMuted: '#5c5c5c', textFaint: '#747474',
  surface: '#f3f3f3', rowHover: '#f3f3f3',
};

const SLDS_DARK: Theme = {
  bg: '#1a1b1e', panel: '#232428', card: '#232428', subtle: '#161719', headerBg: '#2e2f33',
  side: '#161719', code: '#161719',
  hover: 'rgba(255,255,255,0.06)', zebra: 'rgba(255,255,255,0.03)', track: 'rgba(255,255,255,0.15)',
  text: '#f3f3f3', muted: '#aeaeae', faint: '#8c8c8c',
  border: 'rgba(255,255,255,0.2)', borderStrong: 'rgba(255,255,255,0.35)', divider: 'rgba(255,255,255,0.12)',
  accent: '#1b96ff', accentSoft: 'rgba(27,150,255,0.16)', inputBg: '#161719', ok: '#41b658', success: '#41b658', pass: '#41b658',
  warn: '#fe9339', warning: '#fe9339', danger: '#fe5c4c', fail: '#fe5c4c',
  grant: '#41b658', chipBg: 'rgba(27,150,255,0.16)', diff: 'rgba(254,147,57,0.16)',
  textPrimary: '#f3f3f3', textSecondary: '#d5d5d5', textMuted: '#aeaeae', textFaint: '#8c8c8c',
  surface: 'rgba(255,255,255,0.06)', rowHover: 'rgba(255,255,255,0.06)',
};

export type UiSkin = 'default' | 'slds';
let uiMode: UiSkin = 'default';
// Called on startup + when the user flips the setting. getTheme reads it live.
export function setUiMode(mode: UiSkin): void { uiMode = mode === 'slds' ? 'slds' : 'default'; }
export function getUiMode(): UiSkin { return uiMode; }

export function getTheme(isDark: boolean): Theme {
  if (uiMode === 'slds') return isDark ? SLDS_DARK : SLDS_LIGHT;
  return isDark ? DARK : LIGHT;
}

// ── shared style builders ────────────────────────────────────────────────────
// Reusable inline-style objects so features stop hand-writing the same button /
// input / card CSS on every element. Spread the result onto Object.assign(...).

export function buttonStyle(C: Theme, variant: 'accent' | 'neutral' | 'danger' | 'success' = 'neutral'): Partial<CSSStyleDeclaration> {
  const base: Partial<CSSStyleDeclaration> = {
    borderRadius: '8px', padding: '8px 14px', cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: '700', fontSize: '13px', border: 'none', whiteSpace: 'nowrap',
  };
  if (variant === 'accent') return { ...base, background: C.accent, color: '#fff' };
  if (variant === 'danger') return { ...base, background: C.danger, color: '#fff' };
  if (variant === 'success') return { ...base, background: C.ok, color: '#fff' };
  return { ...base, background: 'transparent', color: C.text, border: `1px solid ${C.border}` };
}

export function inputStyle(C: Theme): Partial<CSSStyleDeclaration> {
  return {
    boxSizing: 'border-box', padding: '9px 12px', fontSize: '13px', borderRadius: '10px',
    border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none',
  };
}

export function cardStyle(C: Theme): Partial<CSSStyleDeclaration> {
  return { background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px 18px' };
}
