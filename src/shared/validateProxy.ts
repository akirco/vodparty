/**
 * SSRF guards for the `/api/proxy` endpoints.
 *
 * The proxy is reachable by anyone who can load the app, so without these
 * checks it is an open relay into whatever network the server sits on:
 * cloud metadata endpoints, other containers on the same bridge, loopback
 * admin ports, and so on.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::',
  '::1',
  '[::]',
  '[::1]',
  // AWS / GCP / Azure instance metadata.
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

/** Suffixes that resolve inside a private network. */
const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost', '.localdomain'];

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

/**
 * Hostnames may be written as a bare integer or hex/octal literal
 * (`2130706433`, `0x7f000001`, `017700000001`), all of which resolve to
 * loopback and would otherwise sail past a dotted-quad regex.
 */
function numericHost(host: string): number | null {
  if (/^\d+$/.test(host)) return Number(host);
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) return parseInt(host, 16);
  if (/^0[0-7]+$/.test(host)) return parseInt(host, 8);
  return null;
}

function ipv4IsPrivate(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 TEST-NET
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function ipv6IsPrivate(host: string): boolean {
  // Strip the URL bracket form and any zone id.
  const h = host.replace(/^\[/, '').replace(/\]$/, '').split('%')[0];
  if (!h.includes(':')) return false;

  // IPv4-mapped / IPv4-compatible (::ffff:127.0.0.1, ::127.0.0.1).
  const embedded = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (embedded) {
    const parts = embedded.slice(1).map(Number);
    if (parts.every((p) => p >= 0 && p <= 255) && ipv4IsPrivate(parts)) {
      return true;
    }
  }

  const lower = h.toLowerCase();
  if (lower === '::' || lower === '::1') return true;

  // fc00::/7 unique-local, fe80::/10 link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;

  return false;
}

export function isPrivateIP(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host) return true; // empty host is not routable, treat as unsafe

  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (ipv6IsPrivate(host)) return true;

  const v4 = parseIPv4(host);
  if (v4) return ipv4IsPrivate(v4);

  // Bare integer / hex / octal literal forms.
  const num = numericHost(host);
  if (num !== null) {
    if (num > 0xffffffff) return true;
    return ipv4IsPrivate([
      (num >>> 24) & 0xff,
      (num >>> 16) & 0xff,
      (num >>> 8) & 0xff,
      num & 0xff,
    ]);
  }

  return false;
}

export function validateProxyUrl(urlStr: string): {
  valid: boolean;
  error?: string;
} {
  if (typeof urlStr !== 'string' || urlStr.length === 0) {
    return { valid: false, error: 'Invalid URL format' };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP/HTTPS URLs are allowed' };
  }

  // Credentials in the URL are a classic way to make a request look like it
  // targets a different host than the one that will actually be dialled.
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with credentials are not allowed' };
  }

  if (isPrivateIP(parsed.hostname)) {
    return { valid: false, error: 'Private/internal URLs are not allowed' };
  }

  return { valid: true };
}
