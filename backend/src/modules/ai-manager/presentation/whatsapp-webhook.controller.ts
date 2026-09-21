import { Body, Controller, Post, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { WhatsappPromptService } from '../application/whatsapp-prompt.service';
import { DbContextService, SYSTEM_WORKER_PRINCIPAL } from '../../../core/auth/db-context.service';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import { AuditService } from '../../../shared/audit/audit.service';
import { doctorHolidays } from '../../../infrastructure/database/schema';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = 'da6ca871-3c49-4ef6-8bca-f208a0bfba77';

const WAHA_URL =
  process.env.WAHA_URL ??
  'https://waha-production-f5bc.up.railway.app';

const WAHA_API_KEY = process.env.WAHA_API_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';

function malaysiaDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${value('year')}-${value('month')}-${value('day')}`;
}

function nurPrompt(): string {
  return `
Awak ialah Nur, pembantu WhatsApp Klinik Pergigian Medini,
cawangan Setia Tropika, Johor Bahru.

TUGAS:
Bantu pelanggan tentang rawatan dan proses booking secara automatik.
Ingat maklumat booking yang diberikan dalam konteks.
Tanya hanya maklumat yang masih belum ada.
Jangan ulang soalan yang telah dijawab.

TARIKH SISTEM HARI INI: ${malaysiaDate()}
Zon waktu: Asia/Kuala_Lumpur.
Gunakan tarikh sistem ini untuk esok dan lusa.
Jangan mereka nama hari. Gunakan tarikh sahaja jika tidak pasti.

MAKLUMAT BOOKING:
Nama penuh, tarikh, masa dan jenis rawatan.

CARA BERCAKAP:
- Bahasa Melayu yang mesra, profesional dan ringkas.
- Boleh campur sedikit English.
- Gunakan Encik untuk lelaki apabila pelanggan menyatakan dirinya lelaki
  atau menggunakan gelaran Encik/En./Tuan.
- Gunakan Puan untuk wanita apabila pelanggan menyatakan dirinya wanita
  atau menggunakan gelaran Puan/Pn.
- Jika pelanggan meminta gelaran tertentu, ikut permintaannya.
- Jika gelaran atau jantina belum diketahui, gunakan "anda".
- Jangan meneka jantina berdasarkan nama.
- Jangan guna Cik sebagai panggilan lalai, sis atau bro.
- "sy" dan "saya" ialah kata ganti diri, bukan nama pelanggan.
- Maksimum 2 atau 3 ayat dan maksimum 1 emoji.

WAKTU DAN SLOT:
- Ahad hingga Khamis: 10:00 pagi hingga 9:00 malam.
- Jumaat dan Sabtu: 10:00 pagi hingga 5:00 petang.
- Waktu rehat: 1:00 hingga 2:00 petang.
- Slot setiap 30 minit.
- Slot terakhir Ahad-Khamis 8:30 malam.
- Slot terakhir Jumaat-Sabtu 4:30 petang.

PERATURAN:
- Fahami 10 pagi sebagai 10:00, 10.30 pagi sebagai 10:30,
  2 petang sebagai 14:00 dan 6 malam sebagai 18:00.
- Jika maklumat belum lengkap, tanya satu perkara yang masih kosong.
- Jadual doktor, cuti dan ketersediaan mesti disahkan oleh sistem.
- Jangan reka slot kosong atau nama doktor.
- Jika semua maklumat lengkap, maklumkan bahawa sistem akan menyemak slot.
- Jangan minta staff mengesahkan booking.
- Jangan kata booking berjaya sebelum sistem mengesahkannya.
- Jangan reka harga, discount, diagnosis atau maklumat klinik.
`;
}

function extractPrompt(): string {
  return `
Kamu ialah pengekstrak data booking Klinik Pergigian Medini.

Pulangkan JSON sahaja tanpa markdown:
{
  "is_booking": true,
  "name": "",
  "date": "",
  "time": "",
  "treatment": "",
  "branch": "",
  "salutation": "",
  "missing": []
}

PERATURAN:
- is_booking true jika mesej berkaitan booking atau melengkapkan
  maklumat booking dalam konteks terdahulu.
- Jawapan ringkas seperti nama, masa atau "ya betul" boleh menjadi
  sambungan booking apabila konteks booking wujud.
- is_booking false jika bukan berkaitan booking.
- Isi hanya maklumat daripada mesej atau konteks.
- Jangan padam maklumat lama kecuali pelanggan membetulkannya.
- name ialah nama sahaja, tanpa kata ganti "sy", "saya" atau gelaran.
- Jangan anggap nama pertama yang diberikan ialah nama penuh jika
  pelanggan belum memberitahunya; jangan cipta nama tambahan.
- salutation hanya "", "Encik", "Puan", "Cik" atau "Tuan".
- Gunakan Encik jika pelanggan menyatakan lelaki atau gelaran En./Encik.
- Gunakan Puan jika pelanggan menyatakan wanita atau gelaran Pn./Puan.
- Ikut gelaran yang diminta secara jelas oleh pelanggan.
- Kekalkan salutation daripada konteks jika tiada pembetulan.
- Jangan tentukan jantina berdasarkan nama.
- Tarikh mesti YYYY-MM-DD.
- Masa mesti 24 jam HH:MM.
- 10 pagi = 10:00, 10.30 pagi = 10:30, 2 petang = 14:00.
- TARIKH SISTEM HARI INI: ${malaysiaDate()}.
- Gunakan tarikh Malaysia ini untuk esok dan lusa.
- Jika tiada cawangan disebut, gunakan Setia Tropika.
- missing hanya name, date, time atau treatment.
`;
}

type Salutation = '' | 'Encik' | 'Puan' | 'Cik' | 'Tuan';

type BookingMemory = {
  name: string;
  date: string;
  time: string;
  treatment: string;
  branch: string;
  salutation?: Salutation;
};

@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappWebhookController {
  private readonly logger = new Logger('WhatsappWebhook');
  private readonly redis: IORedis | null;

  constructor(
    private readonly minimax: MinimaxAdapter,
    private readonly dbCtx: DbContextService,
    private readonly whatsappPrompt: WhatsappPromptService,
    private readonly audit: AuditService,
  ) {
    const url = process.env.REDIS_URL;

    this.redis = url
      ? new IORedis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
        })
      : null;
  }

  @Public()
  @Post('webhook')
  async webhook(@Body() body: any) {
    if (body?.event !== 'message') return { ok: true };

    const payload = body?.payload ?? {};
    const chatId = String(payload.from ?? payload.chatId ?? '');
    const text = String(payload.body ?? payload.text ?? '').trim();

    if (
      payload.fromMe ||
      !chatId ||
      !text ||
      chatId.endsWith('@g.us') ||
      chatId.endsWith('@broadcast') ||
      chatId.endsWith('@newsletter')
    ) {
      return { ok: true };
    }

    try {
      await this.saveIncomingMessage(chatId, text, payload);
    } catch (error) {
      this.logError('Gagal simpan mesej WhatsApp', error);
    }

    try {
      if (await this.handleAppointmentAction(chatId, text, payload)) {
        return { ok: true };
      }

      const previous = await this.getBookingMemory(chatId);
      const remembered = await this.getSalutation(chatId);
      const explicit = this.explicitSalutation(text);
      const salutation = explicit || remembered || previous?.salutation || '';

      if (explicit) {
        await this.setSalutation(chatId, explicit);
      }

      const context =
        `\nKONTEKS BOOKING:\n${JSON.stringify(previous ?? {})}` +
        `\nGELARAN PELANGGAN: ${salutation || 'belum diketahui; gunakan anda'}`;

      try {
        const reply = await this.minimax.chat(
          (
            (await this.whatsappPrompt.getForBot(ORG_ID, BRANCH_ID))
            ?? nurPrompt()
          ) +
          `\nTARIKH SISTEM HARI INI: ${malaysiaDate()}` +
          '\nZon waktu: Asia/Kuala_Lumpur.' +
          '\nPengesahan booking dan nama doktor mesti datang daripada sistem. Jangan reka keputusan semakan slot.' +
          context,
          text,
        );
        await this.sendText(chatId, reply);
      } catch (error) {
        this.logError('Gagal balas WhatsApp', error);
      }

      await this.maybeSaveBooking(chatId, text, payload);
    } catch (error) {
      this.logError('Gagal proses auto booking', error);

      try {
        await this.sendText(
          chatId,
          'Maaf, sistem belum dapat menyelesaikan semakan booking. Sila hubungi klinik untuk semakan; booking ini belum disahkan.',
        );
      } catch (sendError) {
        this.logError('Gagal hantar makluman ralat', sendError);
      }
    }

    return { ok: true };
  }

  private logError(message: string, error: unknown) {
    const err = error as any;

    this.logger.error({
      message,
      errorMessage: err?.message ?? String(error),
      causeMessage: err?.cause?.message,
      code: err?.cause?.code,
      constraint: err?.cause?.constraint,
      table: err?.cause?.table,
    });
  }

  private async saveIncomingMessage(
    chatId: string,
    text: string,
    payload: any,
  ) {
    const phone = await this.resolvePhone(chatId, payload);
    const messageKey = String(
      payload?.id ??
      payload?._data?.key?.id ??
      `${chatId}:${Date.now()}`,
    );

    await this.dbCtx.runAsWorker(
      {
        orgId: ORG_ID,
        branchIds: [BRANCH_ID],
        correlationId: 'wa-incoming-message',
        source: 'system_worker',
      },
      async (tx) => {
        const channels = await tx.execute(sql`
          SELECT id
          FROM wa_channels
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND session_name = 'setia-tropika'
            AND deleted_at IS NULL
          LIMIT 1
        `);

        const channelId = (channels as any).rows?.[0]?.id;
        if (!channelId) return;

        const conversations = await tx.execute(sql`
          SELECT id
          FROM wa_conversations
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND channel_id = ${channelId}
            AND contact_phone = ${phone}
            AND deleted_at IS NULL
          LIMIT 1
        `);

        let conversationId = (conversations as any).rows?.[0]?.id;

        if (!conversationId) {
          conversationId = randomUUID();
          await tx.execute(sql`
            INSERT INTO wa_conversations
              (
                id, org_id, branch_id, channel_id,
                contact_phone, status, unread_count
              )
            VALUES
              (
                ${conversationId}, ${ORG_ID}, ${BRANCH_ID}, ${channelId},
                ${phone}, 'open', 0
              )
          `);
        }

        if (!conversationId) return;

        const duplicate = await tx.execute(sql`
          SELECT id
          FROM wa_messages
          WHERE org_id = ${ORG_ID}
            AND conversation_id = ${conversationId}
            AND idempotency_key = ${messageKey}
            AND deleted_at IS NULL
          LIMIT 1
        `);

        if ((duplicate as any).rows?.length) return;

        await tx.execute(sql`
          INSERT INTO wa_messages
            (
              id, org_id, branch_id, channel_id, conversation_id,
              direction, sender_type, body, status, idempotency_key
            )
          VALUES
            (
              ${randomUUID()}, ${ORG_ID}, ${BRANCH_ID}, ${channelId}, ${conversationId},
              'in', 'patient', ${text}, 'delivered', ${messageKey}
            )
        `);

        await tx.execute(sql`
          UPDATE wa_conversations
          SET unread_count = unread_count + 1,
              last_message_at = NOW(),
              updated_at = NOW()
          WHERE id = ${conversationId}
            AND org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
        `);
      },
    );
  }

  private async resolvePhone(
    chatId: string,
    payload: any,
  ): Promise<string> {
    const altJid = String(payload?._data?.key?.remoteJidAlt ?? '');

    if (altJid.endsWith('@s.whatsapp.net')) {
      return altJid.replace('@s.whatsapp.net', '');
    }

    if (chatId.endsWith('@c.us')) {
      return chatId.replace('@c.us', '');
    }

    if (chatId.endsWith('@s.whatsapp.net')) {
      return chatId.replace('@s.whatsapp.net', '');
    }

    if (chatId.endsWith('@lid')) {
      const lid = chatId.replace('@lid', '');

      try {
        const response = await fetch(
          `${WAHA_URL}/api/${encodeURIComponent(WAHA_SESSION)}/lids/${encodeURIComponent(lid)}`,
          { headers: { 'X-Api-Key': WAHA_API_KEY } },
        );

        if (response.ok) {
          const data = await response.json() as { pn?: string };

          if (data.pn) {
            return data.pn
              .replace('@c.us', '')
              .replace('@s.whatsapp.net', '');
          }
        }
      } catch (error) {
        this.logError('Gagal resolve phone', error);
      }

      return lid;
    }

    return chatId;
  }

  private async maybeSaveBooking(
    chatId: string,
    text: string,
    payload: any,
  ) {
    const previous = await this.getBookingMemory(chatId);
    const remembered = await this.getSalutation(chatId);

    const raw = await this.minimax.chat(
      extractPrompt() +
        `\nKONTEKS:\n${JSON.stringify({
          ...previous,
          salutation: remembered || previous?.salutation || '',
        })}`,
      text,
    );

    let data: any;

    try {
      data = JSON.parse(
        raw.replace(/```json/gi, '').replace(/```/g, '').trim(),
      );
    } catch {
      throw new Error('AI booking response bukan JSON');
    }

    if (!data || data.is_booking !== true) return;

    const name = this.normalizeName(
      String(data.name || previous?.name || ''),
    );
    const date = this.normalizeDate(
      String(data.date || previous?.date || ''),
    );
    const time = this.normalizeTime(
      String(data.time || previous?.time || ''),
    );
    const treatment = String(
      data.treatment || previous?.treatment || '',
    ).trim();
    const branch = String(
      data.branch || previous?.branch || 'Setia Tropika',
    ).trim();

    const salutation =
      this.explicitSalutation(text) ||
      remembered ||
      previous?.salutation ||
      '';

    await this.setBookingMemory(chatId, {
      name,
      date,
      time,
      treatment,
      branch,
      salutation,
    });

    if (salutation) {
      await this.setSalutation(chatId, salutation);
    }

    if (!name || !date || !time || !treatment) return;

    if (!this.isValidBookingTime(date, time)) {
      await this.sendText(
        chatId,
        'Maaf, masa tersebut di luar slot operasi atau jatuh pada waktu rehat. Sila pilih masa lain pada sela 30 minit.',
      );
      return;
    }

    const slotTimestamp = Date.parse(`${date}T${time}:00+08:00`);

    if (slotTimestamp <= Date.now()) {
      await this.sendText(
        chatId,
        'Maaf, tarikh atau masa tersebut sudah berlalu. Sila pilih slot akan datang.',
      );
      return;
    }

    const phone = await this.resolvePhone(chatId, payload);
    let outcome = '';

    await this.dbCtx.runAsWorker(
      {
        orgId: ORG_ID,
        branchIds: [BRANCH_ID],
        correlationId: 'wa-auto-booking',
        source: 'system_worker',
      },
      async (tx) => {
        const duplicate = await tx.execute(sql`
          SELECT
            a.id,
            a.patient_name,
            s.name AS doctor_name
          FROM booking_requests br
          JOIN appointments a ON a.id = br.linked_appointment_id
          LEFT JOIN staff s ON s.id = a.doctor_id
          WHERE br.org_id = ${ORG_ID}
            AND br.branch_id = ${BRANCH_ID}
            AND br.contact_phone = ${phone}
            AND a.org_id = ${ORG_ID}
            AND a.branch_id = ${BRANCH_ID}
            AND a.scheduled_date = ${date}
            AND a.scheduled_time = ${time}
            AND a.deleted_at IS NULL
            AND a.status NOT IN ('cancelled', 'no-show')
          LIMIT 1
        `);

        const existing = (duplicate as any).rows?.[0];

        if (existing) {
          outcome = [
            'Booking pada waktu ini sudah direkodkan.',
            `Nama: ${existing.patient_name}`,
            `Tarikh: ${date}`,
            `Masa: ${time}`,
            `Doktor bertugas: ${existing.doctor_name || 'Sila semak dengan klinik'}`,
          ].join('\n');
          return;
        }

        const holidays = await tx.execute(sql`
          SELECT ${doctorHolidays.reason} AS reason
          FROM ${doctorHolidays}
          WHERE ${doctorHolidays.orgId} = ${ORG_ID}
            AND ${doctorHolidays.branchId} = ${BRANCH_ID}
            AND ${doctorHolidays.holidayDate} = CAST(${date} AS DATE)
          LIMIT 1
        `);

        if ((holidays as any).rows?.length) {
          outcome =
            `Maaf, klinik bercuti pada ${date}. Sila pilih tarikh lain.`;
          return;
        }

        const doctors = await tx.execute(sql`
          SELECT s.id AS doctor_id, s.name AS doctor_name
          FROM doctor_schedules ds
          JOIN staff s ON s.id = ds.doctor_id
          WHERE ds.org_id = ${ORG_ID}
            AND ds.branch_id = ${BRANCH_ID}
            AND s.org_id = ${ORG_ID}
            AND ds.schedule_date = ${date}
            AND ds.start_time <= CAST(${time} AS TIME)
            AND TIMESTAMP(${date}, ds.end_time)
                >= DATE_ADD(TIMESTAMP(${date}, CAST(${time} AS TIME)), INTERVAL 30 MINUTE)
            AND s.role = 'doctor'
            AND s.status = 'Active'
            AND s.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM appointments a
              WHERE a.org_id = ${ORG_ID}
                AND a.branch_id = ${BRANCH_ID}
                AND a.doctor_id = s.id
                AND a.scheduled_date = ${date}
                AND a.scheduled_time
                    < ADDTIME(CAST(${time} AS TIME), '00:30:00')
                AND ADDTIME(a.scheduled_time, SEC_TO_TIME(a.duration_min * 60)) > CAST(${time} AS TIME)
                AND a.deleted_at IS NULL
                AND a.status NOT IN (
                  'completed', 'cancelled', 'no-show'
                )
            )
          ORDER BY ds.start_time, s.name
          LIMIT 1
        `);

        const selectedDoctor = (
          doctors as unknown as {
            rows: Array<{
              doctor_id: string;
              doctor_name: string;
            }>;
          }
        ).rows[0];

        if (!selectedDoctor) {
          outcome =
            `Maaf, tiada doktor tersedia untuk slot ${date} jam ${time}. Sila pilih masa lain atau hubungi klinik untuk semakan.`;
          return;
        }

        // Kekalkan aturan asal: satu appointment bagi waktu cawangan.
        const occupied = await tx.execute(sql`
          SELECT id
          FROM appointments
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND scheduled_date = ${date}
            AND scheduled_time = ${time}
            AND deleted_at IS NULL
            AND status NOT IN ('cancelled', 'no-show')
          LIMIT 1
        `);

        if ((occupied as any).rows?.length) {
          outcome =
            `Maaf, slot ${time} pada ${date} sudah ditempah. Sila pilih masa lain.`;
          return;
        }

        const patients = await tx.execute(sql`
          SELECT id
          FROM patients
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND deleted_at IS NULL
            AND (phone = ${phone} OR whatsapp = ${phone})
          LIMIT 1
        `);

        let patientId = (patients as any).rows?.[0]?.id;

        if (!patientId) {
          const mrn = await new OrgAllocator(tx as any).nextMrn(ORG_ID);
          patientId = randomUUID();

          await tx.execute(sql`
            INSERT INTO patients
              (id, org_id, branch_id, mrn, name, phone, whatsapp)
            VALUES
              (
                ${patientId}, ${ORG_ID}, ${BRANCH_ID}, ${mrn},
                ${name}, ${phone}, ${phone}
              )
          `);
        }

        if (!patientId) {
          throw new Error('Pesakit gagal dicipta');
        }

        const code = await new OrgAllocator(tx as any).nextAptCode(ORG_ID);

        const appointmentId = randomUUID();
        await tx.execute(sql`
          INSERT INTO appointments
            (
              id, org_id, branch_id, code, patient_id, patient_name,
              doctor_id, treatment_ref, scheduled_date,
              scheduled_time, duration_min, status, notes
            )
          VALUES
            (
              ${appointmentId}, ${ORG_ID}, ${BRANCH_ID}, ${code}, ${patientId}, ${name},
              ${selectedDoctor.doctor_id}, ${treatment}, ${date},
              ${time}, 30, 'confirmed', ${text}
            )
        `);

        if (!appointmentId) {
          throw new Error('Appointment gagal dicipta');
        }

        await tx.execute(sql`
          INSERT INTO booking_requests
            (
              id, org_id, branch_id, contact_phone, patient_name,
              preferred_date, preferred_time, treatment,
              branch_name, raw_message, status, linked_appointment_id
            )
          VALUES
            (
              ${randomUUID()}, ${ORG_ID}, ${BRANCH_ID}, ${phone}, ${name},
              ${date}, ${time}, ${treatment},
              'Setia Tropika', ${text}, 'confirmed', ${appointmentId}
            )
        `);

        const displayName = salutation
          ? `${salutation} ${name}`
          : name;

        outcome = [
          'Booking berjaya disahkan',
          `Kod: ${code}`,
          `Nama: ${displayName}`,
          `Tarikh: ${date}`,
          `Masa: ${time}`,
          `Rawatan: ${treatment}`,
          'Cawangan: Setia Tropika',
          `Doktor bertugas: ${selectedDoctor.doctor_name}`,
        ].join('\n');
      },
    );

    if (outcome) {
      await this.sendText(chatId, outcome);

      if (
        outcome.startsWith('Booking berjaya disahkan') ||
        outcome.startsWith('Booking pada waktu ini sudah direkodkan')
      ) {
        await this.deleteBookingMemory(chatId);
      }
    }
  }

  private normalizeName(value: string): string {
    return value
      .trim()
      .replace(/^(?:sy|saya)\s+/i, '')
      .replace(/^(?:encik|en\.?|puan|pn\.?|tuan|cik)\s+/i, '')
      .trim();
  }

  private explicitSalutation(text: string): Salutation {
    if (
      /\b(?:panggil|gelaran)\s+(?:saya\s+)?(?:encik|en\.?)(?:\s|$)/i.test(text) ||
      /\b(?:saya|sy)\s+(?:seorang\s+)?(?:lelaki|encik)(?:\s|[.,!?]|$)/i.test(text) ||
      /\b(?:nama\s+saya|nama\s+sy)\s+(?:encik|en\.?)\s+/i.test(text)
    ) {
      return 'Encik';
    }

    if (
      /\b(?:panggil|gelaran)\s+(?:saya\s+)?(?:puan|pn\.?)(?:\s|$)/i.test(text) ||
      /\b(?:saya|sy)\s+(?:seorang\s+)?(?:wanita|perempuan|puan)(?:\s|[.,!?]|$)/i.test(text)
    ) {
      return 'Puan';
    }

    if (/\bpanggil\s+(?:saya\s+)?cik(?:\s|$)/i.test(text)) {
      return 'Cik';
    }

    if (/\bpanggil\s+(?:saya\s+)?tuan(?:\s|$)/i.test(text)) {
      return 'Tuan';
    }

    return '';
  }

  private normalizeDate(value: string): string {
    const cleaned = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return '';

    const parsed = new Date(`${cleaned}T00:00:00Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== cleaned
    ) {
      return '';
    }

    return cleaned;
  }

  private normalizeTime(value: string): string {
    const match = value.toLowerCase().trim().match(
      /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|pagi|petang|malam)?$/,
    );

    if (!match) return '';

    let hour = Number(match[1]);
    const minute = Number(match[2] ?? '0');
    const period = match[3] ?? '';

    if (period && (hour < 1 || hour > 12)) return '';

    if (['pm', 'petang', 'malam'].includes(period) && hour < 12) {
      hour += 12;
    }

    if (['am', 'pagi'].includes(period) && hour === 12) {
      hour = 0;
    }

    if (hour > 23 || minute > 59) return '';

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private isValidBookingTime(date: string, time: string): boolean {
    if (!this.normalizeDate(date)) return false;
    if (!/^\d{2}:\d{2}$/.test(time)) return false;

    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const [hour = -1, minute = -1] = time.split(':').map(Number);
    const total = hour * 60 + minute;
    const closing = day === 5 || day === 6 ? 17 * 60 : 21 * 60;

    return (
      (minute === 0 || minute === 30) &&
      total >= 10 * 60 &&
      total + 30 <= closing &&
      !(total < 14 * 60 && total + 30 > 13 * 60)
    );
  }

  private bookingKey(chatId: string): string {
    return `medini:whatsapp:booking:${chatId}`;
  }

  private salutationKey(chatId: string): string {
    return `medini:whatsapp:salutation:${ORG_ID}:${BRANCH_ID}:${chatId}`;
  }

  private appointmentActionKey(chatId: string): string {
    return `medini:whatsapp:appointment-action:${chatId}`;
  }

  private async getSalutation(chatId: string): Promise<Salutation> {
    if (!this.redis) return '';

    try {
      const value = await this.redis.get(this.salutationKey(chatId));

      return ['Encik', 'Puan', 'Cik', 'Tuan'].includes(value ?? '')
        ? value as Salutation
        : '';
    } catch (error) {
      this.logError('Gagal baca gelaran', error);
      return '';
    }
  }

  private async setSalutation(
    chatId: string,
    value: Salutation,
  ): Promise<void> {
    if (!this.redis || !value) return;

    try {
      await this.redis.set(
        this.salutationKey(chatId),
        value,
        'EX',
        30 * 86400,
      );
    } catch (error) {
      this.logError('Gagal simpan gelaran', error);
    }
  }

  private async getBookingMemory(
    chatId: string,
  ): Promise<BookingMemory | null> {
    if (!this.redis) return null;

    try {
      const value = await this.redis.get(this.bookingKey(chatId));
      if (!value) return null;

      const parsed = JSON.parse(value) as BookingMemory;
      parsed.name = this.normalizeName(parsed.name ?? '');
      return parsed;
    } catch (error) {
      this.logError('Gagal baca sesi booking', error);
      return null;
    }
  }

  private async setBookingMemory(
    chatId: string,
    value: BookingMemory,
  ): Promise<void> {
    if (!this.redis) return;

    try {
      // Booking and appointment-cancellation state must never overlap.
      // A stale pending cancellation could otherwise consume a normal
      // "Ya" reply from the booking flow and cancel the appointment.
      await this.redis.del(this.appointmentActionKey(chatId));

      await this.redis.set(
        this.bookingKey(chatId),
        JSON.stringify(value),
        'EX',
        86400,
      );
    } catch (error) {
      this.logError('Gagal simpan sesi booking', error);
    }
  }

  private async deleteBookingMemory(chatId: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(this.bookingKey(chatId));
    } catch (error) {
      this.logError('Gagal padam sesi booking', error);
    }
  }

  private async handleAppointmentAction(
    chatId: string,
    text: string,
    payload: any,
  ): Promise<boolean> {
    if (!this.redis) return false;

    const normalized = text.trim().toLowerCase();
    const key = this.appointmentActionKey(chatId);
    const pendingId = await this.redis.get(key);

    const confirms = [
      'ya', 'yes', 'betul', 'sahkan', 'confirm',
    ].includes(normalized);

    if (
      pendingId &&
      ['tidak', 'tak', 'no', 'jangan batal'].includes(normalized)
    ) {
      await this.redis.del(key);
      await this.sendText(
        chatId,
        'Baik, pembatalan tidak diteruskan.',
      );
      return true;
    }

    if (pendingId && confirms) {
      const phone = await this.resolvePhone(chatId, payload);

      const result = await this.dbCtx.runAsWorker(
        {
          orgId: ORG_ID,
          branchIds: [BRANCH_ID],
          correlationId: 'wa-cancel-appointment',
          source: 'system_worker',
        },
        async (tx) => {
          const beforeResult = await tx.execute(sql`
            SELECT a.status
            FROM appointments a
            WHERE a.id = ${pendingId}
              AND a.org_id = ${ORG_ID}
              AND a.branch_id = ${BRANCH_ID}
              AND a.deleted_at IS NULL
              AND a.status IN (
                'booked', 'confirmed', 'checked-in', 'waiting'
              )
              AND a.patient_id IN (
                SELECT id
                FROM patients
                WHERE org_id = ${ORG_ID}
                  AND branch_id = ${BRANCH_ID}
                  AND deleted_at IS NULL
                  AND (phone = ${phone} OR whatsapp = ${phone})
              )
            LIMIT 1
            FOR UPDATE
          `);

          const beforeStatus =
            (beforeResult as any).rows?.[0]?.status;

          if (!beforeStatus) {
            return { affectedRows: 0 };
          }

          const updateResult = await tx.execute(sql`
            UPDATE appointments
            SET status = 'cancelled',
                updated_at = NOW(6)
            WHERE id = ${pendingId}
              AND org_id = ${ORG_ID}
              AND branch_id = ${BRANCH_ID}
              AND deleted_at IS NULL
              AND status IN (
                'booked', 'confirmed', 'checked-in', 'waiting'
              )
          `);

          const affectedRows =
            Number((updateResult as any).affectedRows ?? 0);

          if (affectedRows > 0) {
            await this.audit.record(
              {
                actorId:
                  SYSTEM_WORKER_PRINCIPAL.staffId,
                actorRole:
                  SYSTEM_WORKER_PRINCIPAL.role,
                action:
                  'appointment_cancelled_whatsapp',
                entity: 'appointments',
                entityId: pendingId,
                orgId: ORG_ID,
                branchId: BRANCH_ID,
                source: 'integration',
                before: {
                  status: beforeStatus,
                },
                after: {
                  status: 'cancelled',
                  channel: 'whatsapp',
                },
              },
              tx,
            );
          }

          return { affectedRows };
        },
      );

      await this.redis.del(key);

      await this.sendText(
        chatId,
        Number((result as any).affectedRows ?? 0) > 0
          ? 'Appointment berjaya dibatalkan.'
          : 'Appointment tidak dapat dibatalkan. Sila hubungi klinik untuk semakan.',
      );

      return true;
    }

    const wantsCancel =
      /\b(batal|batalkan|cancel|tak dapat hadir|tidak dapat hadir)\b/i
        .test(normalized);

    if (!wantsCancel) return false;

    const phone = await this.resolvePhone(chatId, payload);

    const result = await this.dbCtx.runAsWorker(
      {
        orgId: ORG_ID,
        branchIds: [BRANCH_ID],
        correlationId: 'wa-find-appointment-to-cancel',
        source: 'system_worker',
      },
      async (tx) => tx.execute(sql`
        SELECT
          a.id,
          a.patient_name,
          DATE_FORMAT(a.scheduled_date, '%Y-%m-%d') AS booking_date,
          a.scheduled_time
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        WHERE a.org_id = ${ORG_ID}
          AND a.branch_id = ${BRANCH_ID}
          AND p.org_id = ${ORG_ID}
          AND p.branch_id = ${BRANCH_ID}
          AND (p.phone = ${phone} OR p.whatsapp = ${phone})
          AND a.status IN (
            'booked', 'confirmed', 'checked-in', 'waiting'
          )
          AND a.scheduled_date >= CAST(${malaysiaDate()} AS DATE)
          AND a.deleted_at IS NULL
          AND p.deleted_at IS NULL
        ORDER BY a.scheduled_date, a.scheduled_time
        LIMIT 1
      `),
    );

    const row = (result as any).rows?.[0];

    if (!row) {
      await this.sendText(
        chatId,
        'Maaf, saya tidak jumpa appointment aktif untuk nombor ini.',
      );
      return true;
    }

    // Entering cancellation flow invalidates any stale booking session,
    // so a later "Ya" has only one possible meaning.
    await this.deleteBookingMemory(chatId);
    await this.redis.set(key, String(row.id), 'EX', 600);

    await this.sendText(
      chatId,
      `Betul nak batalkan appointment ${row.patient_name} pada ${row.booking_date} pukul ${String(row.scheduled_time).slice(0, 5)}? Balas Ya untuk sahkan.`,
    );

    return true;
  }

  private async sendText(chatId: string, text: string): Promise<void> {
    const response = await fetch(`${WAHA_URL}/api/sendText`, {
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
    });

    if (!response.ok) {
      throw new Error(`WAHA sendText gagal: HTTP ${response.status}`);
    }
  }
}