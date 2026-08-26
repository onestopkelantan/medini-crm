import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';
import { Public } from '../../core/auth/decorators';

/** S9-T3 — Prometheus scrape endpoint. Version-neutral like /health (Q6:
 * @Public + deploy-time network restriction documented in OBSERVABILITY.md). */
@Public()
@Controller({ path: '/', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly svc: MetricsService) {}

  @Get('metrics')
  async metrics(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.svc.contentType);
    res.send(await this.svc.render());
  }
}
