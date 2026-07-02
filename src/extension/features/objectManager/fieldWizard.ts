// "New Field" wizard — Setup parity on any object:
//   1. pick the target object (searchable, custom + customizable standard)
//   2. pick a field type (all 21 wizard types — see fieldTypes.ts)
//   3. fill the type's settings (same options as Setup step 2)
//   4. queue any number of fields, then deploy them together
//   5. grant field-level security to profiles / permission sets
//      (API-created fields are invisible to everyone else until FLS is set)
//
// Backend-agnostic via injected deps — see [[file-structure-convention]].

import { palette, el, section, row, textInput, textArea, numberInput, select, checkbox, button, banner, toolHeader, labelToApiName, validateApiName } from './ui';
import { FIELD_TYPES, FORMULA_RETURN_TYPES, validateFieldValues, buildFieldMetadata, type FieldTypeDef, type FieldFormValues } from './fieldTypes';

export interface SfObjectRef { apiName: string; label: string; custom: boolean }
export interface FlsTarget { id: string; label: string; isProfile: boolean }

export interface FieldWizardDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast?: (msg: string) => void;
  listObjects: () => Promise<{ data?: SfObjectRef[]; error?: string }>;
  createField: (fullName: string, metadata: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  listFlsTargets: () => Promise<{ data?: FlsTarget[]; error?: string }>;
  grantFls: (grants: Array<{ parentId: string; sobjectType: string; field: string; read: boolean; edit: boolean }>) => Promise<{ success: boolean; granted?: number; failed?: Array<{ grant: unknown; error?: string }>; error?: string }>;
  /** Preselect the target object (deep link from "object created"). */
  initialObject?: SfObjectRef;
}

interface QueuedField {
  def: FieldTypeDef;
  values: FieldFormValues;
  metadata: Record<string, unknown>;
  status: 'pending' | 'ok' | 'error';
  error?: string;
}

