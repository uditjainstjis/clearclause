/**
 * Response hardening.
 *
 * The policy below is strict by construction rather than by exception: all
 * scripts and styles live in their own files, so `script-src 'self'` needs no
 * `unsafe-inline` or `unsafe-eval` escape hatch, and the app has no third-party
 * origins to allow.
 *
 * Two directives are worth explaining because they are unusual.
 *
 * `require-trusted-types-for 'script'` with `trusted-types 'none'` makes the
 * browser refuse every assignment to a DOM sink that parses markup —
 * `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML`. The front
 * end already writes exclusively through `textContent`, which is the property
 * that stops a document smuggling markup through the analysis. Before this,
 * that property was a convention held by code review. Now it is enforced by the
 * browser, and a future commit that reaches for `innerHTML` breaks loudly
 * instead of silently widening the attack surface.
 *
 * `cross-origin-embedder-policy: require-corp` completes the COOP/COEP/CORP
 * trio. Nothing here is cross-origin isolated for its own sake; it costs
 * nothing because the page loads no cross-origin subresources at all, and it
 * forecloses a class of side-channel that would otherwise stay open.
 *
 * `permissions-policy` denies every feature rather than the five most obvious
 * ones. A document reader needs none of them, and an allowlist that enumerates
 * only what someone thought of is an allowlist that grows a hole each time the
 * platform adds a capability.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * Every powerful feature, denied. Enumerated rather than inferred, so adding a
 * capability to the platform cannot quietly grant it here.
 */
const PERMISSIONS_POLICY = [
  'accelerometer',
  'ambient-light-sensor',
  'autoplay',
  'battery',
  'bluetooth',
  'browsing-topics',
  'camera',
  'display-capture',
  'encrypted-media',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
]
  .map((feature) => `${feature}=()`)
  .join(', ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': CSP,
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': PERMISSIONS_POLICY,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'x-permitted-cross-domain-policies': 'none',
  'origin-agent-cluster': '?1',
});

/** Apply {@link SECURITY_HEADERS} to a response without altering its body. */
export function harden(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}
