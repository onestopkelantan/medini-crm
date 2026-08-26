import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { QueueEventsListener } from './queue-events.listener';
import { InfraGauges } from './infra-gauges';
import { QueueModule } from '../queue/queue.module';
import { DatabaseModule } from '../database/database.module';
import { Database } from '../database/database';

/** S9-T3 — Observability module (Prometheus). */
@Module({
  imports: [QueueModule, DatabaseModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    QueueEventsListener,
    {
      provide: InfraGauges,
      useFactory: (db: Database | null, metrics: MetricsService) => new InfraGauges(db, metrics, true),
      inject: ['DATABASE', MetricsService],
    },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
