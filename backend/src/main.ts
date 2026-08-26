import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  /* Structured logging */
  app.useLogger(app.get(PinoLogger));

  /* Correlation context for EVERY request (incl. 404/errors before controllers). */
  const { correlationMiddleware } = await import('./shared/correlation/correlation');
  app.use(correlationMiddleware);

  /* API prefix + versioning → /api/v1 */
  const prefix = config.get<string>('app.apiPrefix') ?? 'api';
  app.setGlobalPrefix(prefix, { exclude: ['health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.get<string>('app.apiVersion') ?? 'v1' });

  /* Global validation (whitelist + transform). Domain DTOs arrive later. */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  /* CORS — production: allow the explicit frontend origin only.
   * CORS_ORIGIN env (comma-separated) overrides; defaults to same-origin (false). */
  const corsOrigin = config.get<string>('app.corsOrigin');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : false,
    credentials: true,
  });

  /* OpenAPI foundation (bearer auth scheme pre-registered for later sprints). */
  const docConfig = new DocumentBuilder()
    .setTitle('Medini CRM — Production Backend')
    .setDescription('Modular monolith backend. Source of truth: MEDINI_ARCHITECTURE. Sprint 0 Foundation.')
    .setVersion(config.get<string>('app.apiVersion') ?? 'v1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, docConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Medini CRM backend (Sprint 0) listening on :${port}/${prefix}`);
}

void bootstrap();
