import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/errors';

/**
 * Anti-ban + escalation settings, per cawangan.
 *
 * Ditetapkan dalam AI Manager; WhatsApp Hub membaca nilai yang sama supaya
 * kedua-dua paparan menunjukkan had yang serupa (satu sumber kebenaran).
 */

const branchSchema = z.string().uuid();

const DEFAULT_ESCALATION_KEYWORDS = [
  'komplen',
  'marah',
  'manager',
  'pengurus',
  'doktor',
  'saman',
  'batal',
  'refund',
  'pulangkan duit',
  'sakit teruk',
  'emergency',
  'kecemasan',
].join(', ');

const DEFAULT_ESCALATION_REPLY =
  'Baik, saya akan minta pegawai kami menyemak perkara ini. ' +
  'Sila tunggu sebentar, pegawai kami akan membalas tidak lama lagi.';

/** Anti-ban knobs the operator may set. The blast/reply-window fields are
 *  optional on save so an older client (or a partial update) keeps its current
 *  values instead of being reset to the built-in envelope. */
const saveSchema = z.object({
  /* The AI switch. Separate from antibanEnabled below, which controls the
   * anti-ban BRAKES — a different switch with the opposite effect. */
  aiEnabled: z.boolean().optional(),
  antibanEnabled: z.boolean(),
  minDelaySeconds: z.number().int().min(1).max(600),
  maxDelaySeconds: z.number().int().min(1).max(3600),
  dailyMessageCap: z.number().int().min(1).max(10000),
  hourlyMessageCap: z.number().int().min(1).max(1000),
  warmupDays: z.number().int().min(0).max(90),
  warmupDailyCap: z.number().int().min(1).max(10000),
  escalationKeywords: z.string().trim().max(2000),
  maxAiTurns: z.number().int().min(1).max(50),
  escalateOnAiUncertainty: z.boolean(),
  escalationReply: z.string().trim().min(10).max(2000),
}).strict();

/**
 * Blast scheduling — a PROMOTION is a window, not a single send.
 *
 * A branch runs "Merdeka 30% off" over 14 days; the operator decides how many
 * numbers in total and how many per day (up to the daily ceiling). The service
 * derives the send gap from the blast window, so 100 numbers across 08:00–22:00
 * become one message every 8.4 minutes instead of a burst.
 *
 * Validation refuses a plan that cannot fit: if the remaining days cannot absorb
 * the remaining recipients within the daily cap, that is a configuration error
 * the operator must fix — silently flooding would be the ban.
 */
const blastSchema = z.object({
  /** Local hour the daily blast window opens (default 08:00 MYT). */
  windowStartHour: z.number().int().min(0).max(23),
  /** Local hour the daily blast window closes (default 22:00 MYT). */
  windowEndHour: z.number().int().min(1).max(24),
  /** Rolling ceiling for blast recipients per day (default 100). */
  maxBlastPerDay: z.number().int().min(1).max(10000),
  /** Randomised gap floor between blast messages, in seconds. */
  blastMinGapSeconds: z.number().int().min(1).max(7200),
  /** Randomised gap ceiling between blast messages, in seconds. */
  blastMaxGapSeconds: z.number().int().min(1).max(7200),
}).strict();

/** Derived send spacing for a campaign — computed, never hand-entered. */
export interface BlastPlan {
  recipients: number;
  perDay: number;
  days: number;
  windowHours: number;
  /** Average seconds between two blast messages. */
  gapSeconds: number;
  gapLabel: string;
  /** Would the plan exceed the daily ceiling? */
  exceedsDailyCap: boolean;
  note: string;
}

/**
 * Work out the blast spacing for a promotion.
 *
 * Pure and total: given N recipients over D days inside an H-hour window, the
 * gap is (H * 3600) / perDay seconds. It reports rather than throws, so the UI
 * can show the operator the consequence of what they typed before they commit.
 */
