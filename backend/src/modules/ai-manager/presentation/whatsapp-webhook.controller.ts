/* WhatsApp webhook - Nur reply + booking intake to booking_requests. */
import { Body, Controller, Post, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { DbContextService } from '../../../core/auth/db-context.service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

const NUR_PROMPT = `Awak Nur, staf AI Klinik Pergigian Medini (klinik gigi). Tugas: bantu customer faham rawatan, jawab soalan lazim, beri panduan awal (tapi doktor akan check), dan kumpul detail booking sebelum pass ke admin sebenar.

CARA BERCAKAP:
- Professional, mesra, warm, tak skema. Bahasa Melayu campur simple English.
- Boleh guna: Hi, Baik, Boleh je, Okay, Done. Singkatan ok: kat, nak, tu, ni, utk, yg, tgh.
- Guna 1 emoji ringkas setiap mesej.
- Panggil Cik/Tuan/Puan. Guna Cik kalau tak pasti jantina. JANGAN guna sis/bro.
- Balas RINGKAS, maksimum 2-3 ayat pendek.

HARGA (RM, ikut keadaan - sarankan checkup dulu): Consult 30-150; Scaling 120-350; Cabut gigi 120-1800 (wisdom 1000-1800); Tambal 130-350; Root canal 1000-1800; Crown 1200-2000; Veneer 350-1800; Whitening 399-799; Denture 500-2370; Braces 5500-15000; Clear aligner 12000-16000; Implant 7000-8000; Kanak-kanak 60-600.

CAWANGAN (JB kecuali dinyatakan): Mutiara Mas, Taman Daya, Uda Business Centre, Gelang Patah, Bukit Indah, Setia Tropika, Pasir Gudang, Taman Molek, Taman Sentosa, Uda Padi Ria, Pearl Kebun Teh, Metropoint (Kajang), Norfaizah (Kajang), Meor Ahmad (KL). Kebanyakan buka 9 pagi-9 malam; utk waktu/alamat tepat, admin akan sahkan.

FAQ: Walk in boleh tapi galakkan appointment. Sakit gigi - sarankan check segera, tanya area mana. Cabut gigi - doktor bius dulu. Panel/perkeso - minta nama company.

PANTANG LARANG: JANGAN reka harga/discount. JANGAN confirm slot booking - sentiasa beritahu admin akan verify dulu. Sakit kronik - rujuk doktor. Maksimum 2-3 ayat. Guna Cik/Tuan/Puan.

BOOKING: bila customer nak buat, kumpul: nama penuh, tarikh, masa, rawatan, cawangan. Bila lengkap, beritahu admin akan verify & confirm slot.`;

const EXTRACT_PROMPT = `Kamu adalah pengekstrak data booking. Baca mesej customer klinik gigi. Kalau ia MENGANDUNGI niat tempahan/booking (ada nama ATAU tarikh ATAU masa ATAU rawatan ATAU cawangan), pulangkan JSON SAHAJA dalam format:
{"is_booking":true,"name":"","date":"","time":"","treatment":"","branch":""}
Isi field yang ada, biar kosong "" untuk yang tiada. Kalau mesej BUKAN tentang booking (cuma tanya harga/soalan am/borak), pulangkan {"is_booking":false}.
JANGAN tulis apa-apa selain JSON. Tiada markdown, tiada penjelasan.`;

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

    /* Booking intake (best-effort, never blocks the reply). */
    try {
      await this.maybeSaveBooking(chatId, text);
    } catch (e) {
      this.logger.error('Gagal simpan booking: ' + (e as Error).message);
    }
    return { ok: true };
  }

  private async maybeSaveBooking(chatId: string, text: string) {
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

    /* Need at least a name plus one scheduling detail to be worth saving. */
    if (!name && !date && !time) return;

    const phone = chatId.replace('@c.us', '');
    await this.dbCtx.runAsWorker(
      { orgId: ORG_ID, branchIds: [], correlationId: 'wa-booking', source: 'system_worker' },
      async (tx) => {
        await tx.execute(sql`
          INSERT INTO booking_requests
            (org_id, branch_id, contact_phone, patient_name, preferred_date, preferred_time, treatment, branch_name, raw_message, status)
          VALUES
            (${ORG_ID}, NULL, ${phone}, ${name || null}, ${date || null}, ${time || null}, ${treatment || null}, ${branch || null}, ${text}, 'pending')
        `);
      },
    );
    this.logger.warn('Booking request saved for ' + phone);
  }

  private async sendText(chatId: string, text: string) {
    const url = process.env.WAHA_URL ?? 'https://waha-production-f5bc.up.railway.app';
    const res = await fetch(`${url}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.WAHA_API_KEY ?? '' },
      body: JSON.stringify({ session: process.env.WAHA_SESSION ?? 'default', chatId, text }),
    });
    if (!res.ok) this.logger.error(`sendText gagal ${res.status}: ${await res.text()}`);
  }
}
