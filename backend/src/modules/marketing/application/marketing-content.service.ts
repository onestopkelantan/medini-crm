import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, count, desc, eq, inArray, isNull, isNotNull, lte, or } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors/errors';
import { MarketingContentRepository } from '../infrastructure/marketing-content.repository';
import { patients, campaigns, MarketingTemplate, MarketingSegment, Patient, Campaign } from '../../../infrastructure/database/schema';

const uuid = z.string().uuid();

const channelEnum = z.enum(['whatsapp', 'sms', 'email']);
const templateStatusEnum = z.enum(['draft', 'active', 'archived']);

const templateCreate = z.object({
  branchId: uuid,
  name: z.string().trim().min(2).max(256),
  channel: channelEnum,
  category: z.string().trim().max(64).nullish(),
  subject: z.string().trim().max(256).nullish(), /* email only */
  body: z.string().trim().min(1).max(8000),
  variables: z.array(z.string().trim().min(1).max(64)).max(50).nullish(),
});

const templateUpdate = z.object({
  name: z.string().trim().min(2).max(256).optional(),
  category: z.string().trim().max(64).nullish(),
  subject: z.string().trim().max(256).nullish(),
  body: z.string().trim().min(1).max(8000).optional(),
  variables: z.array(z.string().trim().min(1).max(64)).max(50).nullish(),
});

const templateStatus = z.object({ status: templateStatusEnum });

/** Audience filter — shared by preview and saved segments. */
const audienceFilter = z.object({
  branchId: uuid.nullish(), /* HQ may target a branch; managers are pinned */
  statuses: z.array(z.enum(['Active', 'VIP', 'Recall Due', 'Inactive'])).max(4).nullish(),
  patientType: z.string().trim().max(32).nullish(),
  hasWhatsapp: z.boolean().nullish(),
  inactiveSinceDays: z.number().int().positive().max(3650).nullish(),
  limitSample: z.number().int().min(0).max(50).nullish(),
});
type AudienceFilter = z.infer<typeof audienceFilter>;

const segmentCreate = z.object({
  branchId: uuid,
  name: z.string().trim().min(2).max(256),
  filters: audienceFilter,
});

const campaignEdit = z.object({
  name: z.string().trim().min(2).max(256).optional(),
  intent: z.string().trim().min(1).max(512).optional(),
  audienceDefinition: z.record(z.unknown()).optional(),
  templateReference: z.string().max(256).nullish(),
});

export interface AudiencePreview {
  count: number;
  sample: Patient[];
}

/**
 * MarketingContentService — templates + saved segments + audience preview.
 * Access mirrors MarketingService exactly: HQ and branch_manager only; managers
 * are pinned to their own branch; HQ mutations require an explicit branchId.
 * Audience preview reads the patients table under the caller's RLS context.
 */
