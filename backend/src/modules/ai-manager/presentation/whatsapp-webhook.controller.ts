/* WhatsApp webhook - Nur reply + automatic booking intake. */
import { Body, Controller, Post, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { DbContextService } from '../../../core/auth/db-context.service';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = 'da6ca871-3c49-4ef6-8bca-f208a0bfba77';
const WAHA_URL =
  process.env.WAHA_URL ??
  'https://waha-production-f5bc.up.railway.app';
const WAHA_API_KEY = process.env.WAHA_API_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';

const NUR_PROMPT = `Awak Nur, staf AI Klinik Pergigian Medini cawangan Setia Tropika, Johor Bahru. Bantu customer faham rawatan, jawab soalan lazim, beri panduan awal, dan kumpul detail booking.

CARA BERCAKAP: Professional, mesra, warm, BM campur simple English. Guna 1 emoji ringkas. Panggil Cik/Tuan/Puan. Balas maksimum 2-3 ayat.

BOOKING: Kumpul nama penuh, tarikh, masa dan rawatan. Jika maklumat lengkap, beritahu booking akan diproses secara automatik. Jangan reka harga atau discount.

WAKTU BOOKING:
Ahad-Khamis: 10 pagi hingga 9 malam.
Jumaat-Sabtu: 10 pagi hingga 5 petang.
Waktu rehat: 1 petang hingga 2 petang.
Slot setiap 30 minit.`;

const EXTRACT_PROMPT = `Kamu pengekstrak data booking klinik gigi.

Jika mesej mempunyai niat booking, pulangkan JSON sahaja:
{
  "is_booking": true,
  "name": "",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "treatment": "",
  "branch": ""
}

Tarikh mesti format YYYY-MM-DD.
Masa mesti format 24 jam HH:MM.
Contoh: 6pm menjadi 18:00.
Jika maklumat tiada, kosongkan nilai tersebut.
Jika bukan booking, pulangkan {"is_booking":false}.
Jangan tulis markdown atau penerangan lain.`;

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
    const chatId: string =
      payload.from ?? payload.chatId ?? '';
    const text: string =
      payload.body ?? payload.text ?? '';
    const fromMe: boolean =
      payload.fromMe ?? false;

    if (fromMe) return { ok: true };
    if (!chatId) return { ok: true };
    if (chatId.endsWith('@g.us')) return { ok: true };
    if (!text || !text.trim()) return { ok: true };

    try {
      const reply = await this.minimax.chat(NUR_PROMPT, text);
      await this.sendText(chatId, reply);
    } catch (e) {
      this.logger.error(
        'Gagal balas WhatsApp: ' + (e as Error).message,
      );
    }

    try {
      await this.maybeSaveBooking(chatId, text, payload);
    } catch (e) {
      this.logger.error(
        'Gagal proses auto booking: ' + (e as Error).message,
      );
    }

    return { ok: true };
  }

  private async resolvePhone(
    chatId: string,
    payload: any,
  ): Promise<string> {
    const altJid =
      payload?._data?.key?.remoteJidAlt ?? '';

    if (altJid.includes('@s.whatsapp.net')) {
      return altJid.replace('@s.whatsapp.net', '');
    }

    if (chatId.endsWith('@c.us')) {
      return chatId.replace('@c.us', '');
    }

    if (chatId.endsWith('@lid')) {
      const lid = chatId.replace('@lid', '');

      try {
        const response = await fetch(
          `${WAHA_URL}/api/default/lids/${lid}`,
          {
            headers: {
              'X-Api-Key': WAHA_API_KEY,
            },
          },
        );

        if (response.ok) {
          const data = (await response.json()) as {
            pn?: string;
          };

          if (data?.pn) {
            return data.pn
              .replace('@c.us', '')
              .replace('@s.whatsapp.net', '');
          }
        }
      } catch (e) {
        this.logger.error(
          'Gagal resolve phone: ' + (e as Error).message,
        );
      }

      return lid;
    }

    return chatId
      .replace('@c.us', '')
      .replace('@lid', '');
  }

  private async maybeSaveBooking(
    chatId: string,
    text: string,
    payload: any,
  ) {
    const raw = await this.minimax.chat(
      EXTRACT_PROMPT,
      text,
    );

    const jsonStr = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let data: any;

    try {
      data = JSON.parse(jsonStr);
    } catch {
      this.logger.warn('AI booking response bukan JSON');
      return;
    }

    if (!data || data.is_booking !== true) {
      return;
    }

    const name = String(data.name ?? '').trim();
    const date = this.normalizeDate(
      String(data.date ?? '').trim(),
    );
    const time = this.normalizeTime(
      String(data.time ?? '').trim(),
    );
    const treatment = String(
      data.treatment ?? '',
    ).trim();
    const branch = String(
      data.branch ?? '',
    ).trim();

    if (!name || !date || !time) {
      this.logger.warn(
        'Booking belum lengkap; appointment tidak dicipta',
      );
      return;
    }

    if (!this.isValidBookingTime(date, time)) {
      this.logger.warn(
        `Slot booking tidak sah: ${date} ${time}`,
      );
      return;
    }

    const phone = await this.resolvePhone(
      chatId,
      payload,
    );

    await this.dbCtx.runAsWorker(
      {
        orgId: ORG_ID,
        branchIds: [BRANCH_ID],
        correlationId: 'wa-auto-booking',
        source: 'system_worker',
      },
      async (tx) => {
        const duplicate = await tx.execute(sql`
          SELECT id
          FROM booking_requests
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND contact_phone = ${phone}
            AND raw_message = ${text}
          LIMIT 1
        `);

        const duplicateRows = (
          duplicate as unknown as {
            rows: Array<{ id: string }>;
          }
        ).rows;

        if (duplicateRows.length > 0) {
          this.logger.warn(
            `Booking duplicate diabaikan untuk ${phone}`,
          );
          return;
        }

        const patientResult = await tx.execute(sql`
          SELECT id, name
          FROM patients
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND deleted_at IS NULL
            AND (
              phone = ${phone}
              OR whatsapp = ${phone}
            )
          LIMIT 1
        `);

        let patientId = (
          patientResult as unknown as {
            rows: Array<{
              id: string;
              name: string;
            }>;
          }
        ).rows[0]?.id ?? null;

        if (!patientId) {
          const mrn = await new OrgAllocator(
            tx as any,
          ).nextMrn(ORG_ID);

          const newPatient = await tx.execute(sql`
            INSERT INTO patients
              (org_id, branch_id, mrn, name, phone, whatsapp)
            VALUES
              (
                ${ORG_ID},
                ${BRANCH_ID},
                ${mrn},
                ${name},
                ${phone},
                ${phone}
              )
            RETURNING id
          `);

          patientId = (
            newPatient as unknown as {
              rows: Array<{ id: string }>;
            }
          ).rows[0]?.id ?? null;
        }

        if (!patientId) {
          this.logger.error(
            'Pesakit gagal dicipta',
          );
          return;
        }

        const code = await new OrgAllocator(
          tx as any,
        ).nextAptCode(ORG_ID);

        const appointment = await tx.execute(sql`
          INSERT INTO appointments
            (
              org_id,
              branch_id,
              code,
              patient_id,
              patient_name,
              treatment_ref,
              scheduled_date,
              scheduled_time,
              duration_min,
              status,
              notes
            )
          VALUES
            (
              ${ORG_ID},
              ${BRANCH_ID},
              ${code},
              ${patientId},
              ${name},
              ${treatment || null},
              ${date},
              ${time},
              30,
              'booked',
              ${text}
            )
          RETURNING id
        `);

        const appointmentId = (
          appointment as unknown as {
            rows: Array<{ id: string }>;
          }
        ).rows[0]?.id ?? null;

        await tx.execute(sql`
          INSERT INTO booking_requests
            (
              org_id,
              branch_id,
              contact_phone,
              patient_name,
              preferred_date,
              preferred_time,
              treatment,
              branch_name,
              raw_message,
              status,
              linked_appointment_id
            )
          VALUES
            (
              ${ORG_ID},
              ${BRANCH_ID},
              ${phone},
              ${name},
              ${date},
              ${time},
              ${treatment || null},
              ${branch || 'Setia Tropika'},
              ${text},
              'confirmed',
              ${appointmentId}
            )
        `);

        this.logger.warn(
          `Auto appointment berjaya: ${code}`,
        );
      },
    );
  }

  private normalizeDate(value: string): string {
    const match = value.match(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    return match ? value : '';
  }

  private normalizeTime(value: string): string {
    const cleaned = value
      .toLowerCase()
      .trim();

    const match = cleaned.match(
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|pagi|petang|malam)?$/,
    );

    if (!match) return '';

    let hour = Number(match[1]);
    const minute = Number(match[2] ?? '00');
    const period = match[3] ?? '';

    if (
      ['pm', 'petang', 'malam'].includes(period) &&
      hour < 12
    ) {
      hour += 12;
    }

    if (
      ['am', 'pagi'].includes(period) &&
      hour === 12
    ) {
      hour = 0;
    }

    if (
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return '';
    }

    return `${String(hour).padStart(2, '0')}:${String(
      minute,
    ).padStart(2, '0')}`;
  }

  private isValidBookingTime(
    date: string,
    time: string,
  ): boolean {
    const day = new Date(
      `${date}T00:00:00`,
    ).getDay();

    const [hour = -1, minute = -1] = time
      .split(':')
      .map(Number);

    const totalMinutes =
      hour * 60 + minute;

    if (minute !== 0 && minute !== 30) {
      return false;
    }

    if (
      totalMinutes >= 13 * 60 &&
      totalMinutes < 14 * 60
    ) {
      return false;
    }

    if (day === 5 || day === 6) {
      return (
        totalMinutes >= 10 * 60 &&
        totalMinutes < 17 * 60
      );
    }

    return (
      totalMinutes >= 10 * 60 &&
      totalMinutes < 21 * 60
    );
  }

  private async sendText(
    chatId: string,
    text: string,
  ) {
    const response = await fetch(
      `${WAHA_URL}/api/sendText`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': WAHA_API_KEY,
        },
        body: JSON.stringify({
          session: WAHA_SESSION,
          chatId,
          text,
        }),
      },
    );

    if (!response.ok) {
      this.logger.error(
        `sendText gagal ${response.status}: ${await response.text()}`,
      );
    }
  }
}