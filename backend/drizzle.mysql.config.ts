import { defineConfig } from 'drizzle-kit';

/**
 * MySQL-only Drizzle Kit config for the mysql-migration branch.
 * Do not point production at this until schema + data validation is complete.
 */
export default defineConfig({
  dialect: 'mysql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle-mysql',
  dbCredentials: {
    url: process.env.MYSQL_DATABASE_URL ?? 'mysql://localhost:3306/medini_dev',
  },
  strict: true,
  verbose: true,
});
