import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { ValidationError, ForbiddenError } from '../../../shared/errors/errors';
import { SettingsService } from './settings.service';

const keySchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/, 'invalid integration key');
const valueSchema = z.string().trim().min(1).max(512);

export interface IntegrationTestResult {
  key: string;
  status: 'ok' | 'not_configured' | 'not_found';
  simulated: true;
  checkedAt: string;
  message: string;
}

export interface IntegrationSetResult {
  key: string;
  status: 'ok';
  message: string;
  requiresRestart: boolean;
}

/**
 * IntegrationsService — test and configure external integrations.
 *
 * Stores API keys in database (integration_secrets table) — NOT in .env file.
 * This allows the backend container to read them without file-system access.
 * Secrets are never exposed via API — only written and used internally.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  async test(principal: Principal, rawKey: string): Promise<IntegrationTestResult> {
    if (principal.role !== 'hq') throw new ForbiddenError('Integration testing is HQ-only');
    const parsed = keySchema.safeParse(rawKey);
    if (!parsed.success) throw new ValidationError({ key: [parsed.error.issues[0]!.message] });
    const key = parsed.data;

    const refs = await this.settings.listSecretRefs(principal);
    const ref = (refs as Array<{ key: string; status: string }>).find((r) => r.key === key);

    let status: IntegrationTestResult['status'];
    let message: string;
    if (!ref) {
      status = 'not_found';
      message = `No integration registered under key '${key}'`;
    } else if (ref.status === 'ABSENT') {
      status = 'not_configured';
      message = `Integration '${key}' is registered but no credential is provisioned`;
    } else {
      status = 'ok';
      message = `Integration '${key}' configuration is present (${ref.status}). Simulated check passed.`;
    }

    await this.dbCtx.runAs(principal, (tx) =>
      this.audit.record(
        {
          actorId: principal.staffId, actorRole: principal.role,
          action: 'integration_test_run', entity: 'secret_refs', entityId: key,
          orgId: principal.orgId, branchId: null, source: 'api',
          after: { status },
        },
        tx,
      ),
    );

    return { key, status, simulated: true, checkedAt: new Date().toISOString(), message };
  }

  /**
   * Set an integration API key. Stores in database (integration_secrets table).
   * The secret is sent over HTTPS but NEVER returned by any API endpoint.
   */
  async set(principal: Principal, rawKey: string, rawValue: string): Promise<IntegrationSetResult> {
    if (principal.role !== 'hq') throw new ForbiddenError('Integration configuration is HQ-only');

    const parsedKey = keySchema.safeParse(rawKey);
    if (!parsedKey.success) throw new ValidationError({ key: [parsedKey.error.issues[0]!.message] });
    const parsedValue = valueSchema.safeParse(rawValue);
    if (!parsedValue.success) throw new ValidationError({ value: [parsedValue.error.issues[0]!.message] });

    const key = parsedKey.data;
    const value = parsedValue.data;

    // Map integration keys to supported list
    const supportedKeys = ['bukku', 'waha', 'minimax', 'ai-provider', 'whatsapp'];
    if (!supportedKeys.includes(key)) {
      throw new ValidationError({ key: [`Unknown integration key '${key}'. Supported: ${supportedKeys.join(', ')}`] });
    }

    // Store in database using Drizzle schema
    await this.dbCtx.runAs(principal, async (tx: any) => {
      const { integrationSecrets } = await import('../../../infrastructure/database/schema.js');

      // Upsert: insert or update if exists
      await tx.insert(integrationSecrets).values({
        orgId: principal.orgId,
        integrationKey: key,
        secretValue: value,
      }).onDuplicateKeyUpdate({
        set: { secretValue: value, updatedAt: new Date() },
      });

      await this.audit.record(
        {
          actorId: principal.staffId, actorRole: principal.role,
          action: 'integration_configured', entity: 'integration_secrets', entityId: key,
          orgId: principal.orgId, branchId: null, source: 'api',
          after: { key, status: 'configured' },
        },
        tx,
      );
    });

    return {
      key,
      status: 'ok',
      message: `Integration '${key}' configured and saved to database.`,
      requiresRestart: false,
    };
  }

  /**
   * Get integration secret (internal use only — never exposed via API).
   * Used by backend services to read API keys at runtime.
   */
  async getSecret(orgId: string, key: string): Promise<string | null> {
    // This method is NOT exposed via controller — internal use only
    // Uses a system worker context since we don't have a user principal
    const result = await this.dbCtx.runAsWorker(
      { orgId, branchIds: [], correlationId: 'system', source: 'system_worker' },
      async (tx: any) => {
        const { integrationSecrets } = await import('../../../infrastructure/database/schema.js');
        const { eq, and } = await import('drizzle-orm');

        const rows = await tx.select().from(integrationSecrets).where(
          and(
            eq(integrationSecrets.orgId, orgId),
            eq(integrationSecrets.integrationKey, key),
          ),
        ).limit(1);

        return rows[0]?.secretValue ?? null;
      },
    );
    return result;
  }
}
