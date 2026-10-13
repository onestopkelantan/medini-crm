import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { WhatsappService } from '../application/whatsapp.service';

@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Post('blast')
  @RequirePermission('whatsapp', 'create')
  blast(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ) {
    return this.service.queueBlast(
      req.principal!,
      body,
    );
  }

  @Post('channels')
  @RequirePermission('whatsapp', 'create')
  createChannel(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ) {
    return this.service.createChannel(req.principal!, body);
  }

  @Patch('channels/:id')
  @RequirePermission('whatsapp', 'edit')
  updateChannel(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateChannel(req.principal!, id, body);
  }

  @Get('channels')
  @RequirePermission('whatsapp', 'view')
  listChannels(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listChannels(req.principal!, branchId, {
      limit,
      offset,
    });
  }

  @Patch('channels/:id/status')
  @RequirePermission('whatsapp', 'edit')
  channelStatus(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.transitionChannel(req.principal!, id, body);
  }

  @Get('channels/:id/health')
  @RequirePermission('whatsapp', 'view')
  channelHealth(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getChannelHealth(req.principal!, id);
  }

  @Patch('channels/:id/health')
  @RequirePermission('whatsapp', 'edit')
  updateChannelHealth(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateChannelHealth(req.principal!, id, body);
  }

  @Post('channels/:id/resume-auto-pause')
  @RequirePermission('whatsapp', 'edit')
  resumeAutoPause(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.resumeAutoPause(req.principal!, id);
  }

  @Get('channels/:id/qr')
  @RequirePermission('whatsapp', 'edit')
  channelQr(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.generateChannelQr(req.principal!, id);
  }

  @Delete('channels/:id')
  @RequirePermission('whatsapp', 'edit')
  deactivateChannel(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deactivateChannel(req.principal!, id);
  }

  /** 0029 — switch the branch's live channel to this one. */
  @Patch('channels/:id/primary')
  @RequirePermission('whatsapp', 'edit')
  setChannelPrimary(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.setChannelPrimary(req.principal!, id);
  }

  /** Toggle AI auto-reply for a number. */
  @Patch('channels/:id/ai-reply')
  @RequirePermission('whatsapp', 'edit')
  setAiReply(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.setChannelAiReply(req.principal!, id, body);
  }

  /** Inbox queue with operator tabs (all / needs_human / unanswered / ai). */
  @Get('conversation-queue')
  @RequirePermission('whatsapp', 'view')
  conversationQueue(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.listConversationQueue(req.principal!, query);
  }

  /**
   * FASA 5D-C — who is waiting, longest first.
   *
   * Sorted by wait, not by recency: a newest-first inbox buries the patient who
   * has been waiting longest. Reports the branch's limit alongside, so the screen
   * can mark the breaches without a second call.
   */
  @Get('conversations/sla')
  @RequirePermission('whatsapp', 'view')
  slaBoard(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.slaBoard(req.principal!, query);
  }

  @Post('conversations')
  @RequirePermission('whatsapp', 'create')
  createConversation(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ) {
    return this.service.createConversation(req.principal!, body);
  }

  @Get('conversations')
  @RequirePermission('whatsapp', 'view')
  listConversations(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.listConversations(req.principal!, query);
  }

  /**
   * FASA 5F — campaign schedule.
   *
   * `edit`, not `view`: setting dates changes what the clinic will send and when.
   */
  @Patch('campaigns/:id/schedule')
  @RequirePermission('whatsapp', 'edit')
  setCampaignSchedule(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.setCampaignSchedule(req.principal!, id, body);
  }

  /** FASA 5F — campaign progress: day N of M, and whether it is on track. */
  @Get('campaigns/progress')
  @RequirePermission('whatsapp', 'view')
  campaignProgress(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.campaignProgressBoard(req.principal!, query);
  }

  @Get('conversations/:id')
  @RequirePermission('whatsapp', 'view')
  getConversation(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getConversation(req.principal!, id);
  }

  @Get('conversations/:id/messages')
  @RequirePermission('whatsapp', 'view')
  listMessages(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listMessages(req.principal!, id, {
      limit,
      offset,
    });
  }

  /** Staff who can be assigned a conversation in the caller's scope.
   *  Distinct from the HQ-only /admin/staff list so branch users can actually
   *  use the assign control. */
  @Get('assignable-staff')
  @RequirePermission('whatsapp', 'view')
  listAssignableStaff(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.listAssignableStaff(req.principal!, branchId);
  }

  /**
   * Fasa 1a — mark a thread read. Clears `wa_conversations.unread_count`.
   *
   * Fasa 1 registered no such route while its UI called it on every thread
   * open, so the call 404'd and the unread badge never cleared. See
   * `WhatsAppService.markConversationRead` for why this touches the THREAD
   * counter and not the notification bell.
   */
  @Post('conversations/:id/read')
  @RequirePermission('whatsapp', 'edit')
  markConversationRead(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.markConversationRead(req.principal!, id);
  }

  @Post('conversations/:id/messages')
  @RequirePermission('whatsapp', 'create')
  createMessage(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.createMessage(req.principal!, id, body);
  }

  @Post('conversations/:id/assign')
  @RequirePermission('whatsapp', 'edit')
  assign(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.assignConversation(req.principal!, id, body);
  }

  @Post('conversations/:id/unassign')
  @RequirePermission('whatsapp', 'edit')
  unassign(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.unassignConversation(req.principal!, id);
  }

  @Post('conversations/:id/handoff')
  @RequirePermission('whatsapp', 'edit')
  handoff(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.handoffConversation(req.principal!, id);
  }

  @Post('conversations/:id/return-to-ai')
  @RequirePermission('whatsapp', 'edit')
  returnToAi(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.returnToAiConversation(req.principal!, id);
  }

  @Post('conversations/:id/resolve')
  @RequirePermission('whatsapp', 'edit')
  resolve(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.resolveConversation(req.principal!, id);
  }

  @Post('conversations/:id/reopen')
  @RequirePermission('whatsapp', 'edit')
  reopen(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.reopenConversation(req.principal!, id);
  }

  @Post('conversations/:id/archive')
  @RequirePermission('whatsapp', 'edit')
  archive(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.archiveConversation(req.principal!, id);
  }

  @Post('conversations/:id/ai-queue')
  @RequirePermission('whatsapp', 'edit')
  startAiQueue(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.startAiQueue(req.principal!, id);
  }

  @Patch('conversations/:id/ai-queue')
  @RequirePermission('whatsapp', 'edit')
  transitionAiQueue(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.transitionAiQueue(req.principal!, id, body);
  }

  @Patch('messages/:id/status')
  @RequirePermission('whatsapp', 'edit')
  messageStatus(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.transitionMessage(req.principal!, id, body);
  }

  @Get('templates')
  @RequirePermission('whatsapp', 'view')
  listTemplates(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listTemplates(req.principal!, branchId, {
      limit,
      offset,
    });
  }

  @Post('templates')
  @RequirePermission('whatsapp', 'create')
  createTemplate(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ) {
    return this.service.createTemplate(req.principal!, body);
  }

  @Patch('templates/:id')
  @RequirePermission('whatsapp', 'edit')
  updateTemplate(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateTemplate(req.principal!, id, body);
  }

  @Get('safety-decisions')
  @RequirePermission('whatsapp', 'view')
  listSafetyDecisions(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listSafetyDecisions(req.principal!, branchId, {
      limit,
      offset,
    });
  }
}
