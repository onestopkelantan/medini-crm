/* WhatsApp webhook - Nur reply + booking intake (Setia Tropika branch). */
import { Body, Controller, Post, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { DbContextService } from '../../../core/auth/db-context.service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = 'da6ca871-3c49-4ef6-8bca-f208a0bfba77'; // Setia Tropika
const WAHA_URL = process.env.WAHA_URL ?? 'https://waha-production-f5bc.up.railway.app';
const WAHA_API_KEY = process.env.WAHA_API_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';

const NUR_PROMPT = `Awak Nur, staf AI Klinik Pergigian Medini cawangan Setia Tropika, Johor Bahru. Bantu customer faham rawatan, jawab soalan lazim, beri panduan awal (doktor akan check), kumpul detail booking sebelum pass ke admin.

CARA BERCAKAP: Professional, mesra, warm, tak skema. BM campur simple English. Guna 1 emoji ringkas. Panggil Cik/Tuan/Puan (Cik kalau tak pasti). JANGAN sis/bro. Balas RINGKAS, maksimum 2-3 ayat.

HARGA (RM, ikut keadaan - sarankan checkup dulu): Consult 30-150; Scaling 120-350; Cabut gigi 120-1800; Tambal 130-350; Root canal 1000-1800; Crown 1200-2000; Veneer 350-1800; Whitening 399-799; Denture 500-2370; Braces 5500-15000; Clear aligner 12000-16000; Implant 7000-8000; Kanak-kanak 60-600.

CAWANGAN: Awak khusus untuk Setia Tropika (dekat JPN Johor, Taman Setia Tropika, JB). Buka 9 pagi-9 malam. Utk waktu/alamat tepat, admin akan sahkan.

FAQ: Walk in boleh tapi galakkan appointment. Sakit gigi - sarankan check segera. Cabut gigi - doktor bius dulu. Panel/perkeso - minta nama company.

PANTANG LARANG: JANGAN reka harga/discount. JANGAN confirm slot - beritahu admin akan verify dulu. Sakit kronik - rujuk doktor. Maksimum 2-3 ayat. Guna Cik/Tuan/Puan.

BOOKING: kumpul nama penuh, tarikh, masa, rawatan. Bila lengkap, beritahu admin akan verify & confirm slot.`;

const EXTRACT_PROMPT = `Kamu pengekstrak data booking klinik gigi. Kalau mesej ADA niat booking (nama/tarikh/masa/rawatan), pulangkan JSON: {"is_booking":true,"name":"","date":"","time":"","treatment":"","branch":""}. Isi yang ada, kosong "" untuk tiada. Kalau BUKAN booking, pulangkan {"is_booking":false}. JANGAN tulis apa-apa selain JSON. Tiada markdown.`;

@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappWebhookController {
  private readonly logger = new Logger('WhatsappWebhook');
  constructor(
    private readonly minimax: MinimaxAdapter,
    private readonly dbCtx: DbContextService,
  ) {}

  @Public()
  @Post('webhook')
  async webhook(@Body() body: any) {
    if (body?.event !== 'message') return { ok: true };
    const payload = body?.payload ?? {};
    const chatId: string = payload.from ?? payload.chatId ?? '';
    const text: string = payload.body ?? payload.text ?? '';
    const fromMe: boolean = payload.fromMe ?? false;

    if (fromMe) return { ok: true };
    if (!chatId) return { ok: true };
    if (chatId.endsWith('@g.us')) return { ok: true };
    if (!text || !text.trim()) return { ok: true };

    try {
      const reply = await this.minimax.chat(NUR_PROMPT, text);
      await this.sendText(chatId, reply);
    } catch (e) {
      this.logger.error('Gagal balas: ' + (e as Error).message);
    }

    try {
      await this.maybeSaveBooking(chatId, text, payload);
    } catch (e) {
      this.logger.error('Gagal simpan booking: ' + (e as Error).message);
    }
    return { ok: true };
  }

  private async resolvePhone(chatId: string, payload: any): Promise<string> {
    const altJid = payload?._data?.key?.remoteJidAlt ?? '';
    if (altJid.includes('@s.whatsapp.net')) return altJid.replace('@s.whatsapp.net', '');
    if (chatId.endsWith('@c.us')) return chatId.replace('@c.us', '');
    if (chatId.endsWith('@lid')) {
      const lid = chatId.replace('@lid', '');
      try {
        const res = await fetch(`${WAHA_URL}/api/default/lids/${lid}`, {
          headers: { 'X-Api-Key': WAHA_API_KEY },
        });
        if (res.ok) {
          const data = await res.json() as { pn?: string };
          if (data?.pn) return data.pn.replace('@c.us', '');
        }
      } catch (e) {
        this.logger.error('resolvePhone gagal: ' + (e as Error).message);
      }
      return lid;
    }
    return chatId.replace('@c.us', '').replace('@lid', '');
  }

  private async maybeSaveBooking(chatId: string, text: string, payload: any) {
    const raw = await this.minimax.chat(EXTRACT_PROMPT, text);
    const jsonStr = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    let data: any;
    try { data = JSON.parse(jsonStr); } catch { return; }
    if (!data || data.is_booking !== true) return;

    const name = (data.name ?? '').toString().trim();
    const date = (data.date ?? '').toString().trim();
    const time = (data.time ?? '').toString().trim();
    const treatment = (data.treatment ?? '').toString().trim();
    const branch = (data.branch ?? '').toString().trim();
    if (!name && !date && !time) return;

    const phone = await this.resolvePhone(chatId, payload);
    await this.dbCtx.runAsWorker(
      { orgId: ORG_ID, branchIds: [BRANCH_ID], correlationId: 'wa-booking', source: 'system_worker' },
      async (tx) => {
        await tx.execute(sql`
          INSERT INTO booking_requests
            (org_id, branch_id, contact_phone, patient_name, preferred_date, preferred_time, treatment, branch_name, raw_message, status)
          VALUES
            (${ORG_ID}, ${BRANCH_ID}, ${phone}, ${name || null}, ${date || null}, ${time || null}, ${treatment || null}, ${branch || null}, ${text}, 'pending')
        `);
      },
    );
    this.logger.warn('Booking request saved for ' + phone);
  }

  private async sendText(chatId: string, text: string) {
    const res = await fetch(`${WAHA_URL}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
      body: JSON.stringify({ session: WAHA_SESSION, chatId, text }),
    });
    if (!res.ok) this.logger.error(`sendText gagal ${res.status}: ${await res.text()}`);
  }
}
