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

export function lightningOrigin(): string {
  const host = sfHostname()
    .replace(/\.mcas\.ms$/, '')
    .replace(/\.my\.salesforce\.com$/, '.lightning.force.com');
  return `${sfProtocol()}//${host}`;
}

// Lightning apps open via the Setup domain: <mydomain>.my.salesforce-setup.com
// using /lightning?appContextId=<AppDefinition DurableId>.
export function setupOrigin(): string {
  const host = sfHostname()
    .replace(/\.mcas\.ms$/, '')
    .replace(/\.lightning\.force\.com$/, '.my.salesforce-setup.com')
    .replace(/\.my\.salesforce\.com$/, '.my.salesforce-setup.com');
  return `${sfProtocol()}//${host}`;
}

export function getSfCredentials(): Promise<any> {
  return new Promise((resolve) => {
    const chromeRuntime = (globalThis as any).chrome?.runtime;
    if (!chromeRuntime) return resolve(null);
    chromeRuntime.sendMessage(
      { type: 'GET_SF_CREDENTIALS', hostname: cleanSfDomain(sfHostname()) },
      (r: any) => resolve(r?.data || null),
    );
  });
}
