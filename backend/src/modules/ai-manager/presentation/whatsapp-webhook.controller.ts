import { Body, Controller, Post, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../../../core/auth/decorators';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { WhatsappPromptService } from '../application/whatsapp-prompt.service';
import { WhatsappPromptSlotsService } from '../application/whatsapp-prompt-slots.service';
import { AiWhatsappSettingsService } from '../application/ai-whatsapp-settings.service';
import { DbContextService, SYSTEM_WORKER_PRINCIPAL } from '../../../core/auth/db-context.service';
import {
  WaReplyQueueService,
  DEFAULT_REPLY_QUEUE_CONFIG,
} from '../../whatsapp/application/reply-queue.service';
import { WaBranchResolverService } from '../../whatsapp/application/wa-branch-resolver.service';
import { WahaAdapter } from '../../whatsapp/infrastructure/waha.adapter';
import { NotificationService } from '../../whatsapp/application/notification.service';
import { findFreeSlots, parseTime, type DoctorShift, type BusyBlock } from '../domain/slot-finder';
import { formatSlotContext } from '../domain/slot-context';
import { resolveMentionedDate } from '../domain/mentioned-date';
import { preferredDoctor, realVisits, preferenceLine, matchDoctorName, cleanDoctorName, type Visit } from '../domain/doctor-continuity';
import { planTyping, planPostSendPause } from '../domain/typing-pacing';
import { splitReply } from '../domain/reply-split';
import { evaluateReplyCaps, HOURLY_HOLD_MS } from '../domain/reply-caps';
import {
  canAiReply,
  canAiCreateBooking,
  shouldFlagForHuman,
  type AiHoldReason,
} from '../../whatsapp/domain/ai-control';
import { AiPolicyPort } from '../../../shared/ports/ai-policy.port';
import {
  WaOptOutService,
  detectStopRequest,
  STOP_CONFIRMATION,
} from '../../whatsapp/application/wa-opt-out.service';
import { OrgAllocator } from '../../../shared/allocators/org-allocator';
import { AuditService } from '../../../shared/audit/audit.service';
import { doctorHolidays } from '../../../infrastructure/database/schema';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * Branch scope for one inbound message.
 *
 * Previously a module-level `BRANCH_ID` constant pinned every message to a
 * single hard-coded branch — one that no longer exists in the database. With one
 * WhatsApp number per branch, the session name WAHA sends with each webhook is
 * the only correct way to know which clinic a patient is talking to, so the
 * resolved branch travels with the message instead of being read from a constant.
 */
interface WaScope {
  orgId: string;
  branchId: string;
  branchName: string;
  /** WAHA session that received the message — replies must go back out on it. */
  sessionName: string;
}

/**
 * Raw WAHA webhook payload.
 *
 * Only the fields this controller reads are described; everything arrives from
 * an external service and is treated as untrusted, so each value stays `unknown`
 * until it is converted at the point of use.
 */
interface WahaWebhookPayload {
  from?: unknown;
  chatId?: unknown;
  text?: unknown;
  body?: unknown;
  fromMe?: unknown;
  id?: unknown;
  _data?: {
    key?: {
      id?: unknown;
      remoteJidAlt?: unknown;
    };
  };
}

/** The envelope WAHA posts to the webhook. */
interface WahaWebhookBody {
  event?: unknown;
  session?: unknown;
  payload?: WahaWebhookPayload;
}

/** Shape returned by the booking extractor after the model's JSON is parsed. */
interface BookingExtract {
  is_booking?: boolean;
  name?: string;
  date?: string;
  time?: string;
  treatment?: string;
  branch?: string;
  doctor?: string;
}

/**
 * Where to reach WAHA.
 *
 * Runtime configuration wins; the fallback is the WAHA service on the shared
 * docker network. The previous default pointed at a decommissioned Railway
 * instance (`waha-production-f5bc.up.railway.app`), which no longer resolves —
 * every presence/send call then failed with EAI_AGAIN, so STOP acknowledgements
 * and "sedang menaip…" silently never happened while everything looked wired.
 *
 * `WAHA_BASE_URL` is the name used by the adapter and docker-compose; accept both
 * so a single service cannot be configured under two different keys.
 */
const WAHA_URL = (
  process.env.WAHA_URL
  ?? process.env.WAHA_BASE_URL
  ?? 'http://waha-medini:3000'
).replace(/\/$/, '');

const WAHA_API_KEY = process.env.WAHA_API_KEY ?? '';
const WAHA_SESSION = process.env.WAHA_SESSION ?? 'default';

/**
 * Emergency line quoted to patients by Nur.
 *
 * EMPTY on purpose: the clinic has not supplied a number yet. When empty, the
 * prompt escalates to a human instead of printing a placeholder — a patient who
 * is bleeding must never be told to call "[NOMBOR KECEMASAN]". The model copies
 * whatever this string says, verbatim, into the reply, so never put a bracketed
 * placeholder here. Fill it in when the clinic provides the line.
 */
export const NUR_EMERGENCY_PHONE = '';

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

export function nurPrompt(): string {
  /* Empty NUR_EMERGENCY_PHONE must change the instruction, not just the number:
   * a placeholder printed to a patient mid-emergency is worse than no number. */
  const emergencyLine = NUR_EMERGENCY_PHONE
    ? `- Beri nombor kecemasan klinik ini: ${NUR_EMERGENCY_PHONE}.`
    : '- Jangan beri sebarang nombor telefon. Beritahu pelanggan bahawa pihak klinik akan dihubungi segera dan staf akan menghubungi semula.';

  return `
Awak ialah Nur, pembantu WhatsApp Klinik Pergigian Medini.
Nama cawangan anda diberitahu dalam KONTEKS BOOKING di bawah — gunakan itu.
Jangan sebut cawangan lain, dan jangan andaikan cawangan anda.

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

APABILA MASA YANG DIMINTA PENUH:
- Jangan sekali-kali meminta pelanggan meneka masa sendiri
  (jangan kata "sila pilih masa lain" sahaja).
- Sistem akan berikan senarai masa yang KOSONG. Tawarkan maksimum 2 pilihan
  daripada senarai itu, sebut masa DAN nama doktor bagi setiap satu.
- Pelanggan biasanya tidak kisah doktor mana — jika dia tidak sebut nama
  doktor, jangan paksa dia memilih doktor.
- Jika dia minta doktor tertentu, tawarkan masa doktor itu sahaja.
- Setelah pelanggan pilih satu, ulang pilihan itu dan mintakan pengesahan.
- Jika senarai masa kosong atau tiada, tawarkan tarikh lain — bukan masa rekaan.

DOKTOR TETAP:
- Jika konteks menyebut doktor terdahulu pelanggan, tanya dengan sopan sama ada
  dia mahu doktor yang sama. Bertanya sekali sahaja; jangan desak.
- Jika dia tidak kisah, teruskan dengan mana-mana doktor yang ada slot.

KESELAMATAN — KECEMASAN:
- Jika pelanggan menyebut pendarahan yang tidak berhenti, bengkak teruk pada
  muka atau leher, sakit tidak tertahan, gigi tertanggal kerana kemalangan,
  atau sukar bernafas atau menelan — anggap ini kecemasan.
- Minta dia datang ke klinik dengan segera.
${emergencyLine}
- JANGAN beri nasihat klinikal, ubat, dos atau rawatan sendiri.
- JANGAN teruskan proses booking biasa dalam kes ini.

PENGESAHAN IDENTITI:
- Sebelum berkongsi apa-apa maklumat perubatan atau rekod pesakit —
  contohnya senarai rawatan lepas, diagnosis atau butiran temujanji lama —
  minta dua perkara: nombor ID pesakit ATAU tarikh lahir, dan nombor telefon
  yang berdaftar dengan klinik.
- Selepas pelanggan memberi maklumat itu, maklumkan bahawa staf akan
  mengesahkannya dahulu sebelum butiran dikongsi.
- Peraturan ini TIDAK menghalang booking biasa. Untuk membuat atau menukar
  temujanji, teruskan seperti biasa.
- Jangan sekali-kali mendedahkan rekod pesakit lain, walaupun diminta.

DI LUAR WAKTU OPERASI:
- Jika pelanggan menghubungi di luar waktu operasi di atas, atau pada hari
  klinik bercuti, jangan tawarkan slot pada waktu itu.
- Sebaliknya: ambil mesejnya dengan sopan — nama, nombor telefon dan perkara
  yang dia mahu.
- Beritahu bahawa staf akan menghubungi semula pada hari bekerja berikutnya.
- Jangan janjikan masa yang tepat untuk panggilan balik itu.

PERATURAN:
- Fahami 10 pagi sebagai 10:00, 10.30 pagi sebagai 10:30,
  2 petang sebagai 14:00 dan 6 malam sebagai 18:00.
- Jika maklumat belum lengkap, tanya satu perkara yang masih kosong.
- Jadual doktor, cuti dan ketersediaan mesti disahkan oleh sistem.
- Jangan reka slot kosong, nama doktor, atau nombor telefon.
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
  "doctor": "",
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
- doctor: isi HANYA jika pelanggan menyebut nama doktor (contoh "Dr. Siti",
  "nak doktor yang sama", "tak kisah doktor"). Untuk "tak kisah" atau
  "doktor mana-mana", biarkan kosong. Jangan reka nama doktor.
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
- Jangan isi cawangan. Sistem tahu cawangan ini sendiri; biarkan kosong.
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
  /* FASA 6B — the doctor the patient asked for BY NAME, when they named one.
   * Kept so the slot search can honour it: offering another doctor after the
   * patient said "nak Dr. Siti" ignores what they just told us. */
  doctorId?: string;
  doctorName?: string;
};

@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappWebhookController {
  private readonly logger = new Logger('WhatsappWebhook');
  private readonly redis: IORedis | null;
  /** Anti-ban reply engine — collects bursts, answers once, one line out. */
  private readonly replies: WaReplyQueueService;

  constructor(
    private readonly minimax: MinimaxAdapter,
    private readonly dbCtx: DbContextService,
    private readonly whatsappPrompt: WhatsappPromptService,
    private readonly promptSlots: WhatsappPromptSlotsService,
    private readonly aiSettings: AiWhatsappSettingsService,
    private readonly audit: AuditService,
    private readonly branchResolver: WaBranchResolverService,
    /* STOP list — a patient's opt-out must stop every future blast. */
    private readonly optOuts: WaOptOutService,
    /* FASA 5D-B — raising an event for a human. Marking a conversation in the
     * database is not the same as telling anybody: without this, a patient who
     * needs a person waits in a list nobody is watching. */
    private readonly notifications: NotificationService,
    /* POLICY ENGINE — the AI Manager registry gates the bot. Without this the
     * Pause button in AI Manager is decorative: the UI would say "nothing it
     * proposes can run" while this pipeline keeps replying. The port is the
     * sanctioned cross-module boundary (S7 T4); it evaluates policy only and
     * never calls a model. */
    private readonly policy: AiPolicyPort,
    /* A2 — the WAHA transport, used to pre-flight a send against a dead
     * session. The adapter is a shared singleton (WhatsappModule exports it),
     * so its restart history and stuck-tracking persist across calls. */
    private readonly waha: WahaAdapter,
  ) {
    const url = process.env.REDIS_URL;

    this.redis = url
      ? new IORedis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
        })
      : null;

    /* Anti-ban reply engine. Config is read from env so an operator can tune
     * the collection window without a code change:
     *   WA_REPLY_WINDOW_MS       collect window after the first fragment (10s)
     *   WA_REPLY_MAX_WINDOW_MS   hard ceiling from the first fragment (30s)
     *   WA_REPLY_MIN_INTERVAL_MS spacing floor between replies (10s)
     *   WA_REPLY_MAX_INTERVAL_MS spacing ceiling between replies (20s)
     * Every value is clamped to a sane floor so a bad env value cannot turn the
     * queue into a flood. */
    const num = (key: string, fallback: number, floor: number) => {
      const raw = Number(process.env[key]);
      return Number.isFinite(raw) && raw >= floor ? raw : fallback;
    };
    this.replies = new WaReplyQueueService(
      {
        windowMs: num('WA_REPLY_WINDOW_MS', DEFAULT_REPLY_QUEUE_CONFIG.windowMs, 1000),
        maxWindowMs: num('WA_REPLY_MAX_WINDOW_MS', DEFAULT_REPLY_QUEUE_CONFIG.maxWindowMs, 1000),
        minIntervalMs: num('WA_REPLY_MIN_INTERVAL_MS', DEFAULT_REPLY_QUEUE_CONFIG.minIntervalMs, 0),
        maxIntervalMs: num('WA_REPLY_MAX_INTERVAL_MS', DEFAULT_REPLY_QUEUE_CONFIG.maxIntervalMs, 0),
      },
      (burst) => this.answerConversation(burst),
    );
  }

  @Public()
  @Post('webhook')
  async webhook(@Body() body: WahaWebhookBody) {
    if (body?.event !== 'message') return { ok: true };

    const payload: WahaWebhookPayload = body?.payload ?? {};
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

    /* WHICH CLINIC IS THIS?
     *
     * One WhatsApp number per branch means the session name is the identity of
     * the message. Without this step every branch shares one branch scope and a
     * patient of Setia Tropika would be answered with Bukit Indah's prompt,
     * prices and staff.
     *
     * An unmapped session is refused outright: answering as the wrong clinic is
     * worse than not answering, so nothing is saved and no reply is generated. */
    const scope = await this.resolveScope(body?.session);
    if (!scope) {
      this.logger.warn(
        `Webhook diabaikan — sesi "${body?.session ?? '(tiada)'}" tidak dipetakan kepada cawangan`,
      );
      return { ok: true };
    }

    /* IS THE AI SWITCHED OFF FOR THIS BRANCH? (FASA 5D-A)
     *
     * Checked HERE, at the moment the message arrives, not only before sending.
     * With the AI off there is no reply to produce, and it would be wasteful to
     * run the collection window, call the model and then discard the answer.
     *
     * The send-time check in `answerConversation` still exists and is not
     * redundant: the switch can be flipped during the collection window, and a
     * reply generated under the old setting must not go out under the new one.
     *
     * The message is still SAVED and the conversation flagged for a human — an
     * operator who switches the AI off is asking to answer patients themselves,
     * not asking for the messages to disappear. */
    const aiAllowedAtArrival = await this.isAiAllowed(scope, chatId);
    if (!aiAllowedAtArrival.allowed) {
      await this.holdForHuman(scope, chatId, aiAllowedAtArrival.reason ?? 'BRANCH_AI_DISABLED');
      /* Tell someone. The conversation is flagged in the database, but a flag
       * nobody is looking at is the same as no flag — this is what makes the
       * operator's bell ring. */
      await this.notifications.raise({
        orgId: scope.orgId,
        branchId: scope.branchId,
        kind: 'human_needed',
        branchName: scope.branchName ?? null,
        entityType: 'wa_conversation',
      });
      this.logger.log(
        `AI tidak menjawab (${aiAllowedAtArrival.reason}) — mesej disimpan untuk staf, cawangan ${scope.branchId}`,
      );
      return { ok: true };
    }

    /* STOP HANDLING — checked before anything else the bot might do.
     *
     * A patient asking to be left alone is not a support question: it must be
     * recorded, acknowledged, and must stop every future blast. Handled ahead of
     * the AI so the model can never reinterpret "STOP" as a booking enquiry, and
     * ahead of the queue so no reply is generated for it.
     *
     * Deliberately narrow matching (see detectStopRequest): a patient asking
     * about stopping TREATMENT must not be silently removed from reminders. */
    const stopKeyword = detectStopRequest(text);
    if (stopKeyword) {
      /* Record first, in its own try: the PATIENT'S REQUEST is the thing that
       * matters, and it must be saved even if the acknowledgement cannot be
       * sent (WAHA down, session unpaired). Lumping both into one try/catch made
       * a failed acknowledgement log "Gagal rekod permintaan STOP" — which reads
       * as "we didn't record it" when in fact the block was applied. */
      let recorded: { created: boolean } = { created: false };
      try {
        recorded = await this.optOuts.record(scope.orgId, chatId, {
          source: 'reply_stop',
          matchedKeyword: stopKeyword,
          originBranchId: scope.branchId,
        });
      } catch (error) {
        this.logError('Gagal rekod permintaan STOP (senarai mungkin tidak dikemas kini)', error);
      }

      /* Acknowledge once. A repeated STOP is common and stays quiet, so the
       * patient is not spammed by the very system they asked to stop. */
      if (recorded.created) {
        try {
          await this.sendText(scope.sessionName, chatId, STOP_CONFIRMATION);
        } catch (error) {
          this.logError('STOP direkod, tetapi pengesahan gagal dihantar', error);
        }

        /* Tell the clinic. This is a compliance fact the front desk may need to
         * act on — a patient who asked to stop may also have an appointment.
         * Raised only for a NEW opt-out: a repeat must not re-enter the list. */
        await this.notifications.raise({
          orgId: scope.orgId,
          branchId: scope.branchId,
          kind: 'opt_out',
          entityId: chatId.replace(/@.*$/, ''),
          entityType: 'wa_opt_out',
          branchName: scope.branchName ?? null,
        });
      }
      return { ok: true };
    }

    try {
      await this.saveIncomingMessage(scope, chatId, text, payload);
    } catch (error) {
      this.logError('Gagal simpan mesej WhatsApp', error);
    }

    try {
      if (await this.handleAppointmentAction(scope, chatId, text, payload)) {
        return { ok: true };
      }

      /* ANTI-BAN: never answer on arrival.
       *
       * A patient typing in bursts used to produce one AI call and one reply
       * per fragment, and simultaneous patients produced simultaneous calls.
       * Instead the fragments are COLLECTED per conversation for a short window
       * and answered ONCE, then replies leave through a single FIFO line spaced
       * by a randomised interval. Outbound volume ends up proportional to
       * QUESTIONS, not to keystrokes.
       *
       * The escalation keyword is still honoured immediately — an angry patient
       * must not wait behind a collection window. */
      const settings = await this.aiSettings.getForBot(scope.orgId, scope.branchId);
      const matched = this.matchEscalationKeyword(text, settings.escalationKeywords);

      if (matched && settings.antibanEnabled) {
        await this.escalateToHuman(scope, chatId, matched, settings.escalationReply);
        /* The patient has asked for a person. Escalation marks the conversation;
         * this is what actually reaches the operator. */
        await this.notifications.raise({
          orgId: scope.orgId,
          branchId: scope.branchId,
          kind: 'human_needed',
          branchName: scope.branchName ?? null,
          entityType: 'wa_conversation',
        });
        await this.maybeSaveBooking(scope, chatId, text, payload);
        return { ok: true };
      }

      this.replies.enqueue({
        chatId,
        text,
        branchId: scope.branchId,
        orgId: scope.orgId,
        branchName: scope.branchName,
        sessionName: scope.sessionName,
        receivedAt: Date.now(),
        /* Operator policy for this branch: how long to collect fragments, how
         * fast to answer, and whether the patient sees "sedang menaip…". */
        windowMs: settings.replyWindowSeconds * 1000,
        minIntervalMs: settings.minDelaySeconds * 1000,
        maxIntervalMs: settings.maxDelaySeconds * 1000,
        typingIndicator: settings.typingIndicatorEnabled,
      });
    } catch (error) {
      this.logError('Gagal proses auto booking', error);
    }

    return { ok: true };
  }

  /**
   * Map the WAHA session name to the branch it belongs to.
   *
   * Returns null when the session is unknown or unconfigured — the caller
   * refuses the message rather than guessing a branch.
   */
  private async resolveScope(sessionName: unknown): Promise<WaScope | null> {
    const resolved = await this.branchResolver.resolve(
      typeof sessionName === 'string' ? sessionName : null,
    );
    if (!resolved) return null;
    return {
      orgId: resolved.orgId,
      branchId: resolved.branchId,
      branchName: resolved.branchName,
      sessionName: resolved.sessionName,
    };
  }

  /**
   * Answer one conversation's coalesced burst. Called by the reply queue once
   * the collection window closes and this conversation reaches the front of the
   * FIFO line.
   */
  /**
   * FASA 5D-A — may the AI answer this conversation right now?
   *
   * Reads the three doors (branch switch, patient escalation, staff handoff) and
   * applies them through one pure rule, so no call site can check only part of it.
   *
   * Fails CLOSED on a database error: if the branch's setting cannot be read, the
   * AI stays quiet and the message is held for a human. Answering when we cannot
   * confirm the operator wants us to is the worse mistake — a clinic that has
   * switched the AI off must not have it speak because a query timed out.
   */
  private async isAiAllowed(
    scope: WaScope,
    chatId: string,
  ): Promise<{ allowed: boolean; reason: AiHoldReason | null }> {
    try {
      /* Read through getForBot(), NOT get().
       *
       * `get()` runs the OPERATOR permission guard in resolveBranch()
       * (hq / branch_manager only) and throws for every other role. The webhook
       * runs as a SYSTEM WORKER — no human, no role — so calling get() made the
       * guard throw on EVERY inbound message, which was caught below, turned
       * into BRANCH_AI_DISABLED, and returned EARLY: the message was never
       * saved. The entire inbound path was dead (wa_messages stayed empty).
       *
       * getForBot() reads the same row through runAsWorker() with no permission
       * guard, which is the correct identity for background code — the same
       * pattern every other scoped worker read already uses. */
      const settings = await this.aiSettings.getForBot(scope.orgId, scope.branchId);

      /* POLICY ENGINE — the registry gate (AI Manager → Agents).
       *
       * ai-receptionist must be `enabled` AND its whatsapp EXECUTE
       * must evaluate AUTO for the reply to go out. Anything else — paused,
       * archived, capability revoked, guardrail HARD_BLOCK, fail-closed
       * APPROVAL_REQUIRED — holds the conversation for a human with
       * AGENT_PAUSED. This is what makes the Pause button real: the AI Manager
       * states "a paused agent cannot run anything it proposes", and this check
       * is that statement on the reply pipeline.
       *
       * A policy-lookup ERROR also holds (fail-closed), matching the existing
       * rule below: answering when we cannot confirm the operator wants us to
       * is the worse mistake. */
      let agentEnabled = true;
      try {
        const workerPrincipal = {
          ...SYSTEM_WORKER_PRINCIPAL, orgId: scope.orgId, branchId: scope.branchId,
        } as never;
        /* evaluate() rather than canAutoExecute(): the DECISION matters now.
         * APPROVAL_REQUIRED is not the same as BLOCKED — it means a human should
         * decide — and the two were indistinguishable once collapsed to a
         * boolean. */
        const verdict = await this.policy.evaluate(workerPrincipal, {
          agentKey: 'ai-receptionist',
          domain: 'whatsapp',
          capability: 'EXECUTE',
          actionKey: 'wa.reply_patient',
        });
        agentEnabled = verdict.decision === 'AUTO';

        /* A3b — file the held action. Before this, an APPROVAL_REQUIRED verdict
         * collapsed into the boolean above and the request VANISHED: the reply
         * was withheld and nothing recorded what a human was ever asked to
         * approve. Recording it is best-effort on purpose — if the queue write
         * fails, the reply must STILL be withheld (the hold is decided; only its
         * audit is missing), so this failure never flips agentEnabled back. */
        if (verdict.decision === 'APPROVAL_REQUIRED') {
          try {
            await this.policy.recordApproval(workerPrincipal, {
              agentKey: 'ai-receptionist',
              domain: 'whatsapp',
              actionKey: 'wa.reply_patient',
              reason: verdict.reason,
              payload: { chatId, held: 'AI reply awaiting human approval' },
            });
          } catch (recordError) {
            this.logger.error(
              `Gagal rekod permintaan kelulusan: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Gagal semak polisi agen: ${error instanceof Error ? error.message : String(error)} — AI tidak menjawab`,
        );
        agentEnabled = false;
      }

      const phone = chatId.replace(/@.*$/, '');

      const row = await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-ai-control',
          source: 'system_worker',
        },
        async (tx) => {
          const result = await tx.execute(sql`
            SELECT needs_human, ai_queue_state, status
            FROM wa_conversations
            WHERE org_id = ${scope.orgId}
              AND branch_id = ${scope.branchId}
              AND contact_phone = ${phone}
              AND deleted_at IS NULL
            LIMIT 1
          `);
          return (result as { rows?: Array<{ needs_human?: unknown; ai_queue_state?: string | null; status?: string | null }> }).rows?.[0] ?? null;
        },
      );

      return canAiReply({
        branchAiEnabled: settings.aiEnabled,
        agentEnabled,
        needsHuman: Boolean(row?.needs_human),
        aiQueueState: row?.ai_queue_state ?? null,
        status: row?.status ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Gagal semak suis AI: ${error instanceof Error ? error.message : String(error)} — AI tidak menjawab`,
      );
      return { allowed: false, reason: 'BRANCH_AI_DISABLED' };
    }
  }

  /**
   * FASA 5D-A — surface a conversation for a human when the AI is held.
   *
   * Does NOT overwrite an existing escalation: `needs_human_at` records when the
   * patient first needed a person, and that timestamp is what the SLA measures.
   * Rewriting it on every inbound message would make a patient who has waited an
   * hour look like they just arrived.
   */
  private async holdForHuman(
    scope: WaScope,
    chatId: string,
    reason: AiHoldReason,
  ): Promise<void> {
    if (!shouldFlagForHuman(reason)) return;

    const phone = chatId.replace(/@.*$/, '');
    try {
      await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-ai-hold',
          source: 'system_worker',
        },
        async (tx) => {
          await tx.execute(sql`
            UPDATE wa_conversations
            SET needs_human = 1,
                needs_human_reason = ${reason.slice(0, 64)},
                needs_human_at = COALESCE(needs_human_at, NOW(6)),
                updated_at = NOW(6)
            WHERE org_id = ${scope.orgId}
              AND branch_id = ${scope.branchId}
              AND contact_phone = ${phone}
              AND deleted_at IS NULL
          `);
        },
      );
    } catch (error) {
      this.logger.error(
        `Gagal tandakan perbualan untuk staf: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * AB2 — count this branch's outbound AI replies (today, last hour) from
   * wa_messages and apply the domain policy. Returns 'allow' | 'escalate'
   * | 'held'; escalation (message + notification + thread flag) happens
   * here so the caller only has to stop.
   *
   * sentToday counts only sender_type='ai' replies — staff messages are a
   * human's own pacing and are not the bot's budget to spend.
   */
  private async checkReplyCaps(
    scope: WaScope,
    chatId: string,
  ): Promise<'allow' | 'escalate' | 'held'> {
    try {
      const settings = await this.aiSettings.getForBot(scope.orgId, scope.branchId);

      /* Count with the caller's transaction-less helper: two small SELECTs
       * against wa_messages, branch-scoped, indexed on (org,branch,created). */
      const rows = await this.countOutboundReplies(scope);
      const verdict = evaluateReplyCaps(
        {
          dailyMessageCap: settings.dailyMessageCap,
          hourlyMessageCap: settings.hourlyMessageCap,
          warmupDays: settings.warmupDays,
          warmupDailyCap: settings.warmupDailyCap,
          daysActive: await this.branchDaysActive(scope),
        },
        rows,
      );

      if (verdict.decision === 'ALLOW') return 'allow';

      if (verdict.decision === 'HOLD') {
        this.logger.warn(
          `Cap jam tercapai (${rows.sentLastHour}/${settings.hourlyMessageCap}) branch=${scope.branchId} — tahan ${HOURLY_HOLD_MS / 1000}s`,
        );
        return 'held';
      }

      /* ESCALATE — tell the patient once, flag the thread, notify staff. */
      this.logger.warn(
        `Cap harian tercapai (${verdict.reason}) branch=${scope.branchId} chatId=${chatId} — eskalasi ke manusia`,
      );
      await this.escalateToHuman(
        scope,
        chatId,
        'reply-cap',
        'Maaf, saya terhad buat seketika. Pasukan klinik akan membalas tidak lama lagi. 🙏',
      );
      await this.notifications.raise({
        orgId: scope.orgId,
        branchId: scope.branchId,
        kind: 'human_needed',
        branchName: scope.branchName ?? null,
        entityType: 'wa_conversation',
      });
      return 'escalate';
    } catch (error) {
      /* Fail-OPEN deliberately and unlike the blast guard: refusing every
       * reply because the counter read failed turns a metrics hiccup into a
       * full bot outage; the pacing (AB1) and the queue still bound volume
       * shape. Loudly logged. */
      this.logError('Gagal semak cap balasan AI — hantar tanpa cap', error);
      return 'allow';
    }
  }

  /** Outbound AI reply counts for the cap policy. */
  private async countOutboundReplies(scope: WaScope): Promise<{
    sentToday: number;
    sentLastHour: number;
  }> {
    const row = await this.dbCtx.runAsWorker(
      {
        orgId: scope.orgId,
        branchIds: [scope.branchId],
        correlationId: 'wa-reply-caps',
        source: 'system_worker',
      },
      async (tx) => {
        const result = await tx.execute(sql`
          SELECT
            SUM(CASE WHEN created_at >= DATE(NOW()) THEN 1 ELSE 0 END) AS sent_today,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL 1 HOUR THEN 1 ELSE 0 END) AS sent_hour
          FROM wa_messages
          WHERE org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
            AND direction = 'out'
            AND sender_type = 'ai'
            AND status IN ('sent', 'delivered', 'read')
        `);
        return (result as { rows?: Array<{ sent_today?: number | string | null; sent_hour?: number | string | null }> }).rows?.[0] ?? null;
      },
    );
    return {
      sentToday: Number(row?.sent_today ?? 0),
      sentLastHour: Number(row?.sent_hour ?? 0),
    };
  }

  /** Age of the branch's WhatsApp number in whole days (for warm-up). */
  private async branchDaysActive(scope: WaScope): Promise<number> {
    try {
      const row = await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-reply-caps',
          source: 'system_worker',
        },
        async (tx) => {
          const result = await tx.execute(sql`
            SELECT DATEDIFF(NOW(), MIN(created_at)) AS days
            FROM wa_messages
            WHERE org_id = ${scope.orgId} AND branch_id = ${scope.branchId}
          `);
          return (result as { rows?: Array<{ days?: number | string | null }> }).rows?.[0] ?? null;
        },
      );
      /* A branch with no history yet is brand new — full warm-up applies. */
      return Number(row?.days ?? 0);
    } catch {
      return 0;
    }
  }

  private async answerConversation(burst: {
    branchName: string;
    sessionName: string;
    chatId: string;
    branchId: string;
    orgId: string;
    text: string;
    typingIndicator: boolean;
  }): Promise<void> {
    const { chatId, text, typingIndicator } = burst;

    /* SECOND CHECK — the switch may have been flipped while this conversation sat
     * in the collection window or the FIFO queue (up to 30 seconds, and longer
     * behind other conversations). A reply generated under the old setting must
     * not go out under the new one: an operator switching the AI off is saying
     * "that answer should not be sent", and cancelling here is the only way to
     * honour that.
     *
     * Placed before the model call so a wasted request is avoided too, but the
     * authority is this check, not the one at arrival. */
    const stillAllowed = await this.isAiAllowed(
      { orgId: burst.orgId, branchId: burst.branchId, branchName: burst.branchName, sessionName: burst.sessionName },
      chatId,
    );
    if (!stillAllowed.allowed) {
      this.logger.log(
        `Balasan AI dibatalkan (${stillAllowed.reason}) chatId=${chatId} — suis berubah semasa menunggu`,
      );
      return;
    }

    /* AB2 — reply caps. The anti-ban panel has always promised caps; only the
     * blast path obeyed them. The reply path counted nothing, so a busy day
     * or a webhook storm could blow past every limit invisibly — and daily
     * outbound volume is what WhatsApp's ban heuristics weigh most.
     *
     * DAILY/WARM-UP ceilings ESCALATE instead of sending: a patient
     * mid-conversation must never be silently dropped. The HOURLY ceiling
     * is congestion, not exhaustion — hold briefly and re-check rather
     * than spending the branch's day-budget in one hour. One hold only:
     * if the cap is still hit afterwards, escalate honestly. */
    /* Branch context for this conversation, carried through the queue so a reply
     * is produced with the right clinic's prompt, prices and staff. */
    const burstScope: WaScope = {
      orgId: burst.orgId,
      branchId: burst.branchId,
      branchName: burst.branchName,
      sessionName: burst.sessionName,
    };

    const capVerdict = await this.checkReplyCaps(burstScope, chatId);
    if (capVerdict === 'escalate') {
      return;
    }
    if (capVerdict === 'held') {
      await new Promise((r) => setTimeout(r, HOURLY_HOLD_MS));
      const recheck = await this.checkReplyCaps(burstScope, chatId);
      if (recheck !== 'allow') {
        return; /* escalated by the re-check itself */
      }
    }

    try {
      const previous = await this.getBookingMemory(chatId);
      const remembered = await this.getSalutation(burstScope, chatId);
      const explicit = this.explicitSalutation(text);
      const salutation = explicit || remembered || previous?.salutation || '';

      /* FASA 6B — the doctor this patient usually sees.
       *
       * Given to the AI as a FACT, not a hint. Without it the AI either ignores
       * continuity or invents a doctor, and both are wrong: a returning patient
       * asked "nak jumpa siapa?" when the clinic already knows makes the clinic
       * look like a stranger. */
      const knownDoctor = await this.findPreviousDoctor(burstScope, chatId);

      if (explicit) {
        await this.setSalutation(burstScope, chatId, explicit);
      }

      /* SLOT VISIBILITY — the date in play for THIS reply.
       *
       * Primary source: accumulated booking memory (the extraction step runs
       * after every reply, so turn N already knows the date the patient gave
       * in turn N-1). Turn-1 fallback: a fail-closed mention scan of THIS
       * message — resolveMentionedDate returns null for anything ambiguous,
       * so a non-booking message ("berapa harga?") pays no schedule query. */
      let slotDate = previous?.date ?? null;
      if (!slotDate) {
        slotDate = resolveMentionedDate(text, malaysiaDate());
      }
      const slotContext = slotDate
        ? await this.freeSlotsContext(burstScope, slotDate, previous?.doctorId)
        : '';

      const context =
        `
KONTEKS BOOKING:
${JSON.stringify(previous ?? {})}` +
        `
GELARAN PELANGGAN: ${salutation || 'belum diketahui; gunakan anda'}` +
        (knownDoctor
          ? `\n${knownDoctor.line} Tanya sama ada pelanggan mahu doktor ini lagi atau doktor lain.` +
            ' Jika pelanggan kata doktor ini, sistem akan cari slot doktor itu sahaja.'
          : '\nPELANGGAN: tiada rekod doktor terdahulu (pesakit baru atau nombor baharu).' +
            ' Jangan sebut nama doktor; teruskan dengan tarikh dan masa.') +
        /* One number per branch means the patient must be told WHICH clinic
         * they reached — the prompt cannot hard-code a branch name any more. */
        `
CAWANGAN ANDA: Klinik Pergigian Medini ${burst.branchName}.` +
        ' Jika pelanggan bertanya klinik mana, jawab dengan nama cawangan ini sahaja.' +
        slotContext;

      const reply = await this.minimax.chat(
        (
          (await this.promptSlots.getActiveForBot(burstScope.orgId, burstScope.branchId))
          ?? (await this.whatsappPrompt.getForBot(burstScope.orgId, burstScope.branchId))
          ?? nurPrompt()
        ) +
        `\nTARIKH SISTEM HARI INI: ${malaysiaDate()}` +
        '\nZon waktu: Asia/Kuala_Lumpur.' +
        '\nPengesahan booking dan nama doktor mesti datang daripada sistem. Jangan reka keputusan semakan slot.' +
        context,
        text,
      );

      /* "Sedang menaip…" for a duration PROPORTIONAL to the reply (AB1): a
       * two-line reply types ~7s, a five-paragraph one ~20s, never below 4s,
       * never above 25s, jittered so identical replies never pace identically.
       * A flat 5–10s regardless of length was a machine signature — no one
       * types 400 characters in five seconds. Presence is best-effort: if the
       * operator disabled it, or WAHA rejects the call, the reply still goes
       * out — but the pause is kept EITHER WAY, because the pause itself (not
         just the indicator) is what shapes the cadence WhatsApp can observe. */
      /* AB4 — blue ticks BEFORE typing: the patient watched their message
       * go unread for the whole queue window; showing it read at the
       * moment work begins is the human sequence (read → type → answer). */
      await this.markSeen(burstScope.sessionName, chatId);

      /* AB3 — a human sends a long answer as several messages, not one
       * wall of text. Split at paragraph/sentence boundaries (never
       * mid-word), cap at 4 parts, fold one-word orphans. Each part gets
       * its own proportional typing duration and a post-send pause, so a
       * 3-part reply reads like a person typing thrice — not a machine
       * gunning three bubbles in one second. */
      const { parts } = splitReply(reply);

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const plan = planTyping(part);

        if (typingIndicator) {
          await this.setPresence(burstScope.sessionName, chatId, 'typing');
        }
        await new Promise((r) => setTimeout(r, plan.typingMs));
        if (typingIndicator) {
          await this.setPresence(burstScope.sessionName, chatId, 'paused');
        }

        await this.sendText(burstScope.sessionName, chatId, part);

        /* Post-send pause (AB1): a human reads what they just sent before
         * the next action. Chained sends with zero gap broadcast the bot
         * even when every individual send was paced. 1.5–3.5s, jittered. */
        await new Promise((r) => setTimeout(r, planPostSendPause()));
      }
      /* resolvePhone() falls back to parsing chatId when the raw WAHA payload is
       * absent, so an empty object here is correct — the burst carries no
       * transport payload, only the collected text. */
      await this.maybeSaveBooking(burstScope, chatId, text, {});
    } catch (error) {
      this.logError('Gagal balas WhatsApp', error);
    }
  }

  private logError(message: string, error: unknown) {
    const err = error as { message?: string; cause?: { message?: string; code?: string; constraint?: string; table?: string } };

    this.logger.error({
      message,
      errorMessage: err?.message ?? String(error),
      causeMessage: err?.cause?.message,
      code: err?.cause?.code,
      constraint: err?.cause?.constraint,
      table: err?.cause?.table,
    });
  }

  /** First escalation keyword present in the message, or null. */
  private matchEscalationKeyword(text: string, keywords: string[]): string | null {
    if (!text) return null;
    const haystack = text.toLowerCase();
    for (const k of keywords) {
      if (k && haystack.includes(k)) return k;
    }
    return null;
  }

  /**
   * Hands the conversation to a human: replies once with the configured holding
   * message and flags the thread so it surfaces in the operator's
   * "perlu reply manual" queue. Best-effort — a failure here must not break the
   * webhook, so errors are logged and swallowed.
   */
  private async escalateToHuman(
    scope: WaScope,
    chatId: string,
    reason: string,
    reply: string,
  ): Promise<void> {
    try {
      await this.sendText(scope.sessionName, chatId, reply);
    } catch (error) {
      this.logError('Gagal hantar mesej eskalasi', error);
    }

    try {
      await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-escalate',
          source: 'system_worker',
        },
        async (tx) => {
          await tx.execute(sql`
            UPDATE wa_conversations
            SET needs_human = 1,
                needs_human_reason = ${reason.slice(0, 64)},
                needs_human_at = NOW(6),
                status = 'escalated',
                updated_at = NOW(6)
            WHERE org_id = ${scope.orgId}
              AND branch_id = ${scope.branchId}
              AND contact_phone = ${chatId.replace(/@.*$/, '')}
              AND deleted_at IS NULL
          `);
        },
      );
    } catch (error) {
      this.logError('Gagal tandakan perbualan untuk tindakan manusia', error);
    }
  }

  /**
   * Persist each inbound fragment so the WhatsApp Hub transcript stays complete.
   *
   * LOUD ON MISCONFIGURATION. The previous version silently `return`ed whenever
   * it could not resolve a channel, which made every inbound message vanish with
   * no trace — wa_messages stayed empty while the bot still appeared to work.
   * A missing channel now raises, and the caller logs it, so the failure is
   * visible instead of invisible.
   */
  private async saveIncomingMessage(
    scope: WaScope,
    chatId: string,
    text: string,
    payload: WahaWebhookPayload,
  ) {
    const phone = await this.resolvePhone(chatId, payload);
    const messageKey = String(
      payload?.id ??
      payload?._data?.key?.id ??
      `${chatId}:${Date.now()}`,
    );

    await this.dbCtx.runAsWorker(
      {
        orgId: scope.orgId,
        branchIds: [scope.branchId],
        correlationId: 'wa-incoming-message',
        source: 'system_worker',
      },
      async (tx) => {
        /* Find THIS branch's channel — not a named one.
         *
         * The session name used to be hard-coded to 'setia-tropika', so even
         * after routing was fixed only that one branch could ever store a
         * message; every other branch threw "no channel" and dropped the
         * patient's message. Scoping by branch_id (already resolved from the
         * session) is what makes the fix work for all fourteen branches. Any
         * active channel for this branch will do — the branch is the identity. */
        const channels = await tx.execute(sql`
          SELECT id
          FROM wa_channels
          WHERE org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
            AND deleted_at IS NULL
          ORDER BY (status = 'working') DESC, created_at ASC
          LIMIT 1
        `);

        const channelId = (channels as { rows?: Array<{ id?: string }> }).rows?.[0]?.id;
        if (!channelId) {
          /* No channel row for this branch — nothing to attach the message to.
           * Raise so the gap is loud; the caller records it. */
          throw new Error(
            `Channel WhatsApp tiada untuk branch ${scope.branchId}. ` +
              'Daftarkan channel di WhatsApp Hub sebelum bot boleh menyimpan mesej masuk.',
          );
        }

        const conversations = await tx.execute(sql`
          SELECT id
          FROM wa_conversations
          WHERE org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
            AND channel_id = ${channelId}
            AND contact_phone = ${phone}
            AND deleted_at IS NULL
          LIMIT 1
        `);

        let conversationId = (conversations as { rows?: Array<{ id?: string }> }).rows?.[0]?.id;

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
                ${conversationId}, ${scope.orgId}, ${scope.branchId}, ${channelId},
                ${phone}, 'open', 0
              )
          `);
        }

        if (!conversationId) return;

        const duplicate = await tx.execute(sql`
          SELECT id
          FROM wa_messages
          WHERE org_id = ${scope.orgId}
            AND conversation_id = ${conversationId}
            AND idempotency_key = ${messageKey}
            AND deleted_at IS NULL
          LIMIT 1
        `);

        if ((duplicate as { rows?: unknown[] }).rows?.length) return;

        await tx.execute(sql`
          INSERT INTO wa_messages
            (
              id, org_id, branch_id, channel_id, conversation_id,
              direction, sender_type, body, status, idempotency_key
            )
          VALUES
            (
              ${randomUUID()}, ${scope.orgId}, ${scope.branchId}, ${channelId}, ${conversationId},
              'in', 'patient', ${text}, 'delivered', ${messageKey}
            )
        `);

        await tx.execute(sql`
          UPDATE wa_conversations
          SET unread_count = unread_count + 1,
              last_message_at = NOW(),
              updated_at = NOW()
          WHERE id = ${conversationId}
            AND org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
        `);
      },
    );
  }

  private async resolvePhone(
    chatId: string,
    payload: WahaWebhookPayload,
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

  /**
   * FASA 6B — turn a doctor's NAME from a conversation into a real id.
   *
   * Patients write "Dr Siti", "doktor siti", "Dr. Siti Nurhaliza". The match is
   * deliberately forgiving about the title and spacing, and deliberately strict
   * about the result: it must identify exactly ONE doctor in this branch. Two
   * candidates means we do not know who was meant, and guessing would book the
   * patient with a stranger — worse than asking again.
   */
  private async resolveDoctorByName(
    scope: WaScope,
    raw: string,
  ): Promise<{ doctorId: string; doctorName: string } | null> {
    /* Cheap guard against a query for a one-letter fragment; the real matching
     * (and the "exactly one" rule) is matchDoctorName in the domain. */
    if (cleanDoctorName(raw).length < 2) return null;

    try {
      const rows = await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-doctor-resolve',
          source: 'system_worker',
        },
        async (tx) => {
          const result = await tx.execute(sql`
            SELECT s.id AS doctorId, s.name AS doctorName
            FROM staff s
            WHERE s.org_id = ${scope.orgId}
              AND s.branch_id = ${scope.branchId}
              AND s.role = 'doctor'
              AND s.status = 'Active'
              AND s.deleted_at IS NULL
          `);
          const rows = (result as { rows?: Array<{ doctorId: string; doctorName: string }> }).rows ?? [];
          return rows;
        },
      );

      /* Matching lives in the domain (matchDoctorName) so the "exactly one, or
       * ask again" rule is unit-tested rather than trusted. Here we only fetch
       * the candidates; the decision is the domain's. */
      const match = matchDoctorName(
        rows.map((r) => ({ doctorId: r.doctorId, doctorName: r.doctorName })),
        raw,
      );

      if (!match) return null;
      return { doctorId: match.doctorId, doctorName: match.doctorName };
    } catch (e) {
      this.logError('Gagal padan nama doktor', e);
      return null;
    }
  }

  /**
   * FASA 6B — the doctor this patient usually sees, if there is one.
   *
   * Returns null for a new patient, for a patient whose history we cannot read,
   * and when the query fails. All three mean the same thing to the caller: do not
   * mention a doctor. Guessing would be worse than silence — greeting someone
   * with the wrong dentist's name is precisely the small wrongness that makes a
   * clinic look like it does not know its own patients.
   *
   * Cancelled and no-show appointments are excluded: they are records that the
   * patient did NOT see that doctor.
   */
  private async findPreviousDoctor(
    scope: WaScope,
    phone: string,
  ): Promise<{ doctorId: string; doctorName: string; line: string } | null> {
    try {
      const rows = await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-doctor-continuity',
          source: 'system_worker',
        },
        async (tx) => {
          const result = await tx.execute(sql`
            SELECT a.doctor_id AS doctorId, s.name AS doctorName,
                   DATE_FORMAT(a.scheduled_date, '%Y-%m-%d') AS date,
                   a.status AS status
            FROM appointments a
            JOIN patients p ON p.id = a.patient_id
            LEFT JOIN staff s ON s.id = a.doctor_id
            WHERE a.org_id = ${scope.orgId}
              AND a.branch_id = ${scope.branchId}
              AND a.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND (p.phone = ${phone} OR p.whatsapp = ${phone})
            ORDER BY a.scheduled_date DESC
            LIMIT 50
          `);
          const rows = (result as { rows?: Array<Visit & { status?: string | null }> }).rows ?? [];
          return rows;
        },
      );

      const visits = realVisits(rows);
      const pref = preferredDoctor(visits);
      if (!pref) return null;

      return {
        doctorId: pref.doctorId,
        doctorName: pref.doctorName,
        line: preferenceLine(pref),
      };
    } catch (e) {
      this.logError('Gagal cari doktor terdahulu', e);
      return null;
    }
  }

  /**
   * FASA 6A — when the requested slot is taken, offer what IS free.
   *
   * The old reply was "sila pilih masa lain", which asks the patient to guess.
   * At 1am with toothache they guess twice, fail, and are gone — and the clinic
   * never learns. This returns two concrete options near what they asked for, so
   * the AI can run a real conversation instead of a dead end.
   *
   * THE SLOTS COME FROM THE SCHEDULE, NEVER FROM THE MODEL. Everything returned
   * here was checked against the doctor's shift and the existing appointments; a
   * hallucinated "4pm" is a patient arriving to a full chair.
   *
   * Returns [] whenever it cannot be sure — no shifts, unreadable times, a query
   * that fails. Silence is safe: the caller falls back to asking for another day.
   */
  /**
   * Verified free slots for the date in play, as prompt FACTS.
   *
   * Same query as findAlternatives() (the booking-completion path) — Nur can
   * never know more or less than the booking system. `preferredMin` is null:
   * the patient named a day, not a time; findFreeSlots then ranks by closeness
   * to the start of the shift.
   *
   * Fail-soft like findAlternatives: a DB error returns '' so the patient's
   * reply is never broken by a lookup. A branch with no schedules yields the
   * honest "tiada slot" fact — the same answer the booking path would give.
   */
  private async freeSlotsContext(
    scope: WaScope,
    date: string | null,
    doctorId?: string | null,
  ): Promise<string> {
    if (!date) return '';

    try {
      const data = await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-slot-context',
          source: 'system_worker',
        },
        async (tx) => {
          const shifts = await tx.execute(sql`
            SELECT ds.doctor_id AS doctorId, s.name AS doctorName,
                   DATE_FORMAT(ds.schedule_date, '%Y-%m-%d') AS date,
                   TIME_FORMAT(ds.start_time, '%H:%i') AS startTime,
                   TIME_FORMAT(ds.end_time, '%H:%i') AS endTime
            FROM doctor_schedules ds
            JOIN staff s ON s.id = ds.doctor_id
            WHERE ds.org_id = ${scope.orgId}
              AND ds.branch_id = ${scope.branchId}
              AND s.org_id = ${scope.orgId}
              AND s.role = 'doctor'
              AND s.status = 'Active'
              AND s.deleted_at IS NULL
              AND ds.schedule_date >= DATE(${date})
              AND ds.schedule_date <= DATE_ADD(DATE(${date}), INTERVAL 14 DAY)
          `);

          const busy = await tx.execute(sql`
            SELECT a.doctor_id AS doctorId,
                   DATE_FORMAT(a.scheduled_date, '%Y-%m-%d') AS date,
                   TIME_FORMAT(a.scheduled_time, '%H:%i') AS startTime,
                   a.duration_min AS durationMin
            FROM appointments a
            WHERE a.org_id = ${scope.orgId}
              AND a.branch_id = ${scope.branchId}
              AND a.deleted_at IS NULL
              AND a.status NOT IN ('cancelled', 'no-show')
              AND a.scheduled_date >= DATE(${date})
              AND a.scheduled_date <= DATE_ADD(DATE(${date}), INTERVAL 14 DAY)
          `);

          return {
            shifts: (shifts as { rows?: Array<{
              doctorId: string; doctorName: string; date: string;
              startTime: string; endTime: string;
            }> }).rows ?? [],
            busy: (busy as { rows?: Array<{
              doctorId: string; date: string; startTime: string; durationMin: number;
            }> }).rows ?? [],
          };
        },
      );

      /* Same drop-don't-default mapping findAlternatives uses. */
      const mappedShifts: DoctorShift[] = [];
      for (const s of data.shifts) {
        const startMin = parseTime(s.startTime);
        const endMin = parseTime(s.endTime);
        if (startMin === null || endMin === null || endMin <= startMin) continue;
        mappedShifts.push({
          doctorId: s.doctorId, doctorName: s.doctorName, date: s.date, startMin, endMin,
        });
      }

      const mappedBusy: BusyBlock[] = [];
      for (const b of data.busy) {
        const startMin = parseTime(b.startTime);
        if (startMin === null) continue;
        mappedBusy.push({
          doctorId: b.doctorId, date: b.date, startMin,
          durationMin: Number(b.durationMin ?? 30),
        });
      }

      const slots = findFreeSlots({
        shifts: mappedShifts,
        busy: mappedBusy,
        preferredDoctorId: doctorId ?? null,
        preferredDate: date,
        preferredMin: null,
        limit: 2,
      });

      return formatSlotContext(slots);
    } catch (e) {
      this.logError('Gagal bina konteks slot untuk balasan', e);
      return '';
    }
  }

  private async findAlternatives(
    scope: WaScope,
    wanted: { date: string; time: string; doctorId?: string | null },
  ): Promise<string> {
    const wantedMin = parseTime(wanted.time);

    try {
      const data = await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-slot-search',
          source: 'system_worker',
        },
        async (tx) => {
          /* Shifts from today forward, plus a bounded window. A patient asking
           * for a date two months out is answered from the schedule; one asking
           * for last week is a misunderstanding we do not invent a slot for. */
          const shifts = await tx.execute(sql`
            SELECT ds.doctor_id AS doctorId, s.name AS doctorName,
                   DATE_FORMAT(ds.schedule_date, '%Y-%m-%d') AS date,
                   TIME_FORMAT(ds.start_time, '%H:%i') AS startTime,
                   TIME_FORMAT(ds.end_time, '%H:%i') AS endTime
            FROM doctor_schedules ds
            JOIN staff s ON s.id = ds.doctor_id
            WHERE ds.org_id = ${scope.orgId}
              AND ds.branch_id = ${scope.branchId}
              AND s.org_id = ${scope.orgId}
              AND s.role = 'doctor'
              AND s.status = 'Active'
              AND s.deleted_at IS NULL
              AND ds.schedule_date >= DATE(${wanted.date})
              AND ds.schedule_date <= DATE_ADD(DATE(${wanted.date}), INTERVAL 14 DAY)
          `);

          const busy = await tx.execute(sql`
            SELECT a.doctor_id AS doctorId,
                   DATE_FORMAT(a.scheduled_date, '%Y-%m-%d') AS date,
                   TIME_FORMAT(a.scheduled_time, '%H:%i') AS startTime,
                   a.duration_min AS durationMin
            FROM appointments a
            WHERE a.org_id = ${scope.orgId}
              AND a.branch_id = ${scope.branchId}
              AND a.deleted_at IS NULL
              AND a.status NOT IN ('cancelled', 'no-show')
              AND a.scheduled_date >= DATE(${wanted.date})
              AND a.scheduled_date <= DATE_ADD(DATE(${wanted.date}), INTERVAL 14 DAY)
          `);

          return {
            shifts: (shifts as { rows?: Array<{
              doctorId: string; doctorName: string; date: string;
              startTime: string; endTime: string;
            }> }).rows ?? [],
            busy: (busy as { rows?: Array<{
              doctorId: string; date: string; startTime: string; durationMin: number;
            }> }).rows ?? [],
          };
        },
      );

      /* A shift whose times cannot be read is DROPPED, not defaulted. Defaulting
       * to 10:00–17:00 would invent a shift the clinic never set. */
      const mappedShifts: DoctorShift[] = [];
      for (const s of data.shifts) {
        const startMin = parseTime(s.startTime);
        const endMin = parseTime(s.endTime);
        if (startMin === null || endMin === null || endMin <= startMin) continue;
        mappedShifts.push({
          doctorId: s.doctorId, doctorName: s.doctorName, date: s.date, startMin, endMin,
        });
      }

      const mappedBusy: BusyBlock[] = [];
      for (const b of data.busy) {
        const startMin = parseTime(b.startTime);
        if (startMin === null) continue;
        mappedBusy.push({
          doctorId: b.doctorId, date: b.date, startMin,
          durationMin: Number(b.durationMin ?? 30),
        });
      }

      const slots = findFreeSlots({
        shifts: mappedShifts,
        busy: mappedBusy,
        preferredDoctorId: wanted.doctorId ?? null,
        preferredDate: wanted.date,
        preferredMin: wantedMin,
        limit: 2,
      });

      if (slots.length === 0) return '';

      const lines = slots.map(
        (s) => `• ${s.date} ${s.label} — ${s.doctorName}`,
      );

      return [
        `Ini masa yang masih kosong:`,
        ...lines,
        'Yang mana sesuai?',
      ].join('\n');
    } catch (e) {
      /* Never let a slot search break the patient's reply. Saying nothing is
       * recoverable; a 500 mid-conversation is not. */
      this.logError('Gagal cari slot alternatif', e);
      return '';
    }
  }

  private async maybeSaveBooking(
    scope: WaScope,
    chatId: string,
    text: string,
    payload: WahaWebhookPayload,
  ) {
    const previous = await this.getBookingMemory(chatId);
    const remembered = await this.getSalutation(scope, chatId);

    const raw = await this.minimax.chat(
      extractPrompt() +
        `\nKONTEKS:\n${JSON.stringify({
          ...previous,
          salutation: remembered || previous?.salutation || '',
        })}`,
      text,
    );

    let data: BookingExtract;

    try {
      data = JSON.parse(
        raw.replace(/```json/gi, '').replace(/```/g, '').trim(),
      ) as BookingExtract;
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
    /* The branch is the one that received the message — one number per branch, so
     * a patient never "names" a branch and there is nothing to infer. The old
     * 'Setia Tropika' default wrote the wrong clinic into every other branch. */
    const branch = String(
      data.branch || previous?.branch || scope.branchName || '',
    ).trim();

    const salutation =
      this.explicitSalutation(text) ||
      remembered ||
      previous?.salutation ||
      '';

    /* FASA 6B — the doctor the patient named, resolved to an id.
     *
     * The extractor returns a NAME ("Dr. Siti"), which is all a conversation
     * contains. Turning it into an id happens here, against the branch's own
     * staff list, so a name that matches nobody resolves to nothing rather than
     * to a guess. An unresolvable name leaves the field empty, which the slot
     * search reads as "any doctor" — the safe reading, since we cannot honour a
     * doctor we cannot identify. */
    let doctorId = previous?.doctorId;
    let doctorName = previous?.doctorName;
    const namedDoctor = String(data.doctor ?? '').trim();

    if (namedDoctor) {
      const resolved = await this.resolveDoctorByName(scope, namedDoctor);
      if (resolved) {
        doctorId = resolved.doctorId;
        doctorName = resolved.doctorName;
      } else {
        /* The patient named someone we do not have. Clearing is deliberate: a
         * stale doctor from an earlier turn would silently restrict the search
         * to a doctor the patient has just moved away from. */
        doctorId = undefined;
        doctorName = undefined;
      }
    }

    await this.setBookingMemory(chatId, {
      name,
      date,
      time,
      treatment,
      branch,
      salutation,
      doctorId,
      doctorName,
    });

    if (salutation) {
      await this.setSalutation(scope, chatId, salutation);
    }

    if (!name || !date || !time || !treatment) return;

    if (!this.isValidBookingTime(date, time)) {
      const alts = await this.findAlternatives(scope, { date, time, doctorId });
      await this.sendText(
        scope.sessionName,
        chatId,
        alts
          ? `Maaf, masa tersebut di luar waktu operasi atau waktu rehat.\n\n${alts}`
          : 'Maaf, masa tersebut di luar waktu operasi atau jatuh pada waktu rehat. Boleh cadangkan masa lain? Slot kami setiap 30 minit.',
      );
      return;
    }

    const slotTimestamp = Date.parse(`${date}T${time}:00+08:00`);

    if (slotTimestamp <= Date.now()) {
      await this.sendText(scope.sessionName, 
        chatId,
        'Maaf, tarikh atau masa tersebut sudah berlalu. Sila pilih slot akan datang.',
      );
      return;
    }

    const phone = await this.resolvePhone(chatId, payload);
    let outcome = '';

    /* POLICY GATE — the OTHER agent. Booking is created by `booking-ai`
     * (owner domain appointments), not by the reply agent. Without this check
     * the reply agent's gate was the only gate, and pausing "Booking AI" in
     * the AI Manager changed nothing: appointments kept being created. The
     * registry states "a paused agent cannot run anything it proposes"; for
     * booking that statement now has teeth. Fail-closed: a lookup error holds
     * the booking, because creating an appointment we were told not to create
     * is the worse mistake. */
    let bookingAgentEnabled = true;
    try {
      bookingAgentEnabled = await this.policy.canAutoExecute(
        { ...SYSTEM_WORKER_PRINCIPAL, orgId: scope.orgId, branchId: scope.branchId } as never,
        {
          agentKey: 'booking-ai',
          domain: 'appointments',
          actionKey: 'booking.create',
        },
      );
    } catch (error) {
      this.logger.error(
        `Gagal semak polisi agen booking: ${error instanceof Error ? error.message : String(error)} — tempahan tidak dibuat`,
      );
      bookingAgentEnabled = false;
    }

    const bookingDecision = canAiCreateBooking({ bookingAgentEnabled });
    if (!bookingDecision.allowed) {
      /* Do NOT silently drop it: the patient asked for a booking and is
       * waiting. Flag the conversation so a human completes the booking. */
      await this.holdForHuman(scope, chatId, bookingDecision.reason!);
      return;
    }

    await this.dbCtx.runAsWorker(
      {
        orgId: scope.orgId,
        branchIds: [scope.branchId],
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
          WHERE br.org_id = ${scope.orgId}
            AND br.branch_id = ${scope.branchId}
            AND br.contact_phone = ${phone}
            AND a.org_id = ${scope.orgId}
            AND a.branch_id = ${scope.branchId}
            AND a.scheduled_date = ${date}
            AND a.scheduled_time = ${time}
            AND a.deleted_at IS NULL
            AND a.status NOT IN ('cancelled', 'no-show')
          LIMIT 1
        `);

        const existing = (duplicate as { rows?: Array<{ id?: string; patient_name?: string | null; doctor_name?: string | null }> }).rows?.[0];

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
          WHERE ${doctorHolidays.orgId} = ${scope.orgId}
            AND ${doctorHolidays.branchId} = ${scope.branchId}
            AND ${doctorHolidays.holidayDate} = CAST(${date} AS DATE)
          LIMIT 1
        `);

        if ((holidays as { rows?: unknown[] }).rows?.length) {
          outcome =
            `Maaf, klinik bercuti pada ${date}. Sila pilih tarikh lain.`;
          return;
        }

        const doctors = await tx.execute(sql`
          SELECT s.id AS doctor_id, s.name AS doctor_name
          FROM doctor_schedules ds
          JOIN staff s ON s.id = ds.doctor_id
          WHERE ds.org_id = ${scope.orgId}
            AND ds.branch_id = ${scope.branchId}
            AND s.org_id = ${scope.orgId}
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
              WHERE a.org_id = ${scope.orgId}
                AND a.branch_id = ${scope.branchId}
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
          const alts = await this.findAlternatives(scope, { date, time, doctorId });
          outcome = alts
            ? `Maaf, ${date} jam ${time} tiada doktor tersedia.\n\n${alts}`
            : `Maaf, tiada doktor tersedia untuk slot ${date} jam ${time}. Boleh cadangkan tarikh atau masa lain?`;
          return;
        }

        // Kekalkan aturan asal: satu appointment bagi waktu cawangan.
        const occupied = await tx.execute(sql`
          SELECT id
          FROM appointments
          WHERE org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
            AND scheduled_date = ${date}
            AND scheduled_time = ${time}
            AND deleted_at IS NULL
            AND status NOT IN ('cancelled', 'no-show')
          LIMIT 1
        `);

        if ((occupied as { rows?: unknown[] }).rows?.length) {
          const alts = await this.findAlternatives(scope, { date, time, doctorId });
          outcome = alts
            ? `Maaf, slot ${time} pada ${date} sudah ditempah.\n\n${alts}`
            : `Maaf, slot ${time} pada ${date} sudah ditempah. Boleh cadangkan tarikh atau masa lain?`;
          return;
        }

        const patients = await tx.execute(sql`
          SELECT id
          FROM patients
          WHERE org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
            AND deleted_at IS NULL
            AND (phone = ${phone} OR whatsapp = ${phone})
          LIMIT 1
        `);

        let patientId = (patients as { rows?: Array<{ id?: string }> }).rows?.[0]?.id;

        if (!patientId) {
          const mrn = await new OrgAllocator(tx).nextMrn(scope.orgId);
          patientId = randomUUID();

          await tx.execute(sql`
            INSERT INTO patients
              (id, org_id, branch_id, mrn, name, phone, whatsapp)
            VALUES
              (
                ${patientId}, ${scope.orgId}, ${scope.branchId}, ${mrn},
                ${name}, ${phone}, ${phone}
              )
          `);
        }

        if (!patientId) {
          throw new Error('Pesakit gagal dicipta');
        }

        const code = await new OrgAllocator(tx).nextAptCode(scope.orgId);

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
              ${appointmentId}, ${scope.orgId}, ${scope.branchId}, ${code}, ${patientId}, ${name},
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
              ${randomUUID()}, ${scope.orgId}, ${scope.branchId}, ${phone}, ${name},
              ${date}, ${time}, ${treatment},
              ${scope.branchName ?? ''}, ${text}, 'confirmed', ${appointmentId}
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
          `Cawangan: ${scope.branchName ?? ''}`,
          `Doktor bertugas: ${selectedDoctor.doctor_name}`,
        ].join('\n');
      },
    );

    if (outcome) {
      await this.sendText(scope.sessionName, chatId, outcome);

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

  private salutationKey(scope: WaScope, chatId: string): string {
    return `medini:whatsapp:salutation:${scope.orgId}:${scope.branchId}:${chatId}`;
  }

  private appointmentActionKey(chatId: string): string {
    return `medini:whatsapp:appointment-action:${chatId}`;
  }

  private async getSalutation(scope: WaScope, chatId: string): Promise<Salutation> {
    if (!this.redis) return '';

    try {
      const value = await this.redis.get(this.salutationKey(scope, chatId));

      return ['Encik', 'Puan', 'Cik', 'Tuan'].includes(value ?? '')
        ? value as Salutation
        : '';
    } catch (error) {
      this.logError('Gagal baca gelaran', error);
      return '';
    }
  }

  private async setSalutation(
    scope: WaScope,
    chatId: string,
    value: Salutation,
  ): Promise<void> {
    if (!this.redis || !value) return;

    try {
      await this.redis.set(
        this.salutationKey(scope, chatId),
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
    scope: WaScope,
    chatId: string,
    text: string,
    payload: WahaWebhookPayload,
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
      await this.sendText(scope.sessionName, 
        chatId,
        'Baik, pembatalan tidak diteruskan.',
      );
      return true;
    }

    if (pendingId && confirms) {
      const phone = await this.resolvePhone(chatId, payload);

      const result = await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-cancel-appointment',
          source: 'system_worker',
        },
        async (tx) => {
          const beforeResult = await tx.execute(sql`
            SELECT a.status
            FROM appointments a
            WHERE a.id = ${pendingId}
              AND a.org_id = ${scope.orgId}
              AND a.branch_id = ${scope.branchId}
              AND a.deleted_at IS NULL
              AND a.status IN (
                'booked', 'confirmed', 'checked-in', 'waiting'
              )
              AND a.patient_id IN (
                SELECT id
                FROM patients
                WHERE org_id = ${scope.orgId}
                  AND branch_id = ${scope.branchId}
                  AND deleted_at IS NULL
                  AND (phone = ${phone} OR whatsapp = ${phone})
              )
            LIMIT 1
            FOR UPDATE
          `);

          const beforeStatus =
            (beforeResult as { rows?: Array<{ status?: string | null }> }).rows?.[0]?.status;

          if (!beforeStatus) {
            return { affectedRows: 0 };
          }

          const updateResult = await tx.execute(sql`
            UPDATE appointments
            SET status = 'cancelled',
                updated_at = NOW(6)
            WHERE id = ${pendingId}
              AND org_id = ${scope.orgId}
              AND branch_id = ${scope.branchId}
              AND deleted_at IS NULL
              AND status IN (
                'booked', 'confirmed', 'checked-in', 'waiting'
              )
          `);

          const affectedRows =
            Number((updateResult as { affectedRows?: number }).affectedRows ?? 0);

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
                orgId: scope.orgId,
                branchId: scope.branchId,
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

      await this.sendText(scope.sessionName, 
        chatId,
        Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0
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

    const requestedCode =
      normalized.match(/\bapt-\d+\b/i)?.[0]?.toUpperCase() ?? '';

    const result = await this.dbCtx.runAsWorker(
      {
        orgId: scope.orgId,
        branchIds: [scope.branchId],
        correlationId: 'wa-find-appointment-to-cancel',
        source: 'system_worker',
      },
      async (tx) => {
        if (requestedCode) {
          return tx.execute(sql`
            SELECT
              a.id,
              a.code,
              a.patient_name,
              DATE_FORMAT(
                a.scheduled_date,
                '%Y-%m-%d'
              ) AS booking_date,
              a.scheduled_time
            FROM appointments a
            JOIN patients p
              ON p.id = a.patient_id
            WHERE a.org_id = ${scope.orgId}
              AND a.branch_id = ${scope.branchId}
              AND p.org_id = ${scope.orgId}
              AND p.branch_id = ${scope.branchId}
              AND (
                p.phone = ${phone}
                OR p.whatsapp = ${phone}
              )
              AND a.code = ${requestedCode}
              AND a.status IN (
                'booked',
                'confirmed',
                'checked-in',
                'waiting'
              )
              AND a.scheduled_date
                >= CAST(${malaysiaDate()} AS DATE)
              AND a.deleted_at IS NULL
              AND p.deleted_at IS NULL
            LIMIT 1
          `);
        }

        return tx.execute(sql`
          SELECT
            a.id,
            a.code,
            a.patient_name,
            DATE_FORMAT(
              a.scheduled_date,
              '%Y-%m-%d'
            ) AS booking_date,
            a.scheduled_time
          FROM appointments a
          JOIN patients p
            ON p.id = a.patient_id
          WHERE a.org_id = ${scope.orgId}
            AND a.branch_id = ${scope.branchId}
            AND p.org_id = ${scope.orgId}
            AND p.branch_id = ${scope.branchId}
            AND (
              p.phone = ${phone}
              OR p.whatsapp = ${phone}
            )
            AND a.status IN (
              'booked',
              'confirmed',
              'checked-in',
              'waiting'
            )
            AND a.scheduled_date
              >= CAST(${malaysiaDate()} AS DATE)
            AND a.deleted_at IS NULL
            AND p.deleted_at IS NULL
          ORDER BY
            a.scheduled_date,
            a.scheduled_time
          LIMIT 10
        `);
      },
    );

    const rows = (result as { rows?: Array<{
      id?: string;
      code?: string;
      patient_name?: string | null;
      booking_date?: string | null;
      scheduled_time?: string | null;
    }> }).rows ?? [];

    if (!rows.length) {
      await this.sendText(scope.sessionName, 
        chatId,
        requestedCode
          ? `Maaf, saya tidak jumpa appointment aktif dengan kod ${requestedCode} untuk nombor ini.`
          : 'Maaf, saya tidak jumpa appointment aktif untuk nombor ini.',
      );
      return true;
    }

    if (!requestedCode && rows.length > 1) {
      await this.deleteBookingMemory(chatId);
      await this.redis.del(key);

      const options = rows
        .map(
          (row) =>
            `${row.code} - ${row.patient_name}, ${row.booking_date} ${String(row.scheduled_time).slice(0, 5)}`,
        )
        .join('\n');

      await this.sendText(scope.sessionName, 
        chatId,
        [
          'Anda ada lebih daripada satu appointment aktif:',
          options,
          '',
          `Sila nyatakan kod yang hendak dibatalkan, contoh: cancel ${rows[0]!.code}`,
        ].join('\n'),
      );

      return true;
    }

    const row = rows[0]!;

    // Entering cancellation flow invalidates any stale booking session,
    // so a later "Ya" has only one possible meaning.
    await this.deleteBookingMemory(chatId);
    await this.redis.set(key, String(row.id), 'EX', 600);

    await this.sendText(scope.sessionName, 
      chatId,
      `Betul nak batalkan appointment ${row.code} - ${row.patient_name} pada ${row.booking_date} pukul ${String(row.scheduled_time).slice(0, 5)}? Balas Ya untuk sahkan.`,
    );

    return true;
  }

  /**
   * Set chat presence so the patient sees "sedang menaip…" before the reply
   * lands. WAHA never does this automatically — its docs are explicit that the
   * caller must send it manually before /api/sendText to look human.
   *
   * Best-effort: presence is cosmetic. If it fails, the reply must still go —
   * so the error is logged, never thrown.
   */
  /**
   * AB4 — mark the patient's message as READ (blue ticks) before replying.
   * A human reads first, then types; a bot that answers while the message
   * sits unread tells the patient exactly what they are. Best-effort by
   * design: a failed sendSeen never blocks the reply, it is only logged.
   */
  private async markSeen(session: string, chatId: string): Promise<void> {
    try {
      const response = await fetch(`${WAHA_URL}/api/sendSeen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': WAHA_API_KEY,
        },
        body: JSON.stringify({ session, chatId }),
      });
      if (!response.ok) {
        this.logger.debug(
          `sendSeen tidak diterima (HTTP ${response.status}) sesi=${session} — dibiarkan, balasan tetap keluar`,
        );
      }
    } catch (error) {
      this.logger.debug(
        `sendSeen gagal sesi=${session}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async setPresence(session: string, chatId: string, presence: 'typing' | 'paused'): Promise<void> {
    try {
      const response = await fetch(
        `${WAHA_URL}/api/${encodeURIComponent(session)}/presence`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': WAHA_API_KEY,
          },
          body: JSON.stringify({ chatId, presence }),
        },
      );
      if (!response.ok) {
        this.logger.warn(`WAHA presence ${presence} gagal: HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`WAHA presence ${presence} ralat: ${(error as Error)?.message ?? error}`);
    }
  }

  /**
   * Send a reply on the session that received the message.
   *
   * The session must be passed in, not read from a module constant: with one
   * WhatsApp number per branch, a single global session would post every
   * branch's replies through one number — a patient of Setia Tropika answered
   * from Bukit Indah's line.
   */
  private async sendText(session: string, chatId: string, text: string): Promise<void> {
    /* A2 HARD STOP (2 Okt 2026): never send through a dead session. We kept
     * hammering sendText at a session stuck in FAILED ("Connection Failure"),
     * which is the exact pattern Meta flags before a ban. The pre-flight is
     * fail-open on an unreadable status (the send path has its own six gates). */
    const preflight = await this.waha.assertSendable(session);
    if (!preflight.allowed) {
      if (preflight.shouldLock) {
        await this.lockChannel(session, preflight.reason ?? 'SESSION_FAILED');
      }
      throw new Error(
        `Hantar dibatalkan — sesi "${session}" tidak sihat (${preflight.reason})`,
      );
    }

    const response = await fetch(`${WAHA_URL}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY,
      },
      body: JSON.stringify({
        session,
        chatId,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error(`WAHA sendText gagal: HTTP ${response.status}`);
    }

    /* RECORD THE OUTBOUND MESSAGE.
     *
     * WAHA's response carries the message id it assigned — the natural
     * idempotency key. Without this write the patient receives the reply (it
     * left through WAHA) but the CRM transcript never learns it existed:
     * the Hub shows a one-sided conversation, unread_count never settles,
     * first-response SLA cannot be measured, and later AI turns lose the
     * memory of what the bot itself said. Verified live: replies reached the
     * patient while wa_messages held only the inbound rows.
     *
     * BEST-EFFORT by design: the send has already succeeded, so a recording
     * failure must never read as a failed reply. It is logged loudly instead —
     * a transcript hole is an operational problem, not a reason to resend a
     * message the patient already has. */
    try {
      const body = await response.json() as { id?: unknown; messageId?: unknown };
      const externalMessageId = body.id != null ? String(body.id)
        : body.messageId != null ? String(body.messageId) : null;

      await this.recordOutgoingMessage(session, chatId, text, externalMessageId);
    } catch (error) {
      this.logError('Mesej terkirim tetapi gagal direkodkan dalam transkrip', error);
    }
  }

  /** Persist one outbound (AI/staff/system) message row for the transcript.
   *
   * Resolves the branch from the SESSION NAME through the same cached
   * resolver the inbound path uses, then finds-or-creates the conversation
   * exactly as `saveIncomingMessage` does, so both sides of a chat live in one
   * thread. Idempotent on the external message id: WAHA retries and duplicated
   * sends must not double-write. */
  private async recordOutgoingMessage(
    session: string,
    chatId: string,
    text: string,
    externalMessageId: string | null,
  ): Promise<void> {
    const scope = await this.resolveScope(session);
    if (!scope) {
      /* An unmapped session cannot be attributed to a branch. LOUD, not
       * silent: a reply that left from an unknown number is a routing
       * misconfiguration the operator must hear about. */
      this.logger.warn(
        `Mesej keluar tidak direkodkan — sesi "${session}" tidak dipetakan kepada cawangan`,
      );
      return;
    }

    const phone = chatId.replace(/@.*$/, '');

    await this.dbCtx.runAsWorker(
      {
        orgId: scope.orgId,
        branchIds: [scope.branchId],
        correlationId: 'wa-outgoing-message',
        source: 'system_worker',
      },
      async (tx) => {
        const channels = await tx.execute(sql`
          SELECT id
          FROM wa_channels
          WHERE org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
            AND deleted_at IS NULL
          ORDER BY (status = 'working') DESC, created_at ASC
          LIMIT 1
        `);
        const channelId = (channels as { rows?: Array<{ id?: string }> }).rows?.[0]?.id;
        if (!channelId) return;

        const conversations = await tx.execute(sql`
          SELECT id
          FROM wa_conversations
          WHERE org_id = ${scope.orgId}
            AND branch_id = ${scope.branchId}
            AND channel_id = ${channelId}
            AND contact_phone = ${phone}
            AND deleted_at IS NULL
          LIMIT 1
        `);
        let conversationId = (conversations as { rows?: Array<{ id?: string }> }).rows?.[0]?.id;
        if (!conversationId) {
          conversationId = randomUUID();
          await tx.execute(sql`
            INSERT INTO wa_conversations
              (id, org_id, branch_id, channel_id, contact_phone, status, unread_count)
            VALUES
              (${conversationId}, ${scope.orgId}, ${scope.branchId}, ${channelId}, ${phone}, 'open', 0)
          `);
        }

        /* The unique index is (org, conversation, idempotency_key, live-guard):
         * NULL key never collides, a real key dedupes WAHA retries. */
        const idemKey = externalMessageId ?? `out:${randomUUID()}`;
        /* 'sent', bukan 'delivered': WAHA baru sahaja menerima mesej —
         * delivered ialah JANJI pengesahan yang kita belum terima. (Boss
         * #2: reply mesti tersimpan; status mesti jujur tentang apa yg
         * kita tahu.) */
        await tx.execute(sql`
          INSERT IGNORE INTO wa_messages
            (id, org_id, branch_id, channel_id, conversation_id,
             direction, sender_type, body, status,
             idempotency_key, external_message_id, sent_at, delivered_at)
          VALUES
            (${randomUUID()}, ${scope.orgId}, ${scope.branchId}, ${channelId}, ${conversationId},
             'out', 'ai', ${text}, 'sent',
             ${idemKey}, ${externalMessageId}, NOW(6), NULL)
        `);
      },
    );
  }

  /**
   * A2 — lock the branch's channel after a dead-session send attempt.
   *
   * Sets the channel status to `failed` so the Hub shows it needs attention and
   * nothing else tries to send through it until a human resets it (re-pair).
   * Best-effort: a failure here must not mask the original send error, so it is
   * logged, never thrown.
   */
  private async lockChannel(session: string, reason: string): Promise<void> {
    const scope = await this.resolveScope(session);
    if (!scope) return;

    try {
      await this.dbCtx.runAsWorker(
        {
          orgId: scope.orgId,
          branchIds: [scope.branchId],
          correlationId: 'wa-antiban-lock',
          source: 'system_worker',
        },
        async (tx) => {
          await tx.execute(sql`
            UPDATE wa_channels
            SET status = 'failed',
                health_score = LEAST(health_score, 20),
                updated_at = NOW(6)
            WHERE org_id = ${scope.orgId}
              AND branch_id = ${scope.branchId}
              AND deleted_at IS NULL
          `);
        },
      );
      this.logger.warn(
        `Saluran cawangan dikunci (status=failed) selepas sesi "${session}" gagal: ${reason}`,
      );
    } catch (error) {
      this.logError('Gagal mengunci saluran selepas sesi gagal', error);
    }
  }
}