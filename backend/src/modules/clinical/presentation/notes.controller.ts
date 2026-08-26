import {
  Controller, Get, Post, Body, Req, Param, Query,
  ParseUUIDPipe } from '@nestjs/common';
import { NotesService } from '../application/notes.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * NotesController — SOAP notes (immutable after sign, ADR-009) + FDI tooth
 * chart. There is intentionally NO update/delete route for notes: draft
 * replace = POST (supersede), correction of signed notes = POST /:id/amend.
 */
@Controller({ path: 'clinical', version: '1' })
export class NotesController {
  constructor(private readonly service: NotesService) {}

  @Post('notes')
  @RequirePermission('clinical', 'create')
  createDraft(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createOrReplaceDraft(req.principal!, body);
  }

  @Get('notes')
  @RequirePermission('clinical', 'view')
  listForEncounter(@Req() req: AuthedRequest, @Query('encounterId') encounterId: string) {
    return this.service.listForEncounter(req.principal!, encounterId);
  }

  @Post('notes/:id/sign')
  @RequirePermission('clinical', 'edit')
  sign(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.sign(req.principal!, id);
  }

  @Post('notes/:id/amend')
  @RequirePermission('clinical', 'create')
  amend(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.amend(req.principal!, id, body);
  }

  @Post('tooth-records')
  @RequirePermission('clinical', 'create')
  upsertTooth(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.upsertTooth(req.principal!, body);
  }

  @Get('tooth-records')
  @RequirePermission('clinical', 'view')
  listTeeth(@Req() req: AuthedRequest, @Query('encounterId') encounterId: string) {
    return this.service.listTeeth(req.principal!, encounterId);
  }
}
