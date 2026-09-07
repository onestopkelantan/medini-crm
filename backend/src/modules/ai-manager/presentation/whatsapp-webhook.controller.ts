/* WhatsApp webhook - Nur reply + automatic booking intake. */
import { Body, Controller, Post, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { DbContextService } from '../../../core/auth/db-context.service';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import IORedis from 'ioredis';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = 'da6ca871-3c49-4ef6-8bca-f208a0bfba77';
const WAHA_URL =
  process.env.WAHA_URL ??
  'https://waha-production-f5bc.up.railway.app';
const WAHA_API_KEY = process.env.WAHA_API_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';
const CURRENT_DATE = new Date().toISOString().slice(0, 10);

const NUR_PROMPT = `
Awak ialah Nur, pembantu WhatsApp Klinik Pergigian Medini, cawangan Setia Tropika, Johor Bahru.

TUGAS:
Bantu pelanggan tentang rawatan dan proses booking secara automatik. Ingat semua maklumat booking yang telah diberikan dalam perbualan. Tanya hanya maklumat yang masih belum ada. Jangan ulang soalan yang telah dijawab.

TARIKH SISTEM HARI INI: ${CURRENT_DATE}
Gunakan tahun dan tarikh sistem ini. Jangan gunakan tahun lama seperti 2025.

MAKLUMAT BOOKING:
Nama penuh, tarikh, masa dan jenis rawatan.

CARA BERCAKAP:
- Bahasa Melayu yang mesra, profesional dan ringkas.
- Boleh campur sedikit English.
- Panggil Cik, Puan atau Tuan; jika tidak pasti gunakan Cik.
- Jangan guna sis atau bro.
- Maksimum 2 atau 3 ayat dan maksimum 1 emoji.

WAKTU DAN SLOT:
- Ahad hingga Khamis: 10:00 pagi hingga 9:00 malam.
- Jumaat dan Sabtu: 10:00 pagi hingga 5:00 petang.
- Waktu rehat: 1:00 hingga 2:00 petang.
- Slot setiap 30 minit.
- Slot terakhir Ahad-Khamis 8:30 malam.
- Slot terakhir Jumaat-Sabtu 4:30 petang.

PERATURAN:
- Fahami 10 pagi sebagai 10:00, 10.30 pagi sebagai 10:30, 2 petang sebagai 14:00 dan 6 malam sebagai 18:00.
- Fahami esok dan lusa berdasarkan tarikh semasa sistem.
- Jika maklumat belum lengkap, tanya satu perkara yang masih kosong.
- Jika slot penuh, maklumkan slot penuh dan cadangkan slot kosong lain.
- Jika waktu tidak sah, tawarkan slot yang sah.
- Jika semua maklumat lengkap, maklumkan booking sedang diproses secara automatik.
- Jangan minta staff mengesahkan booking.
- Jangan kata berjaya sebelum sistem mengesahkan slot.
- Jangan reka harga, discount, diagnosis atau maklumat klinik.

CONTOH:
Pelanggan: Nama saya Ali
Nur: Baik Cik Ali  Tarikh yang Cik mahu?

Pelanggan: Esok, 10 pagi untuk scaling
Nur: Baik Cik Ali. Saya sedang semak slot Scaling untuk esok pada 10:00 pagi.
`;

const EXTRACT_PROMPT = `
Kamu ialah pengekstrak data booking Klinik Pergigian Medini.

Pulangkan JSON sahaja tanpa markdown:
{
  "is_booking": true,
  "name": "",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "treatment": "",
  "branch": "",
  "missing": []
}

PERATURAN:
- is_booking true jika mesej ada niat membuat, menukar atau menyemak booking.
- is_booking false jika bukan berkaitan booking.
- Isi hanya maklumat yang wujud dalam mesej atau konteks yang diberikan.
- Jangan padam maklumat lama yang sudah diberikan.
- Tarikh mesti YYYY-MM-DD.
- Masa mesti format 24 jam HH:MM.
- 10 pagi = 10:00, 10.30 pagi = 10:30, 2 petang = 14:00, 6 malam = 18:00.
- Jika tarikh disebut sebagai esok atau lusa, gunakan tarikh sebenar berdasarkan tarikh semasa sistem.
- Tahun semasa mesti diambil daripada TARIKH SISTEM HARI INI: ${CURRENT_DATE}.
- Jika tiada cawangan disebut, gunakan Setia Tropika.
- missing hanya boleh mengandungi name, date, time atau treatment.
- Jika semua lengkap, missing mesti [].
`;

type BookingMemory = {
  name: string;
  date: string;
  time: string;
  treatment: string;
  branch: string;
};

@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappWebhookController {
  private readonly logger = new Logger('WhatsappWebhook');
  private readonly redis: IORedis | null;

  constructor(
    private readonly minimax: MinimaxAdapter,
    private readonly dbCtx: DbContextService,
  ) {
    const url = process.env.REDIS_URL;
    this.redis = url
      ? new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: null })
      : null;
  }

  @Public()
  @Post('webhook')
  async webhook(@Body() body: any) {
    this.logger.warn({
      message: 'WAHA payload diterima',
      event: body?.event,
      payloadKeys: Object.keys(body?.payload ?? {}),
      fromMe: body?.payload?.fromMe,
      chatId: body?.payload?.from ?? body?.payload?.chatId,
      text: body?.payload?.body ?? body?.payload?.text,
    });

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
      await this.saveIncomingMessage(chatId, text, payload);
    } catch (e) {
      this.logger.error("Gagal simpan mesej WhatsApp: " + (e as Error).message);
    }
    const appointmentActionHandled = await this.handleAppointmentAction(
      chatId,
      text,
      payload,
    );
    if (appointmentActionHandled) return { ok: true };

    const previous = await this.getBookingMemory(chatId);
    const context = previous
      ? `\nMAKLUMAT BOOKING SEMENTARA YANG SUDAH DIKUMPUL:\n${JSON.stringify(previous)}\nGunakan maklumat ini dan tanya hanya perkara yang masih kosong.\n`
      : '';

    try {
      const reply = await this.minimax.chat(
        NUR_PROMPT + context,
        text,
      );
      await this.sendText(chatId, reply);
    } catch (e) {
      this.logger.error(
        'Gagal balas WhatsApp: ' + (e as Error).message,
      );
    }

    try {
      await this.maybeSaveBooking(chatId, text, payload);
    } catch (e) {
      const err = e as any;
      this.logger.error({
        message: 'Gagal proses auto booking',
        errorMessage: err?.message,
        causeMessage: err?.cause?.message,
        detail: err?.cause?.detail,
        hint: err?.cause?.hint,
        code: err?.cause?.code,
        constraint: err?.cause?.constraint,
        table: err?.cause?.table,
      });
    }

    return { ok: true };
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
        const channelResult = await tx.execute(sql`
          SELECT id
          FROM wa_channels
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND session_name = 'setia-tropika'
            AND deleted_at IS NULL
          LIMIT 1
        `);

        const channelId = (channelResult as any).rows?.[0]?.id;
        if (!channelId) return;

        const conversationResult = await tx.execute(sql`
          SELECT id
          FROM wa_conversations
          WHERE org_id = ${ORG_ID}
            AND branch_id = ${BRANCH_ID}
            AND channel_id = ${channelId}
            AND contact_phone = ${phone}
            AND deleted_at IS NULL
          LIMIT 1
        `);

        let conversationId = (conversationResult as any).rows?.[0]?.id;

        if (!conversationId) {
          const created = await tx.execute(sql`
            INSERT INTO wa_conversations
              (org_id, branch_id, channel_id, contact_phone, status, unread_count)
            VALUES
              (${ORG_ID}, ${BRANCH_ID}, ${channelId}, ${phone}, 'open', 1)
            RETURNING id
          `);

          conversationId = (created as any).rows?.[0]?.id;
        } else {
          await tx.execute(sql`
            UPDATE wa_conversations
            SET
              unread_count = unread_count + 1,
              last_message_at = NOW(),
              updated_at = NOW()
            WHERE id = ${conversationId}
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
              org_id,
              branch_id,
              channel_id,
              conversation_id,
              direction,
              sender_type,
              body,
              status,
              idempotency_key
            )
          VALUES
            (
              ${ORG_ID},
              ${BRANCH_ID},
              ${channelId},
              ${conversationId},
              'in',
              'patient',
              ${text},
              'delivered',
              ${messageKey}
            )
        `);

        await tx.execute(sql`
          UPDATE wa_conversations
          SET last_message_at = NOW(), updated_at = NOW()
          WHERE id = ${conversationId}
        `);
      },
    );
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
    const previous = await this.getBookingMemory(chatId);
    const raw = await this.minimax.chat(
      EXTRACT_PROMPT +
        `\nKONTEKS BOOKING TERDAHULU:\n${JSON.stringify(previous ?? {})}`,
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

    const name = String(
      data.name || previous?.name || '',
    ).trim();
    const date = this.normalizeDate(
      String(data.date || previous?.date || '').trim(),
    );
    const time = this.normalizeTime(
      String(data.time || previous?.time || '').trim(),
    );
    const treatment = String(
      data.treatment || previous?.treatment || '',
    ).trim();
    const branch = String(
      data.branch || previous?.branch || 'Setia Tropika',
    ).trim();

    await this.setBookingMemory(chatId, {
      name,
      date,
      time,
      treatment,
      branch,
    });

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

    let autoBooked = false;

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
          await this.deleteBookingMemory(chatId);
          return;
        }

        const doctorResult = await tx.execute(sql`
          SELECT s.id AS doctor_id, s.name AS doctor_name
          FROM doctor_schedules ds
          JOIN staff s ON s.id = ds.doctor_id
          WHERE ds.org_id = ${ORG_ID}
            AND ds.branch_id = ${BRANCH_ID}
            AND ds.schedule_date = ${date}
            AND ds.start_time <= ${time}::time
            AND ds.end_time > ${time}::time
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
                AND a.scheduled_time::time < (${time}::time + interval '30 minutes')
                AND (a.scheduled_time::time + a.duration_min * interval '1 minute') > ${time}::time
                AND a.deleted_at IS NULL
                AND a.status NOT IN ('completed', 'cancelled', 'no-show')
            )
          ORDER BY ds.start_time, s.name
          LIMIT 1
        `);

        const doctorId = (
          doctorResult as unknown as {
            rows: Array<{ doctor_id: string; doctor_name: string }>;
          }
        ).rows[0]?.doctor_id ?? null;

        if (!doctorId) {
          await this.sendText(
            chatId,
            `Maaf Cik, tiada doktor yang bertugas atau tersedia pada ${date} jam ${time}. Sila pilih masa lain `,
          );
          this.logger.warn(`Tiada doktor tersedia: ${date} ${time}`);
          return;
        }

        const occupiedResult = await tx.execute(sql`
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

        const occupiedRows = (
          occupiedResult as unknown as {
            rows: Array<{ id: string }>;
          }
        ).rows;

        if (occupiedRows.length > 0) {
          const busyResult = await tx.execute(sql`
            SELECT scheduled_time
            FROM appointments
            WHERE org_id = ${ORG_ID}
              AND branch_id = ${BRANCH_ID}
              AND scheduled_date = ${date}
              AND deleted_at IS NULL
              AND status NOT IN ('cancelled', 'no-show')
          `);

          const busySlots = new Set(
            (
              busyResult as unknown as {
                rows: Array<{ scheduled_time: string }>;
              }
            ).rows.map((row) =>
              String(row.scheduled_time).slice(0, 5),
            ),
          );

          const alternatives = this.getBookingSlots(date)
            .filter((slot) => !busySlots.has(slot))
            .slice(0, 3);

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
                status
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
                'pending'
              )
          `);

          const suggestion = alternatives.length > 0
            ? ` Slot tersedia: ${alternatives.join(', ')}.`
            : ' Tiada slot lain tersedia pada tarikh tersebut.';

          await this.sendText(
            chatId,
            `Maaf Cik, slot ${time} pada ${date} sudah penuh.${suggestion} `,
          );

          this.logger.warn(
            `Slot penuh ditolak: ${date} ${time}`,
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
              doctor_id,
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
              ${doctorId},
              ${treatment || null},
              ${date},
              ${time},
              30,
              'confirmed',
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
        autoBooked = true;
        await this.deleteBookingMemory(chatId);
      },
    );

    if (autoBooked) {
      await this.sendText(
        chatId,
        `Booking berjaya disahkan \nNama: ${name}\nTarikh: ${date}\nMasa: ${time}\nRawatan: ${treatment || 'Pemeriksaan'}\nCawangan: ${branch || 'Setia Tropika'}`,
      );
    }
  }

  private normalizeDate(value: string): string {
    const match = value.match(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    return match ? value : '';
  }

  private bookingKey(chatId: string): string {
    return `medini:whatsapp:booking:${chatId}`;
  }

  private appointmentActionKey(chatId: string): string {
    return `medini:whatsapp:appointment-action:${chatId}`;
  }

  private async handleAppointmentAction(
    chatId: string,
    text: string,
    payload: any,
  ): Promise<boolean> {
    if (!this.redis) return false;

    const normalized = text.trim().toLowerCase();
    const pendingId = await this.redis.get(this.appointmentActionKey(chatId));
    const confirms = ['ya', 'yes', 'betul', 'sahkan', 'confirm'].includes(normalized);

    if (pendingId && confirms) {
      const phone = await this.resolvePhone(chatId, payload);
      await this.dbCtx.runAsWorker(
        {
          orgId: ORG_ID,
          branchIds: [BRANCH_ID],
          correlationId: 'wa-cancel-appointment',
          source: 'system_worker',
        },
        async (tx) => {
          await tx.execute(sql`
            UPDATE appointments
            SET status = 'cancelled', updated_at = NOW()
            WHERE id = ${pendingId}
              AND org_id = ${ORG_ID}
              AND branch_id = ${BRANCH_ID}
              AND status IN ('booked', 'confirmed', 'checked-in', 'waiting')
              AND patient_id IN (
                SELECT id FROM patients
                WHERE org_id = ${ORG_ID}
                  AND branch_id = ${BRANCH_ID}
                  AND (phone = ${phone} OR whatsapp = ${phone})
              )
          `);
        },
      );
      await this.redis.del(this.appointmentActionKey(chatId));
      await this.sendText(chatId, 'Appointment berjaya dibatalkan. Slot tersebut kini dibuka semula ');
      return true;
    }

    const wantsCancel = /\b(batal|batalkan|cancel|tak dapat hadir|tidak dapat hadir)\b/i.test(normalized);
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
        SELECT a.id, a.patient_name, a.scheduled_date, a.scheduled_time, a.treatment_ref
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        WHERE a.org_id = ${ORG_ID}
          AND a.branch_id = ${BRANCH_ID}
          AND p.org_id = ${ORG_ID}
          AND p.branch_id = ${BRANCH_ID}
          AND (p.phone = ${phone} OR p.whatsapp = ${phone})
          AND a.status IN ('booked', 'confirmed', 'checked-in', 'waiting')
          AND a.scheduled_date >= CURRENT_DATE
          AND a.deleted_at IS NULL
        ORDER BY a.scheduled_date, a.scheduled_time
        LIMIT 1
      `),
    );
    const row = (result as unknown as { rows: Array<any> }).rows[0];
    if (!row) {
      await this.sendText(chatId, 'Maaf, saya tidak jumpa appointment aktif untuk nombor ini. ');
      return true;
    }

    await this.redis.set(this.appointmentActionKey(chatId), String(row.id), 'EX', 600);
    await this.sendText(
      chatId,
      `Betul nak batalkan appointment ${row.patient_name} pada ${String(row.scheduled_date).slice(0, 10)} pukul ${String(row.scheduled_time).slice(0, 5)}? Balas Ya untuk sahkan.`,
    );
    return true;
  }

  private async getBookingMemory(chatId: string): Promise<BookingMemory | null> {
    if (!this.redis) return null;
    try {
      const value = await this.redis.get(this.bookingKey(chatId));
      return value ? JSON.parse(value) as BookingMemory : null;
    } catch (e) {
      this.logger.error('Gagal baca sesi booking Redis: ' + (e as Error).message);
      return null;
    }
  }

  private async setBookingMemory(chatId: string, value: BookingMemory): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(this.bookingKey(chatId), JSON.stringify(value), 'EX', 86400);
    } catch (e) {
      this.logger.error('Gagal simpan sesi booking Redis: ' + (e as Error).message);
    }
  }

  private async deleteBookingMemory(chatId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.bookingKey(chatId));
    } catch (e) {
      this.logger.error('Gagal padam sesi booking Redis: ' + (e as Error).message);
    }
  }

  private getBookingSlots(date: string): string[] {
    const day = new Date(`${date}T00:00:00`).getDay();
    const closingHour = day === 5 || day === 6 ? 17 : 21;
    const slots: string[] = [];

    for (
      let minutes = 10 * 60;
      minutes < closingHour * 60;
      minutes += 30
    ) {
      if (
        minutes >= 13 * 60 &&
        minutes < 14 * 60
      ) {
        continue;
      }

      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      slots.push(
        `${String(hour).padStart(2, '0')}:${String(
          minute,
        ).padStart(2, '0')}`,
      );
    }

    return slots;
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



