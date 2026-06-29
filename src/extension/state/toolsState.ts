// Persisted Tools toggles (show field API names, hide dev bar, hide login ad)
// and the page tweaks that apply them. The `toolsState` object is exported by
// reference; callers flip its boolean properties then call the apply helpers.

export interface ToolsState { showFieldApi: boolean; hideDevBar: boolean; hideLoginAd: boolean; }
const TOOLS_STATE_KEY = 'sf_spotlight_tools_state';
export const toolsState: ToolsState = { showFieldApi: false, hideDevBar: false, hideLoginAd: false };

export function loadToolsState(cb?: () => void): void {
  if ((globalThis as any).chrome?.storage?.local) {
    (globalThis as any).chrome.storage.local.get([TOOLS_STATE_KEY], (res: any) => {
      Object.assign(toolsState, res?.[TOOLS_STATE_KEY] || {});
      cb?.();
    });
  } else { cb?.(); }
}
export function saveToolsState(): void {
  (globalThis as any).chrome?.storage?.local?.set({ [TOOLS_STATE_KEY]: toolsState });
}

// Inject (or remove) a scoped <style> used to hide page chrome.
function setHideStyle(id: string, css: string, on: boolean): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (on) {
    if (!el) { el = document.createElement('style'); el.id = id; (document.head || document.documentElement).appendChild(el); }
    el.textContent = css;
  } else {
    el?.remove();
  }
}

function applyHideDevBar(on: boolean): void {
  setHideStyle('sf-tool-hide-devbar',
    'one-app-dev-tools-panel, .oneAuraDevToolBar, .auraDevToolBar, .devModeFooter, [class*="auraDevTool"], [class*="DevToolBar"] { display: none !important; }',
    on);
}
function applyHideLoginAd(on: boolean): void {
  setHideStyle('sf-tool-hide-loginad',
    '#rightPanel, .right, .loginAd, .right-panel, [id*="rightPanel"], .marketing, .promo, .field.right { display: none !important; }',
    on);
}

// Field API-name chips on Lightning record pages.
let fieldApiTimer: any = null;
let fieldApiObserver: MutationObserver | null = null;
function scanFieldApiNames(): void {
  // Field cells expose data-target-selection-name on the inner div; the API name
  // is the third dot-segment (e.g. "….….FieldApiName").
  const fields = document.querySelectorAll(
    'record_flexipage-record-field > div, records-record-layout-item > div, div .forcePageBlockItemView'
  );
  fields.forEach((field) => {
    const sel = (field as HTMLElement).dataset?.targetSelectionName;
    if (!sel) return;
    const parts = sel.split('.');
    const api = parts[2] || parts[parts.length - 1];
    if (!api) return;
    const labelEl = field.querySelector('span');
    if (!labelEl) return;
    if (field.querySelector('.sf-api-chip')) return;

    // Pill: [ ApiName | copy ] — placed inline next to the field label.
    const chip = document.createElement('span');
    chip.className = 'sf-api-chip';
    Object.assign(chip.style, {
      display: 'inline-flex', alignItems: 'center', gap: '6px', verticalAlign: 'middle', maxWidth: '100%',
      marginLeft: '6px', padding: '0px 4px 0px 8px', borderRadius: '6px',
      background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.25)',
      color: '#2563eb', fontSize: '11px', fontWeight: '600', fontFamily: 'monospace', lineHeight: '1.7',
    });

    const text = document.createElement('span');
    text.textContent = api;
    Object.assign(text.style, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy API name';
    const copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    const okIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    copyBtn.innerHTML = copyIcon;
    Object.assign(copyBtn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px',
      background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#2563eb',
      appearance: 'none', WebkitAppearance: 'none', flexShrink: '0',
    });
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      navigator.clipboard?.writeText(api).then(() => {
        copyBtn.innerHTML = okIcon;
        setTimeout(() => { copyBtn.innerHTML = copyIcon; }, 1100);
      }).catch(() => {});
    });

    chip.appendChild(text);
    chip.appendChild(copyBtn);
    labelEl.insertAdjacentElement('afterend', chip);
  });
}
export function applyShowFieldApi(on: boolean): void {
  if (on) {
    scanFieldApiNames();
    if (!fieldApiObserver) {
      fieldApiObserver = new MutationObserver(() => {
        clearTimeout(fieldApiTimer);
        fieldApiTimer = setTimeout(scanFieldApiNames, 400);
      });
      try { if (document.body) fieldApiObserver.observe(document.body, { childList: true, subtree: true }); } catch { /* ignore */ }
    }
  } else {
    fieldApiObserver?.disconnect();
    fieldApiObserver = null;
    document.querySelectorAll('.sf-api-chip').forEach((e) => e.remove());
  }
}

export function applyToolToggle(key: keyof ToolsState): void {
  if (key === 'hideDevBar') applyHideDevBar(toolsState.hideDevBar);
  else if (key === 'hideLoginAd') applyHideLoginAd(toolsState.hideLoginAd);
  else if (key === 'showFieldApi') applyShowFieldApi(toolsState.showFieldApi);
}
export function applyAllToolToggles(): void {
  applyHideDevBar(toolsState.hideDevBar);
  applyHideLoginAd(toolsState.hideLoginAd);
  applyShowFieldApi(toolsState.showFieldApi);
}