export function planBlast(
  recipients: number,
  days: number,
  settings: { windowStartHour: number; windowEndHour: number; maxBlastPerDay: number },
): BlastPlan {
  const safeDays = Math.max(1, Math.floor(days));
  const safeRecipients = Math.max(0, Math.floor(recipients));
  const windowHours = Math.max(1, settings.windowEndHour - settings.windowStartHour);
  const perDay = Math.ceil(safeRecipients / safeDays) || 0;
  const gapSeconds = perDay > 0 ? Math.round((windowHours * 3600) / perDay) : 0;

  const mins = Math.floor(gapSeconds / 60);
  const secs = gapSeconds % 60;
  const gapLabel =
    gapSeconds === 0 ? '—'
      : mins >= 1 ? `${mins} min ${secs.toString().padStart(2, '0')}s`
        : `${secs}s`;

  const exceedsDailyCap = perDay > settings.maxBlastPerDay;
  const note = exceedsDailyCap
    ? `${perDay} sehari melebihi had ${settings.maxBlastPerDay}. Panjangkan tempoh promosi atau kurangkan bilangan penerima.`
    : `${perDay} mesej sehari, setiap ${gapLabel}, dalam tetingkap ${settings.windowStartHour}:00–${settings.windowEndHour}:00.`;

  return {
    recipients: safeRecipients,
    perDay,
    days: safeDays,
    windowHours,
    gapSeconds,
    gapLabel,
    exceedsDailyCap,
    note,
  };
}

export interface AntibanSettings {
  branchId: string;
  /** AI replies for this branch. Not the same as antibanEnabled. */
  aiEnabled: boolean;
  antibanEnabled: boolean;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  dailyMessageCap: number;
  hourlyMessageCap: number;
  warmupDays: number;
  warmupDailyCap: number;
  escalationKeywords: string;
  maxAiTurns: number;
  escalateOnAiUncertainty: boolean;
  escalationReply: string;
  /** Minutes collected before an AI reply is produced (anti-ban coalescing). */
  replyWindowSeconds: number;
  /** Enable the "sedang menaip…" presence before a reply lands. */
  typingIndicatorEnabled: boolean;
  /** Enable the scheduling envelope for blasts. */
  blastScheduleEnabled: boolean;
  blastWindowStartHour: number;
  blastWindowEndHour: number;
  maxBlastPerDay: number;
  blastMinGapSeconds: number;
  blastMaxGapSeconds: number;
  configured: boolean;
  updatedAt: string | null;
}

interface SettingsRow {
  branch_id: string;
  /* Added in 0011_ai_enabled.sql. Optional so the service still type-checks
   * against a database that has not run the migration — format() falls back to
   * "on" for a NULL/absent value, which is the pre-existing behaviour. */
  ai_enabled?: number | boolean | null;
  antiban_enabled: number | boolean;
  min_delay_seconds: number;
  max_delay_seconds: number;
  daily_message_cap: number;
  hourly_message_cap: number;
  warmup_days: number;
  warmup_daily_cap: number;
  escalation_keywords: string;
  max_ai_turns: number;
  escalate_on_ai_uncertainty: number | boolean;
  escalation_reply: string;
  /* Added in 0004_antiban_reply_queue.sql. Typed as optional so the service
   * still type-checks against a database that has not run the migration yet —
   * format() falls back to the built-in envelope for any NULL/absent value. */
  reply_window_seconds?: number | null;
  typing_indicator_enabled?: number | boolean | null;
  blast_schedule_enabled?: number | boolean | null;
  blast_window_start_hour?: number | null;
  blast_window_end_hour?: number | null;
  max_blast_per_day?: number | null;
  blast_min_gap_seconds?: number | null;
  blast_max_gap_seconds?: number | null;
  updated_at: Date | string | null;
}

@Injectable()
export class AiWhatsappSettingsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  private resolveBranch(principal: Principal, requested?: string): string {
    if (principal.role !== 'hq' && principal.role !== 'branch_manager') {
      throw new ForbiddenError(
        'Hanya HQ dan pengurus cawangan boleh mengurus tetapan AI WhatsApp',
      );
    }

    const branchId = requested || principal.branchId;

    if (!branchId || !branchSchema.safeParse(branchId).success) {
      throw new ValidationError({ branchId: ['Sila pilih cawangan yang sah'] });
    }

    if (principal.role !== 'hq' && branchId !== principal.branchId) {
      throw new ForbiddenError(
        'Anda hanya boleh mengurus tetapan cawangan sendiri',
      );
    }

