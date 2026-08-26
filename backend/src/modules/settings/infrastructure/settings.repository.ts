import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  settingsDefinitions, settingsValues, settingsVersions, secretRefs,
  SettingsDefinition, SettingsValue, SettingsVersion, SecretRef,
} from '../../../infrastructure/database/schema';
import { DbClient } from '../../patients/infrastructure/patients.repository';
import { toDomainError } from '../../../shared/errors/pg-error';
import { ScopeLevel } from '../domain/settings-lifecycle';

export const SETTINGS_PAGE_MAX = 100;

/**
 * SettingsRepository — data access for the configuration governance plane.
 * Registry (definitions), current scoped values, immutable version history,
 * and SecretRef metadata. No secret VALUES are ever stored or read here.
 */
@Injectable()
export class SettingsRepository {
  /* ---------- definitions (registry) ---------- */
  async createDefinition(tx: DbClient, values: typeof settingsDefinitions.$inferInsert): Promise<SettingsDefinition> {
    try { return (await tx.insert(settingsDefinitions).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async findDefinition(tx: DbClient, orgId: string, key: string): Promise<SettingsDefinition | null> {
    const rows = await tx.select().from(settingsDefinitions)
      .where(and(eq(settingsDefinitions.orgId, orgId), eq(settingsDefinitions.key, key))).limit(1);
    return rows[0] ?? null;
  }
  async listDefinitions(tx: DbClient, orgId: string, category?: string): Promise<SettingsDefinition[]> {
    const conds = [eq(settingsDefinitions.orgId, orgId)];
    if (category) conds.push(eq(settingsDefinitions.category, category));
    return tx.select().from(settingsDefinitions).where(and(...conds)).orderBy(asc(settingsDefinitions.key)).limit(SETTINGS_PAGE_MAX);
  }

  /* ---------- values ---------- */
  async findValue(tx: DbClient, orgId: string, key: string, scope: ScopeLevel, scopeRef: string | null): Promise<SettingsValue | null> {
    const rows = await tx.select().from(settingsValues).where(and(
      eq(settingsValues.orgId, orgId), eq(settingsValues.key, key),
      eq(settingsValues.scope, scope),
      scopeRef == null ? sql`${settingsValues.scopeRef} IS NULL` : eq(settingsValues.scopeRef, scopeRef),
    )).limit(1);
    return rows[0] ?? null;
  }
  /** All values for a key across scopes (for effective resolution). */
  async listValuesForKey(tx: DbClient, orgId: string, key: string): Promise<SettingsValue[]> {
    return tx.select().from(settingsValues)
      .where(and(eq(settingsValues.orgId, orgId), eq(settingsValues.key, key)));
  }
  async upsertValue(tx: DbClient, orgId: string, key: string, scope: ScopeLevel, scopeRef: string | null, value: unknown, actorId: string): Promise<SettingsValue> {
    const existing = await this.findValue(tx, orgId, key, scope, scopeRef);
    if (existing) {
      const rows = await tx.update(settingsValues)
        .set({ value: value as never, version: existing.version + 1, updatedBy: actorId, updatedAt: new Date() } as never)
        .where(eq(settingsValues.id, existing.id)).returning();
      return rows[0]!;
    }
    try {
      return (await tx.insert(settingsValues).values({
        orgId, key, scope, scopeRef, value: value as never, version: 1, updatedBy: actorId, createdBy: actorId,
      }).returning())[0]!;
    } catch (e) { throw toDomainError(e); }
  }

  /* ---------- versions (append-only) ---------- */
  async createVersion(tx: DbClient, values: typeof settingsVersions.$inferInsert): Promise<SettingsVersion> {
    try { return (await tx.insert(settingsVersions).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async listVersions(tx: DbClient, orgId: string, key: string, limit = SETTINGS_PAGE_MAX): Promise<SettingsVersion[]> {
    return tx.select().from(settingsVersions)
      .where(and(eq(settingsVersions.orgId, orgId), eq(settingsVersions.key, key)))
      .orderBy(desc(settingsVersions.createdAt)).limit(limit);
  }

  /* ---------- secret refs (metadata ONLY) ---------- */
  async upsertSecretRef(tx: DbClient, values: typeof secretRefs.$inferInsert): Promise<SecretRef> {
    const existing = await tx.select().from(secretRefs)
      .where(and(eq(secretRefs.orgId, values.orgId as string), eq(secretRefs.key, values.key as string))).limit(1);
    if (existing[0]) {
      const rows = await tx.update(secretRefs)
        .set({ vaultPath: values.vaultPath, lastFour: values.lastFour, status: values.status, rotatedAt: values.rotatedAt, updatedBy: values.updatedBy, updatedAt: new Date() } as never)
        .where(eq(secretRefs.id, existing[0].id)).returning();
      return rows[0]!;
    }
    try { return (await tx.insert(secretRefs).values(values).returning())[0]!; } catch (e) { throw toDomainError(e); }
  }
  async findSecretRef(tx: DbClient, orgId: string, key: string): Promise<SecretRef | null> {
    const rows = await tx.select().from(secretRefs)
      .where(and(eq(secretRefs.orgId, orgId), eq(secretRefs.key, key))).limit(1);
    return rows[0] ?? null;
  }
  async listSecretRefs(tx: DbClient, orgId: string): Promise<SecretRef[]> {
    return tx.select().from(secretRefs).where(eq(secretRefs.orgId, orgId)).orderBy(asc(secretRefs.key)).limit(SETTINGS_PAGE_MAX);
  }
}
