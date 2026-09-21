import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth/auth.module';
import { AiPolicyPort } from '../../shared/ports/ai-policy.port';

import { AiManagerController } from './presentation/ai-manager.controller';
import { NurTestController } from './presentation/nur-test.controller';
import { WhatsappWebhookController } from './presentation/whatsapp-webhook.controller';
import { BookingRequestsController } from './presentation/booking-requests.controller';
import { AiSummaryController } from './presentation/ai-summary.controller';
import { WhatsappPromptController } from './presentation/whatsapp-prompt.controller';

import { AiManagerService } from './application/ai-manager.service';
import { AiSummaryService } from './application/ai-summary.service';
import { WhatsappPromptService } from './application/whatsapp-prompt.service';

import { AiManagerRepository } from './infrastructure/ai-manager.repository';
import { MinimaxAdapter } from './infrastructure/minimax.adapter';

@Module({
  imports: [AuthModule],

  controllers: [
    AiManagerController,
    AiSummaryController,
    NurTestController,
    WhatsappWebhookController,
    BookingRequestsController,
    WhatsappPromptController,
  ],

  providers: [
    AiManagerService,
    AiManagerRepository,
    AiPolicyPort,
    AiSummaryService,
    MinimaxAdapter,
    WhatsappPromptService,
  ],

  exports: [
    AiManagerService,
    AiManagerRepository,
    AiPolicyPort,
    WhatsappPromptService,
    MinimaxAdapter,
  ],
})
export class AiManagerModule {}
