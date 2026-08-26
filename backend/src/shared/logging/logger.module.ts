import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoOptions } from './logger.config';
import { getCorrelationId } from '../correlation/correlation';

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const level = config.get<string>('LOG_LEVEL') ?? (config.get('app.isProd') ? 'info' : 'debug');
        const isProd = config.get<boolean>('app.isProd') ?? false;
        const opts = buildPinoOptions(level, isProd);
        return {
          pinoHttp: {
            ...opts,
            /* attach correlation id + category to every request log */
            customProps: () => ({ correlationId: getCorrelationId(), category: 'api' }),
            autoLogging: { ignore: (req: { url?: string }) => {
              const u = req.url ?? '';
              return u.startsWith('/health') || u.startsWith('/metrics');
            } },
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
