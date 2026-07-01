// Salesforce host / origin helpers and session-credential lookup.
//
// Full-page mode (spotlight.html?host=<sfHost>) opens in its own tab, so there's
// no Salesforce host in window.location — we carry it in the query string.

export const SPOTLIGHT_PAGE = typeof location !== 'undefined' && location.pathname.endsWith('spotlight.html');

let pageHost: string | null = null;
if (SPOTLIGHT_PAGE) {
  try { pageHost = new URLSearchParams(location.search).get('host'); } catch { pageHost = null; }
}

export function sfHostname(): string { return pageHost || window.location.hostname; }
export function sfProtocol(): string { return pageHost ? 'https:' : window.location.protocol; }

export function cleanSfDomain(domain: string): string {
  return domain.replace(/\.lightning\.force\./, '.my.salesforce.').replace(/\.mcas\.ms$/, '');
}

// Origins are built from the ACTIVE host (honors the session switcher override),
// so when the panel is retargeted to another org, navigation opens that org too.
export function lightningOrigin(): string {
  const host = activeSfHost()
    .replace(/\.mcas\.ms$/, '')
    .replace(/\.my\.salesforce\.com$/, '.lightning.force.com');
  return `https://${host}`;
}

// Lightning apps open via the Setup domain: <mydomain>.my.salesforce-setup.com
// using /lightning?appContextId=<AppDefinition DurableId>.
export function setupOrigin(): string {
  const host = activeSfHost()
    .replace(/\.mcas\.ms$/, '')
    .replace(/\.lightning\.force\.com$/, '.my.salesforce-setup.com')
    .replace(/\.my\.salesforce\.com$/, '.my.salesforce-setup.com');
  return `https://${host}`;
}

// Active session override. When set, getSfCredentials resolves the session for
// this host instead of the current page's host — this is how the footer session
// switcher retargets the panel to another org "in place". The token itself is
// still fetched live from cookies by the background; nothing secret is stored.
let sessionOverrideHost: string | null = null;

export function setSessionOverrideHost(host: string | null): void {
  sessionOverrideHost = host ? cleanSfDomain(host) : null;
}
export function getSessionOverrideHost(): string | null { return sessionOverrideHost; }

/** The host the panel is currently operating against (override or page host). */
export function activeSfHost(): string {
  return sessionOverrideHost || cleanSfDomain(sfHostname());
}

export function getSfCredentials(): Promise<any> {
  return new Promise((resolve) => {
    const chromeRuntime = (globalThis as any).chrome?.runtime;
    if (!chromeRuntime) return resolve(null);
    chromeRuntime.sendMessage(
      { type: 'GET_SF_CREDENTIALS', hostname: activeSfHost() },
      (r: any) => resolve(r?.data || null),
    );
  });
}
