import { Body, Controller, Get, Param, Patch, Post, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { WhatsappService } from '../application/whatsapp.service';

/**
 * WhatsApp Hub REST API v1 (Sprint 6). Simulated state only — no WAHA transport.
 * RBAC via canonical matrix: hq all · branch roles branch · doctor = NONE (D1,
 * enforced by PermissionGuard + RLS, never by service hacks).
 */
@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  /* ---------- channels ---------- */
  @Post('channels') @RequirePermission('whatsapp', 'create') createChannel(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createChannel(req.principal!, body); }
  @Get('channels') @RequirePermission('whatsapp', 'view') listChannels(@Req() req: AuthedRequest, @Query('branchId') branchId?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) { return this.service.listChannels(req.principal!, branchId, { limit, offset }); }
  @Patch('channels/:id/status') @RequirePermission('whatsapp', 'edit') channelStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionChannel(req.principal!, id, body); }
  @Get('channels/:id/health') @RequirePermission('whatsapp', 'view') channelHealth(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.getChannelHealth(req.principal!, id); }
  @Patch('channels/:id/health') @RequirePermission('whatsapp', 'edit') updateChannelHealth(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.updateChannelHealth(req.principal!, id, body); }
  @Post('channels/:id/resume-auto-pause') @RequirePermission('whatsapp', 'edit') resumeAutoPause(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.resumeAutoPause(req.principal!, id); }

  /* ---------- conversations ---------- */
  @Post('conversations') @RequirePermission('whatsapp', 'create') createConversation(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createConversation(req.principal!, body); }
  @Get('conversations') @RequirePermission('whatsapp', 'view') listConversations(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) { return this.service.listConversations(req.principal!, query); }
  @Get('conversations/:id') @RequirePermission('whatsapp', 'view') getConversation(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.getConversation(req.principal!, id); }
  @Get('conversations/:id/messages') @RequirePermission('whatsapp', 'view') listMessages(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string, @Query('offset') offset?: string) { return this.service.listMessages(req.principal!, id, { limit, offset }); }
  @Post('conversations/:id/messages') @RequirePermission('whatsapp', 'create') createMessage(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.createMessage(req.principal!, id, body); }
  @Post('conversations/:id/assign') @RequirePermission('whatsapp', 'edit') assign(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.assignConversation(req.principal!, id, body); }
  @Post('conversations/:id/unassign') @RequirePermission('whatsapp', 'edit') unassign(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.unassignConversation(req.principal!, id); }
  @Post('conversations/:id/handoff') @RequirePermission('whatsapp', 'edit') handoff(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.handoffConversation(req.principal!, id); }
  @Post('conversations/:id/return-to-ai') @RequirePermission('whatsapp', 'edit') returnToAi(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.returnToAiConversation(req.principal!, id); }
  @Post('conversations/:id/resolve') @RequirePermission('whatsapp', 'edit') resolve(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.resolveConversation(req.principal!, id); }
  @Post('conversations/:id/reopen') @RequirePermission('whatsapp', 'edit') reopen(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.reopenConversation(req.principal!, id); }
  @Post('conversations/:id/archive') @RequirePermission('whatsapp', 'edit') archive(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.archiveConversation(req.principal!, id); }
  @Post('conversations/:id/ai-queue') @RequirePermission('whatsapp', 'edit') startAiQueue(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.startAiQueue(req.principal!, id); }
  @Patch('conversations/:id/ai-queue') @RequirePermission('whatsapp', 'edit') transitionAiQueue(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionAiQueue(req.principal!, id, body); }

  /* ---------- messages ---------- */
  @Patch('messages/:id/status') @RequirePermission('whatsapp', 'edit') messageStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionMessage(req.principal!, id, body); }

  /* ---------- templates ---------- */
  @Get('templates') @RequirePermission('whatsapp', 'view') listTemplates(@Req() req: AuthedRequest, @Query('branchId') branchId?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) { return this.service.listTemplates(req.principal!, branchId, { limit, offset }); }
  @Post('templates') @RequirePermission('whatsapp', 'create') createTemplate(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createTemplate(req.principal!, body); }
  @Patch('templates/:id') @RequirePermission('whatsapp', 'edit') updateTemplate(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.updateTemplate(req.principal!, id, body); }

  /* ---------- safety decisions (audit surface) ---------- */
  @Get('safety-decisions') @RequirePermission('whatsapp', 'view') listSafetyDecisions(@Req() req: AuthedRequest, @Query('branchId') branchId?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) { return this.service.listSafetyDecisions(req.principal!, branchId, { limit, offset }); }
}
