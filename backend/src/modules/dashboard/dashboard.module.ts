import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { DashboardController } from './presentation/dashboard.controller';
import { DashboardService } from './application/dashboard.service';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';
import { AppointmentsReadPort } from '../../shared/ports/appointments.read-port';

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService, PatientsReadPort, AppointmentsReadPort],
  exports: [DashboardService],
})
export class DashboardModule {}
