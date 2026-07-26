/**
 * Outbound request allowlist — SSRF protection.
 *
 * The provider layer may only ever contact explicitly configured hosts. This is
 * what stops a configuration mistake, a hostile redirect, or an attacker-supplied
 * URL from turning maqua.app into an open proxy or reaching cloud metadata
 * endpoints.
 *
 * The brief is explicit: "The external provider layer must only contact
 * explicitly configured domains. Do not build arbitrary proxy behaviour."
 */

/** Exact hostnames maqua.app is permitted to contact server-side. */
export const ALLOWED_UPSTREAM_HOSTS = new Set([
  // EEA European AQI dissemination layer — the primary air-quality source.
  'dis2datalake.blob.core.windows.net',
  // EEA station metadata and download service.
  'eeadmz1-downloads-api-appservice.azurewebsites.net',
  'eeadmz1-downloads-webapp.azurewebsites.net',
  // Weather and atmospheric context.
  'api.open-meteo.com',
  'air-quality-api.open-meteo.com',
  // ERA — permitted so a future verified integration needs no security change.
  'era.org.mt',
  // AI routing.
  'openrouter.ai',
  // Transactional email.
  'api.resend.com',
]);

export class BlockedHostError extends Error {
  constructor(readonly host: string) {
    // Deliberately terse: error text can reach logs and, in some paths, users.
    super(`Refusing to contact non-allowlisted host: ${host}`);
    this.name = 'BlockedHostError';
  }
}

/**
 * Assert a URL is safe to fetch, returning the parsed URL.
 *
 * Rejects: non-HTTPS schemes, credentials embedded in the URL, and any host not
 * on the allowlist. Host comparison is exact — no suffix matching, because
 * `evil-dis2datalake.blob.core.windows.net` would pass a naive `endsWith`.
 */
export function assertAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedHostError('(unparseable URL)');
  }

  if (url.protocol !== 'https:') {
    throw new BlockedHostError(`${url.hostname} (non-HTTPS scheme ${url.protocol})`);
  }

  if (url.username || url.password) {
    throw new BlockedHostError(`${url.hostname} (embedded credentials)`);
  }

  if (!ALLOWED_UPSTREAM_HOSTS.has(url.hostname)) {
    throw new BlockedHostError(url.hostname);
  }

  return url;
}

export function isAllowedUrl(rawUrl: string): boolean {
  try {
    assertAllowedUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether an external link is safe to render as a clickable citation.
 *
 * Looser than the fetch allowlist — we cite sources we do not fetch — but still
 * refuses anything that is not plain HTTPS, which blocks `javascript:` and
 * `data:` URLs arriving from feeds or AI output.
 */
export function isSafeExternalLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
