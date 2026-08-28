import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { AiPolicyPort } from '../../shared/ports/ai-policy.port';
import { AiManagerController } from './presentation/ai-manager.controller';
import { NurTestController } from './presentation/nur-test.controller';
import { WhatsappWebhookController } from './presentation/whatsapp-webhook.controller';
import { AiSummaryController } from './presentation/ai-summary.controller';
import { AiManagerService } from './application/ai-manager.service';
import { AiSummaryService } from './application/ai-summary.service';
import { AiManagerRepository } from './infrastructure/ai-manager.repository';
import { MinimaxAdapter } from './infrastructure/minimax.adapter';

@Module({
  imports: [AuthModule],
  controllers: [AiManagerController, AiSummaryController, NurTestController, WhatsappWebhookController],
  providers: [AiManagerService, AiManagerRepository, AiPolicyPort, AiSummaryService, MinimaxAdapter],
  exports: [AiManagerService, AiManagerRepository, AiPolicyPort],
})
export class AiManagerModule {}
