# Component Inspector — Implementation Plan & Status

> Status: Phase 1 + Phase 2 **built** (2026-06-30). See sections 6–7. Phase 3 is future.

**Scope:** On-page action → highlight every custom LWC rendered on the page with a name badge → click a component → open a source viewer (html / js / css / meta) fetched via the Tooling API, with deep links to Setup — and, for org-owned components, an inline editor that deploys changes back with guardrails.

---

## 1. Why Phase 1 is safe & cheap on the current architecture

- Content scripts (`content-ui.js`) run in the **isolated world** at `document_end` — they can already read the full DOM, including Salesforce **synthetic shadow** subtrees and **open** native shadow roots (`element.shadowRoot`). No MAIN-world injection needed.
- The org's LWC source lives in the Tooling API (`LightningComponentBundle` + `LightningComponentResource.Source`). We already query `LightningComponentBundle` in `spotlight/metadataCatalog.ts`, and there's a generic Tooling handler (`METADATA_QUERY`) and credential plumbing (`getSfCredentials`, `GET_ORG_LIMITS`-style background handlers).
- **No manifest changes required.** `host_permissions` + `cookies` already cover the Tooling calls; DOM access is inherent to the content script.

---

## 2. UX flow

1. User triggers **Inspect Components** (new Tools-drawer entry `inspectlwc`, and/or a keyboard shortcut). Triggering dismisses the Spotlight panel and enters *inspect mode*.
2. A full-page overlay layer draws a border box + name badge over each detected **custom** LWC. Base/managed components are dimmed or hidden (view-only).
3. Hovering a box emphasizes it; a small fixed toolbar shows count + **Exit** (also `Esc`).
4. Clicking a component (or its "View source" button on the badge) opens the **read-only viewer** docked to the side, with tabs per file. Toolbar offers **Copy**, **Open in Setup**, **Open in Dev Console**.

---

## 3. Modules (new folder `src/extension/features/componentInspector/`)

Per the project file-structure convention, this is its own feature folder, decoupled from `content-ui.tsx` via injected deps.

### `detect.ts` — find the components
- Recursive DOM walker that descends into `el.shadowRoot` when present (handles synthetic + open shadow). Note: **closed** native shadow is invisible — acceptable, rare on platform.
- Collect custom elements (tag contains `-`). Filter OUT platform/base namespaces: `lightning-`, `force-`, `forcegenerated-`, `lightningsnapin-`, `aura-`, `one-`, `flowruntime-`, `runtime_*`, `interop-`, etc.
- Map remaining tags → bundle DeveloperName: `c-my-component` → `myComponent`; `ns-foo-bar` → namespace `ns`, name `fooBar`.
- Cross-check against a **one-time Tooling query** of the org's bundles (`SELECT Id, DeveloperName, NamespacePrefix FROM LightningComponentBundle`). Keep only tags that match a real bundle. Mark `NamespacePrefix === null` as **editable/own**; managed (non-null) as **view-only**.
- Output: `{ tag, bundleId, developerName, namespace, elements: Element[], editable: boolean }[]` (one entry per distinct component, with all live element instances).

### `overlay.ts` — highlight layer
- A single fixed-position container at very high z-index, appended to `document.body`, `pointer-events: none` except on badges/handles.
- One absolutely-positioned box per element instance via `getBoundingClientRect()`; colored border + a name badge (developerName, instance count).
- Reposition on `scroll` / `resize` and via `ResizeObserver`, batched with `requestAnimationFrame`. Throttle; only render boxes for matched (real) bundles to avoid noise/perf issues on heavy pages.
- Exit affordances: toolbar button + `Esc` keydown. Clean teardown removes listeners/observers.

### `source.ts` (client) + new background handler `GET_LWC_SOURCE`
- Background handler given a `bundleId` returns the bundle's files:
  - Try inline: `GET /tooling/query?q=SELECT Id, FilePath, Format, Source FROM LightningComponentResource WHERE LightningComponentBundleId = '<id>'`.
  - **Validate** whether `Source` comes back inline via Tooling SOQL; if not (or truncated), fall back to per-resource `GET /tooling/sobjects/LightningComponentResource/<id>` for each file.
  - Return `[{ filePath, format, source }]`.
- Client `source.ts` wraps it in a `Promise` like the existing `fetchLimits`/`dataQuery` injected deps.

