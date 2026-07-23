// Theme-aware JSON syntax highlighting → HTML string. Input is HTML-escaped
// before highlighting, so it's safe to assign to innerHTML. Shared by the Event
// Monitor and REST Explorer response viewers.

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);

function palette(isDark: boolean) {
  return isDark
    ? { key: '#7dd3fc', string: '#86efac', number: '#fbbf24', bool: '#c4b5fd', nul: '#94a3b8' }
    : { key: '#0369a1', string: '#15803d', number: '#b45309', bool: '#7c3aed', nul: '#64748b' };
}

// Highlight an already-formatted (indented) JSON string.
export function highlightJsonText(json: string, isDark: boolean): string {
  const jc = palette(isDark);
  return escapeHtml(json).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, kw, num) => {
      if (str !== undefined) return colon ? `<span style="color:${jc.key}">${str}</span>${colon}` : `<span style="color:${jc.string}">${str}</span>`;
      if (kw !== undefined) return `<span style="color:${kw === 'null' ? jc.nul : jc.bool}">${kw}</span>`;
      if (num !== undefined) return `<span style="color:${jc.number}">${num}</span>`;
      return m;
    },
  );
}

// Stringify a value (pretty) then highlight it.
export function highlightJson(value: unknown, isDark: boolean): string {
  let json: string;
  try { json = JSON.stringify(value, null, 2); } catch { return escapeHtml(String(value)); }
  return highlightJsonText(json, isDark);
}
