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
}
