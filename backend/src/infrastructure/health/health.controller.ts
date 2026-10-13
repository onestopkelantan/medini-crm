import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { Public } from '../../core/auth/decorators';

/**
 * Health endpoints (unauthenticated, infrastructure-facing).
 * VERSION_NEUTRAL so they live at /health/* (outside the versioned /api/v1).
 * /health/live  — process liveness only.
 * /health/ready — honest dependency readiness (never fakes a healthy dep).
 */
@Public()
@Controller({ path: '/health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService, private readonly config: ConfigService) {}

  @Get('live')
  live() {
    return this.health.liveness();
  }

  @Get('ready')
  async ready() {
    return this.health.readiness();
  }
}
