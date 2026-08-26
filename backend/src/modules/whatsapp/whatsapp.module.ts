import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';
import { WhatsappController } from './presentation/whatsapp.controller';
import { WhatsappService } from './application/whatsapp.service';
import { WhatsappRepository } from './infrastructure/whatsapp.repository';
import { WahaAdapter } from './infrastructure/waha.adapter';
import { WhatsappTransportWorker } from './infrastructure/whatsapp-transport.worker';
import { RECOVERY_SWEEP, RecoverySweep } from '../../infrastructure/outbox/recovery.scheduler';
import { DbContextService } from '../../core/auth/db-context.service';
import { AuditService } from '../../shared/audit/audit.service';

/** F-04 (+N6-3): stranded queued-message reconciliation and auto-pause resume,
 *  driven by the central recovery scheduler's hourly tick. */
const WHATSAPP_RECOVERY_SWEEP = {
  provide: RECOVERY_SWEEP,
  useFactory: (whatsapp: WhatsappService): RecoverySweep[] => [
    { name: 'whatsapp-reconcile-queued', run: (ctx) => whatsapp.reconcileQueuedMessages(ctx) },
    { name: 'whatsapp-auto-resume', run: (ctx) => whatsapp.autoResumeExpiredChannels(ctx) },
  ],
  inject: [WhatsappService],
  multi: true,
};

@Module({
  imports: [AuthModule],
  controllers: [WhatsappController],
  providers: [
    {
      provide: WhatsappService,
      useFactory: (
        dbCtx: DbContextService,
        repo: WhatsappRepository,
        patients: PatientsReadPort,
        audit: AuditService,
      ) => new WhatsappService(dbCtx, repo, patients, audit, () => new Date(), new WahaAdapter(), undefined),
      inject: [DbContextService, WhatsappRepository, PatientsReadPort, AuditService],
    },
    WhatsappRepository,
    PatientsReadPort,
    WahaAdapter,
    WhatsappTransportWorker,
    WHATSAPP_RECOVERY_SWEEP,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
