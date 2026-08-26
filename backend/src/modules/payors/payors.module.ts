import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PanelsController } from './presentation/panels.controller';
import { InsurancesController } from './presentation/insurances.controller';
import { PanelsService } from './application/panels.service';
import { InsurancesService } from './application/insurances.service';
import { PanelsRepository } from './infrastructure/panels.repository';
import { InsurancesRepository } from './infrastructure/insurances.repository';
import { PayorsReadPort } from '../../shared/ports/payors.read-port';

@Module({
  imports: [AuthModule],
  controllers: [PanelsController, InsurancesController],
  providers: [
    PanelsService, PanelsRepository,
    InsurancesService, InsurancesRepository,
    PayorsReadPort,
  ],
  exports: [PanelsService, InsurancesService, PayorsReadPort],
})
export class PayorsModule {}
