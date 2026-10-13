import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_REGISTRY } from './shared/architecture/architecture.contract';
import { Public } from './core/auth/decorators';

/**
 * Root API status endpoint — confirms the API foundation + contract layer.
 * Global prefix 'api' + path 'v1' → /api/v1. Not a domain endpoint.
 * Public (unauthenticated) — reveals only non-sensitive service metadata.
 */
@Public()
@Controller({ path: 'v1', version: VERSION_NEUTRAL })
export class RootController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  status() {
    return {
      data: {
        service: 'medini-crm-backend',
        version: this.config.get<string>('app.apiVersion') ?? 'v1',
        environment: this.config.get<string>('app.nodeEnv'),
        domains: DOMAIN_REGISTRY.length,
        sprint: 'Sprint 0 — Foundation',
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }
}
