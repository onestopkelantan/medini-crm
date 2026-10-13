import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth/auth.module';
import { AiPolicyPort } from '../../shared/ports/ai-policy.port';
import { FinanceReadPort } from '../../shared/ports/finance.read-port';
import { AppointmentsReadPort } from '../../shared/ports/appointments.read-port';
import { ReportsModule } from '../reports/reports.module';
import { InventoryModule } from '../inventory/inventory.module';

import { AiManagerController } from './presentation/ai-manager.controller';
import { FinanceAiService } from '../finance/application/finance-ai.service';
import { AnalystController } from './presentation/analyst.controller';
import { AssistantController } from './presentation/assistant.controller';
import { InsightsController } from './presentation/insights.controller';
import { NurTestController } from './presentation/nur-test.controller';
import { WhatsappWebhookController } from './presentation/whatsapp-webhook.controller';
import { BookingRequestsController } from './presentation/booking-requests.controller';
import { AiSummaryController } from './presentation/ai-summary.controller';
import { WhatsappPromptController } from './presentation/whatsapp-prompt.controller';
import { WhatsappPromptSlotsController } from './presentation/whatsapp-prompt-slots.controller';
import { WhatsappPlaygroundController } from './presentation/whatsapp-playground.controller';
import { AiWhatsappSettingsController } from './presentation/ai-whatsapp-settings.controller';
import { AiModelSettingsController } from './presentation/ai-model-settings.controller';

import { AiManagerService } from './application/ai-manager.service';
import { AnalystService } from './application/analyst.service';
import { InsightsService } from './application/insights.service';
import { AiSummaryService } from './application/ai-summary.service';
import { WhatsappPromptService } from './application/whatsapp-prompt.service';
import { WhatsappPromptSlotsService } from './application/whatsapp-prompt-slots.service';
import { WhatsappPlaygroundService } from './application/whatsapp-playground.service';
import { AiWhatsappSettingsService } from './application/ai-whatsapp-settings.service';
import { AiModelSettingsService } from './application/ai-model-settings.service';
import { WaBranchResolverService } from '../whatsapp/application/wa-branch-resolver.service';
import { WahaAdapter } from '../whatsapp/infrastructure/waha.adapter';
import { WaOptOutService } from '../whatsapp/application/wa-opt-out.service';
import { NotificationService } from '../whatsapp/application/notification.service';

import { AiManagerRepository } from './infrastructure/ai-manager.repository';
import { MinimaxAdapter } from './infrastructure/minimax.adapter';

@Module({
  imports: [AuthModule, ReportsModule, InventoryModule],

  controllers: [
    AiManagerController,
    AnalystController,
    AssistantController,
    InsightsController,
    AiSummaryController,
    NurTestController,
    WhatsappWebhookController,
    BookingRequestsController,
    WhatsappPromptController,
    WhatsappPromptSlotsController,
    WhatsappPlaygroundController,
    AiWhatsappSettingsController,
    AiModelSettingsController,
  ],

  providers: [
    AnalystService,
    InsightsService,
    /* FinanceAiService instantiated HERE (not via FinanceModule import —
     * finance.module imports AiManagerModule, so importing it back is a
     * circular dependency Nest refuses at boot). Its own dependencies
     * (AiPolicyPort, DbContextService) are already available globally. */
    FinanceAiService,
    FinanceReadPort,
    AppointmentsReadPort,
    AiManagerService,
    AiManagerRepository,
    AiPolicyPort,
    AiSummaryService,
    MinimaxAdapter,
    WhatsappPromptService,
    WhatsappPromptSlotsService,
    WhatsappPlaygroundService,
    AiWhatsappSettingsService,
    AiModelSettingsService,
    WaBranchResolverService,
    WahaAdapter,
    WaOptOutService,
    NotificationService,
  ],

  exports: [
    AiManagerService,
    AiManagerRepository,
    AiPolicyPort,
    WhatsappPromptService,
    WhatsappPromptSlotsService,
    AiWhatsappSettingsService,
    MinimaxAdapter,
  ],
})
export class AiManagerModule {}
