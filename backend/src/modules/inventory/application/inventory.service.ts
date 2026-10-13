/**
 * InventoryService — P6 per Invelli PRD.
 *
 * Dua bahagian:
 *  1. TRANSAKSI: master (items/rooms/BOM), restock, kiraan mingguan
 *     (submit oleh staf, kelulusan manager - PRD B7), snapshot
 *     opening/stock-in semasa kelulusan untuk carry-forward (C2).
 *  2. ENJIN: computeWeek(branch, week) — kira Actual (C1), Expected
 *     (D2, volum rawatan AUTO dari encounters), variance + flag (D3/D4).
 *
 * Peranan: staff kira → manager luluskan → HQ lihat semua (PRD §5).
 */
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import type { Principal } from '../../../core/auth/principal';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/errors';
import { AuditService } from '../../../shared/audit/audit.service';
import {
  invItems, invRooms, invBom, invRestocks, invCounts, invVarianceFlags,
} from '../../../infrastructure/database/schema';
import {
  actualUsage, expectedUsage, variance, isoWeek, previousIsoWeek,
} from '../domain/inventory-formulas';

const THRESHOLD_PCT = 5; /* PRD D4 contoh; A5: boleh jadikan konfigurasi kemudian */

const itemSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2).max(256),
  category: z.string().trim().max(128).nullish(),
  unit: z.string().trim().max(32).default('unit'),
  unitCost: z.number().min(0).default(0),
  supplier: z.string().trim().max(256).nullish(),
});

const roomSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2).max(128),
});

const bomSchema = z.object({
  treatmentType: z.string().trim().min(2).max(128),
  itemId: z.string().uuid(),
  qtyPerCase: z.number().positive(),
});

