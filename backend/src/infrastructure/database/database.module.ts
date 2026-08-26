import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase, Database } from './database';

export const DATABASE = 'DATABASE';

/**
 * DatabaseModule — provides the Drizzle client. Connection is created from
 * DATABASE_URL at boot; if the DB is unreachable, the app still starts but
 * /health/ready reports it honestly (no fake healthy dependency).
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database | null => {
        /* Runtime uses the non-owner RLS-subject role (medini_app), never the
         * table owner (medini). See database.config.ts runtimeUrl. */
        const url = config.get<string>('database.runtimeUrl');
        if (!url) return null; /* report not-configured honestly */
        try {
          return createDatabase(url);
        } catch {
          return null;
        }
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
