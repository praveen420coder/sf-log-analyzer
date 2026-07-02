// Automation Map — "what happens on save" for any object, laid out in
// Salesforce's actual order of execution: before-save flows → before triggers
// → validation rules → duplicate rules → after triggers → assignment /
// auto-response rules → workflow rules → processes & after-save flows →
// escalation rules. A DML filter (Insert / Update / Delete) narrows each phase
// to what actually fires for that operation.
//
// Data arrives via the injected `fetchAutomation` (GET_OBJECT_AUTOMATION);
// each source fails soft so a missing permission dims one phase instead of
// blanking the map. Backend-agnostic — see [[file-structure-convention]].

import { palette, el, textInput, button, toolHeader } from './objectManager/ui';
import type { SfObjectRef } from './objectManager';

type SfRow = Record<string, unknown>;
interface QueryResult { records: SfRow[]; error?: string }

export interface AutomationData {
  triggers: QueryResult;
  validations: QueryResult;
  dupRules: QueryResult;
  workflows: QueryResult;
  flows: QueryResult;
  assignment: QueryResult;
}

export interface AutomationMapDeps {
  isDark: boolean;
  onBack: () => void;
  flashToast?: (msg: string) => void;
  listObjects: () => Promise<{ data?: SfObjectRef[]; error?: string }>;
  fetchAutomation: (objectApiName: string) => Promise<{ data?: AutomationData; error?: string }>;
  lightningOrigin: () => string;
  openUrl: (url: string) => void;
}

type Dml = 'insert' | 'update' | 'delete';

interface Item {
  icon: string;
  name: string;
  detail?: string;
  active: boolean;
  url?: string;
}

