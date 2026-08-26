import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { ReportsController } from './presentation/reports.controller';
import { ReportsService } from './application/reports.service';
import { ReportAuditService } from './application/report-audit.service';
import { ReportsRepository } from './infrastructure/reports.repository';
import { FinanceReadPort } from '../../shared/ports/finance.read-port';
import { AppointmentsReadPort } from '../../shared/ports/appointments.read-port';
import { ClinicalReadPort } from '../../shared/ports/clinical.read-port';
import { RecallReadPort } from '../../shared/ports/recall.read-port';

/** S9 — Reports module (READ/INTELLIGENCE LAYER). */
@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [
    ReportsService, ReportAuditService, ReportsRepository,
    FinanceReadPort, AppointmentsReadPort, ClinicalReadPort, RecallReadPort,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