const restockSchema = z.object({
  branchId: z.string().uuid(),
  roomId: z.string().uuid().nullish(),
  itemId: z.string().uuid(),
  qty: z.number().positive(),
  unitCost: z.number().min(0).default(0),
  supplier: z.string().trim().max(256).nullish(),
  restockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const countSchema = z.object({
  roomId: z.string().uuid(),
  itemId: z.string().uuid(),
  qtyCounted: z.number().min(0),
  submit: z.boolean().default(false),
});

const approveSchema = z.object({
  countId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
});

@Injectable()
export class InventoryService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  /* ---------- master data (HQ; PRD A1/A2/A3) ---------- */

  async createItem(p: Principal, raw: unknown) {
    if (p.role !== 'hq') throw new ForbiddenError('Hanya HQ mengurus katalog item');
    const input = itemSchema.parse(raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.insert(invItems).values({
        orgId: p.orgId, sku: input.sku, name: input.name,
        category: input.category ?? null, unit: input.unit,
        unitCost: String(input.unitCost), supplier: input.supplier ?? null,
        createdBy: p.staffId, updatedBy: p.staffId,
      }).returning();
      return rows[0]!;
    });
  }

  async listItems(p: Principal) {
    return this.dbCtx.runAs(p, (tx) =>
      tx.select().from(invItems)
        .where(and(eq(invItems.orgId, p.orgId), isNull(invItems.deletedAt))));
  }

  async createRoom(p: Principal, raw: unknown) {
    if (p.role !== 'hq') throw new ForbiddenError('Hanya HQ mengurus bilik stor');
    const input = roomSchema.parse(raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.insert(invRooms).values({
        orgId: p.orgId, branchId: input.branchId, code: input.code, name: input.name,
      }).returning();
      return rows[0]!;
    });
  }

  async listRooms(p: Principal, branchId?: string) {
    const target = p.role === 'hq' ? branchId : p.branchId;
    return this.dbCtx.runAs(p, (tx) =>
      tx.select().from(invRooms)
        .where(and(eq(invRooms.orgId, p.orgId), isNull(invRooms.deletedAt),
          ...(target ? [eq(invRooms.branchId, target)] : []))));
  }

  async upsertBom(p: Principal, raw: unknown) {
    if (p.role !== 'hq') throw new ForbiddenError('Hanya HQ mengurus BOM');
    const input = bomSchema.parse(raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const existing = await tx.select().from(invBom)
        .where(and(eq(invBom.orgId, p.orgId), eq(invBom.treatmentType, input.treatmentType),
          eq(invBom.itemId, input.itemId), isNull(invBom.deletedAt)));
      if (existing[0]) {
        const rows = await tx.update(invBom)
          .set({ qtyPerCase: String(input.qtyPerCase) })
          .where(eq(invBom.id, existing[0]!.id)).returning();
        return rows[0]!;
      }
      const rows = await tx.insert(invBom).values({
        orgId: p.orgId, treatmentType: input.treatmentType, itemId: input.itemId,
        qtyPerCase: String(input.qtyPerCase), createdBy: p.staffId,
      }).returning();
      return rows[0]!;
    });
  }

  async listBom(p: Principal) {
    return this.dbCtx.runAs(p, (tx) =>
      tx.select().from(invBom)
        .where(and(eq(invBom.orgId, p.orgId), isNull(invBom.deletedAt))));
  }

  /* ---------- restock (staf cawangan / HQ; PRD C3) ---------- */

  async createRestock(p: Principal, raw: unknown) {
    const input = restockSchema.parse(raw);
    if (p.role !== 'hq' && p.branchId && input.branchId !== p.branchId) {
      throw new ForbiddenError('Restock hanya untuk cawangan sendiri');
    }
    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.insert(invRestocks).values({
        orgId: p.orgId, branchId: input.branchId, roomId: input.roomId ?? null,
        itemId: input.itemId, qty: String(input.qty), unitCost: String(input.unitCost),
        supplier: input.supplier ?? null, restockDate: input.restockDate,
        receivedBy: p.staffId, createdBy: p.staffId,
        /* nota: inv_restocks tiada updated_* (0034) — jangan hantar */
      }).returning();
      const row = rows[0]!;
      await this.audit.record({
        actorId: p.staffId, actorRole: p.role, action: 'inventory_restock',
        entity: 'inv_restocks', entityId: row.id, orgId: p.orgId,
        branchId: input.branchId, source: 'api',
        after: { itemId: input.itemId, qty: input.qty, restockDate: input.restockDate },
      }, tx);
      return row;
    });
  }

  async listRestocks(p: Principal, branchId?: string) {
    const target = p.role === 'hq' ? branchId : p.branchId;
    return this.dbCtx.runAs(p, (tx) =>
      tx.select().from(invRestocks)
        .where(and(eq(invRestocks.orgId, p.orgId), isNull(invRestocks.deletedAt),
          ...(target ? [eq(invRestocks.branchId, target)] : []))));
  }

  /* ---------- kiraan mingguan (staf kira, manager luluskan; PRD B) ---------- */

  /** Staf simpan draf + submit. `submit: true` hantar untuk kelulusan. */
  async saveCount(p: Principal, raw: unknown) {
    const input = countSchema.parse(raw);
    const week = isoWeek(new Date());
    return this.dbCtx.runAs(p, async (tx) => {
      const roomRows = await tx.select().from(invRooms)
        .where(and(eq(invRooms.id, input.roomId), eq(invRooms.orgId, p.orgId), isNull(invRooms.deletedAt)));
      const room = roomRows[0];
      if (!room) throw new NotFoundError('Room', input.roomId);
      if (p.role !== 'hq' && p.branchId !== room.branchId) {
        throw new ForbiddenError('Kiraan hanya untuk bilik cawangan sendiri');
      }
      const existing = await tx.select().from(invCounts)
        .where(and(eq(invCounts.orgId, p.orgId), eq(invCounts.roomId, input.roomId),
          eq(invCounts.itemId, input.itemId), eq(invCounts.isoWeek, week), isNull(invCounts.deletedAt)));
      const status = input.submit ? 'submitted' as const : 'draft' as const;
      if (existing[0]) {
        if (existing[0]!.status === 'approved') {
          throw new ForbiddenError('Kiraan minggu ini sudah diluluskan — hubungi manager');
        }
        const rows = await tx.update(invCounts)
          .set({ qtyCounted: String(input.qtyCounted), status, countedBy: p.staffId, updatedBy: p.staffId })
          .where(eq(invCounts.id, existing[0]!.id)).returning();
        return rows[0]!;
      }
      const rows = await tx.insert(invCounts).values({
        orgId: p.orgId, branchId: room.branchId, roomId: input.roomId,
        itemId: input.itemId, isoWeek: week, qtyCounted: String(input.qtyCounted),
        status, countedBy: p.staffId,
      }).returning();
      return rows[0]!;
    });
  }

  /** Manager menyemak & meluluskan (PRD B7); HQ boleh luluskan apa-apa. */
  async decideCount(p: Principal, raw: unknown) {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Hanya manager (atau HQ) meluluskan kiraan');
    }
    const input = approveSchema.parse(raw);
    const week = isoWeek(new Date());
    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.select().from(invCounts)
        .where(and(eq(invCounts.id, input.countId), eq(invCounts.orgId, p.orgId), isNull(invCounts.deletedAt)));
      const count = rows[0];
      if (!count) throw new NotFoundError('Count', input.countId);
      if (p.role !== 'hq' && p.branchId !== count.branchId) {
        throw new ForbiddenError('Kelulusan hanya untuk cawangan sendiri');
      }
      if (count.status !== 'submitted') {
        throw new ForbiddenError(`Kiraan berstatus ${count.status} — tidak boleh diluluskan`);
      }
      if (input.decision === 'rejected') {
        const upd = await tx.update(invCounts)
          .set({ status: 'rejected', approvedBy: p.staffId, approvedAt: new Date() })
          .where(eq(invCounts.id, count.id)).returning();
        return upd[0]!;
      }
      /* APPROVED — snapshot opening + stock-in untuk formula C1/C2.
       * opening = qty kiraan minggu lepas (ending → opening carry-forward),
       * stock-in = restock item ini dalam minggu semasa. */
      const prevWeek = previousIsoWeek(week);
      const prevRows = await tx.select().from(invCounts)
        .where(and(eq(invCounts.orgId, p.orgId), eq(invCounts.itemId, count.itemId),
          eq(invCounts.isoWeek, prevWeek), eq(invCounts.status, 'approved'), isNull(invCounts.deletedAt)));
      /* Ambil bilik sama dahulu; jika tiada, mana-mana bilik cawangan (agregat stok). */
      const prevSame = prevRows.find((r) => r.roomId === count.roomId);
      const prevAny = prevSame ?? prevRows[0];
      const opening = prevAny ? Number(prevAny.qtyCounted) : 0;
      /* stock-in minggu semasa: restock 7 hari terakhir termasuk hari ini. */
      const stockInRows = await tx.execute(sql`
        SELECT COALESCE(SUM(qty), 0) AS total FROM inv_restocks
        WHERE org_id = ${p.orgId} AND item_id = ${count.itemId} AND deleted_at IS NULL
          AND restock_date >= SUBDATE(CURDATE(), INTERVAL 7 DAY)
          AND restock_date <= CURDATE()
      `);
      const stockIn = Number(
        ((stockInRows as unknown as { rows: Array<{ total: string }> }).rows[0]?.total) ?? 0,
      );
      const upd = await tx.update(invCounts)
        .set({
          status: 'approved', approvedBy: p.staffId, approvedAt: new Date(),
          openingQty: String(opening), stockIn: String(stockIn),
        })
        .where(eq(invCounts.id, count.id)).returning();
      const updated = upd[0]!;
      await this.audit.record({
        actorId: p.staffId, actorRole: p.role, action: 'inventory_count_approved',
        entity: 'inv_counts', entityId: count.id, orgId: p.orgId,
        branchId: count.branchId, source: 'api',
        after: { week, itemId: count.itemId, opening, stockIn },
      }, tx);
      return updated;
    });
  }

  async listCounts(p: Principal, week?: string) {
    const wk = week ?? isoWeek(new Date());
    const target = p.role === 'hq' ? null : p.branchId;
    return this.dbCtx.runAs(p, (tx) =>
      tx.select().from(invCounts)
        .where(and(eq(invCounts.orgId, p.orgId), eq(invCounts.isoWeek, wk), isNull(invCounts.deletedAt),
          ...(target ? [eq(invCounts.branchId, target)] : []))));
  }

  /* ---------- ENJIN: pengiraan + pengesanan kebocoran (PRD C/D) ---------- */

  /**
   * computeWeek(branchId?, week?) — untuk setiap item yang ada kiraan
   * diluluskan minggu ini: Actual (C1) vs Expected (D2, volum rawatan
   * dari encounters minggu itu × BOM) → variance + flag (D3/D4).
   * Idempoten: flag per (branch, item, week) di-upsert.
   */
  async computeWeek(p: Principal, branchId?: string, week?: string) {
    if (p.role !== 'hq') throw new ForbiddenError('Pengiraan variance untuk HQ');
    const wk = week ?? isoWeek(new Date());
    const prevWk = previousIsoWeek(wk);

    return this.dbCtx.runAs(p, async (tx) => {
      /* 1. Volum rawatan minggu ini per cawangan (D1 — AUTO dari encounters,
       *    bukan input manual seperti PRD: kelebihan integrasi penuh). */
      /* Volum rawatan minggu semasa (7 hari terakhir) — Fasa 1 PRD:
       * minggu ISO takwim semasa, padan snapshot kiraan minggu berjalan. */
      const volRows = await tx.execute(sql`
        SELECT branch_id, chief_complaint AS treatment_type, COUNT(*) AS volume
        FROM encounters
        WHERE org_id = ${p.orgId} AND deleted_at IS NULL
          AND YEARWEEK(started_at, 3) = YEARWEEK(CURDATE(), 3)
        GROUP BY branch_id, chief_complaint
      `);
      const volumesByBranch = new Map<string, Record<string, number>>();
      const volList = (volRows as unknown as { rows: Array<{ branch_id: string; treatment_type: string | null; volume: number }> }).rows ?? [];
      for (const r of volList) {
        if (!r.treatment_type) continue;
        const m = volumesByBranch.get(r.branch_id) ?? {};
        m[r.treatment_type] = Number(r.volume);
        volumesByBranch.set(r.branch_id, m);
      }

      /* 2. BOM per item (item → treatmentType → qty). */
      const bomRows = await tx.select().from(invBom)
        .where(and(eq(invBom.orgId, p.orgId), isNull(invBom.deletedAt)));
      const bomByItem: Record<string, Record<string, number>> = {}; /* itemId → treatmentType → qty */
      for (const b of bomRows) {
        bomByItem[b.itemId] = bomByItem[b.itemId] ?? {};
        bomByItem[b.itemId]![b.treatmentType] = Number(b.qtyPerCase);
      }

      /* 3. Kiraan diluluskan minggu ini (per cawangan+item, jumlah semua bilik). */
      const counts = await tx.select().from(invCounts)
        .where(and(eq(invCounts.orgId, p.orgId), eq(invCounts.isoWeek, wk),
          eq(invCounts.status, 'approved'), isNull(invCounts.deletedAt),
          ...(branchId ? [eq(invCounts.branchId, branchId)] : [])));

      let flagged = 0;
      const results: Array<{ itemId: string; branchId: string; actual: number; expected: number; variancePct: number; flagged: boolean }> = [];

      for (const c of counts) {
        const opening = Number(c.openingQty ?? 0);
        const stockIn = Number(c.stockIn ?? 0);
        const ending = Number(c.qtyCounted);
        const actual = actualUsage({ opening, stockIn, ending });

        const volumes: Record<string, number> = volumesByBranch.get(c.branchId) ?? {};
        const bom: Record<string, number> = bomByItem[c.itemId] ?? {};
        const expected = expectedUsage(volumes, bom);

        const v = variance(actual, expected, THRESHOLD_PCT);
        results.push({ itemId: c.itemId, branchId: c.branchId, actual, expected, variancePct: v.variancePct, flagged: v.flagged });

        if (!v.flagged) continue;
        /* upsert flag (idempoten per branch+item+week) */
        const existingFlag = await tx.select().from(invVarianceFlags)
          .where(and(eq(invVarianceFlags.orgId, p.orgId), eq(invVarianceFlags.branchId, c.branchId),
            eq(invVarianceFlags.itemId, c.itemId), eq(invVarianceFlags.isoWeek, wk)));
        const values = {
          expectedQty: String(expected), actualQty: String(actual),
          varianceQty: String(v.varianceQty), variancePct: String(v.variancePct.toFixed(4)),
          thresholdPct: String(THRESHOLD_PCT), updatedBy: p.staffId,
        };
        if (existingFlag[0]) {
          await tx.update(invVarianceFlags).set(values).where(eq(invVarianceFlags.id, existingFlag[0]!.id));
        } else {
          await tx.insert(invVarianceFlags).values({
            orgId: p.orgId, branchId: c.branchId, itemId: c.itemId, isoWeek: wk,
            ...values,
          });
        }
        flagged++;
      }

      return { week: wk, previousWeek: prevWk, computed: counts.length, flagged, results };
    });
  }

  async listFlags(p: Principal, week?: string, branchId?: string) {
    const target = p.role === 'hq' ? branchId : p.branchId;
    return this.dbCtx.runAs(p, (tx) =>
      tx.select().from(invVarianceFlags)
        .where(and(eq(invVarianceFlags.orgId, p.orgId),
          ...(week ? [eq(invVarianceFlags.isoWeek, week)] : []),
          ...(target ? [eq(invVarianceFlags.branchId, target)] : []))));
  }

}

export { itemSchema, roomSchema, bomSchema, restockSchema, countSchema, approveSchema };
