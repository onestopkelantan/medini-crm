import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { AppointmentsController } from './presentation/appointments.controller';
import { AppointmentsExportController } from './presentation/appointments-export.controller';
import { DoctorRegistrationController } from './presentation/doctor-registration.controller';
import { AppointmentsService } from './application/appointments.service';
import { AppointmentsExportService } from './application/appointments-export.service';
import { DoctorRegistrationService } from './application/doctor-registration.service';
import { AppointmentsRepository } from './infrastructure/appointments.repository';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';

@Module({
  imports: [AuthModule],
  controllers: [
    AppointmentsController,
    AppointmentsExportController,
    DoctorRegistrationController,
  ],
  providers: [
    AppointmentsService,
    AppointmentsRepository,
    PatientsReadPort,
    AppointmentsExportService,
    DoctorRegistrationService,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