### `viewer.ts` — read-only code panel
- Docked side panel (reuse Spotlight theming tokens from existing features). Tab per file (`.html`, `.js`, `.js-meta.xml`, `.css`).
- **Start simple**: `<pre>` + monospace + basic escaping (keeps bundle size flat — current `content-ui.js` is ~414 kB). Defer Monaco/CodeMirror unless syntax highlighting is required; if added, lazy-load it.
- Toolbar: Copy file, **Open in Setup** (`/lightning/setup/LightningComponentBundles/page?address=...` or the bundle record), **Open in Dev Console**.

### Wiring in `content-ui.tsx`
- Add a Tools-drawer entry `{ id: 'inspectlwc', icon: '🔍', label: 'Inspect Components', desc: 'Highlight LWCs on this page' }` whose `run()` hides the Spotlight and calls `enterInspectMode(deps)`.
- Build the injected deps here (where `getSfCredentials` lives): `listBundles()` (METADATA_QUERY) + `fetchSource(bundleId)` (new `GET_LWC_SOURCE`) + `flashToast`.
- Optional: a keyboard shortcut to toggle inspect mode.

---

## 4. Key decisions to validate during build

1. **Does Tooling SOQL return `LightningComponentResource.Source` inline?** If not/truncated, use per-resource GET. (Validate first — it drives the background handler shape.)
2. **Tag → bundle mapping for namespaced/managed components** is ambiguous. Mitigation: only treat `NamespacePrefix === null` bundles as editable; show managed as view-only/greyed.
3. **Detection precision** — pages are full of `lightning-*` / Aura noise. The bundle cross-check is what keeps the highlight list to real, org-owned components.
4. **Performance** on heavy pages — throttle the walk, only box matched components, batch repositioning with rAF.
5. **Closed shadow DOM** — invisible to the walker. Acceptable; note it in the UI if a known component isn't found.

---

## 5. Verify

- `npx tsc -b` clean + `npx vite build` (watch that `content-ui.js` bundle stays roughly flat if no editor lib is added).
- Manual test on a **sandbox** record/app page: confirm own custom LWCs are detected, boxes track on scroll/resize, viewer loads html/js/css, deep links open the right place.

---

## 6. Phase 2 — edit + deploy (BUILT)

Implemented as a gated inline editor in `viewer.ts` + a `SAVE_LWC_SOURCE` background handler.

- **Save mechanism — direct Tooling CRUD, not MetadataContainer.** We deliberately do **not** use the `MetadataContainer` → `ContainerAsyncRequest` flow: per the [MetadataContainer docs](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_metadatacontainer.htm) it only manages `ApexClassMember`, `ApexTriggerMember`, `ApexPageMember`, and `ApexComponentMember` — **LWC's `LightningComponentResource` is not a supported container member**. The supported (and only) Tooling save path for LWC is a direct `PATCH` to `tooling/sobjects/LightningComponentResource/{id}` with `{ "Source": ... }`. Salesforce compiles on save and returns descriptive 400 errors, which we surface verbatim.
- **Safety net — verify-after-save.** Because there's no second save API to "fall back" to for LWC, the meaningful safety net is verification: after a successful PATCH the handler re-queries the resource's `Source` (whitespace-normalized) and returns a `verified` flag. The editor shows "Deployed and verified" on a match, or a soft warning if the org reports different source.
- **Guardrails.** Edit is offered only on org-owned components (`NamespacePrefix == null`). Every save runs through a confirm-deploy modal; on a **production** org (detected via `GET_ORG_INFO.IsSandbox`) the dialog shows a red warning and requires ticking "I understand this edits production" before the Deploy button enables.

## 7. Status (built 2026-06-30)

- Phase 1 (detect + highlight + read-only viewer) and Phase 2 (edit + deploy + verify) are implemented and pass `tsc -b` + `vite build`.
- Shortcut: **Alt+Z / Option+Z** toggles inspect mode (`event.code === 'KeyZ'` to dodge the Mac Option-char remap).
- Bug fixed: Lightning's SPA keeps prior-page components in the DOM hidden, which inflated the count; detection now filters instances through `Element.checkVisibility()` and drops components with no visible instance.

## 8. Phase 3 notes (later)

- Live component **props/state** inspection (React-DevTools-style) likely needs a **MAIN-world** injected script + `postMessage` bridge (the isolated content script can't read the LWC engine's internals).
- If a future need arises to edit Apex from the same surface, *that* is where the `MetadataContainer` → `ContainerAsyncRequest` flow legitimately applies (Apex members are supported).
