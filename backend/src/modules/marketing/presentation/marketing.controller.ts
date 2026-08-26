import { Body, Controller, Get, Param, Patch, Post, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { MarketingService } from '../application/marketing.service';

@Controller({ path: 'marketing', version: '1' })
export class MarketingController {
  constructor(private readonly service: MarketingService) {}
  @Post('leads') @RequirePermission('marketing', 'create') createLead(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createLead(req.principal!, body); }
  @Get('leads') @RequirePermission('marketing', 'view') listLeads(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listLeads(req.principal!, branchId); }
  @Patch('leads/:id/status') @RequirePermission('marketing', 'edit') leadStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionLead(req.principal!, id, body); }
  @Post('campaigns') @RequirePermission('marketing', 'create') createCampaign(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createCampaign(req.principal!, body); }
  @Get('campaigns') @RequirePermission('marketing', 'view') listCampaigns(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listCampaigns(req.principal!, branchId); }
  @Patch('campaigns/:id/status') @RequirePermission('marketing', 'submit') campaignStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionCampaign(req.principal!, id, body); }
  @Post('recall-rules') @RequirePermission('marketing', 'create') createRecallRule(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createRecallRule(req.principal!, body); }
  @Post('recall-cases') @RequirePermission('marketing', 'create') createRecallCase(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createRecallCase(req.principal!, body); }
  @Get('recall-cases') @RequirePermission('marketing', 'view') listRecallCases(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listRecallCases(req.principal!, branchId); }
  @Patch('recall-cases/:id/status') @RequirePermission('marketing', 'edit') recallStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionRecall(req.principal!, id, body); }
  @Post('follow-ups') @RequirePermission('marketing', 'create') createFollowUp(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createFollowUp(req.principal!, body); }
  @Get('follow-ups') @RequirePermission('marketing', 'view') listFollowUps(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listFollowUps(req.principal!, branchId); }
  @Patch('follow-ups/:id/status') @RequirePermission('marketing', 'edit') followUpStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionFollowUp(req.principal!, id, body); }
}
