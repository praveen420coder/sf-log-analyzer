# CLAUDE.md

Guidance for working in this repository. Read this before making changes.

## What this is

**SF Spotlight** (package name `sf-log-analyzer`) is a Manifest V3 Chrome
extension that lives inside a Salesforce org and gives developers/admins a fast
launcher plus a growing set of tools — Spotlight search, an Apex debug-log
analyzer, Flow Manager, Validation Rule Manager, Metadata Explorer, Apex Test
Runner, Object Manager, REST Explorer, Event Monitor (streaming), Data Export,
Execute Anonymous, and more.

This is an **enterprise-grade** extension. Prefer correctness, safety, and
consistency with existing patterns over cleverness. Credentials are **never
stored** — session ids are read live from cookies at request time.

## Commands

```bash
npm install
npm run build     # tsc -b && vite build → emits dist/  (load dist/ as unpacked)
npm run lint      # eslint .
npm run dev       # vite dev server (for the React popup only)
```

Load the built `dist/` folder via `chrome://extensions` → Developer mode → Load
unpacked. After a rebuild, hit Reload on the extension.

Always run `npm run build` (which runs `tsc -b` first) before considering a
change done. Lint has a large baseline of `@typescript-eslint/no-explicit-any`
warnings from `(globalThis as any).chrome` access — those are expected; do not
add *new* non-`any` errors.

## Build entry points (vite.config.ts)

Each is emitted as a standalone file into `dist/`:

- `main` → `index.html` → `src/main.tsx` → `src/App.tsx` — the React popup (the
  Apex log-analyzer dashboard), loaded by the content script as an iframe.
- `content-ui` → `src/extension/content-ui.tsx` — **the main content script**;
  the Spotlight panel + all tool screens (vanilla DOM).
- `content` → `src/extension/content.ts` — tiny bootstrap content script.
- `background` → `src/extension/background.ts` — the service worker.
- `extractor` → `src/extension/extractor.ts` — page-context helper.
- `spotlight.html` — full-page host for `content-ui` (opened in its own tab).

**CRITICAL constraint:** `content-ui.js` is a MV3 content script injected
directly (not an ES module), so it must be a **single self-contained bundle** —
Rollup code-splitting would emit chunks it can't load. Therefore any module under
`src/extension/lib/` or `src/extension/features/` that `content-ui` imports must
stay **content-script-only** (don't let it become a shared chunk between
entries). This is why `lib/theme.ts`, `lib/toast.ts`, etc. carry a note saying
"keep this content-script-only". Only the module-loaded HTML pages (`index.html`)
may use shared chunks.

## Architecture & data flow

```
Salesforce page (cookies hold the session)
   │  content.ts / content-ui.tsx run in the page
   ▼
content-ui.tsx  ── builds the Spotlight panel (overlay or full-page) in vanilla DOM
   │  never calls Salesforce directly; bridges via chrome.runtime.sendMessage
   ▼
background.ts (service worker)  ── one onMessage router; fetches Salesforce with
   │  the live Bearer session id (read from cookies via getSfCredentials)
   ▼
Salesforce REST / Tooling / SOAP / Streaming APIs
```

- **content-ui.tsx** is large and vanilla-DOM by design. It owns the panel
  chrome (modal, tab strip / sidebar, footer), the search tabs, and dispatches
  to feature screens.
- **background.ts** is a single `chrome.runtime.onMessage.addListener` with a
  chain of `if (request.type === 'X') { ... return true; }` handlers. Handlers
  do the actual `fetch` to Salesforce and `sendResponse`. Return `true` to keep
  the message channel open for the async response. Long-lived streams use Ports
  (`api-log`, `event-monitor`).
- **Credentials:** never stored. `getSfCredentials()` (lib/sfUrls.ts) asks the
  background to resolve the session from cookies for the active host. Handlers
  receive `{ instanceUrl, sessionId }` per request.
- **API version:** background keeps a module var `AV` loaded from
  `sf_spotlight_prefs.apiVersion` (Settings → Salesforce). Every endpoint builds
  its URL as `.../services/data/v${AV}/...`. Don't hardcode versions.

## Directory map

```
src/
  App.tsx, main.tsx, components/, hooks/   React popup (log-analyzer dashboard)
  settings/                                (deprecated stubs — settings are in-panel now)
  extension/
    content-ui.tsx        Spotlight panel + all tool screens (vanilla DOM) — the big one
    background.ts         Service worker: message router + Ports + fetches
    content.ts            bootstrap content script
    links.ts              curated Salesforce Setup links (Setup search)
    features/             one file per tool/feature: renderXInto(host, deps)
    lib/                  shared, content-script-only helpers (see below)
    state/               persisted stores backed by chrome.storage.local
    log-analyzer/         Apex log analyzer views (timeline, tree, tables)
    apex-log-parser/      vendored BSD-3 parser (Certinia) — treat as third-party
    spotlight/            metadata catalog for the Metadata Explorer
```

### `lib/` (shared helpers — keep content-script-only)

