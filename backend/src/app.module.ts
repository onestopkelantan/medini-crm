import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { AppLoggerModule } from './shared/logging/logger.module';
import { AuditModule } from './shared/audit/audit.module';
import { IdempotencyModule } from './shared/idempotency/idempotency.module';
import { GlobalExceptionFilter } from './shared/errors/global-exception.filter';
import { ScopeService } from './shared/security/scope.service';
import { HealthModule } from './infrastructure/health/health.module';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuthModule } from './core/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { UsersModule } from './modules/users/users.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PayorsModule } from './modules/payors/payors.module';
import { ClinicalModule } from './modules/clinical/clinical.module';
import { FinanceModule } from './modules/finance/finance.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { OperationsModule } from './modules/operations/operations.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AdministrationModule } from './modules/administration/administration.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AiManagerModule } from './modules/ai-manager/ai-manager.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SystemAdminModule } from './modules/system-admin/system-admin.module';
import { RootController } from './root.controller';

/**
 * Root application module — Sprint 0 Foundation.
 * Domain modules (patients/appointments/...) are registered in later sprints.
 * Correlation is handled by middleware (main.ts) so it covers 404s/errors too.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    AuditModule,
    IdempotencyModule,
    DatabaseModule,
    HealthModule,
    ObservabilityModule,
    QueueModule,
    OutboxModule,
    AuthModule,
    PatientsModule,
    DocumentsModule,
    UsersModule,
    AppointmentsModule,
    DashboardModule,
    PayorsModule,
    ClinicalModule,
    FinanceModule,
    MarketingModule,
    OperationsModule,
    WhatsappModule,
    AdministrationModule,
    SettingsModule,
    AiManagerModule,
    ReportsModule,
    SystemAdminModule,
  ],
  controllers: [RootController],
  providers: [
    ScopeService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [ScopeService],
})
export class AppModule {}
