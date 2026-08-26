import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { AdministrationController } from './presentation/administration.controller';
import { AdministrationService } from './application/administration.service';
import { AdministrationRepository } from './infrastructure/administration.repository';

@Module({
  imports: [AuthModule],
  controllers: [AdministrationController],
  providers: [AdministrationService, AdministrationRepository],
  exports: [AdministrationService],
})
export class AdministrationModule {}
