import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { AppointmentsController } from './presentation/appointments.controller';
import { AppointmentsExportController } from './presentation/appointments-export.controller';
import { DoctorRegistrationController } from './presentation/doctor-registration.controller';
import { DoctorScheduleController } from './presentation/doctor-schedule.controller';
import { WaitlistController } from './presentation/waitlist.controller';
import { AppointmentsService } from './application/appointments.service';
import { AppointmentsExportService } from './application/appointments-export.service';
import { DoctorRegistrationService } from './application/doctor-registration.service';
import { DoctorScheduleService } from './application/doctor-schedule.service';
import { NurseScheduleService } from './application/nurse-schedule.service';
import { NurseScheduleController } from './presentation/nurse-schedule.controller';
import { WaitlistService } from './application/waitlist.service';
import { H8ReminderScheduler } from './application/h8-reminder.scheduler';
import { REMINDER_SENDER, MockReminderSender } from './domain/reminder-sender.port';
import { AppointmentsRepository } from './infrastructure/appointments.repository';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';

@Module({
  imports: [AuthModule],
  controllers: [
    /* WaitlistController FIRST: its literal 'appointments/waitlist' routes
     * must be registered before AppointmentsController's ':id' wildcard,
     * or GET /appointments/waitlist is captured as id='waitlist' and dies
     * in the UUID pipe. Route order in Nest is module declaration order. */
    WaitlistController,
    AppointmentsController,
    AppointmentsExportController,
    DoctorRegistrationController,
    DoctorScheduleController,
    NurseScheduleController,
  ],
  providers: [
    AppointmentsService,
    AppointmentsRepository,
    PatientsReadPort,
    AppointmentsExportService,
    DoctorRegistrationService,
    DoctorScheduleService,
    NurseScheduleService,
    WaitlistService,
    /* E6: the sender behind the port. Mock until a WhatsApp number is
     * verified live — the scheduler's behaviour, the ledger and the logs
     * are identical either way. Swap the class here when WAHA returns. */
    { provide: REMINDER_SENDER, useClass: MockReminderSender },
    H8ReminderScheduler,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
