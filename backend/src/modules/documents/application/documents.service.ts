import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { Principal } from '../../../core/auth/principal';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../shared/errors/errors';
import { DocumentsRepository } from '../infrastructure/documents.repository';
import { DocumentStorageService } from '../infrastructure/document-storage.service';
import { PatientsReadPort } from '../../../shared/ports/patients.read-port';
import { Document } from '../../../infrastructure/database/schema';

/* ---- upload constraints ---- */
const MAX_BYTES = 20 * 1024 * 1024; /* 20 MB */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export interface UploadedFileInput {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

const uploadMetaSchema = z.object({
  title: z.string().trim().min(1).max(256).optional(),
  category: z.string().trim().max(64).nullish(),
  patientId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(), /* HQ mutation target */
});

const statusSchema = z.object({
  status: z.enum(['active', 'archived', 'deleted']),
});

export interface DocumentWithUrl extends Document {
  url: string;
}

/**
 * DocumentsService — Documents domain (upload / list / download / status).
 *
 * Branch resolution mirrors PatientsService exactly:
 *  - non-HQ: branch ALWAYS = principal.branchId (guard pins it; missing → DENY).
 *  - HQ: reads org-wide (branchId=null → RLS sees all); mutations REQUIRE an
 *    explicit target branchId in the payload (422 if absent).
 *
 * Doctor own-scope: the PermissionGuard admits a doctor (scope 'own'), then this
 * service narrows visibility to documents the doctor uploaded OR documents
 * linked to a patient the doctor is linked to — same discipline as
 * PatientsService.assertDoctorCanSee. DB RLS stays branch-level.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: DocumentsRepository,
    private readonly storage: DocumentStorageService,
    private readonly audit: AuditService,
    private readonly readPort: PatientsReadPort,
  ) {}

  private readBranch(p: Principal): string | null {
    if (p.role === 'hq') return null;
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  private mutateBranch(p: Principal, explicit: string | null | undefined): string {
    if (p.role === 'hq') {
      if (!explicit) throw new ValidationError({ branchId: ['branchId is required for HQ mutation'] });
      return explicit;
    }
    if (!p.branchId) throw new ForbiddenError('No branch context — access denied');
    return p.branchId;
  }

  async upload(principal: Principal, file: UploadedFileInput | undefined, rawMeta: unknown): Promise<Document> {
    if (!file) throw new ValidationError({ file: ['A file is required'] });
    if (file.size <= 0) throw new ValidationError({ file: ['File is empty'] });
    if (file.size > MAX_BYTES) throw new ValidationError({ file: [`File exceeds ${MAX_BYTES / (1024 * 1024)}MB limit`] });
    if (!ALLOWED_MIME.has(file.mimeType)) {
      throw new ValidationError({ file: [`Unsupported file type: ${file.mimeType}`] });
    }

    const parsed = uploadMetaSchema.safeParse(rawMeta ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    const meta = parsed.data;
    const branchId = this.mutateBranch(principal, meta.branchId);
    const safeName = this.safeName(file.originalName);
    const objectId = randomUUID();
    const storageKey = this.storage.buildKey(principal.orgId, branchId, objectId, safeName);

    return this.dbCtx.runAs(principal, async (tx) => {
      /* Doctor create with a patient link must target a patient they can see. */
      if (principal.role === 'doctor' && meta.patientId) {
        if (!(await this.doctorLinked(principal, meta.patientId, tx))) {
          throw new ForbiddenError('You do not have access to this patient');
        }
      }

      /* Push bytes to object storage BEFORE the row so a failed upload leaves no dangling record. */
      await this.storage.put({ key: storageKey, body: file.buffer, contentType: file.mimeType });

      const doc = await this.repo.create(tx, principal.orgId, branchId, {
        title: meta.title ?? file.originalName,
        category: meta.category ?? null,
        patientId: meta.patientId ?? null,
        fileName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        storageKey,
        uploadedBy: principal.staffId,
      });

      await this.audit.record(
        {
          actorId: principal.staffId,
          actorRole: principal.role,
          action: 'document_uploaded',
          entity: 'documents',
          entityId: doc.id,
          orgId: principal.orgId,
          branchId,
          source: 'api',
          after: { title: doc.title, fileName: doc.fileName, patientId: doc.patientId },
        },
        tx,
      );
      return doc;
    });
  }

  async list(
    principal: Principal,
    filters: { patientId?: string; status?: string; limit?: number; offset?: number },
  ): Promise<Document[]> {
    const branchId = this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const rows = await this.repo.list(tx, principal.orgId, branchId, {
        patientId: filters.patientId ?? null,
        status: filters.status ?? null,
        limit: filters.limit,
        offset: filters.offset,
      });
      if (principal.role !== 'doctor') return rows;
      /* Doctor own-scope narrowing (RLS is branch-level; this is the 'own' layer). */
      const visible: Document[] = [];
      for (const d of rows) {
        if (await this.doctorCanSee(principal, d, tx)) visible.push(d);
      }
      return visible;
    });
  }

  async getById(principal: Principal, id: string, download: boolean): Promise<DocumentWithUrl> {
    this.readBranch(principal);
    return this.dbCtx.runAs(principal, async (tx) => {
      const doc = await this.repo.findById(tx, principal.orgId, id);
      if (!doc) throw new NotFoundError('Document', id);
      if (principal.role === 'doctor' && !(await this.doctorCanSee(principal, doc, tx))) {
        throw new ForbiddenError('You do not have access to this document');
      }
      const url = await this.storage.signedGetUrl(doc.storageKey, {
        filename: doc.fileName,
        download,
      });
      return { ...doc, url };
    });
  }

  async changeStatus(principal: Principal, id: string, raw: unknown): Promise<Document> {
    const parsed = statusSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    this.readBranch(principal);
    const status = parsed.data.status;

    return this.dbCtx.runAs(principal, async (tx) => {
      const before = await this.repo.findById(tx, principal.orgId, id);
      if (!before) throw new NotFoundError('Document', id);

      const set: Record<string, unknown> = { status };
      /* 'deleted' is a soft delete — hide from lists (deletedAt) but keep the row + object. */
      if (status === 'deleted') set['deletedAt'] = new Date();

      const updated = await this.repo.update(tx, principal.orgId, id, set);
      if (!updated) throw new NotFoundError('Document', id);

      await this.audit.record(
        {
          actorId: principal.staffId,
          actorRole: principal.role,
          action: 'document_status_changed',
          entity: 'documents',
          entityId: id,
          orgId: principal.orgId,
          branchId: before.branchId,
          source: 'api',
          before: { status: before.status },
          after: { status },
        },
        tx,
      );
      return updated;
    });
  }

  /* ---- doctor own-scope helpers (app-layer; DB RLS stays branch-level) ---- */

  private async doctorCanSee(principal: Principal, doc: Document, tx: unknown): Promise<boolean> {
    if (doc.uploadedBy && doc.uploadedBy === principal.staffId) return true;
    if (doc.patientId) return this.doctorLinked(principal, doc.patientId, tx);
    return false;
  }

  private async doctorLinked(principal: Principal, patientId: string, tx: unknown): Promise<boolean> {
    if (!principal.doctorId) return false;
    return this.readPort.doctorLinkedToPatient(tx as never, principal.orgId, principal.doctorId, patientId);
  }

  private safeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'file';
  }
}
