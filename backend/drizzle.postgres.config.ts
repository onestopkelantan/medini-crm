import { defineConfig } from 'drizzle-kit';

/** PostgreSQL reference config retained only for rollback/reference during migration. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.postgres.ts',
  out: './drizzle-postgres-reference',
  dbCredentials: {
    url: process.env.POSTGRES_REFERENCE_URL ?? 'postgres://localhost:5433/medini_dev',
  },
  strict: true,
  verbose: true,
});
