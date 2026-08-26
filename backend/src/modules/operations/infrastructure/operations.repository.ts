import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  doctorStatuses, checklists, tasks, incidents, labCases,
  DoctorStatus, Checklist, Task, Incident, LabCase,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/pg-error';

@Injectable()
export class OperationsRepository {
  async createDoctorStatus(tx: DbClient, values: typeof doctorStatuses.$inferInsert): Promise<DoctorStatus> { return this.insert(tx, doctorStatuses, values); }
  async createChecklist(tx: DbClient, values: typeof checklists.$inferInsert): Promise<Checklist> { return this.insert(tx, checklists, values); }
  async createTask(tx: DbClient, values: typeof tasks.$inferInsert): Promise<Task> { return this.insert(tx, tasks, values); }
  async createIncident(tx: DbClient, values: typeof incidents.$inferInsert): Promise<Incident> { return this.insert(tx, incidents, values); }
  async createLabCase(tx: DbClient, values: typeof labCases.$inferInsert): Promise<LabCase> { return this.insert(tx, labCases, values); }

  private async insert<T extends { $inferInsert: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, values: T['$inferInsert']): Promise<T['$inferSelect']> {
    try { return (await tx.insert(table as never).values(values as never).returning())[0] as T['$inferSelect']; } catch (e) { throw toDomainError(e); }
  }

  async findDoctorStatus(tx: DbClient, orgId: string, id: string): Promise<DoctorStatus | null> { return this.find(tx, doctorStatuses, orgId, id); }
  async findChecklist(tx: DbClient, orgId: string, id: string): Promise<Checklist | null> { return this.find(tx, checklists, orgId, id); }
  async findTask(tx: DbClient, orgId: string, id: string): Promise<Task | null> { return this.find(tx, tasks, orgId, id); }
  async findIncident(tx: DbClient, orgId: string, id: string): Promise<Incident | null> { return this.find(tx, incidents, orgId, id); }
  async findLabCase(tx: DbClient, orgId: string, id: string): Promise<LabCase | null> { return this.find(tx, labCases, orgId, id); }
  private async find<T extends { id: unknown; orgId: unknown; deletedAt: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, orgId: string, id: string): Promise<T['$inferSelect'] | null> {
    const rows = await tx.select().from(table as never).where(and(eq(table.orgId as never, orgId), eq(table.id as never, id), isNull(table.deletedAt as never))).limit(1);
    return (rows[0] as T['$inferSelect']) ?? null;
  }

  async currentDoctorStatus(tx: DbClient, orgId: string, doctorId: string): Promise<DoctorStatus | null> {
    const rows = await tx.select().from(doctorStatuses).where(and(eq(doctorStatuses.orgId, orgId), eq(doctorStatuses.doctorId, doctorId), isNull(doctorStatuses.deletedAt))).orderBy(desc(doctorStatuses.effectiveAt)).limit(1);
    return rows[0] ?? null;
  }

  async listDoctorStatuses(tx: DbClient, orgId: string, branchId: string | null): Promise<DoctorStatus[]> { return this.list(tx, doctorStatuses, orgId, branchId); }
  async listChecklists(tx: DbClient, orgId: string, branchId: string | null): Promise<Checklist[]> { return this.list(tx, checklists, orgId, branchId); }
  async listTasks(tx: DbClient, orgId: string, branchId: string | null): Promise<Task[]> { return this.list(tx, tasks, orgId, branchId); }
  async listIncidents(tx: DbClient, orgId: string, branchId: string | null): Promise<Incident[]> { return this.list(tx, incidents, orgId, branchId); }
  async listLabCases(tx: DbClient, orgId: string, branchId: string | null): Promise<LabCase[]> { return this.list(tx, labCases, orgId, branchId); }
  private async list<T extends { orgId: unknown; branchId: unknown; deletedAt: unknown; createdAt: unknown; $inferSelect: unknown }>(tx: DbClient, table: T, orgId: string, branchId: string | null): Promise<T['$inferSelect'][]> {
    const conditions = [eq(table.orgId as never, orgId), isNull(table.deletedAt as never)];
    if (branchId) conditions.push(eq(table.branchId as never, branchId));
    return (await tx.select().from(table as never).where(and(...conditions)).orderBy(desc(table.createdAt as never))) as T['$inferSelect'][];
  }

  async updateStatus(tx: DbClient, table: typeof doctorStatuses | typeof checklists | typeof tasks | typeof incidents | typeof labCases, orgId: string, id: string, status: string, extra?: Record<string, unknown>) {
    const rows = await tx.update(table).set({ status: status as never, ...(extra ?? {}), updatedAt: new Date() }).where(and(eq(table.orgId, orgId), eq(table.id, id), isNull(table.deletedAt))).returning();
    return rows[0] ?? null;
  }
}
