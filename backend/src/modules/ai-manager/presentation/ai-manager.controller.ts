import { Body, Controller, Get, Param, Patch, Post, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { AiManagerService } from '../application/ai-manager.service';

/**
 * AI Manager REST API v1 (Sprint 7 T3) — AI workforce control plane.
 * RBAC via canonical matrix `ai`: hq view/create/edit/approve · branch_manager
 * view · branch_admin/doctor NONE. Governance only — no LLM/model runtime.
 */
@Controller({ path: 'ai', version: '1' })
export class AiManagerController {
  constructor(private readonly service: AiManagerService) {}

  /* ---------- agents ---------- */
  @Get('agents') @RequirePermission('ai', 'view') listAgents(@Req() req: AuthedRequest) { return this.service.listAgents(req.principal!); }
  @Post('agents') @RequirePermission('ai', 'create') registerAgent(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.registerAgent(req.principal!, body); }
  @Get('agents/:id') @RequirePermission('ai', 'view') getAgent(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAgent(req.principal!, id); }
  @Post('agents/:id/enable') @RequirePermission('ai', 'edit') enable(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.transitionAgent(req.principal!, id, 'enable'); }
  @Post('agents/:id/pause') @RequirePermission('ai', 'edit') pause(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.transitionAgent(req.principal!, id, 'pause'); }
  @Post('agents/:id/archive') @RequirePermission('ai', 'edit') archive(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.transitionAgent(req.principal!, id, 'archive'); }

  /* ---------- capabilities + knowledge + automations ---------- */
  @Post('agents/:id/capabilities') @RequirePermission('ai', 'edit') grantCapability(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.grantCapability(req.principal!, id, body); }
  @Post('agents/:id/knowledge') @RequirePermission('ai', 'edit') addKnowledge(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.addKnowledge(req.principal!, id, body); }
  @Post('agents/:id/automations') @RequirePermission('ai', 'edit') createAutomation(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.createAutomation(req.principal!, id, body); }
  @Patch('automations/:id') @RequirePermission('ai', 'edit') toggleAutomation(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: { enabled: boolean }) { return this.service.toggleAutomation(req.principal!, id, body?.enabled === true); }

  /* ---------- guardrails + approval rules ---------- */
  @Get('guardrails') @RequirePermission('ai', 'view') listGuardrails(@Req() req: AuthedRequest) { return this.service.listGuardrails(req.principal!); }
  @Post('guardrails') @RequirePermission('ai', 'edit') createGuardrail(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createGuardrail(req.principal!, body); }
  @Get('approval-rules') @RequirePermission('ai', 'view') listApprovalRules(@Req() req: AuthedRequest) { return this.service.listApprovalRules(req.principal!); }
  @Post('approval-rules') @RequirePermission('ai', 'approve') createApprovalRule(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createApprovalRule(req.principal!, body); }

  /* ---------- policy evaluation + audit ---------- */
  @Post('policy/evaluate') @RequirePermission('ai', 'view') evaluate(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.evaluate(req.principal!, body); }
  @Get('audit') @RequirePermission('ai', 'view') listAudit(@Req() req: AuthedRequest, @Query('agentId') agentId?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) { return this.service.listAudit(req.principal!, agentId, { limit, offset }); }
}