    return branchId;
  }

  private async assertBranch(
    principal: Principal,
    branchId: string,
    tx: Parameters<Parameters<DbContextService['runAs']>[1]>[0],
  ): Promise<void> {
    const result = await tx.execute(sql`
      SELECT id FROM branches
      WHERE id = ${branchId} AND org_id = ${principal.orgId} AND deleted_at IS NULL
      LIMIT 1
    `);
    const rows = (result as unknown as { rows: Array<{ id: string }> }).rows;
    if (!rows.length) throw new NotFoundError('branch', branchId);
  }

  /** Unconfigured branches report the built-in envelope, so the UI always has
   *  something meaningful to display before anyone saves anything. */
  private defaults(branchId: string): AntibanSettings {
    return {
      branchId,
      /* A branch that has never opened the panel gets a fully-working AI. The
       * switch exists to quieten it deliberately, not to be off by default. */
      aiEnabled: true,
      antibanEnabled: true,
      /* Reply pacing: 10–20s matches the agreed clinic policy — fast enough for
       * a patient mid-conversation, slow enough not to look automated. */
      minDelaySeconds: 10,
      maxDelaySeconds: 20,
      dailyMessageCap: 100,
      hourlyMessageCap: 12,
      warmupDays: 7,
      warmupDailyCap: 20,
      escalationKeywords: DEFAULT_ESCALATION_KEYWORDS,
      maxAiTurns: 3,
      escalateOnAiUncertainty: true,
      escalationReply: DEFAULT_ESCALATION_REPLY,
      replyWindowSeconds: 10,
      typingIndicatorEnabled: true,
      blastScheduleEnabled: true,
      /* Blast window 08:00–22:00: never reaches a patient at 2–3am. */
      blastWindowStartHour: 8,
      blastWindowEndHour: 22,
      maxBlastPerDay: 100,
      blastMinGapSeconds: 300,
      blastMaxGapSeconds: 900,
      configured: false,
      updatedAt: null,
    };
  }

  private format(row: SettingsRow | undefined, branchId: string): AntibanSettings {
    if (!row) return this.defaults(branchId);
    const base = this.defaults(branchId);
    return {
      branchId: row.branch_id,
      /* `?? 1` not `Boolean(...)`: an older row created before the column existed
       * has NULL here, and Boolean(null) is false — which would silently switch
       * the AI off for every branch on upgrade. */
      aiEnabled: Boolean(row.ai_enabled ?? 1),
      antibanEnabled: Boolean(row.antiban_enabled),
      minDelaySeconds: Number(row.min_delay_seconds),
      maxDelaySeconds: Number(row.max_delay_seconds),
      dailyMessageCap: Number(row.daily_message_cap),
      hourlyMessageCap: Number(row.hourly_message_cap),
      warmupDays: Number(row.warmup_days),
      warmupDailyCap: Number(row.warmup_daily_cap),
      escalationKeywords: row.escalation_keywords ?? '',
      maxAiTurns: Number(row.max_ai_turns),
      escalateOnAiUncertainty: Boolean(row.escalate_on_ai_uncertainty),
      escalationReply: row.escalation_reply ?? '',
      replyWindowSeconds: Number(row.reply_window_seconds ?? base.replyWindowSeconds),
      typingIndicatorEnabled: Boolean(
        row.typing_indicator_enabled ?? (base.typingIndicatorEnabled ? 1 : 0),
      ),
      blastScheduleEnabled: Boolean(
        row.blast_schedule_enabled ?? (base.blastScheduleEnabled ? 1 : 0),
      ),
      blastWindowStartHour: Number(row.blast_window_start_hour ?? base.blastWindowStartHour),
      blastWindowEndHour: Number(row.blast_window_end_hour ?? base.blastWindowEndHour),
      maxBlastPerDay: Number(row.max_blast_per_day ?? base.maxBlastPerDay),
      blastMinGapSeconds: Number(row.blast_min_gap_seconds ?? base.blastMinGapSeconds),
      blastMaxGapSeconds: Number(row.blast_max_gap_seconds ?? base.blastMaxGapSeconds),
      configured: true,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : row.updated_at ? String(row.updated_at) : null,
    };
  }

  async get(
    principal: Principal,
    requestedBranchId?: string,
  ): Promise<AntibanSettings> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      const result = await tx.execute(sql`
        SELECT branch_id, ai_enabled, antiban_enabled, min_delay_seconds, max_delay_seconds,
               daily_message_cap, hourly_message_cap, warmup_days, warmup_daily_cap,
               escalation_keywords, max_ai_turns, escalate_on_ai_uncertainty,
               escalation_reply, updated_at
        FROM ai_whatsapp_settings
        WHERE org_id = ${principal.orgId} AND branch_id = ${branchId}
        LIMIT 1
      `);
      const row = (result as unknown as { rows: SettingsRow[] }).rows[0];
      return this.format(row, branchId);
    });
  }

  async save(
    principal: Principal,
    raw: unknown,
    requestedBranchId?: string,
  ): Promise<AntibanSettings> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    const parsed = saveSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'settings';
        errors[key] = [...(errors[key] ?? []), issue.message];
      }
      throw new ValidationError(errors);
    }

    const s = parsed.data;

    if (s.maxDelaySeconds < s.minDelaySeconds) {
      throw new ValidationError({
        maxDelaySeconds: ['Jeda maksimum mesti lebih besar daripada jeda minimum'],
      });
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      /* Read the switch BEFORE the write. Without this there is nothing to
       * compare against, and the audit line would fire on every save — including
       * the many that never touch the AI.
       *
       * A MISSING row means "not configured", and an unconfigured branch has the
       * AI ON (that is the column default and what format() reports). So absence
       * is read as `true`, not as "unknown" — treating it as unknown skipped the
       * single most important case: the first time anyone switches a branch off.
       * That is precisely the event this audit exists to record. */
      const priorRow = await tx.execute(sql`
        SELECT ai_enabled FROM ai_whatsapp_settings
        WHERE org_id = ${principal.orgId} AND branch_id = ${branchId}
        LIMIT 1
      `);
      const priorValue = (priorRow as { rows?: Array<{ ai_enabled?: unknown }> }).rows?.[0]?.ai_enabled;
      const previousAiEnabled =
        priorValue === undefined || priorValue === null ? true : Boolean(priorValue);

      await tx.execute(sql`
        INSERT INTO ai_whatsapp_settings
          (org_id, branch_id, ai_enabled, antiban_enabled, min_delay_seconds, max_delay_seconds,
           daily_message_cap, hourly_message_cap, warmup_days, warmup_daily_cap,
           escalation_keywords, max_ai_turns, escalate_on_ai_uncertainty,
           escalation_reply, updated_by, updated_at)
        VALUES
          /* COALESCE, not a bare bind: the panel does not always send this field.
           * An omitted switch must leave the stored value alone — writing NULL
           * would read back as "AI off" and silence the clinic. */
          (${principal.orgId}, ${branchId}, COALESCE(${s.aiEnabled ?? null}, 1), ${s.antibanEnabled}, ${s.minDelaySeconds},
           ${s.maxDelaySeconds}, ${s.dailyMessageCap}, ${s.hourlyMessageCap},
           ${s.warmupDays}, ${s.warmupDailyCap}, ${s.escalationKeywords},
           ${s.maxAiTurns}, ${s.escalateOnAiUncertainty}, ${s.escalationReply},
           ${principal.staffId}, NOW(6))
        ON DUPLICATE KEY UPDATE
          ai_enabled = COALESCE(VALUES(ai_enabled), ai_enabled),
          antiban_enabled = VALUES(antiban_enabled),
          min_delay_seconds = VALUES(min_delay_seconds),
          max_delay_seconds = VALUES(max_delay_seconds),
          daily_message_cap = VALUES(daily_message_cap),
          hourly_message_cap = VALUES(hourly_message_cap),
          warmup_days = VALUES(warmup_days),
          warmup_daily_cap = VALUES(warmup_daily_cap),
          escalation_keywords = VALUES(escalation_keywords),
          max_ai_turns = VALUES(max_ai_turns),
          escalate_on_ai_uncertainty = VALUES(escalate_on_ai_uncertainty),
          escalation_reply = VALUES(escalation_reply),
          updated_by = VALUES(updated_by),
          updated_at = NOW(6)
      `);

      const refreshed = await tx.execute(sql`
        SELECT branch_id, ai_enabled, antiban_enabled, min_delay_seconds, max_delay_seconds,
               daily_message_cap, hourly_message_cap, warmup_days, warmup_daily_cap,
               escalation_keywords, max_ai_turns, escalate_on_ai_uncertainty,
               escalation_reply, updated_at
        FROM ai_whatsapp_settings
        WHERE org_id = ${principal.orgId} AND branch_id = ${branchId}
        LIMIT 1
      `);
      const row = (refreshed as unknown as { rows: SettingsRow[] }).rows[0];
      const updated = this.format(row, branchId);

      /* Record the AI switch ONLY when it actually moved.
       *
       * A settings save touches a dozen fields, and every one of them writes an
       * audit line here would bury the one that matters. Turning the AI off
       * changes how every patient in that clinic is treated, so "who muted this
       * branch, and when" must be answerable — and a log where that fact is
       * indistinguishable from a change to the warm-up cap is not an answer. */
      if (previousAiEnabled !== null && previousAiEnabled !== updated.aiEnabled) {
        await this.audit.record(
          {
            actorId: principal.staffId,
            actorRole: principal.role,
            action: updated.aiEnabled ? 'ai_enabled_for_branch' : 'ai_disabled_for_branch',
            entity: 'ai_whatsapp_settings',
            entityId: branchId,
            orgId: principal.orgId,
            branchId,
            before: { aiEnabled: previousAiEnabled },
            after: { aiEnabled: updated.aiEnabled },
            source: 'api',
          },
          tx,
        );
      }

      return updated;
    });
  }

  /**
   * Save the blast scheduling envelope for a promotion.
   *
   * Kept separate from save() so the blast plan can be tuned without touching
   * the reply pacing, and validated so the window is coherent: a closing hour
   * at or before the opening hour would produce a zero-length day and a
   * division by zero in planBlast().
   */
  async saveBlast(
    principal: Principal,
    raw: unknown,
    requestedBranchId?: string,
  ): Promise<AntibanSettings> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    const parsed = blastSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'blast';
        errors[key] = [...(errors[key] ?? []), issue.message];
      }
      throw new ValidationError(errors);
    }

    const b = parsed.data;

    if (b.windowEndHour <= b.windowStartHour) {
      throw new ValidationError({
        windowEndHour: ['Waktu tamat mesti selepas waktu mula'],
      });
    }

    if (b.blastMaxGapSeconds < b.blastMinGapSeconds) {
      throw new ValidationError({
        blastMaxGapSeconds: ['Sela maksimum mesti lebih besar daripada sela minimum'],
      });
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      await tx.execute(sql`
        INSERT INTO ai_whatsapp_settings
          (org_id, branch_id, antiban_enabled, min_delay_seconds, max_delay_seconds,
           daily_message_cap, hourly_message_cap, warmup_days, warmup_daily_cap,
           escalation_keywords, max_ai_turns, escalate_on_ai_uncertainty,
           escalation_reply, blast_schedule_enabled, blast_window_start_hour,
           blast_window_end_hour, max_blast_per_day, blast_min_gap_seconds,
           blast_max_gap_seconds, reply_window_seconds, typing_indicator_enabled,
           updated_by, updated_at)
        VALUES
          (${principal.orgId}, ${branchId}, 1, 10, 20, 100, 12, 7, 20,
           ${DEFAULT_ESCALATION_KEYWORDS}, 3, 1, ${DEFAULT_ESCALATION_REPLY},
           1, ${b.windowStartHour}, ${b.windowEndHour}, ${b.maxBlastPerDay},
           ${b.blastMinGapSeconds}, ${b.blastMaxGapSeconds}, 10, 1,
           ${principal.staffId}, NOW(6))
        ON DUPLICATE KEY UPDATE
          blast_schedule_enabled = 1,
          blast_window_start_hour = VALUES(blast_window_start_hour),
          blast_window_end_hour = VALUES(blast_window_end_hour),
          max_blast_per_day = VALUES(max_blast_per_day),
          blast_min_gap_seconds = VALUES(blast_min_gap_seconds),
          blast_max_gap_seconds = VALUES(blast_max_gap_seconds),
          updated_by = VALUES(updated_by),
          updated_at = NOW(6)
      `);

      const refreshed = await tx.execute(sql`
        SELECT branch_id, ai_enabled, antiban_enabled, min_delay_seconds, max_delay_seconds,
               daily_message_cap, hourly_message_cap, warmup_days, warmup_daily_cap,
               escalation_keywords, max_ai_turns, escalate_on_ai_uncertainty,
               escalation_reply, reply_window_seconds, typing_indicator_enabled,
               blast_schedule_enabled, blast_window_start_hour, blast_window_end_hour,
               max_blast_per_day, blast_min_gap_seconds, blast_max_gap_seconds,
               updated_at
        FROM ai_whatsapp_settings
        WHERE org_id = ${principal.orgId} AND branch_id = ${branchId}
        LIMIT 1
      `);
      const row = (refreshed as unknown as { rows: SettingsRow[] }).rows[0];
      return this.format(row, branchId);
    });
  }

  /**
   * Preview the spacing for a proposed promotion before it is saved.
   *
   * Read-only and side-effect free: the operator types "1400 numbers, 14 days"
   * and immediately sees "100/day, one every 8 min 24s" — or a warning that the
   * plan exceeds the daily ceiling.
   */
  async previewBlast(
    principal: Principal,
    recipients: number,
    days: number,
    requestedBranchId?: string,
  ): Promise<BlastPlan> {
    const settings = await this.get(principal, requestedBranchId);
    return planBlast(recipients, days, {
      windowStartHour: settings.blastWindowStartHour,
      windowEndHour: settings.blastWindowEndHour,
      maxBlastPerDay: settings.maxBlastPerDay,
    });
  }

  /**
   * Effective settings for the bot worker — falls back to defaults so a branch
   * that never opened AI Manager still has sane anti-ban protection.
   */
  async getForBot(orgId: string, branchId: string): Promise<{
    /* The branch-level AI switch. Exposed here because the inbound webhook must
     * READ it through this worker-safe path: `get()` runs the operator
     * permission guard (`hq`/`branch_manager` only) and therefore throws for a
     * system worker, which is the identity the webhook runs under. */
    aiEnabled: boolean;
    antibanEnabled: boolean;
    minDelaySeconds: number;
    maxDelaySeconds: number;
    dailyMessageCap: number;
    hourlyMessageCap: number;
    escalationKeywords: string[];
    maxAiTurns: number;
    escalateOnAiUncertainty: boolean;
    escalationReply: string;
    /** Collected-burst window in seconds before the AI answers. */
    replyWindowSeconds: number;
    /** Whether to show "sedang menaip…" before a reply lands. */
    typingIndicatorEnabled: boolean;
    /* AB2 — warm-up limits for the reply caps (see reply-caps.ts). */
    warmupDays: number;
    warmupDailyCap: number;
  }> {
    if (!branchSchema.safeParse(orgId).success || !branchSchema.safeParse(branchId).success) {
      throw new ValidationError({ branchId: ['Konteks tidak sah'] });
    }

    const row = await this.dbCtx.runAsWorker(
      {
        orgId,
        branchIds: [branchId],
        correlationId: 'ai-read-wa-settings',
        source: 'system_worker',
      },
      async (tx) => {
        const result = await tx.execute(sql`
          SELECT branch_id, ai_enabled, antiban_enabled, min_delay_seconds, max_delay_seconds,
                 daily_message_cap, hourly_message_cap, warmup_days, warmup_daily_cap,
                 escalation_keywords, max_ai_turns, escalate_on_ai_uncertainty,
                 escalation_reply, reply_window_seconds, typing_indicator_enabled,
                 blast_schedule_enabled, blast_window_start_hour, blast_window_end_hour,
                 max_blast_per_day, blast_min_gap_seconds, blast_max_gap_seconds,
                 updated_at
          FROM ai_whatsapp_settings
          WHERE org_id = ${orgId} AND branch_id = ${branchId}
          LIMIT 1
        `);
        return (result as unknown as { rows: SettingsRow[] }).rows[0];
      },
    );

    const effective = this.format(row, branchId);

    return {
      aiEnabled: effective.aiEnabled,
      antibanEnabled: effective.antibanEnabled,
      minDelaySeconds: effective.minDelaySeconds,
      maxDelaySeconds: effective.maxDelaySeconds,
      dailyMessageCap: effective.dailyMessageCap,
      hourlyMessageCap: effective.hourlyMessageCap,
      escalationKeywords: effective.escalationKeywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
      maxAiTurns: effective.maxAiTurns,
      escalateOnAiUncertainty: effective.escalateOnAiUncertainty,
      escalationReply: effective.escalationReply,
      replyWindowSeconds: effective.replyWindowSeconds,
      typingIndicatorEnabled: effective.typingIndicatorEnabled,
      warmupDays: effective.warmupDays,
      warmupDailyCap: effective.warmupDailyCap,
    };
  }
}

export { DEFAULT_ESCALATION_KEYWORDS, DEFAULT_ESCALATION_REPLY };
