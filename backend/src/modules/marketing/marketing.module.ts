import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';
import { AppointmentsReadPort } from '../../shared/ports/appointments.read-port';
import { ClinicalReadPort } from '../../shared/ports/clinical.read-port';
import { MarketingController } from './presentation/marketing.controller';
import { MarketingContentController } from './presentation/marketing-content.controller';
import { MarketingService } from './application/marketing.service';
import { MarketingContentService } from './application/marketing-content.service';
import { MarketingRepository } from './infrastructure/marketing.repository';
import { MarketingContentRepository } from './infrastructure/marketing-content.repository';
import { RecallScheduler, RecallWorker } from './infrastructure/recall.worker';
import { RECOVERY_SWEEP, RecoverySweep } from '../../infrastructure/outbox/recovery.scheduler';

/** F-03: due-recall scheduling, driven by the central recovery scheduler's
 *  hourly tick — the production caller for scheduleDue(). */
const RECALL_RECOVERY_SWEEP = {
  provide: RECOVERY_SWEEP,
  useFactory: (scheduler: RecallScheduler): RecoverySweep => ({
    name: 'recall-schedule-due',
    run: async (ctx) => {
      const today = new Date().toISOString().slice(0, 10);
      const orgCtx = { orgId: ctx.orgId, branchIds: [], correlationId: ctx.correlationId, source: 'system_worker' as const };
      const branches = await scheduler.listDueBranches(orgCtx, today);
      for (const branchId of branches) {
        await scheduler.scheduleDue({ ...ctx, branchIds: [branchId] }, today);
      }
    },
  }),
  inject: [RecallScheduler],
  multi: true,
};

@Module({
  imports: [AuthModule],
  controllers: [MarketingController, MarketingContentController],
  providers: [
    MarketingService, MarketingRepository,
    MarketingContentService, MarketingContentRepository,
    PatientsReadPort, AppointmentsReadPort, ClinicalReadPort,
    RecallScheduler, RecallWorker, RECALL_RECOVERY_SWEEP,
  ],
  exports: [MarketingService, MarketingContentService],
})
export class MarketingModule {}
