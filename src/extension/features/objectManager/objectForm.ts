// "New Custom Object" form — mirrors every setting the Setup wizard offers:
// labels/name/description, record name (Text or Auto Number), optional
// features (reports, activities, history, Chatter, search), sharing model,
// Sharing/Bulk/Streaming API flags, and deployment status.
//
// Backend-agnostic: creation goes through the injected `createObject`
// (CREATE_CUSTOM_OBJECT → Tooling API) — see [[file-structure-convention]].

import { palette, el, section, row, textInput, textArea, numberInput, select, checkbox, button, banner, toolHeader, labelToApiName, validateApiName } from './ui';

export interface ObjectFormDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast?: (msg: string) => void;
  createObject: (fullName: string, metadata: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  /** Called after a successful create so the parent can offer "add fields now". */
  onCreated: (objectFullName: string, label: string) => void;
  setupOrigin: () => string;
}

export function renderObjectFormInto(host: HTMLElement, deps: ObjectFormDeps): void {
  const C = palette(deps.isDark);
  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  const { head } = toolHeader(C, '🧱 New Custom Object', deps.onBack, 'Object Manager');
  root.appendChild(head);

  const body = el('div', { flex: '1', minHeight: '0', overflowY: 'auto', padding: '6px 28px 28px' });
  root.appendChild(body);

  const status = banner(C);
  body.appendChild(status.node);

  // ── Information ──────────────────────────────────────────────
  body.appendChild(section(C, 'Information'));

  const labelIn = textInput(C, 'e.g. Invoice');
  const pluralIn = textInput(C, 'e.g. Invoices');
  const apiIn = textInput(C, 'e.g. Invoice');
  const descIn = textArea(C, 'What is this object for? (shown in Setup)', 2);

  // Autofill plural + API name from label until the user edits them manually.
  let pluralTouched = false, apiTouched = false;
  labelIn.addEventListener('input', () => {
    if (!pluralTouched) pluralIn.value = labelIn.value.trim() ? `${labelIn.value.trim()}s` : '';
    if (!apiTouched) apiIn.value = labelToApiName(labelIn.value);
  });
  pluralIn.addEventListener('input', () => { pluralTouched = true; });
  apiIn.addEventListener('input', () => { apiTouched = true; });

  body.appendChild(row(C, 'Label', labelIn, { required: true }));
  body.appendChild(row(C, 'Plural Label', pluralIn, { required: true }));
  body.appendChild(row(C, 'Object Name (API)', apiIn, { required: true, help: '"__c" is appended automatically.' }));
  body.appendChild(row(C, 'Description', descIn));

  // ── Record Name ──────────────────────────────────────────────
  body.appendChild(section(C, 'Record Name'));

  const recNameIn = textInput(C, 'e.g. Invoice Name / Invoice Number');
  const recTypeSel = select(C, [{ value: 'Text', label: 'Text' }, { value: 'AutoNumber', label: 'Auto Number' }], 'Text');
  const fmtIn = textInput(C, 'e.g. INV-{0000}');
  const startIn = numberInput(C, '1', 0);
  const fmtRow = row(C, 'Display Format', fmtIn, { required: true, help: '{0} is the sequence placeholder — INV-{0000} → INV-0001.' });
  const startRow = row(C, 'Starting Number', startIn);
  const syncAuto = () => { const auto = recTypeSel.value === 'AutoNumber'; fmtRow.style.display = auto ? 'flex' : 'none'; startRow.style.display = auto ? 'flex' : 'none'; };
  recTypeSel.addEventListener('change', syncAuto);

  body.appendChild(row(C, 'Record Name Label', recNameIn, { required: true }));
  body.appendChild(row(C, 'Data Type', recTypeSel));
  body.appendChild(fmtRow);
  body.appendChild(startRow);
  syncAuto();

  // ── Optional Features ───────────────────────────────────────
  body.appendChild(section(C, 'Optional Features'));

  const cbReports = checkbox(C, 'Allow Reports', true);
  const cbActivities = checkbox(C, 'Allow Activities', true);
  const cbHistory = checkbox(C, 'Track Field History', false);
  const cbChatter = checkbox(C, 'Allow in Chatter Groups', false);
  const cbSearch = checkbox(C, 'Allow Search', true);
  const featWrap = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '2px 16px' });
  [cbReports, cbActivities, cbHistory, cbChatter, cbSearch].forEach((c) => featWrap.appendChild(c.wrap));
  body.appendChild(featWrap);

  // ── Classification (Sharing / Bulk / Streaming API) ────────
  body.appendChild(section(C, 'Object Classification'));
  const cbSharing = checkbox(C, 'Allow Sharing', true);
  const cbBulk = checkbox(C, 'Allow Bulk API Access', true);
  const cbStreaming = checkbox(C, 'Allow Streaming API Access', true);
  const clsWrap = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '2px 16px' });
  [cbSharing, cbBulk, cbStreaming].forEach((c) => clsWrap.appendChild(c.wrap));
  body.appendChild(clsWrap);
  body.appendChild(el('div', { fontSize: '11px', color: C.faint, marginTop: '6px' }, 'Unchecking any of these makes this a Light Application object; all three must stay checked for an Enterprise Application object.'));

  // ── Sharing & Deployment ────────────────────────────────────
  body.appendChild(section(C, 'Sharing & Deployment'));
  const sharingSel = select(C, [
    { value: 'ReadWrite', label: 'Public Read/Write' },
    { value: 'Read', label: 'Public Read Only' },
    { value: 'Private', label: 'Private' },
  ], 'ReadWrite');
  const deploySel = select(C, [
    { value: 'Deployed', label: 'Deployed' },
    { value: 'InDevelopment', label: 'In Development' },
  ], 'Deployed');
  body.appendChild(row(C, 'Default Sharing Model', sharingSel, { help: 'Org-wide default access for records of this object.' }));
  body.appendChild(row(C, 'Deployment Status', deploySel, { help: '"In Development" hides the object from non-admin users.' }));

  // ── Actions ──────────────────────────────────────────────────
  const actions = el('div', { display: 'flex', gap: '10px', marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${C.divider}` });
  const createBtn = button(C, 'Create Object', 'primary');
  const cancelBtn = button(C, 'Cancel');
  cancelBtn.addEventListener('click', deps.onBack);
  actions.appendChild(createBtn);
  actions.appendChild(cancelBtn);
  body.appendChild(actions);

  createBtn.addEventListener('click', () => {
    status.hide();
    const label = labelIn.value.trim();
    const plural = pluralIn.value.trim();
    const api = apiIn.value.trim();
    const recName = recNameIn.value.trim();

    const fail = (msg: string) => { status.show(msg, 'error'); status.node.scrollIntoView({ block: 'nearest' }); };
    if (!label) return fail('Label is required.');
    if (!plural) return fail('Plural Label is required.');
    const nameErr = validateApiName(api);
    if (nameErr) return fail(nameErr);
    if (!recName) return fail('Record Name Label is required.');
    const isAuto = recTypeSel.value === 'AutoNumber';
    if (isAuto && !/\{0+\}/.test(fmtIn.value)) return fail('Display Format must include a {0} placeholder, e.g. INV-{0000}.');

    const fullName = `${api}__c`;
    const metadata: Record<string, unknown> = {
      label,
      pluralLabel: plural,
      description: descIn.value.trim() || undefined,
      nameField: isAuto
        ? { label: recName, type: 'AutoNumber', displayFormat: fmtIn.value.trim(), startingNumber: Number(startIn.value) || 1 }
        : { label: recName, type: 'Text' },
      deploymentStatus: deploySel.value,
      sharingModel: sharingSel.value,
      enableReports: cbReports.input.checked,
      enableActivities: cbActivities.input.checked,
      enableHistory: cbHistory.input.checked,
      enableFeeds: cbChatter.input.checked,
      enableSearch: cbSearch.input.checked,
      enableSharing: cbSharing.input.checked,
      enableBulkApi: cbBulk.input.checked,
      enableStreamingApi: cbStreaming.input.checked,
    };
    Object.keys(metadata).forEach((k) => { if (metadata[k] === undefined) delete metadata[k]; });

    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    createBtn.style.opacity = '0.6';

    deps.createObject(fullName, metadata).then((resp) => {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Object';
      createBtn.style.opacity = '1';
      if (!resp.success) { fail(resp.error || 'Object creation failed.'); return; }
      deps.flashToast?.(`✅ ${label} (${fullName}) created`);
      deps.onCreated(fullName, label);
    });
  });
}
