import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Two projects, because the suite has two genuinely different jobs.
 *
 * `workers` runs inside workerd — the same runtime the Worker is deployed to —
 * rather than in Node with the Workers globals shimmed. Cache API, crypto,
 * streams, HTMLRewriter and Request/Response therefore behave in tests exactly
 * as they do in production, which is the whole point of testing them.
 *
 * It is deliberately NOT pointed at `wrangler.jsonc`. Workers AI has no local
 * implementation, so a declared `ai` binding makes the pool open a remote proxy
 * session to Cloudflare — which needs an API token and a network. Every test
 * there constructs its own `Env` with a stubbed `AI`, so no real binding is ever
 * wanted. Reading the deploy config would buy nothing and cost the property that
 * matters: the suite is hermetic, and runs identically on a laptop and on a CI
 * runner that holds no credentials.
 *
 * `dom` exists for one reason: axe-core needs a DOM, and workerd has none. It
 * runs the real axe engine over the real shipped markup so the accessibility
 * claim in the README is enforced by CI instead of asserted by a human who ran
 * it once. See test/axe.test.ts.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: '2026-08-22',
              compatibilityFlags: ['nodejs_compat'],
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.dom.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['test/**/*.dom.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/types.ts'],
    },
  },
});
