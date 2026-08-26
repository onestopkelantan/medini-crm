import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';
import { AppointmentsReadPort } from '../../shared/ports/appointments.read-port';
import { ClinicalReadPort } from '../../shared/ports/clinical.read-port';
import { OperationsController } from './presentation/operations.controller';
import { OperationsService } from './application/operations.service';
import { OperationsRepository } from './infrastructure/operations.repository';

@Module({
  imports: [AuthModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, PatientsReadPort, AppointmentsReadPort, ClinicalReadPort],
  exports: [OperationsService],
})
export class OperationsModule {}
