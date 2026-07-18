// Apex Test Runner — pick test classes/methods, run them, watch results live,
// and view code coverage. Backend-agnostic via injected runQuery / runTests.

export interface ApexTestDeps {
  isDark: boolean;
  orgLabel?: string;
  flashToast: (m: string) => void;
  runQuery: (soql: string, tooling?: boolean) => Promise<{ records: any[]; error?: string }>;
  runTests: (payload: any) => Promise<{ jobId?: string; error?: string }>;
}

interface TestClass { id: string; name: string; methods: string[]; }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

// Pull test classes + their @IsTest methods out of ApexClass SymbolTable records.
// Returns the parsed test classes plus the Ids of records whose SymbolTable was
// missing/empty — those can't be trusted here and need the Body fallback below.
// (SymbolTable is computed lazily and is frequently null in freshly deployed
// scratch orgs, which would otherwise make real test classes disappear.)
function parseTestClasses(records: any[]): { classes: TestClass[]; unresolvedIds: string[] } {
  const out: TestClass[] = [];
  const unresolvedIds: string[] = [];
  for (const r of records) {
    const st = r.SymbolTable;
    // A valid SymbolTable has a tableDeclaration. When it's null/empty we can't
    // tell if this is a test class — defer to the Body-based fallback instead.
    if (!st || !st.tableDeclaration) { unresolvedIds.push(r.Id); continue; }
    const classAnns = (st.tableDeclaration?.annotations || []).map((a: any) => (a.name || '').toLowerCase());
    const isTestClass = classAnns.includes('istest');
    const methods: string[] = [];
    for (const m of st.methods || []) {
      const anns = (m.annotations || []).map((a: any) => (a.name || '').toLowerCase());
      const mods = (m.modifiers || []).map((x: any) => String(x).toLowerCase());
      if (anns.includes('istest') || mods.includes('testmethod')) {
        if (m.name && !methods.includes(m.name)) methods.push(m.name);
      }
    }
    if (isTestClass || methods.length) {
      out.push({ id: r.Id, name: r.Name, methods: methods.sort() });
    }
  }
  return { classes: out, unresolvedIds };
}

// Fallback parser for when SymbolTable is unavailable: detect test classes and
// their test methods directly from the Apex Body. Comments are stripped first to
// avoid false positives. A class qualifies if it carries a class-level @IsTest
// annotation or defines any test method (@IsTest method or the legacy
// `testMethod` modifier).
function parseTestClassFromBody(id: string, name: string, body: string): TestClass | null {
  if (!body) return null;
  // Strip block and line comments.
  const src = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  // Class-level @IsTest: look at the text before the first `class` keyword.
  const classKw = src.search(/\bclass\b/i);
  const head = classKw >= 0 ? src.slice(0, classKw) : src;
  const classIsTest = /@istest\b/i.test(head);

  // Test methods: scan for method headers `name(params) {`, then inspect the
  // declaration segment immediately before the name (bounded by the previous
  // `;`, `{`, or `}`, so it holds only this method's own annotations/modifiers,
  // not the class-level ones or a prior method's body). A method is a test if
  // that segment carries @IsTest or the legacy `testMethod` modifier. This is
  // resilient to modifier ordering (e.g. `static testMethod void foo()`).
  const methods: string[] = [];
  // Params never contain parens in Apex, so excluding ()  stops an annotation
  // like `@IsTest(SeeAllData=true)` from swallowing the method header after it.
  const headerRe = /([A-Za-z_]\w*)\s*\([^;{}()]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(src)) !== null) {
    const methodName = m[1];
    const nameStart = m.index;
    // Walk back to the nearest statement/block boundary to isolate this decl.
    let segStart = 0;
    for (let i = nameStart - 1; i >= 0; i--) {
      const ch = src[i];
      if (ch === ';' || ch === '{' || ch === '}') { segStart = i + 1; break; }
    }
    const segment = src.slice(segStart, nameStart).toLowerCase();
    const isTestMethod = /@istest\b/.test(segment) || /\btestmethod\b/.test(segment);
    if (isTestMethod && methodName && !methods.includes(methodName)) methods.push(methodName);
  }

  if (!classIsTest && methods.length === 0) return null;
  return { id, name, methods: methods.sort() };
}

