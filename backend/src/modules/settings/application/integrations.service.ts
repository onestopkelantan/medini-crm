import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { ValidationError, ForbiddenError } from '../../../shared/errors/errors';
import { SettingsService } from './settings.service';

const keySchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/, 'invalid integration key');

export interface IntegrationTestResult {
  key: string;
  status: 'ok' | 'not_configured' | 'not_found';
  simulated: true;
  checkedAt: string;
  message: string;
}

/**
 * IntegrationsService — test an external integration by key.
 *
 * Integrations are configured as SecretRefs (HQ-only, G9): the app stores
 * metadata/vault references only, never secret VALUES. A live external
 * handshake is therefore impossible from here, so this is a SIMULATED probe:
 * it confirms the integration's config is present and provisioned
 * (status != ABSENT) and reports that back. Marked `simulated: true` so callers
 * never mistake it for a real round-trip — consistent with the Bukku/WAHA
 * simulation boundary in this codebase.
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

    /* SettingsService.listSecretRefs runs its own RLS context (HQ-only). */
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
}
