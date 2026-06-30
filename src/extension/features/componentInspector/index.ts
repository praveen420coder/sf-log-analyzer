// Component Inspector (Phase 1): entry point. Lists the org's LWC bundles,
// scans the page for matching rendered components, highlights them, and opens a
// read-only source viewer on click. Fully decoupled from content-ui via deps.

import { scanCustomElements, resolveComponents, type BundleInfo, type DetectedComponent } from './detect';
import { createHighlightOverlay, type OverlayController } from './overlay';
import { openSourceViewer, type ViewerController, type LwcFile } from './viewer';

export interface InspectDeps {
  isDark: boolean;
  flashToast?: (msg: string) => void;
  listBundles: () => Promise<{ bundles?: BundleInfo[]; error?: string }>;
  fetchSource: (bundleId: string) => Promise<{ files?: LwcFile[]; error?: string }>;
  saveSource?: (resourceId: string, source: string) => Promise<{ success?: boolean; error?: string }>;
  getIsSandbox?: () => Promise<boolean | null>;
  setupUrl?: string;
  onExit?: () => void;
}

export interface InspectSession { exit: () => void }

let current: InspectSession | null = null;

export function enterInspectMode(deps: InspectDeps): InspectSession {
  // single active session
  if (current) current.exit();

  let overlay: OverlayController | null = null;
  let viewer: ViewerController | null = null;

  const exit = () => {
    viewer?.destroy(); viewer = null;
    overlay?.destroy(); overlay = null;
    if (current === session) current = null;
    deps.onExit?.();
  };
  const session: InspectSession = { exit };
  current = session;

  const pick = (c: DetectedComponent) => {
    viewer?.destroy();
    viewer = openSourceViewer(c, { isDark: deps.isDark, fetchSource: deps.fetchSource, saveSource: deps.saveSource, getIsSandbox: deps.getIsSandbox, flashToast: deps.flashToast, setupUrl: deps.setupUrl });
  };

  deps.flashToast?.('Scanning page for components…');
  deps.listBundles().then((resp) => {
    if (current !== session) return; // exited while loading
    if (resp.error) { deps.flashToast?.(resp.error); exit(); return; }
    const bundles = resp.bundles || [];
    const tags = scanCustomElements();
    const components = resolveComponents(tags, bundles);
    overlay = createHighlightOverlay(components, { isDark: deps.isDark, onPick: pick, onExit: exit });
  });

  return session;
}

export function isInspecting(): boolean { return current != null; }

export function exitInspectMode(): void { current?.exit(); }
