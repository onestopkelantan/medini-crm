import { Body, Controller, Get, Param, Patch, Post, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { MarketingContentService } from '../application/marketing-content.service';

/**
 * MarketingContentController — templates + audience/segments (Sprint 9).
 * Shares the `marketing` path prefix with MarketingController; route paths do
 * not overlap. All routes gated by the marketing permission cells (HQ + manager).
 */
@Controller({ path: 'marketing', version: '1' })
export class MarketingContentController {
  constructor(private readonly service: MarketingContentService) {}

  /* ---- templates ---- */

  @Get('templates')
  @RequirePermission('marketing', 'view')
  listTemplates(
    @Req() req: AuthedRequest,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.listTemplates(req.principal!, { channel, status, branchId });
  }

  @Post('templates')
  @RequirePermission('marketing', 'create')
  createTemplate(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createTemplate(req.principal!, body);
  }

  @Patch('templates/:id')
  @RequirePermission('marketing', 'edit')
  updateTemplate(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.updateTemplate(req.principal!, id, body);
  }

  @Patch('templates/:id/status')
  @RequirePermission('marketing', 'edit')
  setTemplateStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.setTemplateStatus(req.principal!, id, body);
  }

  @Post('templates/:id/duplicate')
  @RequirePermission('marketing', 'create')
  duplicateTemplate(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.duplicateTemplate(req.principal!, id);
  }

  /* ---- campaign draft edit ---- */

  @Patch('campaigns/:id')
  @RequirePermission('marketing', 'edit')
  updateCampaign(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.updateCampaign(req.principal!, id, body);
  }

  /* ---- audience + segments ---- */

  @Post('audience/preview')
  @RequirePermission('marketing', 'view')
  previewAudience(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.previewAudience(req.principal!, body);
  }

  @Post('segments')
  @RequirePermission('marketing', 'create')
  saveSegment(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.saveSegment(req.principal!, body);
  }

  @Get('segments')
  @RequirePermission('marketing', 'view')
  listSegments(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) {
    return this.service.listSegments(req.principal!, { branchId });
  }
}