- `theme.ts` — `getTheme(isDark)` returns the **single** design palette (bg,
  card, headerBg, side, border, divider, accent, accentSoft, text, muted, …).
  **Use it; never re-declare a per-feature `C = {}` palette.** `setUiMode()`
  switches the default/SLDS skin.
- `toast.ts` — bottom-right stacked toast system. `showToast(msg, {type,id})`,
  `dismissToast`, `setToastTheme`, `setToastEnabled`.
- `jsonHighlight.ts` — themed JSON syntax highlighting → HTML string.
- `sfUrls.ts` — origins (`lightningOrigin`, `setupOrigin`), `sfHostname`,
  `cleanSfDomain`, `getSfCredentials`, active-host override.
- `settingsStore.ts` — storage layer + types/defaults for the Settings screen
  (KEYS, DEFAULT_*, get/set/remove, `bumpUsage`, tab-config helpers).
- `salesforceId.ts`, `idMenu.ts`, `apiLog.ts` — id utilities / API console types.

### `state/` (persisted stores, chrome.storage.local)

`settings.ts` (panel appearance), `toolsState.ts` (on-page toggles),
`sessions.ts` (visited orgs — no tokens), `recents.ts`, `customShortcuts.ts`.

## The feature pattern (how tools are built)

Every tool is a file in `features/` exporting a render function:

```ts
export function renderFlowManagerInto(host: HTMLElement, deps: FlowManagerDeps): void
```

- **Vanilla DOM** using a local `el(tag, style?, text?)` helper and
  `const C = getTheme(deps.isDark)`.
- **`deps` is the only bridge to the outside world.** Features do **not** touch
  `chrome.*`, `fetch`, or storage directly. `deps` carries `isDark`, `onBack`,
  `flashToast`, and typed callbacks like `runQuery(soql)`, `sendBg(msg)`,
  `listFlows()`, `setActiveVersion()`. content-ui implements those callbacks by
  attaching `{ instanceUrl, sessionId }` and calling the background.
- Long lists come from **one bulk query**, not N+1 per row.
- Managed/installed-package metadata is typically hidden and only fetched on
  demand (see Flow/Validation managers).
- Destructive actions get an inline Confirm/Cancel step, not a modal.

### Wiring a new tool (checklist)

1. `features/myTool.ts` → `renderMyToolInto(host, deps)`.
2. Background: add `if (request.type === 'MY_TOOL_X')` handler(s); `return true`.
3. content-ui.tsx:
   - `import { renderMyToolInto }`.
   - Add a `TOOLS` grid tile `{ id: 'mytool', icon, label, desc }`.
   - Add a `toolView === 'mytool'` branch that builds `deps` (with a `sendBg`
     bridge) and calls `renderMyToolInto(resultsContainer, deps)`.
   - Add it to the input-hide list and the command list (`run:` entry).
   - If it should appear in the full-page sidebar, add it to `FULLPAGE_SIDEBAR`.
4. `npm run build` and reload.

## Panel modes (content-ui.tsx)

- **Overlay** — floating card over the SF page; horizontal tab strip.
- **Full-page** (`SPOTLIGHT_PAGE`/`fullPage`, i.e. `spotlight.html`) — fills a
  tab. Layout is a column: a top row of `[vertical tab sidebar | content]` above
  a full-width footer strip. The sidebar is a **curated** list
  (`FULLPAGE_SIDEBAR` = key tabs + tool shortcuts), collapsible to an icon rail
  (`fullPageSidebarCollapsed`, persisted). The current-user avatar sits at the
  top, the SF Spotlight brand at the bottom under Settings.
- Settings render **in-panel** via `features/settingsPanel.ts` (vanilla), not a
  separate HTML page. From the overlay, the ⚙ opens the full-page tab on the
  Settings tab (`spotlight.html?tab=__settings`).

## Code practices / gotchas

- **One palette.** All chrome and all tool screens use `getTheme(isDark)` so
  colors stay consistent (incl. the SLDS skin). Don't introduce ad-hoc hexes for
  surfaces/text/borders.
- **Never store secrets.** No session ids/tokens in storage. Read live via
  `getSfCredentials`. The Connection screen copies live tokens to the clipboard
  only on explicit user action, with a warning.
- **Background handlers** are async: build the URL with `v${AV}`, `fetch` with
  `Authorization: Bearer ${sessionId}`, `sendResponse`, and `return true`.
- **Read-modify-write** for metadata that can't take a partial PATCH (e.g.
  validation rules: GET metadata → flip a field → PATCH the whole thing).
- **Single-file content script.** Don't add imports that force Rollup to split
  `content-ui` into chunks (keep `lib/` helpers content-script-only).
- **Data safety.** "Clear cache" clears only in-memory metadata caches — never
  saved orgs, favorites, or history.
- **TypeScript strict** (`noUnusedLocals`): remove dead imports/vars or the
  build fails. `(globalThis as any).chrome` is the accepted chrome-access idiom.
- `apex-log-parser/` is vendored third-party (BSD-3, Certinia) — avoid editing.

## Docs

User-facing docs live in `docs/docs.html` (guide) and `README.md`. Update the
"What's New" section and README feature list when you ship a notable feature.