@Injectable()
export class MarketingContentService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly repo: MarketingContentRepository,
    private readonly audit: AuditService,
  ) {}

  private assertAccess(p: Principal): void {
    if (p.role !== 'hq' && p.role !== 'branch_manager') {
      throw new ForbiddenError('Marketing access is restricted to HQ and branch managers');
    }
  }

  /** Explicit branch for mutations — manager pinned to own branch. */
  private branch(p: Principal, requested: string): string {
    if (p.role === 'branch_manager' && p.branchId !== requested) {
      throw new ForbiddenError('Branch manager cannot access another branch');
    }
    return requested;
  }

  /** Read scope — HQ org-wide (or explicit), manager own branch. */
  private scoped(p: Principal, requested?: string | null): string | null {
    return p.role === 'hq' ? (requested ?? null) : p.branchId;
  }

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const r = schema.safeParse(raw);
    if (!r.success) {
      throw new ValidationError(
        Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), [i.message]])),
      );
    }
    return r.data;
  }

  private auditEvent(
    p: Principal, action: string, entity: string, id: string, branchId: string,
    before?: Record<string, unknown>, after?: Record<string, unknown>,
  ) {
    return {
      actorId: p.staffId, actorRole: p.role, action, entity, entityId: id,
      orgId: p.orgId, branchId, source: 'api' as const, before, after,
    };
  }

  /* ---------- templates ---------- */

  async listTemplates(p: Principal, q: { channel?: string; status?: string; branchId?: string }): Promise<MarketingTemplate[]> {
    this.assertAccess(p);
    return this.dbCtx.runAs(p, (tx) =>
      this.repo.listTemplates(tx, p.orgId, this.scoped(p, q.branchId), { channel: q.channel, status: q.status }),
    );
  }

  async createTemplate(p: Principal, raw: unknown): Promise<MarketingTemplate> {
    this.assertAccess(p);
    const input = this.parse(templateCreate, raw);
    const branchId = this.branch(p, input.branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createTemplate(tx, {
        orgId: p.orgId,
        branchId,
        name: input.name,
        channel: input.channel,
        category: input.category ?? null,
        subject: input.subject ?? null,
        body: input.body,
        variables: input.variables ?? null,
        createdBy: p.staffId,
        updatedBy: p.staffId,
      });
      await this.audit.record(
        this.auditEvent(p, 'marketing_template_created', 'marketing_templates', row.id, branchId, undefined, {
          channel: row.channel, status: row.status,
        }),
        tx,
      );
      return row;
    });
  }

  async updateTemplate(p: Principal, id: string, raw: unknown): Promise<MarketingTemplate> {
    this.assertAccess(p);
    const input = this.parse(templateUpdate, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.findTemplate(tx, p.orgId, id);
      if (!before) throw new NotFoundError('marketing_template', id);
      this.branch(p, before.branchId);

      const set: Record<string, unknown> = {};
      if (input.name !== undefined) set['name'] = input.name;
      if (input.category !== undefined) set['category'] = input.category;
      if (input.subject !== undefined) set['subject'] = input.subject;
      if (input.body !== undefined) set['body'] = input.body;
      if (input.variables !== undefined) set['variables'] = input.variables;

      const updated = await this.repo.updateTemplate(tx, p.orgId, id, set);
      if (!updated) throw new NotFoundError('marketing_template', id);
      await this.audit.record(
        this.auditEvent(p, 'marketing_template_updated', 'marketing_templates', id, before.branchId,
          { name: before.name }, set),
        tx,
      );
      return updated;
    });
  }

  async setTemplateStatus(p: Principal, id: string, raw: unknown): Promise<MarketingTemplate> {
    this.assertAccess(p);
    const input = this.parse(templateStatus, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const before = await this.repo.findTemplate(tx, p.orgId, id);
      if (!before) throw new NotFoundError('marketing_template', id);
      this.branch(p, before.branchId);
      if (before.status === input.status) return before;

      const set: Record<string, unknown> = { status: input.status };
      if (input.status === 'archived') set['deletedAt'] = null; /* archive keeps the row visible; deletedAt stays null */
      const updated = await this.repo.updateTemplate(tx, p.orgId, id, set);
      if (!updated) throw new NotFoundError('marketing_template', id);
      await this.audit.record(
        this.auditEvent(p, 'marketing_template_status_changed', 'marketing_templates', id, before.branchId,
          { status: before.status }, { status: input.status }),
        tx,
      );
      return updated;
    });
  }

  async duplicateTemplate(p: Principal, id: string): Promise<MarketingTemplate> {
    this.assertAccess(p);
    return this.dbCtx.runAs(p, async (tx) => {
      const src = await this.repo.findTemplate(tx, p.orgId, id);
      if (!src) throw new NotFoundError('marketing_template', id);
      this.branch(p, src.branchId);
      const row = await this.repo.createTemplate(tx, {
        orgId: p.orgId,
        branchId: src.branchId,
        name: `${src.name} (copy)`.slice(0, 256),
        channel: src.channel,
        category: src.category,
        subject: src.subject,
        body: src.body,
        variables: src.variables,
        status: 'draft', /* a duplicate always starts as a draft */
        createdBy: p.staffId,
        updatedBy: p.staffId,
      });
      await this.audit.record(
        this.auditEvent(p, 'marketing_template_duplicated', 'marketing_templates', row.id, src.branchId, undefined, {
          sourceId: id,
        }),
        tx,
      );
      return row;
    });
  }

  /* ---------- audience + segments ---------- */

  async previewAudience(p: Principal, raw: unknown): Promise<AudiencePreview> {
    this.assertAccess(p);
    const filter = this.parse(audienceFilter, raw);
    const branchId = this.scoped(p, filter.branchId ?? undefined);
    const sampleLimit = filter.limitSample ?? 10;

    return this.dbCtx.runAs(p, async (tx) => {
      const where = this.audienceConditions(p.orgId, branchId, filter);
      const countRows = await tx.select({ value: count() }).from(patients).where(where);
      const total = Number(countRows[0]?.value ?? 0);
      const sample = sampleLimit > 0
        ? await tx.select().from(patients).where(where).orderBy(desc(patients.createdAt)).limit(sampleLimit)
        : [];
      return { count: total, sample };
    });
  }

  async saveSegment(p: Principal, raw: unknown): Promise<MarketingSegment> {
    this.assertAccess(p);
    const input = this.parse(segmentCreate, raw);
    const branchId = this.branch(p, input.branchId);
    return this.dbCtx.runAs(p, async (tx) => {
      const row = await this.repo.createSegment(tx, {
        orgId: p.orgId,
        branchId,
        name: input.name,
        filters: input.filters,
        createdBy: p.staffId,
        updatedBy: p.staffId,
      });
      await this.audit.record(
        this.auditEvent(p, 'marketing_segment_created', 'marketing_segments', row.id, branchId),
        tx,
      );
      return row;
    });
  }

  async listSegments(p: Principal, q: { branchId?: string }): Promise<MarketingSegment[]> {
    this.assertAccess(p);
    return this.dbCtx.runAs(p, (tx) => this.repo.listSegments(tx, p.orgId, this.scoped(p, q.branchId)));
  }

  /* ---------- campaign draft edit ---------- */

  async updateCampaign(p: Principal, id: string, raw: unknown): Promise<Campaign> {
    this.assertAccess(p);
    const input = this.parse(campaignEdit, raw);
    return this.dbCtx.runAs(p, async (tx) => {
      const rows = await tx.select().from(campaigns)
        .where(and(eq(campaigns.orgId, p.orgId), eq(campaigns.id, id), isNull(campaigns.deletedAt))).limit(1);
      const before = rows[0];
      if (!before) throw new NotFoundError('campaign', id);
      this.branch(p, before.branchId);
      /* Only a draft can be edited — once submitted/approved it is immutable here. */
      if (before.status !== 'draft') {
        throw new ConflictError(`Only draft campaigns can be edited (current status: ${before.status})`);
      }

      const set: Record<string, unknown> = {};
      if (input.name !== undefined) set['name'] = input.name;
      if (input.intent !== undefined) set['intent'] = input.intent;
      if (input.audienceDefinition !== undefined) set['audienceDefinition'] = input.audienceDefinition;
      if (input.templateReference !== undefined) set['templateReference'] = input.templateReference;
      if (Object.keys(set).length === 0) throw new ValidationError({ _: ['No editable fields supplied'] });

      const updated = (await tx.update(campaigns).set({ ...set, updatedAt: new Date() } as never)
        .where(and(eq(campaigns.orgId, p.orgId), eq(campaigns.id, id), isNull(campaigns.deletedAt))).returning())[0];
      if (!updated) throw new NotFoundError('campaign', id);
      await this.audit.record(this.auditEvent(p, 'marketing_campaign_updated', 'campaigns', id, before.branchId, { name: before.name }, set), tx);
      return updated;
    });
  }

  /** Translate an audience filter into a patients WHERE clause. */
  private audienceConditions(orgId: string, branchId: string | null, f: AudienceFilter) {
    const conditions = [eq(patients.orgId, orgId), isNull(patients.deletedAt)];
    if (branchId) conditions.push(eq(patients.branchId, branchId));
    if (f.statuses && f.statuses.length) conditions.push(inArray(patients.status, f.statuses as never));
    if (f.patientType) conditions.push(eq(patients.patientType, f.patientType));
    if (f.hasWhatsapp === true) conditions.push(isNotNull(patients.whatsapp));
    if (f.hasWhatsapp === false) conditions.push(isNull(patients.whatsapp));
    if (f.inactiveSinceDays) {
      const cutoff = new Date(Date.now() - f.inactiveSinceDays * 86_400_000);
      conditions.push(or(isNull(patients.lastVisitAt), lte(patients.lastVisitAt, cutoff))!);
    }
    return and(...conditions);
  }
}
