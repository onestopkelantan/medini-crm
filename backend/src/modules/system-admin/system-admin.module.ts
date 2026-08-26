import { Module } from '@nestjs/common';
import { HealthModule } from '../../infrastructure/health/health.module';
import { SystemAdminService } from './application/system-admin.service';
import { SystemAdminController } from './presentation/system-admin.controller';

/**
 * SystemAdminModule — S10 GLM 5.3 (Developer / System Admin).
 * Technical diagnostics surface only; zero business-module imports.
 */
@Module({
  imports: [HealthModule],
  providers: [SystemAdminService],
  controllers: [SystemAdminController],
})
export class SystemAdminModule {}
