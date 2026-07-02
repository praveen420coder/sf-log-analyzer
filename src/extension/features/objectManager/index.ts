// Object Manager — Tools-drawer app for creating custom objects and fields
// without leaving the page. Landing screen routes to the two flows:
//   🧱 New Custom Object  (objectForm.ts — every Setup wizard setting)
//   🧩 New Fields         (fieldWizard.ts — all field types + queue + FLS)
// After an object is created we deep-link into the field wizard with that
// object preselected, matching Setup's "now add fields" flow.
//
// Backend-agnostic: all Salesforce calls arrive via injected deps that the
// caller wires to background messages — see [[file-structure-convention]].

import { palette, el, toolHeader } from './ui';
import { renderObjectFormInto, type ObjectFormDeps } from './objectForm';
import { renderFieldWizardInto, type FieldWizardDeps, type SfObjectRef, type FlsTarget } from './fieldWizard';

export type { SfObjectRef, FlsTarget };

export interface ObjectManagerDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast?: (msg: string) => void;
  setupOrigin: () => string;
  listObjects: FieldWizardDeps['listObjects'];
  createObject: ObjectFormDeps['createObject'];
  createField: FieldWizardDeps['createField'];
  listFlsTargets: FieldWizardDeps['listFlsTargets'];
  grantFls: FieldWizardDeps['grantFls'];
}

export function renderObjectManagerInto(host: HTMLElement, deps: ObjectManagerDeps): void {
  const showLanding = () => renderLanding(host, deps, showLanding);
  showLanding();
}

function renderLanding(host: HTMLElement, deps: ObjectManagerDeps, showLanding: () => void): void {
  const C = palette(deps.isDark);
  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  const { head } = toolHeader(C, '🛠️ Object Manager', deps.onBack);
  root.appendChild(head);

  const body = el('div', { flex: '1', minHeight: '0', overflowY: 'auto', padding: '24px 28px' });
  root.appendChild(body);

  const openObjectForm = () => renderObjectFormInto(host, {
    isDark: deps.isDark,
    onBack: showLanding,
    flashToast: deps.flashToast,
    createObject: deps.createObject,
    setupOrigin: deps.setupOrigin,
    onCreated: (fullName, label) => openFieldWizard({ apiName: fullName, label, custom: true }),
  });

  const openFieldWizard = (initialObject?: SfObjectRef) => renderFieldWizardInto(host, {
    isDark: deps.isDark,
    onBack: showLanding,
    flashToast: deps.flashToast,
    listObjects: deps.listObjects,
    createField: deps.createField,
    listFlsTargets: deps.listFlsTargets,
    grantFls: deps.grantFls,
    initialObject,
  });

  const cards: Array<{ icon: string; title: string; desc: string; onClick: () => void }> = [
    {
      icon: '🧱', title: 'New Custom Object',
      desc: 'Create a custom object with the full set of Setup options — record name, sharing model, optional features, and deployment status. Then add fields in one flow.',
      onClick: openObjectForm,
    },
    {
      icon: '🧩', title: 'New Fields',
      desc: 'Add fields to any object — every field type from Auto Number to URL, with type-specific settings, a multi-field queue, and one-step field-level security.',
      onClick: () => openFieldWizard(),
    },
  ];

  const grid = el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', maxWidth: '720px' });
  cards.forEach((c) => {
    const card = el('button', { display: 'flex', flexDirection: 'column', gap: '8px', padding: '22px 20px', borderRadius: '14px', border: `1.5px solid ${C.border}`, background: C.panel, cursor: 'pointer', fontFamily: 'inherit', color: C.text, textAlign: 'left', transition: 'all 0.15s' });
    card.appendChild(el('div', { fontSize: '30px' }, c.icon));
    card.appendChild(el('div', { fontSize: '15px', fontWeight: '800' }, c.title));
    card.appendChild(el('div', { fontSize: '12.5px', color: C.muted, lineHeight: '1.5' }, c.desc));
    card.addEventListener('mouseover', () => { card.style.borderColor = C.accent; card.style.transform = 'translateY(-2px)'; });
    card.addEventListener('mouseout', () => { card.style.borderColor = C.border; card.style.transform = 'none'; });
    card.addEventListener('click', c.onClick);
    grid.appendChild(card);
  });
  body.appendChild(grid);

  body.appendChild(el('div', { marginTop: '18px', fontSize: '11.5px', color: C.faint, lineHeight: '1.5', maxWidth: '720px' },
    'Changes deploy straight to this org via the Tooling API — the same result as the Setup wizards. Remember that new fields still need to be added to page layouts in Setup.'));
}
