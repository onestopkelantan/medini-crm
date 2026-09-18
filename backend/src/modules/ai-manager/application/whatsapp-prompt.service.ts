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

const branchSchema = z.string().uuid();

const saveSchema = z.object({
  prompt: z.string().trim().min(20).max(20000),
  version: z.number().int().min(0).max(2147483646),
}).strict();

interface PromptRow {
  org_id: string;
  branch_id: string;
  prompt: string;
  version: number;
  updated_by: string;
  updated_at: Date | string;
}

export interface WhatsappPromptResult {
  branchId: string;
  prompt: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
  configured: boolean;
}

@Injectable()
export class WhatsappPromptService {
  constructor(private readonly dbCtx: DbContextService) {}

  private resolveBranch(
    principal: Principal,
    requestedBranchId?: string,
  ): string {
    if (
      principal.role !== 'hq' &&
      principal.role !== 'branch_manager'
    ) {
      throw new ForbiddenError(
        'Hanya HQ dan pengurus cawangan boleh mengurus prompt WhatsApp',
      );
    }

    const branchId = requestedBranchId || principal.branchId;

    if (!branchId || !branchSchema.safeParse(branchId).success) {
      throw new ValidationError({
        branchId: ['Sila pilih cawangan yang sah'],
      });
    }

    if (
      principal.role !== 'hq' &&
      branchId !== principal.branchId
    ) {
      throw new ForbiddenError(
        'Anda hanya boleh mengurus prompt cawangan sendiri',
      );
    }

    return branchId;
  }

  private format(
    branchId: string,
    row?: PromptRow,
  ): WhatsappPromptResult {
    if (!row) {
      return {
        branchId,
        prompt: '',
        version: 0,
        updatedBy: null,
        updatedAt: null,
        configured: false,
      };
    }

    return {
      branchId: row.branch_id,
      prompt: row.prompt,
      version: row.version,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
      configured: true,
    };
  }

  async get(
    principal: Principal,
    requestedBranchId?: string,
  ): Promise<WhatsappPromptResult> {
    const branchId = this.resolveBranch(
      principal,
      requestedBranchId,
    );

    return this.dbCtx.runAs(principal, async (tx) => {
      const branchResult = await tx.execute(sql`
        SELECT id
        FROM branches
        WHERE id = ${branchId}
          AND org_id = ${principal.orgId}
          AND deleted_at IS NULL
        LIMIT 1
      `);

      const branches = (
        branchResult as unknown as {
          rows: Array<{ id: string }>;
        }
      ).rows;

      if (!branches.length) {
        throw new NotFoundError('branch', branchId);
      }

      const result = await tx.execute(sql`
        SELECT
          org_id,
          branch_id,
          prompt,
          version,
          updated_by,
          updated_at
        FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
        LIMIT 1
      `);

      const rows = (
        result as unknown as { rows: PromptRow[] }
      ).rows;

      return this.format(branchId, rows[0]);
    });
  }

  async save(
    principal: Principal,
    raw: unknown,
    requestedBranchId?: string,
  ): Promise<WhatsappPromptResult> {
    const branchId = this.resolveBranch(
      principal,
      requestedBranchId,
    );

    const parsed = saveSchema.safeParse(raw);

    if (!parsed.success) {
      const errors: Record<string, string[]> = {};

      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'prompt';
        errors[key] = [
          ...(errors[key] ?? []),
          issue.message,
        ];
      }

      throw new ValidationError(errors);
    }

    const { prompt, version } = parsed.data;

    return this.dbCtx.runAs(principal, async (tx) => {
      const branchResult = await tx.execute(sql`
        SELECT id
        FROM branches
        WHERE id = ${branchId}
          AND org_id = ${principal.orgId}
          AND deleted_at IS NULL
        LIMIT 1
      `);

      const branches = (
        branchResult as unknown as {
          rows: Array<{ id: string }>;
        }
      ).rows;

      if (!branches.length) {
        throw new NotFoundError('branch', branchId);
      }

      // Version 0 bermaksud prompt belum pernah disimpan.
      if (version === 0) {
        const inserted = await tx.execute(sql`
          INSERT IGNORE INTO whatsapp_bot_prompts
            (org_id, branch_id, prompt, version, updated_by, updated_at)
          VALUES
            (${principal.orgId}, ${branchId}, ${prompt}, 1, ${principal.staffId}, NOW(6))
        `);

        if (Number((inserted as any).affectedRows ?? 0) < 1) {
          throw new ConflictError(
            'Prompt telah disimpan oleh pengguna lain. Muat semula sebelum mengedit.',
          );
        }

        const created = await tx.execute(sql`
          SELECT org_id, branch_id, prompt, version, updated_by, updated_at
          FROM whatsapp_bot_prompts
          WHERE org_id = ${principal.orgId} AND branch_id = ${branchId}
          LIMIT 1
        `);
        const row = ((created as unknown as { rows: PromptRow[] }).rows)[0];
        if (!row) throw new ConflictError('Prompt gagal dibaca selepas disimpan.');
        return this.format(branchId, row);
      }

      // Elakkan edit pengguna lain ditindih secara senyap.
      const updated = await tx.execute(sql`
        UPDATE whatsapp_bot_prompts
        SET
          prompt = ${prompt},
          version = version + 1,
          updated_by = ${principal.staffId},
          updated_at = NOW(6)
        WHERE org_id = ${principal.orgId}
          AND branch_id = ${branchId}
          AND version = ${version}
      `);

      if (Number((updated as any).affectedRows ?? 0) < 1) {
        throw new ConflictError(
          'Prompt telah berubah. Muat semula untuk mendapatkan versi terbaru sebelum menyimpan.',
        );
      }

      const refreshed = await tx.execute(sql`
        SELECT org_id, branch_id, prompt, version, updated_by, updated_at
        FROM whatsapp_bot_prompts
        WHERE org_id = ${principal.orgId} AND branch_id = ${branchId}
        LIMIT 1
      `);
      const row = ((refreshed as unknown as { rows: PromptRow[] }).rows)[0];
      if (!row) throw new ConflictError('Prompt gagal dibaca selepas dikemas kini.');
      return this.format(branchId, row);
    });
  }

  /**
   * Digunakan oleh webhook dengan organisasi dan cawangan
   * yang ditentukan oleh backend.
   *
   * Baca terus daripada database supaya simpanan terbaru
   * digunakan pada permintaan berikutnya.
   */
  async getForBot(
    orgId: string,
    branchId: string,
  ): Promise<string | null> {
    if (
      !branchSchema.safeParse(orgId).success ||
      !branchSchema.safeParse(branchId).success
    ) {
      throw new ValidationError({
        branchId: ['Konteks organisasi atau cawangan tidak sah'],
      });
    }

    return this.dbCtx.runAsWorker(
      {
        orgId,
        branchIds: [branchId],
        correlationId: 'wa-read-bot-prompt',
        source: 'system_worker',
      },
      async (tx) => {
        const result = await tx.execute(sql`
          SELECT prompt
          FROM whatsapp_bot_prompts
          WHERE org_id = ${orgId}
            AND branch_id = ${branchId}
          LIMIT 1
        `);

        const row = (
          result as unknown as {
            rows: Array<{ prompt: string }>;
          }
        ).rows[0];

        return row?.prompt ?? null;
      },
    );
  }
}