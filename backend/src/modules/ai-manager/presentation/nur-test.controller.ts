/* Nur test endpoint — TEMPORARY, for verifying MiniMax integration.
 * POST /v1/nur/ask  { "message": "..." }  ->  { "reply": "..." }
 * Public for now (testing only). Remove/secure before production. */
import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';

const NUR_PROMPT = `Awak Nur, staf AI Klinik Pergigian Medini. Balas dalam Bahasa Melayu, mesra dan ringkas (maksimum 2-3 ayat). Guna panggilan Cik/Tuan/Puan. JANGAN reka harga atau pakej yang tak wujud. JANGAN sahkan slot booking tanpa beritahu admin akan verify dulu. Untuk sakit kronik, sarankan jumpa doktor.`;

@Controller({ path: 'nur', version: '1' })
export class NurTestController {
  constructor(private readonly minimax: MinimaxAdapter) {}

  @Public()
  @Post('ask')
  async ask(@Body() body: { message?: string }) {
    const message = body?.message ?? '';
    if (!message) return { error: 'message required' };
    const reply = await this.minimax.chat(NUR_PROMPT, message);
    return { reply };
  }
}