interface Phase {
  step: number;
  title: string;
  note?: string;
  items: Item[];
  error?: string;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

export function renderAutomationMapInto(host: HTMLElement, deps: AutomationMapDeps): void {
  const C = palette(deps.isDark);
  host.innerHTML = '';
  const root = el('div', { height: '100%', minHeight: '0', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text });
  host.appendChild(root);

  const { head, right } = toolHeader(C, '🧭 Automation Map', deps.onBack);
  root.appendChild(head);
  const changeBtn = button(C, 'Change object');
  changeBtn.style.display = 'none';
  right.appendChild(changeBtn);

  const body = el('div', { flex: '1', minHeight: '0', overflowY: 'auto', padding: '6px 28px 28px' });
  root.appendChild(body);

  let target: SfObjectRef | null = null;
  changeBtn.addEventListener('click', () => { target = null; changeBtn.style.display = 'none'; showObjectPicker(); });

  // ── Object picker ───────────────────────────────────────────
  function showObjectPicker(): void {
    body.innerHTML = '';
    body.appendChild(el('div', { fontSize: '13px', color: C.muted, margin: '14px 0 10px', lineHeight: '1.5' },
      'Pick an object to see everything that fires when a record is saved — in the order Salesforce runs it.'));
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
        rowEl.addEventListener('click', () => { target = o; changeBtn.style.display = 'inline-block'; showMap(); });
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

  // ── Map view ────────────────────────────────────────────────
  function showMap(): void {
    if (!target) return;
    const obj = target;
    body.innerHTML = '';

    const controls = el('div', { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', margin: '12px 0 4px' });
    controls.appendChild(el('div', { fontSize: '15px', fontWeight: '800' }, `${obj.label}`));
    controls.appendChild(el('div', { fontSize: '12px', color: C.faint, fontWeight: '600' }, obj.apiName));

    // DML segmented control
    let dml: Dml = 'update';
    const seg = el('div', { display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', marginLeft: 'auto' });
    const segBtns = new Map<Dml, HTMLButtonElement>();
    (['insert', 'update', 'delete'] as Dml[]).forEach((m) => {
      const b = el('button', { background: 'transparent', border: 'none', padding: '6px 14px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit', color: C.muted, fontWeight: '600' }, m[0].toUpperCase() + m.slice(1));
      b.addEventListener('click', () => { dml = m; paintSeg(); paintPhases(); });
      segBtns.set(m, b);
      seg.appendChild(b);
    });
    const paintSeg = () => segBtns.forEach((b, m) => Object.assign(b.style, { background: dml === m ? C.accent : 'transparent', color: dml === m ? '#fff' : C.muted, fontWeight: dml === m ? '700' : '600' }));
    controls.appendChild(seg);

    // Active-only toggle
    let activeOnly = true;
    const activeBtn = el('button', { border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px', fontFamily: 'inherit', background: 'transparent', color: C.muted, fontWeight: '600' }, 'Active only');
    const paintActive = () => Object.assign(activeBtn.style, { background: activeOnly ? C.accent : 'transparent', color: activeOnly ? '#fff' : C.muted, borderColor: activeOnly ? C.accent : C.border });
    activeBtn.addEventListener('click', () => { activeOnly = !activeOnly; paintActive(); paintPhases(); });
    controls.appendChild(activeBtn);
    body.appendChild(controls);

    const phasesHost = el('div', { marginTop: '14px' });
    body.appendChild(phasesHost);
    phasesHost.appendChild(el('div', { padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: '600' }, 'Mapping automation…'));

    let data: AutomationData | null = null;

    const lightning = deps.lightningOrigin();
    const setupAddr = (id: string, page: string) => `${lightning}/lightning/setup/${page}/page?address=%2F${id}`;
    const flowUrl = (r: SfRow) => {
      const vid = str(r.ActiveVersionId) || str(r.LatestVersionId);
      return vid ? `${lightning}/builder_platform_interaction/flowBuilder.app?flowId=${vid}` : undefined;
    };

    function buildPhases(d: AutomationData): Phase[] {
      const triggerItems = (usage: 'Before' | 'After'): Item[] => (d.triggers.records || [])
        .filter((t) => {
          const key = `Usage${usage}${dml === 'insert' ? 'Insert' : dml === 'update' ? 'Update' : 'Delete'}`;
          return t[key] === true;
        })
        .map((t) => ({
          icon: '⚙️',
          name: str(t.Name),
          detail: (['Insert', 'Update', 'Delete', 'Undelete'] as const)
            .filter((op) => t[`Usage${usage}${op}`] === true || (op === 'Undelete' && usage === 'After' && t.UsageAfterUndelete === true))
            .map((op) => op.toLowerCase()).join(', '),
          active: str(t.Status) === 'Active',
          url: setupAddr(str(t.Id), 'ApexTriggers'),
        }));

      const flowMatchesDml = (r: SfRow): boolean => {
        const rt = str(r.RecordTriggerType);
        if (dml === 'insert') return rt === 'Create' || rt === 'CreateAndUpdate';
        if (dml === 'update') return rt === 'Update' || rt === 'CreateAndUpdate';
        return rt === 'Delete';
      };
      const flowItems = (kind: 'before' | 'after' | 'process'): Item[] => (d.flows.records || [])
        .filter((r) => {
          const tt = str(r.TriggerType);
          const pt = str(r.ProcessType);
          if (kind === 'process') return pt === 'Workflow'; // Process Builder
          if (pt === 'Workflow') return false;
          if (kind === 'before') return (tt === 'RecordBeforeSave' && dml !== 'delete' && flowMatchesDml(r)) || (tt === 'RecordBeforeDelete' && dml === 'delete');
          return tt === 'RecordAfterSave' && dml !== 'delete' && flowMatchesDml(r);
        })
        .map((r) => ({
          icon: kind === 'process' ? '🧷' : '🌊',
          name: str(r.Label) || str(r.ApiName),
          detail: kind === 'process' ? 'Process Builder' : str(r.RecordTriggerType) || str(r.TriggerType),
          active: r.IsActive === true,
          url: flowUrl(r),
        }));

      const setupLinkItem = (icon: string, name: string, page: string): Item => ({
        icon, name, active: true, url: `${lightning}/lightning/setup/${page}/home`,
      });

      const simpleItems = (qr: QueryResult, icon: string, nameKey: string, activeKey: string, page: string): Item[] =>
        (qr.records || []).map((r) => ({
          icon,
          name: str(r[nameKey]) || str(r.DeveloperName),
          active: r[activeKey] === true,
          url: setupAddr(str(r.Id), page),
        }));

      const phases: Phase[] = [
        { step: 1, title: 'Before-save record-triggered flows', items: flowItems('before'), error: d.flows.error, note: dml === 'delete' ? 'Before-delete flows' : 'Fast field updates — run before triggers' },
        { step: 2, title: 'Before triggers', items: triggerItems('Before'), error: d.triggers.error },
        ...(dml !== 'delete' ? [
          { step: 3, title: 'Validation rules', items: (d.validations.records || []).map((r) => ({ icon: '🛡️', name: str(r.ValidationName), detail: str(r.ErrorMessage), active: r.Active === true, url: setupAddr(str(r.Id), 'ObjectManager') })), error: d.validations.error, note: 'System validation (required fields, formats) runs first' },
          { step: 4, title: 'Duplicate rules', items: simpleItems(d.dupRules, '👥', 'MasterLabel', 'IsActive', 'DuplicateRules'), error: d.dupRules.error },
        ] : []),
        { step: 5, title: 'After triggers', items: triggerItems('After'), error: d.triggers.error },
        // AutoResponseRule / EscalationRule aren't queryable via API (Metadata
        // API only) — surface those phases as a single Setup deep-link so the
        // execution order stays visible without a doomed query.
        ...(dml === 'insert' && (obj.apiName === 'Lead' || obj.apiName === 'Case') ? [
          { step: 6, title: 'Assignment rules', items: simpleItems(d.assignment, '📮', 'Name', 'Active', obj.apiName === 'Lead' ? 'LeadRules' : 'CaseRules'), error: d.assignment.error },
          { step: 7, title: 'Auto-response rules', items: [setupLinkItem('📧', 'View auto-response rules in Setup', obj.apiName === 'Lead' ? 'LeadResponses' : 'CaseResponses')], note: 'Not queryable via API — opens the Setup list' },
        ] : []),
        ...(dml !== 'delete' ? [
          { step: 8, title: 'Workflow rules', items: simpleItems(d.workflows, '🔁', 'Name', 'Active', 'WorkflowRules'), error: d.workflows.error, note: 'Field updates from workflows re-fire before & after triggers' },
          { step: 9, title: 'Processes & after-save flows', items: [...flowItems('process'), ...flowItems('after')], error: d.flows.error },
        ] : []),
        ...(dml !== 'delete' && obj.apiName === 'Case' ? [
          { step: 10, title: 'Escalation rules', items: [setupLinkItem('🚨', 'View escalation rules in Setup', 'CaseEscRules')], note: 'Not queryable via API — opens the Setup list' },
        ] : []),
      ];
      // Workflow rules: active flag lives in Metadata (not queryable in bulk) —
      // treat unknown as active so they aren't hidden by the Active-only filter.
      const wf = phases.find((p) => p.title === 'Workflow rules');
      if (wf) wf.items = wf.items.map((i) => ({ ...i, active: true }));
      return phases;
    }

    function paintPhases(): void {
      if (!data) return;
      phasesHost.innerHTML = '';
      const phases = buildPhases(data);
      let shownTotal = 0;

      phases.forEach((p, idx) => {
        const items = activeOnly ? p.items.filter((i) => i.active) : p.items;
        shownTotal += items.length;

        const wrap = el('div', { display: 'flex', gap: '14px', position: 'relative' });
        // timeline rail
        const rail = el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '30px', flexShrink: '0' });
        const dot = el('div', {
          width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11.5px', fontWeight: '800', flexShrink: '0',
          background: items.length ? C.accent : C.zebra, color: items.length ? '#fff' : C.faint,
          border: items.length ? 'none' : `1.5px solid ${C.divider}`,
        }, String(idx + 1));
        rail.appendChild(dot);
        if (idx < phases.length - 1) rail.appendChild(el('div', { flex: '1', width: '2px', background: C.divider, margin: '4px 0' }));
        wrap.appendChild(rail);

        const content = el('div', { flex: '1', minWidth: '0', paddingBottom: '18px' });
        const titleRow = el('div', { display: 'flex', alignItems: 'baseline', gap: '8px' });
        titleRow.appendChild(el('div', { fontSize: '13.5px', fontWeight: '800', color: items.length ? C.text : C.faint }, p.title));
        titleRow.appendChild(el('div', { fontSize: '11.5px', color: C.faint, fontWeight: '600' }, items.length ? `${items.length}` : 'none'));
        content.appendChild(titleRow);
        if (p.note) content.appendChild(el('div', { fontSize: '11px', color: C.faint, marginTop: '2px' }, p.note));
        if (p.error) content.appendChild(el('div', { fontSize: '11.5px', color: C.danger, marginTop: '4px' }, `Could not load: ${p.error}`));

        items.forEach((i) => {
          const rowEl = el(i.url ? 'button' : 'div', {
            display: 'flex', alignItems: 'center', gap: '9px', width: '100%', textAlign: 'left',
            padding: '8px 10px', marginTop: '6px', borderRadius: '8px', border: `1px solid ${C.divider}`,
            background: C.panel, cursor: i.url ? 'pointer' : 'default', fontFamily: 'inherit', color: C.text,
            opacity: i.active ? '1' : '0.55',
          });
          rowEl.appendChild(el('span', { fontSize: '14px' }, i.icon));
          const info = el('div', { flex: '1', minWidth: '0' });
          const nameRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
          nameRow.appendChild(el('span', { fontSize: '12.5px', fontWeight: '700' }, i.name));
          if (!i.active) nameRow.appendChild(el('span', { fontSize: '10px', fontWeight: '800', color: C.danger, border: `1px solid ${C.danger}`, borderRadius: '5px', padding: '1px 5px' }, 'INACTIVE'));
          info.appendChild(nameRow);
          if (i.detail) info.appendChild(el('div', { fontSize: '11px', color: C.faint, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, i.detail));
          rowEl.appendChild(info);
          if (i.url) {
            rowEl.appendChild(el('span', { fontSize: '11px', color: C.faint }, '↗'));
            rowEl.addEventListener('mouseover', () => { rowEl.style.borderColor = C.accent; });
            rowEl.addEventListener('mouseout', () => { rowEl.style.borderColor = C.divider; });
            rowEl.addEventListener('click', () => deps.openUrl(i.url!));
          }
          content.appendChild(rowEl);
        });

        wrap.appendChild(content);
        phasesHost.appendChild(wrap);
      });

      phasesHost.appendChild(el('div', { fontSize: '11.5px', color: C.faint, marginTop: '4px', lineHeight: '1.5' },
        shownTotal === 0
          ? `No ${activeOnly ? 'active ' : ''}automation fires on ${dml} for ${obj.label}.`
          : `${shownTotal} automation${shownTotal === 1 ? '' : 's'} fire on ${dml} · after all of this: roll-up summaries to parents, sharing recalculation, then post-commit work (emails, async Apex, queued flows).`));
    }

    paintSeg();
    paintActive();
    deps.fetchAutomation(obj.apiName).then((resp) => {
      if (resp.error || !resp.data) {
        phasesHost.innerHTML = '';
        phasesHost.appendChild(el('div', { padding: '40px 0', textAlign: 'center', color: C.danger, fontSize: '13px', fontWeight: '600' }, resp.error || 'Could not load automation.'));
        return;
      }
      data = resp.data;
      paintPhases();
    });
  }

  showObjectPicker();
}
