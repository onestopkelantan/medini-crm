import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PatientsController } from './presentation/patients.controller';
import { PatientsService } from './application/patients.service';
import { PatientsRepository } from './infrastructure/patients.repository';
import { PatientsReadPort } from '../../shared/ports/patients.read-port';

@Module({
  imports: [AuthModule],
  controllers: [PatientsController],
  providers: [PatientsService, PatientsRepository, PatientsReadPort],
  exports: [PatientsService, PatientsReadPort],
})
export class PatientsModule {}
