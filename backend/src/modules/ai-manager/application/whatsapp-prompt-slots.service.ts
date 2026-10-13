import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/errors';

/**
 * Prompt slots — up to three named variants per branch, exactly one active.
 *
 * The active slot is what the WhatsApp bot uses to answer. Operators draft and
 * compare variants here, test them in the Playground, then switch which one is
 * live without retyping anything.
 */

const MAX_SLOTS = 3;

const branchSchema = z.string().uuid();

const slotSchema = z.number().int().min(1).max(MAX_SLOTS);

const saveSchema = z.object({
  name: z.string().trim().min(1).max(64),
  prompt: z.string().trim().min(20).max(20000),
  version: z.number().int().min(0).max(2147483646),
}).strict();

export interface PromptSlot {
  slot: number;
  name: string;
  prompt: string;
  version: number;
  isActive: boolean;
  configured: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface PromptRow {
  slot: number;
  name: string;
  prompt: string;
  version: number;
  is_active: number | boolean;
  updated_by: string;
  updated_at: Date | string;
}

@Injectable()
export class WhatsappPromptSlotsService {
  constructor(private readonly dbCtx: DbContextService) {}

  /** HQ may act on any branch; a branch manager only on their own. */
  private resolveBranch(principal: Principal, requested?: string): string {
    if (principal.role !== 'hq' && principal.role !== 'branch_manager') {
      throw new ForbiddenError(
        'Hanya HQ dan pengurus cawangan boleh mengurus prompt WhatsApp',
      );
    }

    const branchId = requested || principal.branchId;

    if (!branchId || !branchSchema.safeParse(branchId).success) {
      throw new ValidationError({ branchId: ['Sila pilih cawangan yang sah'] });
    }

    if (principal.role !== 'hq' && branchId !== principal.branchId) {
      throw new ForbiddenError(
        'Anda hanya boleh mengurus prompt cawangan sendiri',
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

  private format(row?: PromptRow, slot?: number): PromptSlot {
    if (!row) {
      return {
        slot: slot ?? 1,
        name: '',
        prompt: '',
        version: 0,
        isActive: false,
        configured: false,
        updatedBy: null,
        updatedAt: null,
      };
    }
    return {
      slot: Number(row.slot),
      name: row.name ?? '',
      prompt: row.prompt,
      version: Number(row.version),
      isActive: Boolean(row.is_active),
      configured: true,
      updatedBy: row.updated_by ?? null,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
    };
  }

  /** All three slots, always returned (empty slots included) so the UI can
   *  render a stable grid without inventing placeholders. */
  async list(
    principal: Principal,
    requestedBranchId?: string,
  ): Promise<{ branchId: string; maxSlots: number; slots: PromptSlot[] }> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      const result = await tx.execute(sql`
        SELECT slot, name, prompt, version, is_active, updated_by, updated_at
        FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND deleted_at IS NULL
        ORDER BY slot ASC
      `);

      const rows = (result as unknown as { rows: PromptRow[] }).rows;
      const bySlot = new Map(rows.map((r) => [Number(r.slot), r]));

      const slots: PromptSlot[] = [];
      for (let s = 1; s <= MAX_SLOTS; s++) {
        slots.push(this.format(bySlot.get(s), s));
      }

      return { branchId, maxSlots: MAX_SLOTS, slots };
    });
  }

  /** Insert or update one slot. `version` guards lost updates (0 = new). */
  /**
   * Boss #3 — apply a BUILT-IN prompt preset (Santai / Profesional) to a
   * branch's preset slot (2 or 3). The preset content comes from
   * domain/prompt-presets (shared safety rules + one voice layer), so an
   * operator who never wrote a prompt still gets a complete, safe
   * starting point. The row lands inactive — the operator reviews it
   * and activates deliberately; a preset must never silently change the
   * voice a branch is currently using.
   */
  async applyPreset(
    principal: Principal,
    presetSlot: number,
    requestedBranchId?: string,
  ): Promise<PromptSlot> {
    const { PROMPT_PRESETS } = await import('../domain/prompt-presets');
    const preset = PROMPT_PRESETS.find((p) => p.slot === presetSlot);
    if (!preset) {
      throw new ValidationError({ slot: ['Preset tidak wujud'] });
    }
    return this.save(
      principal,
      { slot: preset.slot, name: preset.name, prompt: preset.prompt, version: 0 },
      requestedBranchId,
    );
  }

