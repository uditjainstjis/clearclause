import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Tests execute inside workerd — the same runtime the Worker is deployed to —
 * rather than in Node with the Workers globals shimmed. Cache API, crypto,
 * streams and Request/Response therefore behave in tests exactly as they do in
 * production, which is the whole point of testing them.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { compatibilityFlags: ['nodejs_compat'] },
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
