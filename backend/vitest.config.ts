import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    /* Tier 3 STEP 5: load backend/.env deterministically (no manual
     * `set -a && . ./.env`); existing env (CI) is never overridden. */
    globalSetup: ['test/global-setup.ts'],
    coverage: { reporter: ['text', 'json-summary'] },
    /* Sprint 3 verification hardening (assertions untouched): 40+ live-PG
     * integration specs each hold connection pools against the shared dev DB;
     * the default worker strategy exhausted local resources on the Windows
     * dev machine, producing non-deterministic 5s timeouts / worker exits
     * that never reproduced on clean CI runners. Bounded forks workers +
     * realistic timeouts make local/CI runs resource-safe and deterministic. */
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 4,
    minWorkers: 1,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@core': resolve(__dirname, 'src/core'),
      '@config': resolve(__dirname, 'src/config'),
      '@infrastructure': resolve(__dirname, 'src/infrastructure'),
    },
  },
});
