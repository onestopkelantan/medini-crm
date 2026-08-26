import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config — schema → SQL migrations. Migrations are generated,
 * versioned, and applied via `drizzle-kit migrate`. DATABASE_URL from env.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://medini:***@localhost:5433/medini_dev',
  },
  strict: true,
  verbose: true,
});
