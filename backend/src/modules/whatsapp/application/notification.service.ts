import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DbContextService, ScopedSystemWorkerContext } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { NotFoundError } from '../../../shared/errors/errors';
import {
  NOTIFICATION_RULES,
  NotificationKind,
  NotificationSeverity,
  describeNotification,
  severityFor,
} from '../domain/notification';

/**
 * FASA 5D-B — producing, reading and clearing clinic notifications.
 *
 * WHY A SERVICE AND NOT JUST A WORKER
 *
 * Event producers (the webhook, the transport worker, the blast path) must be
 * able to raise a notification without knowing how it is stored or how bursts
 * are merged. Putting that behind one method means the coalescing rule is
 * applied in exactly one place — the failure mode of the alternative is a rule
 * re-implemented per call site, drifting until two kinds of event merge and a
 * third does not.
 *
 * DELIVERY IS BEST-EFFORT, RECORD IS NOT
 *
 * Raising a notification must never break the thing that raised it. A patient
 * message that arrives while the notification table is unreachable must still be
 * stored and still be answered: a failed alert is a missed alert, not a lost
 * patient. So every call catches, logs, and returns — the caller continues.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly dbCtx: DbContextService) {}

  /**
   * Raise an event. Merges into an open notification when the rule allows.
   *
   * Never throws: see the note above. Returns true if a row was written or
   * updated, false if the attempt failed — callers may ignore it.
   */
  async raise(input: {
    orgId: string;
    branchId: string | null;
    kind: NotificationKind;
    entityId?: string | null;
    entityType?: string | null;
    branchName?: string | null;
    /** Extra facts for the copy, e.g. the longest wait. */
    waitedMinutes?: number | null;
  }): Promise<boolean> {
    const rule = NOTIFICATION_RULES[input.kind];

    const ctx: ScopedSystemWorkerContext = {
      orgId: input.orgId,
      branchIds: input.branchId ? [input.branchId] : [],
      correlationId: `notify-${input.kind}`,
      source: 'system_worker',
    };

    try {
      return await this.dbCtx.runAsWorker(ctx, async (tx) => {
        const entityId = input.entityId ?? '';

        /* ONE STATEMENT, NOT A READ THEN A WRITE.
         *
         * The previous version selected an open notification and then inserted
         * one. Two events arriving together both found nothing and both
         * inserted: a burst of eight waiting patients produced two rows, and a
         * concurrent variant produced a single row counting FOUR — four events
         * lost. An operator would have read "4 waiting" when eight were.
         *
         * The database now decides. `unread_key` is a STORED generated column
         * that holds the identity tuple while the row is unread and NULL once it
         * is read (see migration 0013); a unique index sits on it. NULLs do not
         * collide, so read rows leave the constraint by themselves — which is
         * exactly the rule "an event after a read starts a fresh row".
         *
         * ON DUPLICATE KEY UPDATE therefore merges atomically: the count and
         * severity are recomputed inside the statement, so no event can be lost
         * to a lost update.
         *
         * The coalescing WINDOW cannot be expressed in the key. A burst that
         * spans the window boundary is supposed to start a new row, and it does:
         * the update is guarded by the age check, and when the row is too old the
         * count restarts at 1.
         */
        const windowMs = rule.coalesce ? rule.windowMinutes * 60_000 : 0;

        /* Copy for a fresh row; the merged copy is recomputed below from the
         * count the database reports, so the title always matches the row. */
        const first = describeNotification({
          kind: input.kind,
          count: 1,
          branchName: input.branchName,
          waitedMinutes: input.waitedMinutes,
        });

        if (!rule.coalesce) {
          await tx.execute(sql`
            INSERT INTO wa_notifications
              (id, org_id, branch_id, kind, severity, title, body,
               entity_id, entity_type, occurrence_count, first_at, last_at)
            VALUES
              (UUID(), ${input.orgId}, ${input.branchId}, ${input.kind},
               ${severityFor(rule, 1)}, ${first.title}, ${first.body},
               ${entityId || null}, ${input.entityType ?? null}, 1, NOW(6), NOW(6))
          `);
          return true;
        }

        /* Coalescable kinds: merge into the open row for this identity, or
         * create it. `ON DUPLICATE KEY UPDATE` keys off the unique index on
         * unread_key, so the read-then-write race is gone.
         *
         * The row is created with the identity columns and only updated on
         * collision.
         *
         * A row older than the window must NOT absorb the event: the CASE resets
         * it to 1 and re-stamps first_at, so a burst after the gap reads as a new
         * event. */
        const inserted = await tx.execute(sql`
          INSERT INTO wa_notifications
            (id, org_id, branch_id, kind, severity, title, body,
             entity_id, entity_type, occurrence_count, first_at, last_at)
          VALUES
            (UUID(), ${input.orgId}, ${input.branchId}, ${input.kind},
             ${severityFor(rule, 1)}, ${first.title}, ${first.body},
             ${entityId || null}, ${input.entityType ?? null}, 1, NOW(6), NOW(6))
          ON DUPLICATE KEY UPDATE
            occurrence_count = CASE
              WHEN wa_notifications.last_at < NOW(6) - INTERVAL ${windowMs / 1000} SECOND
              THEN 1
              ELSE wa_notifications.occurrence_count + 1
            END,
            first_at = CASE
              WHEN wa_notifications.last_at < NOW(6) - INTERVAL ${windowMs / 1000} SECOND
              THEN NOW(6)
              ELSE wa_notifications.first_at
            END,
            last_at = NOW(6),
            updated_at = NOW(6)
        `);

        /* Re-write the copy from the count the database now holds, so a merged
         * row says "5 pesakit menunggu" rather than "1". Read back by id: the
         * upsert cannot return the row, and the generated key is not the primary
         * key, so the id is fetched via the unique identity tuple. */
        const after = await tx.execute(sql`
          SELECT id, occurrence_count AS c
          FROM wa_notifications
          WHERE org_id = ${input.orgId}
            AND deleted_at IS NULL
            AND read_at IS NULL
            AND kind = ${input.kind}
            AND ${input.branchId ?? null} <=> branch_id
            AND COALESCE(entity_id, '') = ${entityId}
          ORDER BY last_at DESC
          LIMIT 1
        `);

        const landed = (after as { rows?: Array<{ id?: string; c?: unknown }> }).rows?.[0];
        const affected = (inserted as { affectedRows?: number }).affectedRows ?? 0;

        /* affectedRows is 1 for an insert, 2 for a coalesced update. On an
         * update the stored count is authoritative; recompute severity and copy
         * from it. */
        if (landed && affected !== 1) {
          const count = Number(landed.c);
          const merged = describeNotification({
            kind: input.kind,
            count,
            branchName: input.branchName,
            waitedMinutes: input.waitedMinutes,
          });
          await tx.execute(sql`
            UPDATE wa_notifications
            SET severity = ${severityFor(rule, count)},
                title = ${merged.title},
                body = ${merged.body}
            WHERE id = ${landed.id}
          `);
        }

        return true;
      });
    } catch (error) {
      /* Deliberately swallowed. A notification that cannot be written must not
       * take down the patient message that triggered it. */
      this.logger.error(
        `Gagal rekod notifikasi (${input.kind}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** Unread + recent notifications for the operator's scope. */
  async list(p: Principal, limit = 30): Promise<Array<Record<string, unknown>>> {
    return this.dbCtx.runAs(p, async (tx) => {
      const result = await tx.execute(sql`
        SELECT n.id, n.kind, n.severity, n.title, n.body, n.entity_id AS entityId,
               n.occurrence_count AS occurrenceCount, n.first_at AS firstAt,
               n.last_at AS lastAt, n.read_at AS readAt, n.branch_id AS branchId,
               b.short_name AS branchName
        FROM wa_notifications n
        LEFT JOIN branches b ON b.id = n.branch_id
        WHERE n.org_id = ${p.orgId}
          AND n.deleted_at IS NULL
          /* A branch user sees their own branch plus org-wide events; hq sees
           * everything. RLS enforces the branch part too — this keeps the two
           * consistent rather than relying on one.
           *
           * The hq case branches in JS rather than emitting a bound boolean
           * compared against 1: that is a collation-sensitive expression in
           * MySQL and it fails outright across two charsets. */
          AND ${p.role === 'hq' ? sql`1 = 1` : sql`(n.branch_id IS NULL OR n.branch_id = ${p.branchId})`}
        ORDER BY (n.read_at IS NULL) DESC, n.last_at DESC
        LIMIT ${Math.min(Math.max(limit, 1), 100)}
      `);
      return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    });
  }

  /** Unread count, for the bell badge. */
  async unreadCount(p: Principal): Promise<number> {
    return this.dbCtx.runAs(p, async (tx) => {
      const result = await tx.execute(sql`
        SELECT COUNT(*) AS total
        FROM wa_notifications
        WHERE org_id = ${p.orgId}
          AND deleted_at IS NULL
          AND read_at IS NULL
          AND ${p.role === 'hq' ? sql`1 = 1` : sql`(branch_id IS NULL OR branch_id = ${p.branchId})`}
      `);
      const rows = (result as { rows?: Array<{ total?: unknown }> }).rows;
      return Number(rows?.[0]?.total ?? 0);
    });
  }

  /** Mark one notification read. */
  async markRead(p: Principal, id: string): Promise<void> {
    const changed = await this.dbCtx.runAs(p, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE wa_notifications
        SET read_at = NOW(6), read_by = ${p.staffId}, updated_at = NOW(6)
        WHERE id = ${id} AND org_id = ${p.orgId} AND deleted_at IS NULL AND read_at IS NULL
      `);
      const outcome = result as { rowsAffected?: unknown; affectedRows?: unknown };
      return Number(outcome.rowsAffected ?? outcome.affectedRows ?? 0);
    });

    if (changed === 0) {
      /* Either it does not exist, belongs to another tenant, or was already
       * read. The last is not an error — a double-click on a bell must not 404. */
      const exists = await this.dbCtx.runAs(p, async (tx) => {
        const r = await tx.execute(sql`
          SELECT id FROM wa_notifications
          WHERE id = ${id} AND org_id = ${p.orgId} AND deleted_at IS NULL LIMIT 1
        `);
        return (((r as { rows?: unknown[] }).rows) ?? []).length > 0;
      });
      if (!exists) throw new NotFoundError('notification', id);
      return;
    }
  }

  /** Mark everything in scope read — the "clear all" button. */
  async markAllRead(p: Principal): Promise<number> {
    const changed = await this.dbCtx.runAs(p, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE wa_notifications
        SET read_at = NOW(6), read_by = ${p.staffId}, updated_at = NOW(6)
        WHERE org_id = ${p.orgId}
          AND deleted_at IS NULL
          AND read_at IS NULL
          AND ${p.role === 'hq' ? sql`1 = 1` : sql`(branch_id IS NULL OR branch_id = ${p.branchId})`}
      `);
      const outcome = result as { rowsAffected?: unknown; affectedRows?: unknown };
      return Number(outcome.rowsAffected ?? outcome.affectedRows ?? 0);
    });
    return changed;
  }
}

export { NotificationSeverity };
