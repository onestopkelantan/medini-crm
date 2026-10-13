/* Nur test endpoint — verifies the MiniMax integration end-to-end.
 * POST /v1/nur/ask  { "message": "..." }  ->  { "reply": "..." }
 *
 * SECURITY (fixed 28 Sept 2026)
 *
 * This was `@Public()` with a comment saying "Remove/secure before production."
 * That was a real hole, not a formality: with an API key configured, ANY caller
 * on the internet could POST here and spend the clinic's model credit — and the
 * endpoint answers as a clinic receptionist, so it was also an open channel to
 * the model under the clinic's identity. The `@Public()` decorator is gone.
 *
 * It now requires authentication AND an HQ principal, which matches every other
 * AI-configuration surface in this codebase (model status, integration testing,
 * guardrails): technical/provider configuration is an HQ concern. A branch user
 * testing a prompt uses the Playground, which is branch-scoped and permission-
 * checked by the normal guards.
 *
 * Kept (not deleted) because it is the only path that exercises the raw model
 * adapter directly, which is what you want when diagnosing a provider problem
 * without a branch prompt in the way. */
import { Body, Controller, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { ForbiddenError } from '../../../shared/errors/errors';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';

const NUR_PROMPT = `Awak Nur, staf AI Klinik Pergigian Medini. Balas dalam Bahasa Melayu, mesra dan ringkas (maksimum 2-3 ayat). Guna panggilan Cik/Tuan/Puan. JANGAN reka harga atau pakej yang tak wujud. JANGAN sahkan slot booking tanpa beritahu admin akan verify dulu. Untuk sakit kronik, sarankan jumpa doktor.`;

@Controller({ path: 'nur', version: '1' })
export class NurTestController {
  constructor(private readonly minimax: MinimaxAdapter) {}

  @Post('ask')
  @RequirePermission('ai', 'view')
  async ask(@Req() req: AuthedRequest, @Body() body: { message?: string }) {
    /* Diagnostic surface for the raw model adapter — HQ only, same tier as the
     * other provider-configuration endpoints. */
    if (req.principal!.role !== 'hq') {
      throw new ForbiddenError('AI model testing is restricted to HQ');
    }
    const message = body?.message ?? '';
    if (!message) return { error: 'message required' };
    const reply = await this.minimax.chat(NUR_PROMPT, message);
    return { reply };
  }
}
