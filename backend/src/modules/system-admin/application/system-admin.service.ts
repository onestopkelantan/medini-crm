import { Injectable } from '@nestjs/common';
import { HealthService, ReadinessReport } from '../../../infrastructure/health/health.service';

export interface SystemOverview {
  readonly service: string;
  readonly version: string;
  readonly environment: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
}

/**
 * SystemAdminService — S10 GLM 5.3 Remediation (Developer / System Admin).
 *
 * Technical diagnostics ONLY. This service intentionally has NO repository or
 * business-module dependencies: the developer role must be incapable of
 * touching business data (patients, clinical, finance, …) by construction,
 * not merely by policy. Three deny layers: matrix (no cells) → PermissionGuard
 * (403 on every business route) → RLS RESTRICTIVE (migration 0027).
 */
@Injectable()
export class SystemAdminService {
  constructor(private readonly health: HealthService) {}

  overview(): SystemOverview {
    return {
      service: 'medini-crm-backend',
      version: process.env.APP_VERSION ?? '0.0.1',
      environment: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Rich dependency readiness (real DB probe — never faked). */
  readiness(): Promise<ReadinessReport> {
    return this.health.readiness();
  }
}