  async save(
    principal: Principal,
    raw: unknown,
    requestedBranchId?: string,
  ): Promise<PromptSlot> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    const parsed = saveSchema.extend({ slot: slotSchema }).strict().safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'prompt';
        errors[key] = [...(errors[key] ?? []), issue.message];
      }
      throw new ValidationError(errors);
    }

    const { slot, name, prompt, version } = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      if (version === 0) {
        /* A slot row can already exist for this (org, branch, slot) because a
         * deleted prompt is SOFT-deleted — the composite PK stays occupied.
         * A blind INSERT IGNORE would report "another user saved this" for the
         * operator's own deletion, permanently locking the slot. So: look
         * first, then either create, or restore the soft-deleted row. Both
         * paths stay fail-closed against a genuine concurrent write. */
        const found = await tx.execute(sql`
          SELECT deleted_at FROM whatsapp_bot_prompts
          WHERE org_id = ${principal.orgId}
            AND branch_id = ${branchId}
            AND slot = ${slot}
          LIMIT 1
        `);
        const existing = (
          found as unknown as { rows: Array<{ deleted_at: unknown }> }
        ).rows[0];

        if (!existing) {
          const inserted = await tx.execute(sql`
            INSERT IGNORE INTO whatsapp_bot_prompts
              (org_id, branch_id, slot, name, prompt, version, is_active, updated_by, updated_at, deleted_at)
            VALUES
              (${principal.orgId}, ${branchId}, ${slot}, ${name}, ${prompt}, 1, 0,
               ${principal.staffId}, NOW(6), NULL)
          `);

          if (Number((inserted as { affectedRows?: number }).affectedRows ?? 0) < 1) {
            throw new ConflictError(
              'Slot ini telah disimpan oleh pengguna lain. Muat semula sebelum mengedit.',
            );
          }
        } else if (existing.deleted_at != null) {
          /* Restoring a previously deleted slot: content is rewritten, the
           * version continues from where it stopped, and it comes back
           * INACTIVE so nothing silently goes live. */
          const restored = await tx.execute(sql`
            UPDATE whatsapp_bot_prompts
            SET name = ${name},
                prompt = ${prompt},
                version = version + 1,
                is_active = 0,
                deleted_at = NULL,
                updated_by = ${principal.staffId},
                updated_at = NOW(6)
            WHERE org_id = ${principal.orgId}
              AND branch_id = ${branchId}
              AND slot = ${slot}
              AND deleted_at IS NOT NULL
          `);

          if (Number((restored as { affectedRows?: number }).affectedRows ?? 0) < 1) {
            throw new ConflictError(
              'Slot ini baru sahaja dikemas kini oleh pengguna lain. Muat semula sebelum mengedit.',
            );
          }
        } else {
          throw new ConflictError(
            'Slot ini telah disimpan oleh pengguna lain. Muat semula sebelum mengedit.',
          );
        }
      } else {
        const updated = await tx.execute(sql`
          UPDATE whatsapp_bot_prompts
          SET name = ${name},
              prompt = ${prompt},
              version = version + 1,
              updated_by = ${principal.staffId},
              updated_at = NOW(6)
          WHERE org_id = ${principal.orgId}
            AND branch_id = ${branchId}
            AND slot = ${slot}
            AND version = ${version}
            AND deleted_at IS NULL
        `);

        if (Number((updated as { affectedRows?: number }).affectedRows ?? 0) < 1) {
          throw new ConflictError(
            'Prompt ini telah berubah. Muat semula untuk versi terkini sebelum menyimpan.',
          );
        }
      }

      const refreshed = await tx.execute(sql`
        SELECT slot, name, prompt, version, is_active, updated_by, updated_at
        FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId} AND branch_id = ${branchId} AND slot = ${slot}
        LIMIT 1
      `);
      const row = (refreshed as unknown as { rows: PromptRow[] }).rows[0];
      if (!row) throw new ConflictError('Prompt gagal dibaca selepas disimpan.');
      return this.format(row, slot);
    });
  }

  /** Mark one slot active; every other slot on the branch is deactivated. */
  async activate(
    principal: Principal,
    slot: number,
    requestedBranchId?: string,
  ): Promise<PromptSlot> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    const slotParsed = slotSchema.safeParse(slot);
    if (!slotParsed.success) {
      throw new ValidationError({ slot: ['Slot mesti antara 1 hingga 3'] });
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      const existing = await tx.execute(sql`
        SELECT slot, name, prompt, version, is_active, updated_by, updated_at
        FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND slot = ${slot}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const row = (existing as unknown as { rows: PromptRow[] }).rows[0];
      if (!row) {
        throw new NotFoundError('prompt slot', String(slot));
      }

      /* Deactivate siblings first — at most one active prompt per branch. */
      await tx.execute(sql`
        UPDATE whatsapp_bot_prompts
        SET is_active = 0
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND deleted_at IS NULL
          AND is_active = 1
      `);

      await tx.execute(sql`
        UPDATE whatsapp_bot_prompts
        SET is_active = 1,
            updated_by = ${principal.staffId},
            updated_at = NOW(6)
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND slot = ${slot}
          AND deleted_at IS NULL
      `);

      const refreshed = await tx.execute(sql`
        SELECT slot, name, prompt, version, is_active, updated_by, updated_at
        FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId} AND branch_id = ${branchId} AND slot = ${slot}
        LIMIT 1
      `);
      const active = (refreshed as unknown as { rows: PromptRow[] }).rows[0];
      if (!active) throw new ConflictError('Prompt gagal dibaca selepas diaktifkan.');
      return this.format(active, slot);
    });
  }

  /** Remove a slot. An active prompt cannot be deleted — switch first. */
  async remove(
    principal: Principal,
    slot: number,
    requestedBranchId?: string,
  ): Promise<{ slot: number; deleted: boolean }> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    const slotParsed = slotSchema.safeParse(slot);
    if (!slotParsed.success) {
      throw new ValidationError({ slot: ['Slot mesti antara 1 hingga 3'] });
    }

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      const existing = await tx.execute(sql`
        SELECT is_active FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND slot = ${slot}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const row = (existing as unknown as { rows: Array<{ is_active: number | boolean }> }).rows[0];
      if (!row) throw new NotFoundError('prompt slot', String(slot));

      if (row.is_active) {
        throw new ConflictError(
          'Prompt yang sedang aktif tidak boleh dipadam. Aktifkan prompt lain dahulu.',
        );
      }

      await tx.execute(sql`
        UPDATE whatsapp_bot_prompts
        SET deleted_at = NOW(6),
            updated_by = ${principal.staffId},
            updated_at = NOW(6)
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND slot = ${slot}
      `);

      return { slot, deleted: true };
    });
  }

  /** Fetch one slot — used by the Playground to run a specific variant. */
  async getSlotForTest(
    principal: Principal,
    slot: number,
    requestedBranchId?: string,
  ): Promise<PromptSlot> {
    const branchId = this.resolveBranch(principal, requestedBranchId);

    return this.dbCtx.runAs(principal, async (tx) => {
      await this.assertBranch(principal, branchId, tx);

      const result = await tx.execute(sql`
        SELECT slot, name, prompt, version, is_active, updated_by, updated_at
        FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND slot = ${slot}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const row = (result as unknown as { rows: PromptRow[] }).rows[0];
      return this.format(row, slot);
    });
  }

  /**
   * The prompt the bot must use — the ACTIVE slot, falling back to the highest
   * configured slot so a branch that never activated anything still answers.
   * Read as the worker so no user principal is required.
   */
  async getActiveForBot(orgId: string, branchId: string): Promise<string | null> {
    if (!branchSchema.safeParse(orgId).success || !branchSchema.safeParse(branchId).success) {
      throw new ValidationError({
        branchId: ['Konteks organisasi atau cawangan tidak sah'],
      });
    }

    return this.dbCtx.runAsWorker(
      {
        orgId,
        branchIds: [branchId],
        correlationId: 'wa-read-active-prompt',
        source: 'system_worker',
      },
      async (tx) => {
        const result = await tx.execute(sql`
          SELECT prompt
          FROM whatsapp_bot_prompts
          WHERE org_id = ${orgId}
            AND branch_id = ${branchId}
            AND deleted_at IS NULL
          ORDER BY is_active DESC, slot ASC
          LIMIT 1
        `);
        const row = (result as unknown as { rows: Array<{ prompt: string }> }).rows[0];
        return row?.prompt ?? null;
      },
    );
  }
}
