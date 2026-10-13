import {
  Controller,
  Get,
  Query,
  Req,
} from '@nestjs/common';

import {
  RequirePermission,
} from '../../../core/auth/decorators';

import {
  AuthedRequest,
} from '../../../core/auth/auth.guard';

import {
  ScrubbingService,
} from '../application/scrubbing.service';

@Controller({
  path: 'marketing',
  version: '1',
})
export class ScrubbingController {
  constructor(
    private readonly service: ScrubbingService,
  ) {}

  @Get('scrubbing-candidates')
  @RequirePermission('marketing', 'view')
  listCandidates(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.listCandidates(
      req.principal!,
      query,
    );
  }

  /**
   * Treatment catalogue for the recipient filter.
   *
   * Served from the catalogue table rather than hard-coded in the UI so the
   * filter cannot drift from what the clinic actually offers.
   */
  @Get('treatments')
  @RequirePermission('marketing', 'view')
  listTreatments(@Req() req: AuthedRequest) {
    return this.service.listTreatments(req.principal!);
  }
}