export function renderFieldWizardInto(host: HTMLElement, deps: FieldWizardDeps): void {
  const C = palette(deps.isDark);
  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  const { head, right: headRight } = toolHeader(C, '🧩 New Fields', deps.onBack, 'Object Manager');
  root.appendChild(head);
  const crumb = el('div', { fontSize: '12px', color: C.faint, fontWeight: '600' });
  headRight.appendChild(crumb);

  const body = el('div', { flex: '1', minHeight: '0', overflowY: 'auto', padding: '6px 28px 28px' });
  root.appendChild(body);

  // Wizard state
  let target: SfObjectRef | null = deps.initialObject ?? null;
  let typeDef: FieldTypeDef | null = null;
  const queue: QueuedField[] = [];
  let deployed = false;

  const setCrumb = () => { crumb.textContent = target ? `${target.label} (${target.apiName})${queue.length ? ` · ${queue.length} queued` : ''}` : ''; };

  // ── Step 1: object picker ───────────────────────────────────
  function showObjectPicker(): void {
    setCrumb();
    body.innerHTML = '';
    body.appendChild(section(C, 'Step 1 · Choose the object'));
    const search = textInput(C, 'Search objects…');
    search.style.maxWidth = '340px';
    body.appendChild(search);
    const list = el('div', { marginTop: '12px' });
    body.appendChild(list);
    const msg = (t: string) => { list.innerHTML = ''; list.appendChild(el('div', { padding: '30px 0', textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: '600' }, t)); };
    msg('Loading objects…');

    let objects: SfObjectRef[] = [];
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      const view = objects.filter((o) => !q || o.label.toLowerCase().includes(q) || o.apiName.toLowerCase().includes(q)).slice(0, 200);
      list.innerHTML = '';
      if (view.length === 0) { msg('No objects match.'); return; }
      view.forEach((o, i) => {
        const rowEl = el('button', { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderRadius: '8px', background: i % 2 ? C.zebra : 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: C.text });
        rowEl.appendChild(el('span', { fontSize: '16px' }, o.custom ? '🧱' : '📦'));
        rowEl.appendChild(el('span', { fontSize: '13px', fontWeight: '700' }, o.label));
        rowEl.appendChild(el('span', { fontSize: '12px', color: C.faint }, o.apiName));
        rowEl.addEventListener('mouseover', () => { rowEl.style.background = C.accentSoft; });
        rowEl.addEventListener('mouseout', () => { rowEl.style.background = i % 2 ? C.zebra : 'transparent'; });
        rowEl.addEventListener('click', () => { target = o; showTypePicker(); });
        list.appendChild(rowEl);
      });
    };
    search.addEventListener('input', paint);
    deps.listObjects().then((resp) => {
      if (resp.error || !resp.data) { msg(resp.error || 'Could not load objects.'); return; }
      objects = resp.data;
      paint();
      search.focus();
    });
  }

  // ── Step 2: type picker ─────────────────────────────────────
  function showTypePicker(): void {
    setCrumb();
    body.innerHTML = '';
    const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
    const changeObj = button(C, '← Change object');
    changeObj.addEventListener('click', () => { if (!deps.initialObject) { target = null; } showObjectPicker(); });
    bar.appendChild(changeObj);
    if (queue.length > 0) {
      const toQueue = button(C, `View queue (${queue.length})`, 'primary');
      toQueue.addEventListener('click', showQueue);
      bar.appendChild(toQueue);
    }
    body.appendChild(bar);
    body.appendChild(section(C, 'Step 2 · Choose a field type'));
    const grid = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' });
    FIELD_TYPES.forEach((t) => {
      const tile = el('button', { display: 'flex', flexDirection: 'column', gap: '4px', padding: '14px 12px', borderRadius: '12px', border: `1.5px solid ${C.border}`, background: C.panel, cursor: 'pointer', fontFamily: 'inherit', color: C.text, textAlign: 'left', transition: 'all 0.12s' });
      tile.appendChild(el('div', { fontSize: '20px' }, t.icon));
      tile.appendChild(el('div', { fontSize: '13px', fontWeight: '800' }, t.label));
      tile.appendChild(el('div', { fontSize: '11px', color: C.faint, lineHeight: '1.35' }, t.desc));
      tile.addEventListener('mouseover', () => { tile.style.borderColor = C.accent; tile.style.transform = 'translateY(-1px)'; });
      tile.addEventListener('mouseout', () => { tile.style.borderColor = C.border; tile.style.transform = 'none'; });
      tile.addEventListener('click', () => { typeDef = t; showSettingsForm(); });
      grid.appendChild(tile);
    });
    body.appendChild(grid);
  }

  // ── Step 3: settings form ───────────────────────────────────
  function showSettingsForm(): void {
    if (!typeDef || !target) return;
    const def = typeDef;
    setCrumb();
    body.innerHTML = '';

    const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
    const backBtn = button(C, '← Field types');
    backBtn.addEventListener('click', showTypePicker);
    bar.appendChild(backBtn);
    bar.appendChild(el('div', { fontSize: '13px', fontWeight: '800', color: C.text }, `${def.icon} ${def.label} on ${target.label}`));
    body.appendChild(bar);

    const status = banner(C);
    body.appendChild(status.node);

    body.appendChild(section(C, 'Step 3 · Field details'));

    const s = new Set(def.settings);
    const labelIn = textInput(C, 'e.g. Amount Due');
    const apiIn = textInput(C, '');
    let apiTouched = false;
    labelIn.addEventListener('input', () => { if (!apiTouched) apiIn.value = labelToApiName(labelIn.value); });
    apiIn.addEventListener('input', () => { apiTouched = true; });
    body.appendChild(row(C, 'Field Label', labelIn, { required: true }));
    body.appendChild(row(C, 'Field Name (API)', apiIn, { required: true, help: '"__c" is appended automatically.' }));

    // Type-specific controls (created up front; appended per settings list)
    const lengthIn = numberInput(C, String(def.defaults?.length ?? 255), 1, def.type === 'Text' ? 255 : 131072);
    const precIn = numberInput(C, String((def.defaults?.precision ?? 18) - (def.defaults?.scale ?? 0)), 1, 18);
    const scaleIn = numberInput(C, String(def.defaults?.scale ?? 0), 0, 17);
    const linesIn = numberInput(C, String(def.defaults?.visibleLines ?? 3), 1, 50);
    const defaultIn = textInput(C, def.type === 'Date' || def.type === 'DateTime' ? 'e.g. TODAY()' : 'Default value (optional)');
    const checkDefSel = select(C, [{ value: 'false', label: 'Unchecked' }, { value: 'true', label: 'Checked' }], 'false');
    const fmtIn = textInput(C, 'e.g. A-{0000}');
    const startIn = numberInput(C, '1', 0);
    const valuesTa = textArea(C, 'One picklist value per line', 6);
    const sortedCb = checkbox(C, 'Sort values alphabetically');
    const restrictedCb = checkbox(C, 'Restrict picklist to the values defined (recommended)', true);
    const firstDefaultCb = checkbox(C, 'Use first value as default value');
    const refSel = select(C, [{ value: '', label: 'Loading objects…' }]);
    const relLabelIn = textInput(C, 'e.g. Invoices');
    const relNameIn = textInput(C, 'e.g. Invoices');
    let relTouched = false;
    const delConSel = select(C, [
      { value: 'SetNull', label: 'Clear the value of this field (default)' },
      { value: 'Restrict', label: "Don't allow deletion of the related record" },
    ], 'SetNull');
    const mdSharingSel = select(C, [
      { value: 'false', label: 'Read/Write — anyone with access to the master can edit children' },
      { value: 'true', label: 'Read Only — editing children requires edit access on the master' },
    ], 'false');
    const reparentCb = checkbox(C, 'Allow reparenting (child can move to another master)');
    const formulaTa = textArea(C, 'e.g. Amount__c * 1.18', 5);
    const returnSel = select(C, FORMULA_RETURN_TYPES, 'Text');
    const blanksSel = select(C, [
      { value: 'BlankAsZero', label: 'Treat blank fields as zeroes' },
      { value: 'BlankAsBlank', label: 'Treat blank fields as blanks' },
    ], 'BlankAsZero');
    const geoDecCb = checkbox(C, 'Display as decimal (instead of degrees/minutes/seconds)', true);
    const requiredCb = checkbox(C, 'Required — must have a value to save a record');
    const uniqueCb = checkbox(C, 'Unique — no duplicate values allowed');
    const caseCb = checkbox(C, 'Treat "ABC" and "abc" as different values (case sensitive)');
    const extIdCb = checkbox(C, 'External ID — indexed record identifier from an external system');
    const helpIn = textInput(C, 'Shown as a tooltip next to the field (optional)');
    const descIn = textArea(C, 'Internal description for admins (optional)', 2);

    if (s.has('length')) body.appendChild(row(C, 'Length', lengthIn, { required: true, help: def.type === 'Text' ? 'Maximum 255 characters.' : 'Up to 131,072 characters.' }));
    if (s.has('precisionScale') || def.type === 'Formula') {
      const wrap = el('div', { display: 'flex', gap: '10px', alignItems: 'center' });
      wrap.appendChild(precIn); wrap.appendChild(el('span', { fontSize: '12px', color: C.faint }, 'digits left of decimal ·'));
      wrap.appendChild(scaleIn); wrap.appendChild(el('span', { fontSize: '12px', color: C.faint }, 'decimal places'));
      const r = row(C, 'Precision', wrap, { help: 'Combined total cannot exceed 18.' });
      if (def.type === 'Formula') { r.style.display = 'none'; returnSel.addEventListener('change', () => { r.style.display = ['Number', 'Currency', 'Percent'].includes(returnSel.value) ? 'flex' : 'none'; }); }
      body.appendChild(r);
    }
    if (s.has('visibleLines')) body.appendChild(row(C, '# Visible Lines', linesIn));
    if (s.has('autoNumber')) {
      body.appendChild(row(C, 'Display Format', fmtIn, { required: true, help: '{0} is the sequence — A-{0000} → A-0001. Prefix/suffix text is allowed.' }));
      body.appendChild(row(C, 'Starting Number', startIn));
    }
    if (s.has('formula')) {
      body.appendChild(row(C, 'Formula Return Type', returnSel, { required: true }));
      body.appendChild(row(C, 'Formula', formulaTa, { required: true, help: 'Use API names, e.g. Amount__c * 0.1. Salesforce validates syntax on save.' }));
      body.appendChild(row(C, 'Blank Field Handling', blanksSel));
    }
    if (s.has('picklist')) {
      body.appendChild(row(C, 'Values', valuesTa, { required: true, help: 'Enter each value on its own line.' }));
      const pkOpts = el('div');
      [sortedCb, firstDefaultCb, restrictedCb].forEach((c) => pkOpts.appendChild(c.wrap));
      body.appendChild(row(C, 'Picklist Options', pkOpts));
    }
    if (s.has('lookup') || s.has('masterDetail')) {
      body.appendChild(row(C, 'Related To', refSel, { required: true }));
      body.appendChild(row(C, 'Related List Label', relLabelIn, { help: 'Shown on the parent record page.' }));
      body.appendChild(row(C, 'Child Relationship Name', relNameIn, { required: true, help: 'Used in SOQL subqueries, e.g. (SELECT … FROM Invoices__r).' }));
      relLabelIn.addEventListener('input', () => { if (!relTouched) relNameIn.value = labelToApiName(relLabelIn.value); });
      relNameIn.addEventListener('input', () => { relTouched = true; });
      if (s.has('lookup')) body.appendChild(row(C, 'What to do if the lookup record is deleted?', delConSel));
      if (s.has('masterDetail')) {
        body.appendChild(row(C, 'Sharing Setting', mdSharingSel));
        body.appendChild(row(C, 'Reparenting', reparentCb.wrap));
      }
      deps.listObjects().then((resp) => {
        refSel.innerHTML = '';
        (resp.data || []).forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.apiName; opt.textContent = `${o.label} (${o.apiName})`;
          refSel.appendChild(opt);
        });
      });
    }
    if (s.has('geolocation')) {
      body.appendChild(row(C, 'Coordinate Notation', geoDecCb.wrap));
      body.appendChild(row(C, 'Decimal Places', scaleIn));
    }
    if (s.has('checkboxDefault')) body.appendChild(row(C, 'Default Value', checkDefSel));

    // General options
    const genOpts = el('div');
    if (s.has('required')) genOpts.appendChild(requiredCb.wrap);
    if (s.has('unique')) {
      genOpts.appendChild(uniqueCb.wrap);
      if (def.type === 'Text') {
        caseCb.wrap.style.marginLeft = '24px';
        caseCb.wrap.style.display = 'none';
        uniqueCb.input.addEventListener('change', () => { caseCb.wrap.style.display = uniqueCb.input.checked ? 'inline-flex' : 'none'; });
        genOpts.appendChild(caseCb.wrap);
      }
    }
    if (s.has('externalId')) genOpts.appendChild(extIdCb.wrap);
    if (genOpts.childNodes.length) body.appendChild(row(C, 'General Options', genOpts));
    if (s.has('defaultValue')) body.appendChild(row(C, 'Default Value', defaultIn, { help: 'Literal value or formula (e.g. TODAY() for dates).' }));

    body.appendChild(row(C, 'Help Text', helpIn));
    body.appendChild(row(C, 'Description', descIn));

    // Actions
    const actions = el('div', { display: 'flex', gap: '10px', marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${C.divider}` });
    const addBtn = button(C, '+ Add to queue', 'primary');
    const cancelBtn = button(C, 'Cancel');
    cancelBtn.addEventListener('click', showTypePicker);
    actions.appendChild(addBtn);
    actions.appendChild(cancelBtn);
    body.appendChild(actions);
    labelIn.focus();

    addBtn.addEventListener('click', () => {
      status.hide();
      const fail = (m: string) => { status.show(m, 'error'); status.node.scrollIntoView({ block: 'nearest' }); };

      const api = apiIn.value.trim();
      const nameErr = validateApiName(api);
      if (nameErr) return fail(nameErr);
      if (queue.some((qf) => qf.values.apiName.toLowerCase() === api.toLowerCase())) return fail(`"${api}" is already in the queue.`);

      const values: FieldFormValues = {
        label: labelIn.value,
        apiName: api,
        description: descIn.value,
        helpText: helpIn.value,
        required: requiredCb.input.checked,
        unique: uniqueCb.input.checked,
        caseSensitive: caseCb.input.checked,
        externalId: extIdCb.input.checked,
        defaultValue: s.has('checkboxDefault') ? checkDefSel.value : defaultIn.value,
        length: Number(lengthIn.value) || undefined,
        precision: (Number(precIn.value) || 0) + (Number(scaleIn.value) || 0),
        scale: Number(scaleIn.value) || 0,
        visibleLines: Number(linesIn.value) || undefined,
        picklistValues: valuesTa.value.split('\n').map((l) => l.trim()).filter(Boolean).map((label, i) => ({ label, default: firstDefaultCb.input.checked && i === 0 })),
        sorted: sortedCb.input.checked,
        restricted: restrictedCb.input.checked,
        referenceTo: refSel.value || undefined,
        relationshipLabel: relLabelIn.value.trim() || undefined,
        relationshipName: relNameIn.value.trim() || undefined,
        deleteConstraint: delConSel.value as 'SetNull' | 'Restrict',
        writeRequiresMasterRead: mdSharingSel.value === 'true',
        reparentableMasterDetail: reparentCb.input.checked,
        displayFormat: fmtIn.value.trim() || undefined,
        startingNumber: Number(startIn.value) || 1,
        formula: formulaTa.value,
        formulaReturnType: returnSel.value,
        formulaTreatBlanksAs: blanksSel.value as 'BlankAsZero' | 'BlankAsBlank',
        displayLocationInDecimal: geoDecCb.input.checked,
      };

      const valErr = validateFieldValues(def, values);
      if (valErr) return fail(valErr);

      queue.push({ def, values, metadata: buildFieldMetadata(def, values), status: 'pending' });
      deps.flashToast?.(`Queued ${values.label}`);
      showQueue();
    });
  }

  // ── Step 4: queue + deploy ──────────────────────────────────
  function showQueue(): void {
    if (!target) return;
    const obj = target;
    setCrumb();
    body.innerHTML = '';

    const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
    const addMore = button(C, '+ Add another field');
    addMore.addEventListener('click', showTypePicker);
    bar.appendChild(addMore);
    body.appendChild(bar);

    const status = banner(C);
    body.appendChild(status.node);
    body.appendChild(section(C, `Step 4 · Deploy to ${obj.label}`));

    if (queue.length === 0) {
      body.appendChild(el('div', { padding: '30px 0', textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: '600' }, 'Queue is empty — add a field to get started.'));
      return;
    }

    let deploying = false;
    const list = el('div');
    body.appendChild(list);
    const paintQueue = () => {
      list.innerHTML = '';
      queue.forEach((qf, i) => {
        const rowEl = el('div', { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: i % 2 ? C.zebra : 'transparent' });
        const dot = qf.status === 'ok' ? '✅' : qf.status === 'error' ? '❌' : qf.def.icon;
        rowEl.appendChild(el('span', { fontSize: '16px' }, dot));
        const info = el('div', { flex: '1', minWidth: '0' });
        info.appendChild(el('div', { fontSize: '13px', fontWeight: '700' }, `${qf.values.label} · ${qf.def.label}`));
        info.appendChild(el('div', { fontSize: '11.5px', color: qf.status === 'error' ? C.danger : C.faint }, qf.status === 'error' ? (qf.error || 'Failed') : `${obj.apiName}.${qf.values.apiName}__c`));
        rowEl.appendChild(info);
        if (qf.status === 'pending' && !deploying) {
          const rm = button(C, 'Remove');
          rm.style.padding = '4px 10px';
          rm.addEventListener('click', () => { queue.splice(i, 1); setCrumb(); if (queue.length) { paintQueue(); } else { showQueue(); } });
          rowEl.appendChild(rm);
        }
        list.appendChild(rowEl);
      });
    };
    paintQueue();

    const actions = el('div', { display: 'flex', gap: '10px', marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${C.divider}` });
    const deployBtn = button(C, `Deploy ${queue.filter((q) => q.status !== 'ok').length} field${queue.length === 1 ? '' : 's'}`, 'primary');
    actions.appendChild(deployBtn);
    const flsBtn = button(C, 'Set Field-Level Security →');
    flsBtn.style.display = deployed ? 'inline-block' : 'none';
    flsBtn.addEventListener('click', () => showFls());
    actions.appendChild(flsBtn);
    body.appendChild(actions);

    deployBtn.addEventListener('click', async () => {
      if (deploying) return;
      deploying = true;
      deployBtn.disabled = true;
      deployBtn.style.opacity = '0.6';
      status.show('Deploying fields…', 'info');

      let okCount = 0, failCount = 0;
      // Sequential on purpose: Salesforce serializes metadata saves per object,
      // and ordered deploys give deterministic errors (e.g. dependent formulas).
      for (const qf of queue) {
        if (qf.status === 'ok') { okCount++; continue; }
        deployBtn.textContent = `Deploying ${qf.values.label}…`;
        const resp = await deps.createField(`${obj.apiName}.${qf.values.apiName}__c`, qf.metadata);
        qf.status = resp.success ? 'ok' : 'error';
        qf.error = resp.error;
        if (resp.success) { okCount++; } else { failCount++; }
        paintQueue();
      }

      deploying = false;
      deployBtn.disabled = false;
      deployBtn.style.opacity = '1';
      deployBtn.textContent = failCount ? `Retry ${failCount} failed` : 'Deploy complete';
      if (failCount === 0) deployBtn.style.display = 'none';

      if (okCount > 0) {
        deployed = true;
        flsBtn.style.display = 'inline-block';
        Object.assign(flsBtn.style, { background: C.accent, color: '#fff', border: 'none' });
      }
      status.show(
        failCount
          ? `${okCount} field(s) created, ${failCount} failed — fix and retry, or continue to FLS for the created ones.`
          : `✅ All ${okCount} field(s) created on ${obj.label}. Grant field-level security next — without it, only admins can see these fields.`,
        failCount ? 'error' : 'success',
      );
      deps.flashToast?.(failCount ? `${okCount} created · ${failCount} failed` : `✅ ${okCount} field(s) created`);
    });
  }

  // ── Step 5: field-level security ────────────────────────────
  function showFls(): void {
    if (!target) return;
    const obj = target;
    const createdFields = queue.filter((q) => q.status === 'ok');
    setCrumb();
    body.innerHTML = '';

    const bar = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
    const backBtn = button(C, '← Back to queue');
    backBtn.addEventListener('click', showQueue);
    bar.appendChild(backBtn);
    body.appendChild(bar);

    const status = banner(C);
    body.appendChild(status.node);
    body.appendChild(section(C, `Step 5 · Field-level security (${createdFields.length} field${createdFields.length === 1 ? '' : 's'})`));
    body.appendChild(el('div', { fontSize: '12.5px', color: C.muted, lineHeight: '1.5', marginBottom: '12px' },
      'Pick the profiles and permission sets that should see the new fields. Read access is always granted; check "Edit" for write access. Formula and auto-number fields are read-only by design.'));

    const search = textInput(C, 'Filter profiles & permission sets…');
    search.style.maxWidth = '340px';
    body.appendChild(search);

    const editAll = checkbox(C, 'Grant Edit (not just Read) to the selections below', true);
    editAll.wrap.style.margin = '10px 0';
    body.appendChild(editAll.wrap);

    const list = el('div', { marginTop: '4px', maxHeight: '340px', overflowY: 'auto', border: `1px solid ${C.divider}`, borderRadius: '10px', padding: '6px' });
    body.appendChild(list);
    list.appendChild(el('div', { padding: '20px', textAlign: 'center', color: C.muted, fontSize: '13px' }, 'Loading profiles & permission sets…'));

    let targets: FlsTarget[] = [];
    const chosen = new Set<string>();
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const view = targets.filter((t) => !q || t.label.toLowerCase().includes(q));
      if (view.length === 0) { list.appendChild(el('div', { padding: '20px', textAlign: 'center', color: C.muted, fontSize: '13px' }, 'No matches.')); return; }
      view.forEach((t) => {
        const cb = checkbox(C, `${t.isProfile ? '👤' : '🔑'} ${t.label}${t.isProfile ? '  ·  Profile' : ''}`, chosen.has(t.id));
        cb.wrap.style.display = 'flex';
        cb.wrap.style.padding = '5px 8px';
        cb.input.addEventListener('change', () => { if (cb.input.checked) { chosen.add(t.id); } else { chosen.delete(t.id); } grantBtn.textContent = grantLabel(); });
        list.appendChild(cb.wrap);
      });
    };
    search.addEventListener('input', paint);
    deps.listFlsTargets().then((resp) => {
      if (resp.error || !resp.data) { list.innerHTML = ''; list.appendChild(el('div', { padding: '20px', textAlign: 'center', color: C.danger, fontSize: '13px' }, resp.error || 'Could not load permission sets.')); return; }
      targets = resp.data;
      paint();
    });

    const grantLabel = () => `Grant access (${chosen.size} selected)`;
    const actions = el('div', { display: 'flex', gap: '10px', marginTop: '18px' });
    const grantBtn = button(C, grantLabel(), 'primary');
    const doneBtn = button(C, 'Done');
    doneBtn.addEventListener('click', deps.onBack);
    actions.appendChild(grantBtn);
    actions.appendChild(doneBtn);
    body.appendChild(actions);

    grantBtn.addEventListener('click', () => {
      if (chosen.size === 0) { status.show('Select at least one profile or permission set.', 'error'); return; }
      // Formula/AutoNumber fields are read-only — never request edit on them.
      const grants = [...chosen].flatMap((parentId) =>
        createdFields.map((qf) => ({
          parentId,
          sobjectType: obj.apiName,
          field: `${obj.apiName}.${qf.values.apiName}__c`,
          read: true,
          edit: editAll.input.checked && qf.def.type !== 'Formula' && qf.def.type !== 'AutoNumber',
        })),
      );
      grantBtn.disabled = true;
      grantBtn.textContent = 'Granting…';
      status.show('Writing field permissions…', 'info');
      deps.grantFls(grants).then((resp) => {
        grantBtn.disabled = false;
        grantBtn.textContent = grantLabel();
        if (!resp.success) { status.show(resp.error || 'Grant failed.', 'error'); return; }
        const failed = resp.failed || [];
        if (failed.length === 0) {
          status.show(`✅ Access granted: ${resp.granted} permission(s) written.`, 'success');
          deps.flashToast?.('✅ Field-level security granted');
        } else {
          status.show(`${resp.granted} granted, ${failed.length} skipped:\n${failed.slice(0, 5).map((f) => `· ${f.error || 'unknown error'}`).join('\n')}${failed.length > 5 ? `\n…and ${failed.length - 5} more` : ''}`, 'error');
        }
      });
    });
  }

  // Entry point: deep-linked with an object → straight to type picker.
  if (target) { showTypePicker(); } else { showObjectPicker(); }
}
