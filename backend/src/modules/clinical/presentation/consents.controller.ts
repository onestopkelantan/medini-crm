import {
  Controller, Get, Post, Patch, Body, Req, Param, Query,
  ParseUUIDPipe } from '@nestjs/common';
import { ClinicalExtendedService } from '../application/clinical-extended.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * ConsentsController — consent templates (HQ-managed, versioned) + immutable
 * consent records (doctor-recorded). ADR-009: records are INSERT-only; there
 * is no update/delete route by design.
 */
@Controller({ path: 'clinical/consents', version: '1' })
export class ConsentsController {
  constructor(private readonly service: ClinicalExtendedService) {}

  @Post('templates')
  @RequirePermission('clinical', 'create')
  createTemplate(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createTemplate(req.principal!, body);
  }

  @Get('templates')
  @RequirePermission('clinical', 'view')
  listTemplates(@Req() req: AuthedRequest, @Query('activeOnly') activeOnly?: string) {
    return this.service.listTemplates(req.principal!, activeOnly !== 'false');
  }

  @Patch('templates/:id/status')
  @RequirePermission('clinical', 'edit')
  setTemplateActive(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.setTemplateActive(req.principal!, id, body);
  }

  @Post('records')
  @RequirePermission('clinical', 'create')
  recordConsent(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.recordConsent(req.principal!, body);
  }

  @Get('records')
  @RequirePermission('clinical', 'view')
  listConsents(
    @Req() req: AuthedRequest,
    @Query('patientId') patientId?: string,
    @Query('planId') planId?: string,
  ) {
    return this.service.listConsents(req.principal!, { patientId, planId });
  }
}
