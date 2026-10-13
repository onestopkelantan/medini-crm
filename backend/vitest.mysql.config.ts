import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * CI profile for the active MySQL runtime.
 *
 * Historical PostgreSQL/RLS integration specs remain in the repository but are
 * intentionally not reported as MySQL passes: they use PostgreSQL-only APIs
 * such as set_config/current_setting, pg_class, ON CONFLICT and RLS policies.
 * Ported specs must be added explicitly to this audited allow-list.
 */
const mysqlIntegrationSpecs = [
  'test/integration/analyst-ask.spec.ts',
  'test/integration/appointments.spec.ts',
  'test/integration/atomicity.spec.ts',
  'test/integration/bukku-sync.spec.ts',
  'test/integration/dashboard.spec.ts',
  'test/integration/database.spec.ts',
  'test/integration/fasa4-conversation-reply.spec.ts',
  'test/integration/governance-ports.spec.ts',
  'test/integration/p2-doctor-attribution.spec.ts',
  'test/integration/patients.spec.ts',
  'test/integration/s10-auth-lifecycle.spec.ts',
  'test/integration/s10-registration-replay.spec.ts',
  'test/integration/t2-password-hash.spec.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'test/unit/**/*.spec.ts',
      'test/architecture/**/*.spec.ts',
      'test/contract/**/*.spec.ts',
      ...mysqlIntegrationSpecs,
    ],
    globalSetup: ['test/global-setup.ts'],
    coverage: { reporter: ['text', 'json-summary'] },
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
