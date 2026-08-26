import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, sql, SQL } from 'drizzle-orm';
import {
  externalInvoiceRefs, ExternalInvoiceRef,
  bukkuSyncRecords, BukkuSyncRecord,
  reconciliationRecords, ReconciliationRecord,
} from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';
import { DbClient } from '../../patients/infrastructure/patients.repository';

/**
 * FinanceIntegrationRepository — S4-T4 Bukku boundary persistence:
 * external_invoice_refs (POS/Bukku invoice reference), bukku_sync_records
 * (sync queue + idempotency), reconciliation_records (conflict detection).
 *
 * RLS: hq-only for sync/reconciliation; hq/bm for external_invoice_refs.
 * NO real Bukku HTTP adapter lives here — architecture/boundary only (Sprint 8).
 */
@Injectable()
export class FinanceIntegrationRepository {
  /* ================= EXTERNAL_INVOICE_REFS ================= */
  async createExternalRef(tx: DbClient, orgId: string, input: {
    refCode: string; branchId: string; externalInvoiceNumber: string; sourceSystem: string;
    amount: string; invoiceDate: string; patientId?: string | null; treatmentCostId?: string | null;
    status?: string | null; externalRef?: string | null; notes?: string | null;
  }): Promise<ExternalInvoiceRef> {
    try {
      const rows = await tx.insert(externalInvoiceRefs).values({
        orgId,
        branchId: input.branchId,
        patientId: input.patientId ?? null,
        treatmentCostId: input.treatmentCostId ?? null,
        refCode: input.refCode,
        externalInvoiceNumber: input.externalInvoiceNumber,
        sourceSystem: input.sourceSystem,
        amount: input.amount,
        invoiceDate: input.invoiceDate,
        status: input.status ?? null,
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findExternalRefByNumber(tx: DbClient, orgId: string, sourceSystem: string, externalNumber: string): Promise<ExternalInvoiceRef | null> {
    const rows = await tx.select().from(externalInvoiceRefs)
      .where(and(
        eq(externalInvoiceRefs.orgId, orgId),
        eq(externalInvoiceRefs.sourceSystem, sourceSystem),
        eq(externalInvoiceRefs.externalInvoiceNumber, externalNumber),
        isNull(externalInvoiceRefs.deletedAt),
      )).limit(1);
    return rows[0] ?? null;
  }

  async listExternalRefs(tx: DbClient, orgId: string, opts: {
    branchId?: string | null; sourceSystem?: string; limit?: number; offset?: number;
  }): Promise<ExternalInvoiceRef[]> {
    const cond: SQL[] = [eq(externalInvoiceRefs.orgId, orgId), isNull(externalInvoiceRefs.deletedAt)];
    if (opts.branchId) cond.push(eq(externalInvoiceRefs.branchId, opts.branchId));
    if (opts.sourceSystem) cond.push(eq(externalInvoiceRefs.sourceSystem, opts.sourceSystem));
    return tx.select().from(externalInvoiceRefs).where(and(...cond))
      .orderBy(desc(externalInvoiceRefs.invoiceDate))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  /* ================= BUKKU_SYNC_RECORDS ================= */
  async enqueueSync(tx: DbClient, orgId: string, input: {
    entityType: string; entityId: string; idempotencyKey: string; branchId?: string | null;
  }): Promise<BukkuSyncRecord> {
    try {
      const rows = await tx.insert(bukkuSyncRecords).values({
        orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        branchId: input.branchId ?? null,
        idempotencyKey: input.idempotencyKey,
        syncStatus: 'queued',
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async findSyncByIdempotencyKey(tx: DbClient, key: string): Promise<BukkuSyncRecord | null> {
    const rows = await tx.select().from(bukkuSyncRecords)
      .where(eq(bukkuSyncRecords.idempotencyKey, key)).limit(1);
    return rows[0] ?? null;
  }

  async findSyncByEntity(tx: DbClient, orgId: string, entityType: string, entityId: string): Promise<BukkuSyncRecord | null> {
    const rows = await tx.select().from(bukkuSyncRecords)
      .where(and(
        eq(bukkuSyncRecords.orgId, orgId),
        eq(bukkuSyncRecords.entityType, entityType),
        eq(bukkuSyncRecords.entityId, entityId),
      )).limit(1);
    return rows[0] ?? null;
  }

  async listSync(tx: DbClient, orgId: string, opts: {
    status?: string; entityType?: string; limit?: number; offset?: number;
  }): Promise<BukkuSyncRecord[]> {
    const cond: SQL[] = [eq(bukkuSyncRecords.orgId, orgId)];
    if (opts.status) cond.push(eq(bukkuSyncRecords.syncStatus, opts.status as BukkuSyncRecord['syncStatus']));
    if (opts.entityType) cond.push(eq(bukkuSyncRecords.entityType, opts.entityType));
    return tx.select().from(bukkuSyncRecords).where(and(...cond))
      .orderBy(desc(bukkuSyncRecords.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  async updateSyncStatus(tx: DbClient, id: string, input: {
    status: BukkuSyncRecord['syncStatus']; bukkuId?: string | null; syncError?: string | null;
  }): Promise<BukkuSyncRecord | null> {
    const set: Record<string, unknown> = { syncStatus: input.status, updatedAt: new Date() };
    if (input.bukkuId !== undefined) set.bukkuId = input.bukkuId;
    if (input.syncError !== undefined) set.syncError = input.syncError;
    if (input.status === 'synced') set.lastSyncedAt = new Date();
    if (input.status === 'error') set.retryCount = sql`${bukkuSyncRecords.retryCount} + 1`;
    const rows = await tx.update(bukkuSyncRecords).set(set)
      .where(eq(bukkuSyncRecords.id, id)).returning();
    return rows[0] ?? null;
  }

  /* ================= RECONCILIATION_RECORDS ================= */
  async createReconciliation(tx: DbClient, orgId: string, input: {
    entityType: string; entityId: string; bukkuSyncRecordId?: string | null;
    crmValue?: unknown; bukkuValue?: unknown; conflictFields?: string[] | null;
    status?: string;
  }): Promise<ReconciliationRecord> {
    try {
      const rows = await tx.insert(reconciliationRecords).values({
        orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        bukkuSyncRecordId: input.bukkuSyncRecordId ?? null,
        crmValue: (input.crmValue as never) ?? null,
        bukkuValue: (input.bukkuValue as never) ?? null,
        conflictFields: input.conflictFields ?? null,
        reconciliationStatus: (input.status as ReconciliationRecord['reconciliationStatus']) ?? 'pending',
      }).returning();
      return rows[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  async listReconciliation(tx: DbClient, orgId: string, opts: {
    status?: string; limit?: number; offset?: number;
  }): Promise<ReconciliationRecord[]> {
    const cond: SQL[] = [eq(reconciliationRecords.orgId, orgId)];
    if (opts.status) cond.push(eq(reconciliationRecords.reconciliationStatus, opts.status as ReconciliationRecord['reconciliationStatus']));
    return tx.select().from(reconciliationRecords).where(and(...cond))
      .orderBy(desc(reconciliationRecords.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .offset(Math.max(opts.offset ?? 0, 0));
  }

  async resolveReconciliation(tx: DbClient, id: string, input: {
    status: ReconciliationRecord['reconciliationStatus']; resolvedBy: string; notes?: string | null;
  }): Promise<ReconciliationRecord | null> {
    const rows = await tx.update(reconciliationRecords).set({
      reconciliationStatus: input.status,
      resolvedAt: new Date(),
      resolvedBy: input.resolvedBy,
      resolutionNotes: input.notes ?? null,
      updatedAt: new Date(),
    }).where(eq(reconciliationRecords.id, id)).returning();
    return rows[0] ?? null;
  }
}
