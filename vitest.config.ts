import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Tests execute inside workerd — the same runtime the Worker is deployed to —
 * rather than in Node with the Workers globals shimmed. Cache API, crypto,
 * streams, HTMLRewriter and Request/Response therefore behave in tests exactly
 * as they do in production, which is the whole point of testing them.
 *
 * The pool is deliberately NOT pointed at `wrangler.jsonc`. Workers AI has no
 * local implementation, so a declared `ai` binding makes the pool open a remote
 * proxy session to Cloudflare — which needs an API token and a network. Every
 * test here constructs its own `Env` with a stubbed `AI` (see `stubEnv`), so no
 * real binding is ever wanted. Reading the deploy config would buy nothing and
 * cost the property that matters: the suite is hermetic, and runs identically
 * on a laptop and on a CI runner that holds no credentials.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-08-22',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  ],
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/types.ts'],
    },
  },
});
