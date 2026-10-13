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

  /**
   * Fasa 1B — the CONTINUOUS chart: the latest state of every tooth the patient
   * has ever had charted, in one payload.
   *
   * Route shape `patients/:patientId/chart` rather than a query param on
   * `tooth-records`, because the two answer different questions and a caller
   * should not be able to get "all events across all visits" by accident — that
   * response grows with every visit and would be quietly shipped to a phone.
   */
  @Get('patients/:patientId/chart')
  @RequirePermission('clinical', 'view')
  patientChart(
    @Req() req: AuthedRequest,
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    return this.service.getPatientChart(req.principal!, patientId);
  }

  /** The dated events behind one tooth — opened when a dentist clicks a tooth. */
  @Get('patients/:patientId/chart/:fdi/history')
  @RequirePermission('clinical', 'view')
  toothHistory(
    @Req() req: AuthedRequest,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('fdi') fdi: string,
  ) {
    return this.service.getToothHistory(req.principal!, patientId, fdi);
  }
}
