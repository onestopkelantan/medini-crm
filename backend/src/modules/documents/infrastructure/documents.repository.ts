import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc, inArray } from 'drizzle-orm';
import { Database } from '../../../infrastructure/database/database';
import { documents, Document } from '../../../infrastructure/database/schema';
import { toDomainError } from '../../../shared/errors/pg-error';

/** Accepts either the pool client or a drizzle transaction (from runAs). */
export type DbClient = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface CreateDocumentInput {
  title: string;
  category?: string | null;
  patientId?: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedBy?: string | null;
}

export interface DocumentListQuery {
  patientId?: string | null;
  status?: string | null;
  /** Restrict to these ids (doctor own-scope narrowing done in service). */
  ids?: string[] | null;
  limit?: number;
  offset?: number;
}

/**
 * DocumentsRepository — stateless data access for the documents domain.
 *
 * EVERY method takes `tx` first. The caller (DocumentsService) passes the
 * transaction from DbContextService.runAs(), which has applied the trusted GUC
 * context (app.role / app.branch_ids). RLS therefore enforces the branch
 * boundary on every query — a forged branch can never reach the DB.
 */
@Injectable()
export class DocumentsRepository {
  async create(
    tx: DbClient,
    orgId: string,
    branchId: string,
    input: CreateDocumentInput,
  ): Promise<Document> {
    try {
      const rows = await tx
        .insert(documents)
        .values({
          orgId,
          branchId,
          patientId: input.patientId ?? null,
          title: input.title.trim(),
          category: input.category ?? null,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageKey: input.storageKey,
          uploadedBy: input.uploadedBy ?? null,
        })
        .returning();
      return rows[0]!;
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async findById(tx: DbClient, orgId: string, id: string): Promise<Document | null> {
    const rows = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    tx: DbClient,
    orgId: string,
    branchId: string | null,
    query: DocumentListQuery,
  ): Promise<Document[]> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const conditions = [eq(documents.orgId, orgId), isNull(documents.deletedAt)];
    /* HQ (branchId null) lists org-wide — RLS admits all branches. */
    if (branchId) conditions.push(eq(documents.branchId, branchId));
    if (query.patientId) conditions.push(eq(documents.patientId, query.patientId));
    if (query.status) conditions.push(eq(documents.status, query.status as never));
    if (query.ids) {
      if (query.ids.length === 0) return [];
      conditions.push(inArray(documents.id, query.ids));
    }

    return tx
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /** Partial update (status / soft-delete). Only supplied fields are set. */
  async update(
    tx: DbClient,
    orgId: string,
    id: string,
    set: Record<string, unknown>,
  ): Promise<Document | null> {
    const rows = await tx
      .update(documents)
      .set({ ...set, updatedAt: new Date() } as never)
      .where(and(eq(documents.orgId, orgId), eq(documents.id, id), isNull(documents.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }
}
