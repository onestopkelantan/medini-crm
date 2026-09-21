import {
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';

import {
  RequirePermission,
} from '../../../core/auth/decorators';

import {
  AuthedRequest,
} from '../../../core/auth/auth.guard';

import {
  ScrubbingAiService,
} from '../application/scrubbing-ai.service';

@Controller({
  path: 'marketing',
  version: '1',
})
export class ScrubbingAiController {
  constructor(
    private readonly service: ScrubbingAiService,
  ) {}

  @Post('scrubbing-message-drafts')
  @RequirePermission('marketing', 'view')
  generateDrafts(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ) {
    return this.service.generateDrafts(
      req.principal!,
      body,
    );
  }
}
