/**
 * Resolve a WAHA session name to the branch that owns it.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The WhatsApp webhook pinned its branch to a hard-coded UUID constant. When
 * that branch was re-seeded the UUID stopped existing, so every inbound message
 * was attributed to a branch that was not there: no channel matched, no settings
 * row matched, and the bot silently fell back to code defaults. With one number
 * per branch that is fatal — all fourteen branches would share a single (dead)
 * identity, and anything an operator changed in the UI would never reach the bot.
 *
 * WAHA already tells us which session a message belongs to (`body.session` on
 * the webhook payload). This service turns that into an org + branch, so every
 * downstream read (prompt, settings, channel, conversation) is scoped correctly.
 *
 * SOURCE OF TRUTH
 *
 * `wa_channels.session_name` is authoritative because it also carries the phone,
 * status and health the Hub displays. `branches.whatsapp_session` is the
 * denormalised copy on the branch row and is used as a FALLBACK, so a branch
 * whose session is configured before its channel row exists still routes
 * correctly instead of being dropped.
 *
 * NOTE ON SCOPE — this lookup is deliberately org-agnostic. The session name is
 * the only input, and the caller does not yet know which org it belongs to. The
 * MySQL edition's `runAsWorker` opens a transaction without applying row-level
 * scoping (the legacy database GUC/RLS mechanism was removed in the migration), so an
 * unscoped SELECT here is the same visibility the rest of the module already has.
 *
 * CACHING
 *
 * The webhook is a hot path and this lookup runs on every inbound message, so
 * results are cached briefly. A short TTL (default 30s) keeps the query count
 * down while letting an operator's channel change take effect without a restart.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DbContextService } from '../../../core/auth/db-context.service';

export interface ResolvedBranch {
  orgId: string;
  branchId: string;
  branchName: string;
  sessionName: string;
  /** How the mapping was found — useful in logs when diagnosing routing. */
  source: 'channel' | 'branch';
}

interface BranchRow {
  id: string;
  org_id: string;
  short_name: string;
  full_name: string;
}

const CACHE_TTL_MS = 30_000;

/**
 * Worker scope that spans organisations.
 *
 * An empty `branchIds` would trip the service's own guard, so a single sentinel
 * is supplied. The value is not used as a filter (no RLS in the MySQL edition)
 * and the session name remains the only real constraint.
 */
const ALL_ORGS_SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  branchIds: ['00000000-0000-0000-0000-000000000001'],
  correlationId: 'wa-resolve-branch',
  source: 'system_worker' as const,
};

@Injectable()
export class WaBranchResolverService {
  private readonly logger = new Logger(WaBranchResolverService.name);
  private readonly cache = new Map<string, { value: ResolvedBranch | null; expiresAt: number }>();

  constructor(private readonly dbCtx: DbContextService) {}

  /**
   * Resolve a session name to its branch, or null when nothing matches.
   *
   * Returns null rather than throwing: the caller decides how loud to be, and
   * an unknown session is a configuration gap, not an exception. It must NEVER
   * fall back to "some branch" — attributing a patient to the wrong clinic is
   * worse than dropping the message.
   */
  async resolve(sessionName: string | null | undefined): Promise<ResolvedBranch | null> {
    const key = String(sessionName ?? '').trim();
    if (!key) return null;

    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await this.lookup(key);

    /* `undefined` means the lookup itself failed (DB unreachable). That must NOT
     * be cached as "no such branch" — a transient outage would otherwise blank
     * out routing for the whole TTL, dropping every patient message for 30s
     * after the database recovers. Only a definite answer is cached. */
    if (value !== undefined) {
      this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value ?? null;
  }

  /** Drop a cached mapping so a channel change is picked up immediately. */
  invalidate(sessionName?: string): void {
    if (sessionName) this.cache.delete(sessionName);
    else this.cache.clear();
  }

  /** Returns null when no branch matches; `undefined` when the lookup itself failed. */
  private async lookup(sessionName: string): Promise<ResolvedBranch | null | undefined> {
    try {
      const found = await this.dbCtx.runAsWorker(ALL_ORGS_SCOPE, async (tx) => {
        /* 1. Authoritative: the channel row — but only the branch's PRIMARY
         * channel routes inbound traffic (0029). A spare number sitting in
         * the table after a switch must not answer patients behind the
         * branch's back; its messages resolve to nothing and get dropped
         * loudly rather than attributed silently. */
        const viaChannel = await tx.execute(sql`
          SELECT b.id, b.org_id, b.short_name, b.full_name
          FROM wa_channels c
          JOIN branches b ON b.id = c.branch_id AND b.deleted_at IS NULL
          WHERE c.session_name = ${sessionName}
            AND c.deleted_at IS NULL
            AND c.is_primary = 1
          LIMIT 1
        `);
        const row = (viaChannel as unknown as { rows: BranchRow[] }).rows?.[0];
        if (row) return { row, source: 'channel' as const };

        /* 2. Fallback: the branch row's own session field. */
        const viaBranch = await tx.execute(sql`
          SELECT id, org_id, short_name, full_name
          FROM branches
          WHERE whatsapp_session = ${sessionName}
            AND deleted_at IS NULL
          LIMIT 1
        `);
        const row2 = (viaBranch as unknown as { rows: BranchRow[] }).rows?.[0];
        if (row2) return { row: row2, source: 'branch' as const };

        return null;
      });

      if (!found) {
        this.logger.warn(`Sesi WhatsApp "${sessionName}" tidak dipetakan kepada mana-mana cawangan`);
        return null;
      }

      return {
        orgId: found.row.org_id,
        branchId: found.row.id,
        branchName: found.row.short_name || found.row.full_name,
        sessionName,
        source: found.source,
      };
    } catch (error) {
      /* Indeterminate: report the failure and let the caller decide. `undefined`
       * keeps this out of the cache so the next message retries. */
      this.logger.error(
        `Gagal memetakan sesi "${sessionName}": ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  }
}
