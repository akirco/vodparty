// Explicit extension: `server.ts` runs directly under Node (type stripping),
// where bundler-style extensionless imports are not resolvable.
import { validateProxyUrl } from './validateProxy.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export const DEFAULT_TIMEOUT_MS = 10_000;
/** Upstream JSON payloads are metadata lists; anything huge is not one. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface ProxyResult {
  status: number;
  data: unknown;
}

/** Redirect hops allowed before giving up. */
const MAX_REDIRECTS = 5;

const isRedirect = (status: number) =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

/**
 * The single implementation of "fetch some upstream Apple CMS JSON through
 * the proxy", shared by `server.ts` and `netlify/functions/proxy.ts`.
 *
 * The two used to drift apart: the express one parsed the body to decide
 * whether it was JSON, while the Netlify one trusted the `content-type`
 * header and returned a confusing parse error on a mismatch. Both are now
 * the same code, so a source that works in one deployment works in the other.
 *
 * Status codes:
 *   403 - rejected by validation, or the response was not JSON
 *   502 - upstream unreachable / non-2xx
 *   504 - upstream timed out
 */
export async function fetchUpstreamJson(
  targetUrl: string,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    hops = 0,
  }: { timeoutMs?: number; hops?: number } = {},
): Promise<ProxyResult> {
  const validation = validateProxyUrl(targetUrl);
  if (!validation.valid) {
    return { status: 403, data: { error: validation.error } };
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
      },
      // Manual redirect handling: `follow` would let a public host bounce us
      // to an internal one, which is exactly what the validation above exists
      // to prevent. Each hop is re-validated.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          status: 502,
          data: { error: 'Upstream redirect without target' },
        };
      }
      let next: string;
      try {
        next = new URL(location, targetUrl).toString();
      } catch {
        return {
          status: 502,
          data: { error: 'Upstream sent an invalid redirect' },
        };
      }
      if (hops >= MAX_REDIRECTS) {
        return { status: 502, data: { error: 'Too many redirects' } };
      }
      return fetchUpstreamJson(next, { timeoutMs, hops: hops + 1 });
    }

    if (!response.ok) {
      return {
        status: 502,
        data: { error: `Upstream returned status ${response.status}` },
      };
    }

    // Enforce the cap before buffering the whole body.
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return { status: 403, data: { error: 'Response too large' } };
    }

    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) {
      return { status: 403, data: { error: 'Response too large' } };
    }

    // Some Apple CMS backends serve valid JSON with a text/html content-type,
    // so validate by parsing the body rather than trusting the header.
    try {
      return { status: 200, data: JSON.parse(body) };
    } catch {
      return {
        status: 403,
        data: { error: 'Only JSON responses are allowed' },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { status: 504, data: { error: 'Upstream request timed out' } };
    }
    // Never echo the raw cause: it can contain the resolved IP address.
    console.warn(`[Proxy] Failed to fetch upstream: ${message}`);
    return { status: 502, data: { error: 'Failed to fetch from target URL' } };
  }
}
