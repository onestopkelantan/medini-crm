import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { EncountersController } from './presentation/encounters.controller';
import { NotesController } from './presentation/notes.controller';
import { PlansController } from './presentation/plans.controller';
import { ConsentsController } from './presentation/consents.controller';
import { ImagingController } from './presentation/imaging.controller';
import { ClinicalOpsController } from './presentation/clinical-ops.controller';
import { EncountersService } from './application/encounters.service';
import { NotesService } from './application/notes.service';
import { PlansService } from './application/plans.service';
import { ClinicalExtendedService } from './application/clinical-extended.service';
import { ClinicalCoreRepository } from './infrastructure/clinical-core.repository';
import { ClinicalExtendedRepository } from './infrastructure/clinical-extended.repository';
import { ClinicalReadPort } from '../../shared/ports/clinical.read-port';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';

/**
 * ClinicalModule — Sprint 3 (clinicalRecords owner per DATA_OWNERSHIP).
 * Extends the locked architecture: AuthModule (guards/runAs), AuditService
 * (same-tx), OrgAllocator (ENC/TPL/TRT), shared read-ports. Consumes
 * patients via PatientsReadPort — never the patients repository (boundary
 * contract, architecture test enforced).
 */
@Module({
  imports: [AuthModule],
  controllers: [
    EncountersController, NotesController, PlansController,
    ConsentsController, ImagingController, ClinicalOpsController,
  ],
  providers: [
    EncountersService, NotesService, PlansService, ClinicalExtendedService,
    ClinicalCoreRepository, ClinicalExtendedRepository,
    ClinicalReadPort, PatientsReadPort,
  ],
  exports: [ClinicalReadPort],
})
export class ClinicalModule {}
