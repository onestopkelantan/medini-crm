import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';
import jwtConfig from './jwt.config';
import s3Config from './s3.config';
import integrationsConfig from './integrations.config';
import { validateEnv } from './env.validation';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      /* .env is for LOCAL dev only; secrets come from the environment/manager. */
      envFilePath: process.env.NODE_ENV === 'production' ? undefined : ['.env'],
      validate: validateEnv,
      load: [appConfig, databaseConfig, redisConfig, jwtConfig, s3Config, integrationsConfig],
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
