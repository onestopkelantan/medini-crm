/* WhatsApp webhook - terima mesej dari WAHA, tanya Nur, balas balik ke WhatsApp. */
import { Body, Controller, Post, Logger } from '@nestjs/common';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';

const NUR_PROMPT = `Awak Nur, staf AI Klinik Pergigian Medini. Balas dalam Bahasa Melayu, mesra dan ringkas (maksimum 2-3 ayat). Guna panggilan Cik/Tuan/Puan. JANGAN reka harga atau pakej yang tak wujud. JANGAN sahkan slot booking tanpa beritahu admin akan verify dulu. Untuk sakit kronik, sarankan jumpa doktor.`;

const WAHA_URL = process.env.WAHA_URL ?? 'https://waha-production-f5bc.up.railway.app';
const WAHA_API_KEY = process.env.WAHA_API_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';

@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappWebhookController {
  private readonly logger = new Logger('WhatsappWebhook');
  constructor(private readonly minimax: MinimaxAdapter) {}

  @Public()
  @Post('webhook')
  async webhook(@Body() body: any) {
    this.logger.log('PAYLOAD MASUK: ' + JSON.stringify(body));

    const event = body?.event ?? '';
    const payload = body?.payload ?? {};
    const chatId: string = payload.from ?? payload.chatId ?? '';
    const text: string = payload.body ?? payload.text ?? payload?.message?.text ?? '';
    const fromMe: boolean = payload.fromMe ?? payload?.key?.fromMe ?? false;

    this.logger.log(`event=${event} chatId=${chatId} fromMe=${fromMe} text=${text}`);

    if (fromMe) { this.logger.log('SKIP: fromMe'); return { ok: true }; }
    if (!chatId) { this.logger.log('SKIP: no chatId'); return { ok: true }; }
    if (!text || !text.trim()) { this.logger.log('SKIP: no text'); return { ok: true }; }

    try {
      const reply = await this.minimax.chat(NUR_PROMPT, text);
      this.logger.log('NUR REPLY: ' + reply);
      await this.sendText(chatId, reply);
    } catch (e) {
      this.logger.error('Gagal proses mesej: ' + (e as Error).message);
    }
    return { ok: true };
  }

  private async sendText(chatId: string, text: string) {
    const res = await fetch(`${WAHA_URL}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
      body: JSON.stringify({ session: WAHA_SESSION, chatId, text }),
    });
    if (!res.ok) {
      this.logger.error(`sendText gagal ${res.status}: ${await res.text()}`);
    } else {
      this.logger.log('sendText OK ke ' + chatId);
    }
  }
}