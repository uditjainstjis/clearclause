/**
 * Response hardening.
 *
 * The policy below is strict by construction rather than by exception: all
 * scripts and styles live in their own files, so `script-src 'self'` needs no
 * `unsafe-inline` or `unsafe-eval` escape hatch, and the app has no third-party
 * origins to allow. Documents are analysed in memory and never persisted, so
 * there is no stored-data surface to protect either.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': CSP,
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});

/** Apply {@link SECURITY_HEADERS} to a response without altering its body. */
export function harden(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}