export function renderApexTestsInto(host: HTMLElement, deps: ApexTestDeps): void {
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
    hover: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    zebra: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
  };

  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  // ── header ──
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', flexShrink: '0', borderBottom: `1px solid ${C.divider}` });
  const titleWrap = el('div', { display: 'flex', flexDirection: 'column' });
  titleWrap.appendChild(el('div', { fontSize: '16px', fontWeight: '800' }, '🧪 Apex Tests'));
  titleWrap.appendChild(el('div', { fontSize: '12px', color: C.muted }, deps.orgLabel ? `Execute & monitor tests · ${deps.orgLabel}` : 'Execute & monitor Apex test classes'));
  head.appendChild(titleWrap);
  const refreshBtn = el('button', { marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '↻ Refresh');
  refreshBtn.addEventListener('click', () => { if (view === 'results') loadHistory(true); else if (view === 'coverage') renderCoverage(); else loadClasses(true); });
  head.appendChild(refreshBtn);
  root.appendChild(head);

  // ── sub-tabs ──
  const tabBar = el('div', { display: 'flex', gap: '4px', padding: '0 18px', borderBottom: `1px solid ${C.divider}`, flexShrink: '0' });
  root.appendChild(tabBar);
  let view: 'run' | 'results' | 'coverage' = 'run';
  const tabBtns: Record<string, HTMLButtonElement> = {};
  const TABS: [string, string][] = [['run', 'New Test Run'], ['results', 'Test Results'], ['coverage', 'Code Coverage']];
  TABS.forEach(([id, label]) => {
    const b = el('button', { background: 'transparent', border: 'none', padding: '12px 14px', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', color: C.muted, borderBottom: '2px solid transparent' }, label);
    b.addEventListener('click', () => selectView(id as any));
    tabBtns[id] = b; tabBar.appendChild(b);
  });
  const paintTabs = () => Object.entries(tabBtns).forEach(([id, b]) => Object.assign(b.style, { color: view === id ? C.text : C.muted, borderBottom: view === id ? `2px solid ${C.accent}` : '2px solid transparent', fontWeight: view === id ? '700' : '500' }));

  const body = el('div', { flex: '1', minHeight: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' });
  root.appendChild(body);

  function selectView(v: 'run' | 'results' | 'coverage') {
    view = v; paintTabs();
    if (v === 'run') renderRun();
    else if (v === 'results') { renderResults(); if (!historyLoaded) loadHistory(); }
    else renderCoverage();
  }

  // ── state ──
  let classes: TestClass[] = [];
  let loaded = false;
  let loadError = '';
  const selected = new Map<string, Set<string>>(); // classId -> selected method names
  const expanded = new Set<string>();
  let searchVal = '';
  // Test runs from this session (newest first).
  interface RunInfo { jobId: string; enqueued: Date; classes: { id: string; name: string; status: string; ext: string }[]; results: any[]; done: boolean; }
  let runs: RunInfo[] = [];
  let activeJobId: string | null = null;
  let pollTimer: any = null;
  let historyLoaded = false;
  let loadingHistory = false;
  const expandedRuns = new Set<string>();
  const expandedClasses = new Set<string>(); // key `${jobId}|${className}`
  const rFilter = { run: '', message: '', status: '', outcome: '' };
  const DONE_STATUSES = ['Completed', 'Failed', 'Aborted'];

  const isAlive = () => document.body.contains(root);

  // ── data loading ──
  let orgNamespace: string | null | undefined; // undefined = not yet looked up

  // The org's own namespace. In a namespaced scratch/dev org, the developer's
  // OWN Apex classes carry this namespace — so filtering on `NamespacePrefix =
  // null` alone hides every local test class. We include null OR this namespace,
  // which still excludes installed managed packages (other namespaces).
  async function getOrgNamespace(): Promise<string | null> {
    if (orgNamespace !== undefined) return orgNamespace;
    const { records, error } = await deps.runQuery('SELECT NamespacePrefix FROM Organization LIMIT 1', false);
    const ns: string | null = error ? null : (records?.[0]?.NamespacePrefix ?? null);
    orgNamespace = ns;
    return ns;
  }

  // Escape a value for a single-quoted SOQL string literal.
  const soqlStr = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  async function loadClasses(force = false) {
    if (loaded && !force) return;

    const ns = await getOrgNamespace();
    const nsClause = ns ? `(NamespacePrefix = null OR NamespacePrefix = ${soqlStr(ns)})` : 'NamespacePrefix = null';
    const { records, error } = await deps.runQuery(
      `SELECT Id, Name, SymbolTable FROM ApexClass WHERE ${nsClause} AND Status = 'Active' ORDER BY Name LIMIT 2000`, true);
    loaded = true;
    if (error) { loadError = error; if (view === 'run') renderRun(); return; }
    loadError = '';

    const { classes: parsed, unresolvedIds } = parseTestClasses(records || []);
    const byId = new Map<string, TestClass>(parsed.map((c) => [c.id, c]));

    // Fallback: some classes came back with no usable SymbolTable (common right
    // after a scratch-org deploy). Fetch their Body and detect tests from source
    // so they don't silently vanish from the list.
    if (unresolvedIds.length) {
      const bodyClasses = await loadClassesFromBody(unresolvedIds);
      for (const c of bodyClasses) if (!byId.has(c.id)) byId.set(c.id, c);
    }

    classes = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (view === 'run') renderRun();
  }

  // Fetch Body for the given class Ids (chunked to keep SOQL under limits) and
  // parse test classes/methods from source.
  async function loadClassesFromBody(ids: string[]): Promise<TestClass[]> {
    const out: TestClass[] = [];
    const CHUNK = 150;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const inClause = ids.slice(i, i + CHUNK).map(soqlStr).join(',');
      const { records, error } = await deps.runQuery(
        `SELECT Id, Name, Body FROM ApexClass WHERE Id IN (${inClause})`, true);
      if (error) continue; // best-effort; skip this chunk on failure
      for (const r of records || []) {
        const tc = parseTestClassFromBody(r.Id, r.Name, r.Body || '');
        if (tc) out.push(tc);
      }
    }
    return out;
  }

  // Pull recent test runs (and their results) that already exist in the org.
  async function loadHistory(force = false) {
    if (loadingHistory) return;
    if (historyLoaded && !force) return;
    loadingHistory = true;
    if (view === 'results') renderResults();
    const runRes = await deps.runQuery('SELECT AsyncApexJobId, Status, StartTime FROM ApexTestRunResult ORDER BY StartTime DESC LIMIT 25', true);
    if (runRes.error) { loadingHistory = false; historyLoaded = true; if (view === 'results') renderResults(); return; }
    const runRows = (runRes.records || []).filter((r: any) => r.AsyncApexJobId);
    let byJob = new Map<string, any[]>();
    if (runRows.length) {
      const inClause = runRows.map((r: any) => `'${r.AsyncApexJobId}'`).join(',');
      const resRes = await deps.runQuery(`SELECT AsyncApexJobId, Outcome, MethodName, ApexClass.Name, Message, StackTrace, RunTime FROM ApexTestResult WHERE AsyncApexJobId IN (${inClause}) ORDER BY ApexClass.Name, MethodName`, true);
      (resRes.records || []).forEach((r: any) => { const a = byJob.get(r.AsyncApexJobId) || []; a.push(r); byJob.set(r.AsyncApexJobId, a); });
    }
    const built: RunInfo[] = runRows.map((rr: any) => {
      const jid = rr.AsyncApexJobId;
      const res = byJob.get(jid) || [];
      const names = Array.from(new Set(res.map((r: any) => r.ApexClass?.Name).filter(Boolean))) as string[];
      const completed = rr.Status === 'Completed' || rr.Status === 'Failed' || rr.Status === 'Aborted';
      return { jobId: jid, enqueued: rr.StartTime ? new Date(rr.StartTime) : new Date(), classes: names.map((n) => ({ id: n, name: n, status: completed ? 'Completed' : (rr.Status || 'Processing'), ext: '' })), results: res, done: completed };
    });
    // Preserve a still-polling session run that history hasn't caught up to yet.
    const active = runs.find((r) => r.jobId === activeJobId && !built.some((b) => b.jobId === r.jobId));
    runs = active ? [active, ...built] : built;
    loadingHistory = false;
    historyLoaded = true;
    if (view === 'results') renderResults();
  }

  // ── selection helpers ──
  const selCount = () => selected.size;
  const totalSelectedMethods = () => Array.from(selected.values()).reduce((a, s) => a + s.size, 0);
  function setClass(c: TestClass, on: boolean) {
    if (on) selected.set(c.id, new Set(c.methods));
    else selected.delete(c.id);
  }
  function setMethod(c: TestClass, method: string, on: boolean) {
    let s = selected.get(c.id);
    if (on) { if (!s) { s = new Set(); selected.set(c.id, s); } s.add(method); }
    else if (s) { s.delete(method); if (s.size === 0) selected.delete(c.id); }
  }

  // ════════ RUN view ════════
  function renderRun() {
    body.innerHTML = '';
    const wrap = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
    body.appendChild(wrap);

    // search
    const top = el('div', { padding: '14px 24px 10px', flexShrink: '0' });
    const search = el('input', { width: '100%', maxWidth: '480px', boxSizing: 'border-box', padding: '10px 14px', fontSize: '13px', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
    search.placeholder = 'Search test classes & methods…'; search.value = searchVal;
    search.addEventListener('input', () => { searchVal = search.value.trim().toLowerCase(); renderTree(); });
    top.appendChild(search);
    wrap.appendChild(top);

    const treeScroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto', padding: '0 12px' });
    wrap.appendChild(treeScroll);

    // footer
    const footer = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 24px', flexShrink: '0', borderTop: `1px solid ${C.divider}`, background: C.headerBg });
    const fInfo = el('span', { fontSize: '12.5px', color: C.muted });
    footer.appendChild(fInfo);
    const clearBtn = el('button', { marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit' }, '✕ Clear selections');
    clearBtn.addEventListener('click', () => { selected.clear(); renderTree(); });
    const runBtn = el('button', { background: C.accent, border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit' }, '▶ Execute Tests');
    runBtn.addEventListener('click', execute);
    footer.appendChild(clearBtn); footer.appendChild(runBtn);
    wrap.appendChild(footer);

    const updateFooter = () => {
      fInfo.textContent = `${classes.length} test class${classes.length === 1 ? '' : 'es'} · ${selCount()} selected (${totalSelectedMethods()} methods)`;
      runBtn.style.opacity = selCount() ? '1' : '0.5';
      runBtn.style.pointerEvents = selCount() ? 'auto' : 'none';
    };

    function renderTree() {
      treeScroll.innerHTML = '';
      if (!loaded) { treeScroll.appendChild(el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'Loading test classes…')); return; }
      if (loadError) { treeScroll.appendChild(el('div', { padding: '24px', color: C.fail, fontSize: '13px', whiteSpace: 'pre-wrap' }, 'Could not load test classes:\n' + loadError)); updateFooter(); return; }
      if (!classes.length) { treeScroll.appendChild(el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'No Apex test classes found in this org.')); updateFooter(); return; }

      const q = searchVal;
      const shown = classes.map((c) => {
        if (!q) return { c, methods: c.methods };
        const classMatch = c.name.toLowerCase().includes(q);
        const methods = classMatch ? c.methods : c.methods.filter((m) => m.toLowerCase().includes(q));
        return (classMatch || methods.length) ? { c, methods } : null;
      }).filter(Boolean) as { c: TestClass; methods: string[] }[];

      if (!shown.length) { treeScroll.appendChild(el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'No tests match your search.')); updateFooter(); return; }

      shown.forEach(({ c, methods }) => {
        const sel = selected.get(c.id);
        const all = !!sel && sel.size === c.methods.length;
        const some = !!sel && sel.size > 0 && !all;

        const classRow = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 12px', borderBottom: `1px solid ${C.divider}`, cursor: 'pointer' });
        const chev = el('span', { width: '14px', color: C.muted, fontSize: '11px', userSelect: 'none', transition: 'transform .15s' }, expanded.has(c.id) || q ? '▼' : '▶');
        chev.addEventListener('click', (e) => { e.stopPropagation(); if (expanded.has(c.id)) expanded.delete(c.id); else expanded.add(c.id); renderTree(); });
        const cb = el('input') as HTMLInputElement; cb.type = 'checkbox'; cb.checked = all; cb.indeterminate = some; cb.style.cursor = 'pointer'; cb.style.width = '16px'; cb.style.height = '16px';
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => { setClass(c, cb.checked); renderTree(); });
        const nm = el('span', { fontSize: '14px', fontWeight: '700' }, c.name);
        const cnt = el('span', { fontSize: '12px', color: C.muted }, `(${c.methods.length} method${c.methods.length === 1 ? '' : 's'})`);
        classRow.appendChild(chev); classRow.appendChild(cb); classRow.appendChild(nm); classRow.appendChild(cnt);
        classRow.addEventListener('click', () => { if (expanded.has(c.id)) expanded.delete(c.id); else expanded.add(c.id); renderTree(); });
        treeScroll.appendChild(classRow);

        if (expanded.has(c.id) || q) {
          const mWrap = el('div', { background: C.subtle, borderBottom: `1px solid ${C.divider}` });
          methods.forEach((m) => {
            const mRow = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px 8px 48px' });
            const mcb = el('input') as HTMLInputElement; mcb.type = 'checkbox'; mcb.checked = !!sel?.has(m); mcb.style.cursor = 'pointer'; mcb.style.width = '15px'; mcb.style.height = '15px';
            mcb.addEventListener('change', () => { setMethod(c, m, mcb.checked); renderTree(); });
            const ml = el('label', { fontSize: '13px', cursor: 'pointer' }, m);
            ml.addEventListener('click', () => { mcb.checked = !mcb.checked; setMethod(c, m, mcb.checked); renderTree(); });
            mRow.appendChild(mcb); mRow.appendChild(ml);
            mWrap.appendChild(mRow);
          });
          treeScroll.appendChild(mWrap);
        }
      });
      updateFooter();
    }

    renderTree();
    if (!loaded) loadClasses();
  }

  // ════════ Execute + poll ════════
  async function execute() {
    if (!selCount()) return;
    const tests = Array.from(selected.entries()).map(([classId, methods]) => {
      const c = classes.find((x) => x.id === classId);
      const all = c && methods.size === c.methods.length;
      return all ? { classId } : { classId, testMethods: Array.from(methods) };
    });
    deps.flashToast('Submitting test run…');
    const { jobId, error } = await deps.runTests({ tests });
    if (error || !jobId) { deps.flashToast(error || 'Failed to start tests'); return; }
    runs.unshift({ jobId, enqueued: new Date(), classes: [], results: [], done: false });
    expandedRuns.add(jobId);
    activeJobId = jobId;
    selectView('results');
    startPolling();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    const tick = async () => {
      if (!isAlive()) { clearInterval(pollTimer); pollTimer = null; return; }
      const run = runs.find((r) => r.jobId === activeJobId);
      if (!run) { clearInterval(pollTimer); pollTimer = null; return; }
      const [queue, res] = await Promise.all([
        deps.runQuery(`SELECT Status, ExtendedStatus, ApexClassId, ApexClass.Name FROM ApexTestQueueItem WHERE ParentJobId = '${run.jobId}'`, true),
        deps.runQuery(`SELECT Outcome, MethodName, ApexClass.Name, Message, StackTrace, RunTime FROM ApexTestResult WHERE AsyncApexJobId = '${run.jobId}' ORDER BY ApexClass.Name, MethodName`, true),
      ]);
      run.classes = (queue.records || []).map((q: any) => ({ id: q.ApexClassId, name: q.ApexClass?.Name || q.ApexClassId, status: q.Status, ext: q.ExtendedStatus || '' }));
      run.results = res.records || [];
      run.done = run.classes.length > 0 && run.classes.every((c) => DONE_STATUSES.includes(c.status));
      if (view === 'results') renderResults();
      if (run.done) { clearInterval(pollTimer); pollTimer = null; activeJobId = null; }
    };
    pollTimer = setInterval(tick, 2500);
    tick();
  }

  const runProgress = (run: RunInfo) => {
    if (!run.classes.length) return 0;
    const done = run.classes.filter((c) => DONE_STATUSES.includes(c.status)).length;
    return Math.round((done / run.classes.length) * 100);
  };
  const runStatus = (run: RunInfo) => {
    if (!run.classes.length) return 'Queued';
    if (!run.done) return 'Processing';
    return run.results.some((r) => r.Outcome === 'Fail' || r.Outcome === 'CompileFail') ? 'Failed' : 'Completed';
  };
  const classOutcome = (run: RunInfo, name: string) => {
    const rs = run.results.filter((r) => r.ApexClass?.Name === name);
    if (!rs.length) return '-';
    return rs.some((r) => r.Outcome !== 'Pass') ? 'Fail' : 'Pass';
  };

  // ════════ RESULTS view ════════
  const COLS = [
    { key: 'run', label: 'Test Run', flex: '2.4', search: true },
    { key: 'message', label: 'Message', flex: '2', search: true },
    { key: 'status', label: 'Status', flex: '1.3', search: true },
    { key: 'outcome', label: 'Outcome', flex: '1.2', search: true },
    { key: 'progress', label: 'Progress(%)', flex: '1', search: false },
    { key: 'enqueued', label: 'Enqueued Time', flex: '1.6', search: false },
  ];
  const statusColor = (s: string) => s === 'Completed' || s === 'Pass' ? C.pass : (s === 'Failed' || s === 'Fail' || s === 'CompileFail') ? C.fail : s === 'Processing' ? C.accent : C.muted;

  function renderResults() {
    body.innerHTML = '';
    const wrap = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
    body.appendChild(wrap);

    // header row (titles + per-column search)
    const colStyle = (flex: string): Partial<CSSStyleDeclaration> => ({ flex, minWidth: '0', padding: '13px 16px', boxSizing: 'border-box' });
    const header = el('div', { display: 'flex', alignItems: 'stretch', background: C.headerBg, borderBottom: `1px solid ${C.border}`, flexShrink: '0' });
    COLS.forEach((c) => {
      const cell = el('div', { ...colStyle(c.flex), padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' });
      cell.appendChild(el('div', { fontSize: '13.5px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap' }, c.label));
      if (c.search) {
        const inp = el('input', { width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: '12.5px', borderRadius: '7px', border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontFamily: 'inherit', outline: 'none' }) as HTMLInputElement;
        inp.placeholder = `Search ${c.label}`;
        inp.value = (rFilter as any)[c.key];
        inp.addEventListener('input', () => { (rFilter as any)[c.key] = inp.value.trim().toLowerCase(); renderRows(); });
        cell.appendChild(inp);
      }
      header.appendChild(cell);
    });
    wrap.appendChild(header);

    const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto' });
    wrap.appendChild(scroll);

    // footer (count + clear + LIVE)
    const footer = el('div', { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 24px', flexShrink: '0', borderTop: `1px solid ${C.divider}`, background: C.headerBg });
    const fCount = el('span', { fontSize: '12.5px', color: C.muted, fontWeight: '600' });
    footer.appendChild(fCount);
    const clearBtn = el('button', { marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit' }, '⌫ Clear');
    clearBtn.addEventListener('click', () => { runs = []; expandedRuns.clear(); expandedClasses.clear(); renderResults(); });
    footer.appendChild(clearBtn);
    const live = el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', padding: '5px 10px', borderRadius: '8px', border: `1px solid ${activeJobId ? '#ef4444' : C.border}`, color: activeJobId ? '#ef4444' : C.muted });
    live.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${activeJobId ? '#ef4444' : C.faint};display:inline-block"></span>LIVE`;
    footer.appendChild(live);
    wrap.appendChild(footer);

    // ── rows ──
    const cellText = (flex: string, text: string, color?: string, mono?: boolean): HTMLElement =>
      el('div', { ...colStyle(flex), display: 'flex', alignItems: 'center', fontSize: '14px', color: color || C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(mono ? { fontFamily: 'monospace', fontSize: '13px' } : {}) }, text);
    const matches = (vals: { run: string; message: string; status: string; outcome: string }) =>
      (!rFilter.run || vals.run.toLowerCase().includes(rFilter.run)) &&
      (!rFilter.message || vals.message.toLowerCase().includes(rFilter.message)) &&
      (!rFilter.status || vals.status.toLowerCase().includes(rFilter.status)) &&
      (!rFilter.outcome || vals.outcome.toLowerCase().includes(rFilter.outcome));

    const renderRows = () => {
      scroll.innerHTML = '';
      if (!runs.length) {
        scroll.appendChild(el('div', { padding: '28px', color: C.muted, fontSize: '13px' }, loadingHistory ? 'Loading test results…' : 'No test runs found. Run tests from “New Test Run”, or hit Refresh.'));
        fCount.textContent = loadingHistory ? 'Loading…' : '0 test execution results';
        return;
      }

      let shownRuns = 0;
      const mkRow = (depth: number, expandable: boolean, open: boolean, onToggle: (() => void) | null, cells: HTMLElement[]) => {
        const row = el('div', { display: 'flex', alignItems: 'stretch', borderBottom: `1px solid ${C.divider}`, cursor: expandable ? 'pointer' : 'default' });
        row.addEventListener('mouseover', () => (row.style.background = C.hover));
        row.addEventListener('mouseout', () => (row.style.background = ''));
        // chevron goes inside first cell via padding-left
        const first = cells[0];
        first.style.paddingLeft = `${14 + depth * 22}px`;
        const chev = el('span', { width: '16px', flexShrink: '0', color: C.muted, fontSize: '13px', userSelect: 'none', marginRight: '6px' }, expandable ? (open ? '⌄' : '›') : '');
        first.insertBefore(chev, first.firstChild);
        if (expandable && onToggle) row.addEventListener('click', onToggle);
        cells.forEach((c) => row.appendChild(c));
        scroll.appendChild(row);
      };

      runs.forEach((run) => {
        const rStatus = runStatus(run);
        const rVals = { run: run.jobId, message: '-', status: rStatus, outcome: '-' };
        // a run is visible if it matches, or any descendant matches
        const classVisible = (cl: { name: string; status: string; ext: string }) => {
          const cVals = { run: cl.name, message: cl.ext || '-', status: cl.status, outcome: classOutcome(run, cl.name) };
          if (matches(cVals)) return true;
          return run.results.some((r) => r.ApexClass?.Name === cl.name && matches({ run: r.MethodName, message: r.Message || '-', status: 'Completed', outcome: r.Outcome }));
        };
        const visibleClasses = run.classes.filter(classVisible);
        if (!matches(rVals) && !visibleClasses.length) return;
        shownRuns++;

        const runOpen = expandedRuns.has(run.jobId);
        mkRow(0, run.classes.length > 0, runOpen, () => { if (runOpen) expandedRuns.delete(run.jobId); else expandedRuns.add(run.jobId); renderRows(); }, [
          cellText(COLS[0].flex, run.jobId, C.text, true),
          cellText(COLS[1].flex, '-', C.muted),
          cellText(COLS[2].flex, rStatus, statusColor(rStatus)),
          cellText(COLS[3].flex, '-', C.muted),
          cellText(COLS[4].flex, `${runProgress(run)}%`),
          cellText(COLS[5].flex, run.enqueued.toLocaleString(), C.muted),
        ]);

        if (!runOpen) return;
        (visibleClasses.length || rFilter.run || rFilter.message || rFilter.status || rFilter.outcome ? visibleClasses : run.classes).forEach((cl) => {
          const ck = `${run.jobId}|${cl.name}`;
          const clOpen = expandedClasses.has(ck);
          const outc = classOutcome(run, cl.name);
          const methods = run.results.filter((r) => r.ApexClass?.Name === cl.name);
          mkRow(1, methods.length > 0, clOpen, () => { if (clOpen) expandedClasses.delete(ck); else expandedClasses.add(ck); renderRows(); }, [
            cellText(COLS[0].flex, cl.name, C.text),
            cellText(COLS[1].flex, cl.ext || '-', C.muted),
            cellText(COLS[2].flex, cl.status, statusColor(cl.status)),
            cellText(COLS[3].flex, outc, outc === '-' ? C.muted : statusColor(outc)),
            cellText(COLS[4].flex, DONE_STATUSES.includes(cl.status) ? '100%' : (cl.status === 'Processing' ? '…' : '0%')),
            cellText(COLS[5].flex, '', C.muted),
          ]);
          if (!clOpen) return;
          methods.filter((r) => matches({ run: r.MethodName, message: r.Message || '-', status: 'Completed', outcome: r.Outcome })).forEach((r) => {
            const ok = r.Outcome === 'Pass';
            const mrow = el('div', { display: 'flex', flexDirection: 'column', borderBottom: `1px solid ${C.divider}`, background: C.subtle });
            const line = el('div', { display: 'flex', alignItems: 'stretch' });
            const nameCell = el('div', { ...colStyle(COLS[0].flex), display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', paddingLeft: `${14 + 2 * 22 + 18}px` });
            nameCell.appendChild(el('span', { color: ok ? C.pass : C.fail, fontSize: '15px' }, ok ? '✓' : '✗'));
            nameCell.appendChild(el('span', { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, r.MethodName));
            line.appendChild(nameCell);
            line.appendChild(cellText(COLS[1].flex, r.Message ? String(r.Message).split('\n')[0] : '-', C.muted));
            line.appendChild(cellText(COLS[2].flex, 'Completed', C.muted));
            line.appendChild(cellText(COLS[3].flex, r.Outcome, statusColor(r.Outcome)));
            line.appendChild(cellText(COLS[4].flex, `${r.RunTime ?? 0} ms`, C.muted));
            line.appendChild(cellText(COLS[5].flex, '', C.muted));
            mrow.appendChild(line);
            if (!ok && (r.Message || r.StackTrace)) {
              const err = el('pre', { margin: '0 24px 10px', marginLeft: `${14 + 2 * 22 + 18}px`, padding: '10px 12px', borderRadius: '6px', background: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', color: isDark ? '#fca5a5' : '#b91c1c', fontSize: '12.5px', lineHeight: '1.5', whiteSpace: 'pre-wrap', overflowX: 'auto', fontFamily: 'monospace' });
              err.textContent = [r.Message, r.StackTrace].filter(Boolean).join('\n');
              mrow.appendChild(err);
            }
            scroll.appendChild(mrow);
          });
        });
      });

      if (!shownRuns) scroll.appendChild(el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'No results match your search.'));
      fCount.textContent = `${runs.length} test execution result${runs.length === 1 ? '' : 's'}`;
    };

    renderRows();
  }

  // ════════ COVERAGE view ════════
  async function renderCoverage() {
    body.innerHTML = '';
    const wrap = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
    body.appendChild(wrap);
    const loading = el('div', { padding: '24px', color: C.muted, fontSize: '13px' }, 'Loading coverage…');
    wrap.appendChild(loading);

    const [org, agg] = await Promise.all([
      deps.runQuery('SELECT PercentCovered FROM ApexOrgWideCoverage LIMIT 1', true),
      deps.runQuery('SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate ORDER BY ApexClassOrTrigger.Name LIMIT 2000', true),
    ]);
    if (!isAlive()) return;
    wrap.innerHTML = '';
    if (org.error && agg.error) { wrap.appendChild(el('div', { padding: '24px', color: C.fail, fontSize: '13px', whiteSpace: 'pre-wrap' }, 'Could not load coverage:\n' + (org.error || agg.error))); return; }

    const orgPct = org.records?.[0]?.PercentCovered ?? null;
    const banner = el('div', { padding: '18px 24px', flexShrink: '0', display: 'flex', alignItems: 'center', gap: '14px' });
    const pctColor = orgPct == null ? C.muted : orgPct >= 75 ? C.pass : orgPct >= 50 ? '#f59e0b' : C.fail;
    banner.appendChild(el('div', { fontSize: '34px', fontWeight: '800', color: pctColor }, orgPct == null ? '—' : `${orgPct}%`));
    const bt = el('div', {});
    bt.appendChild(el('div', { fontSize: '13px', fontWeight: '700' }, 'Org-wide code coverage'));
    bt.appendChild(el('div', { fontSize: '12px', color: C.muted }, '75% required to deploy to production'));
    banner.appendChild(bt);
    wrap.appendChild(banner);

    const scroll = el('div', { flex: '1', minHeight: '0', overflow: 'auto' });
    wrap.appendChild(scroll);
    const rows = (agg.records || []).map((r: any) => {
      const cov = r.NumLinesCovered || 0, unc = r.NumLinesUncovered || 0, tot = cov + unc;
      return { name: r.ApexClassOrTrigger?.Name || '?', pct: tot ? Math.round((cov / tot) * 100) : 0, cov, tot };
    }).sort((a: any, b: any) => a.pct - b.pct);
    if (!rows.length) { scroll.appendChild(el('div', { padding: '20px', color: C.muted, fontSize: '13px' }, 'No coverage data yet — run tests first.')); return; }

    const table = el('table', { borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' });
    const thead = el('thead'); const htr = el('tr');
    ['Class / Trigger', 'Coverage', 'Lines'].forEach((h, i) => htr.appendChild(el('th', { position: 'sticky', top: '0', textAlign: i === 0 ? 'left' : 'left', padding: '8px 24px', background: C.headerBg, color: C.text, fontWeight: '700', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>, h)));
    thead.appendChild(htr); table.appendChild(thead);
    const tb = el('tbody');
    rows.forEach((r: any, i: number) => {
      const col = r.pct >= 75 ? C.pass : r.pct >= 50 ? '#f59e0b' : C.fail;
      const tr = el('tr', { background: i % 2 ? C.zebra : '' });
      tr.appendChild(el('td', { padding: '7px 24px', borderBottom: `1px solid ${C.divider}`, fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'nowrap' }, r.name));
      const barTd = el('td', { padding: '7px 24px', borderBottom: `1px solid ${C.divider}`, minWidth: '200px' });
      const barWrap = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
      const track = el('div', { flex: '1', height: '8px', borderRadius: '999px', background: C.zebra, overflow: 'hidden', minWidth: '90px' });
      track.appendChild(el('div', { width: `${r.pct}%`, height: '8px', background: col }));
      barWrap.appendChild(track);
      barWrap.appendChild(el('span', { fontWeight: '700', color: col, width: '40px', textAlign: 'right' }, `${r.pct}%`));
      barTd.appendChild(barWrap);
      tr.appendChild(barTd);
      tr.appendChild(el('td', { padding: '7px 24px', borderBottom: `1px solid ${C.divider}`, color: C.muted, whiteSpace: 'nowrap' }, `${r.cov}/${r.tot}`));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    scroll.appendChild(table);
  }

  // boot
  paintTabs();
  renderRun();
  loadClasses();
}
