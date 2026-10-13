import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { ConfigResolverPort } from '../../shared/ports/config-resolver.port';
import { SettingsController } from './presentation/settings.controller';
import { IntegrationsController } from './presentation/integrations.controller';
import { SettingsService } from './application/settings.service';
import { IntegrationsService } from './application/integrations.service';
import { SettingsRepository } from './infrastructure/settings.repository';

@Module({
  imports: [AuthModule],
  controllers: [SettingsController, IntegrationsController],
  providers: [SettingsService, SettingsRepository, ConfigResolverPort, IntegrationsService],
  exports: [SettingsService, ConfigResolverPort],
})
export class SettingsModule {}
