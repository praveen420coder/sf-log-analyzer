// Execute Anonymous Apex — write Apex, run it against the current org, and drop
// straight into the Log Analyzer with the captured debug log.
//
// The debug log comes back inline from the Apex SOAP API's DebuggingHeader
// (see the EXECUTE_ANONYMOUS handler), so there's no trace flag to manage and
// no ApexLog to poll. Backend-agnostic via injected deps — see
// [[file-structure-convention]].

export interface ExecAnonResult {
  success: boolean;          // message-level: did the SOAP call itself succeed?
  error?: string;            // message-level error (network / SOAP fault)
  compiled?: boolean;        // did the Apex compile?
  exceptionThrown?: boolean; // compiled & ran, but threw an unhandled exception
  compileProblem?: string;
  line?: number;
  column?: number;
  exceptionMessage?: string;
  exceptionStackTrace?: string;
  debugLog?: string;
}

export interface ExecuteAnonymousDeps {
  isDark: boolean;
  orgLabel?: string;
  flashToast: (m: string) => void;
  onBack: () => void;
  execute: (apexBody: string, logLevel: string) => Promise<ExecAnonResult>;
  /** Render the Log Analyzer for a captured debug log into `host`; `onBack`
   *  returns to this tool with its editor + result preserved. */
  renderAnalyzer: (host: HTMLElement, logBody: string, name: string, onBack: () => void) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

const LOG_LEVELS: [string, string][] = [
  ['standard', 'Standard (Apex DEBUG)'],
  ['detailed', 'Detailed (FINEST)'],
  ['profiling', 'Profiling'],
];

const SAMPLE = `// Write Apex to run anonymously against this org.
System.debug('Signed in as ' + UserInfo.getName());
`;

export function renderExecuteAnonymousInto(host: HTMLElement, deps: ExecuteAnonymousDeps): void {
  const isDark = deps.isDark;
  const C = {
    bg: isDark ? '#0e1626' : '#ffffff',
    panel: isDark ? '#111c30' : '#ffffff',
    subtle: isDark ? '#0c1322' : '#f8fafc',
    headerBg: isDark ? '#16223b' : '#eef2f7',
    text: isDark ? '#e2e8f0' : '#1f2937',
    muted: isDark ? '#94a3b8' : '#64748b',
    faint: isDark ? 'rgba(148,163,184,0.5)' : 'rgba(31,41,55,0.4)',
    border: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,0,0,0.12)',
    divider: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.07)',
    accent: '#3b82f6',
    pass: '#22c55e',
    fail: '#ef4444',
  };

  // Persisted across the analyzer round-trip so hitting "back" restores state.
  let code = SAMPLE;
  let logLevel = 'standard';
  let lastResult: ExecAnonResult | null = null;
  let running = false;

  function renderMain() {
    host.innerHTML = '';
    const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
    host.appendChild(root);

    // ── header ──
    const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
    const back = el('button', { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '← Tools');
    back.addEventListener('click', deps.onBack);
    head.appendChild(back);
    const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
    titleWrap.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '⚡ Execute Anonymous'));
    titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, deps.orgLabel ? `Run Apex & analyze the log · ${deps.orgLabel}` : 'Run Apex & analyze the debug log'));
    head.appendChild(titleWrap);
    root.appendChild(head);

    const bodyWrap = el('div', { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', padding: '16px 24px 0' });
    root.appendChild(bodyWrap);

    // ── editor ──
    const editor = el('textarea', {
      width: '100%', boxSizing: 'border-box', flex: '1', minHeight: '160px', resize: 'none',
      padding: '12px 14px', fontSize: '13px', lineHeight: '1.55', borderRadius: '10px',
      border: `1px solid ${C.border}`, background: C.subtle, color: C.text, outline: 'none',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre', tabSize: '2',
    }) as HTMLTextAreaElement;
    editor.value = code;
    editor.spellcheck = false;
    editor.addEventListener('input', () => { code = editor.value; });
    // Tab inserts two spaces; Cmd/Ctrl+Enter runs.
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = editor.selectionStart, en = editor.selectionEnd;
        editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(en);
        editor.selectionStart = editor.selectionEnd = s + 2;
        code = editor.value;
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        run();
      }
    });
    bodyWrap.appendChild(editor);

    // ── controls ──
    const controls = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', flexShrink: '0' });
    const lvlLabel = el('span', { fontSize: '12.5px', color: C.muted }, 'Log level');
    const lvlSel = el('select', { padding: '7px 10px', fontSize: '12.5px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', cursor: 'pointer' }) as HTMLSelectElement;
    LOG_LEVELS.forEach(([v, label]) => { const o = el('option', undefined, label); o.value = v; if (v === logLevel) o.selected = true; lvlSel.appendChild(o); });
    lvlSel.addEventListener('change', () => { logLevel = lvlSel.value; });
    const runBtn = el('button', { marginLeft: 'auto', background: C.accent, border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, running ? 'Running…' : '▶ Execute');
    runBtn.title = 'Execute (⌘/Ctrl + Enter)';
    runBtn.addEventListener('click', run);
    if (running) { runBtn.style.opacity = '0.6'; runBtn.style.pointerEvents = 'none'; }
    controls.appendChild(lvlLabel); controls.appendChild(lvlSel); controls.appendChild(runBtn);
    bodyWrap.appendChild(controls);

    // ── result ──
    const resultScroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', paddingBottom: '20px' });
    bodyWrap.appendChild(resultScroll);
    if (lastResult) renderResult(resultScroll, lastResult);
    else resultScroll.appendChild(el('div', { padding: '18px 2px', fontSize: '12.5px', color: C.faint }, 'Results and the captured debug log appear here after you run.'));

    editor.focus();

    async function run() {
      if (running) return;
      const src = editor.value.trim();
      if (!src) { deps.flashToast('Nothing to execute'); return; }
      running = true; code = editor.value;
      runBtn.textContent = 'Running…'; runBtn.style.opacity = '0.6'; runBtn.style.pointerEvents = 'none';
      const res = await deps.execute(code, logLevel);
      running = false; lastResult = res;
      runBtn.textContent = '▶ Execute'; runBtn.style.opacity = '1'; runBtn.style.pointerEvents = 'auto';
      renderResult(resultScroll, res);
    }
  }

  function renderResult(container: HTMLElement, res: ExecAnonResult) {
    container.innerHTML = '';

    const banner = (text: string, color: string) => {
      const b = el('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: '700', border: `1px solid ${color}55`, background: `${color}14`, color });
      b.textContent = text;
      return b;
    };
    const pre = (text: string) => el('pre', {
      margin: '10px 0 0', padding: '12px 14px', borderRadius: '8px', background: C.subtle,
      border: `1px solid ${C.border}`, color: C.text, fontSize: '12.5px', lineHeight: '1.5',
      whiteSpace: 'pre-wrap', overflowX: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }, text);

    if (!res.success) {
      container.appendChild(banner('✕ Could not run', C.fail));
      container.appendChild(pre(res.error || 'Unknown error.'));
      return;
    }

    if (res.compiled === false) {
      const at = (res.line != null && res.line >= 0) ? ` (line ${res.line}${res.column != null && res.column >= 0 ? `, col ${res.column}` : ''})` : '';
      container.appendChild(banner('✕ Compilation failed' + at, C.fail));
      container.appendChild(pre(res.compileProblem || 'Unknown compile error.'));
    } else if (res.exceptionThrown) {
      container.appendChild(banner('✕ Unhandled exception', C.fail));
      container.appendChild(pre([res.exceptionMessage, res.exceptionStackTrace].filter(Boolean).join('\n\n') || 'No exception detail returned.'));
    } else {
      container.appendChild(banner('✓ Executed successfully', C.pass));
    }

    // Debug-log actions — available whenever a log came back.
    if (res.debugLog) {
      const log = res.debugLog;
      const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', flexWrap: 'wrap' });
      const name = `ExecuteAnonymous ${new Date().toLocaleTimeString()}`;
      const mkBtn = (label: string, primary = false) => el('button', {
        background: primary ? C.accent : 'transparent', border: primary ? 'none' : `1px solid ${C.border}`,
        color: primary ? '#fff' : C.text, borderRadius: '8px', padding: '8px 14px', cursor: 'pointer',
        fontSize: '12.5px', fontWeight: '700', fontFamily: 'inherit',
      }, label);

      const analyzeBtn = mkBtn('🔬 Open in Log Analyzer', true);
      analyzeBtn.addEventListener('click', () => deps.renderAnalyzer(host, log, name, renderMain));
      const copyBtn = mkBtn('Copy log');
      copyBtn.addEventListener('click', () => navigator.clipboard?.writeText(log).then(() => deps.flashToast('Log copied')).catch(() => {}));
      const dlBtn = mkBtn('Download');
      dlBtn.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([log], { type: 'text/plain' }));
        a.download = 'ExecuteAnonymous.log'; document.body.appendChild(a); a.click(); a.remove();
      });
      bar.appendChild(analyzeBtn); bar.appendChild(copyBtn); bar.appendChild(dlBtn);
      container.appendChild(bar);
    } else {
      container.appendChild(el('div', { marginTop: '12px', fontSize: '12px', color: C.faint }, 'No debug log was returned for this run.'));
    }
  }

  renderMain();
}
