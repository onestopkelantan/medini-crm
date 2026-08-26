import {
  Controller, Get, Post, Patch, Body, Req, Query, Param,
  ParseUUIDPipe } from '@nestjs/common';
import { ClinicalExtendedService } from '../application/clinical-extended.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * ClinicalOpsController — prescriptions, adverse events, referrals,
 * treatment catalog (Sprint 3 S3-D).
 *  - catalog: HQ write (org-wide reference data, NO pricing — ADR-004),
 *    all clinical-capable roles read (mirrors frontend meta.treatments)
 *  - prescriptions/referrals: doctor own-scope create + scoped read
 *  - adverse events: doctor reports; immutable safety record (INSERT-only)
 */
@Controller({ path: 'clinical', version: '1' })
export class ClinicalOpsController {
  constructor(private readonly service: ClinicalExtendedService) {}

  /* ---- treatment catalog (frontend meta.treatments parity) ---- */
  @Post('treatments')
  @RequirePermission('clinical', 'create')
  createCatalogEntry(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createCatalogEntry(req.principal!, body);
  }

  @Get('treatments')
  @RequirePermission('clinical', 'view')
  listCatalog(@Req() req: AuthedRequest, @Query('activeOnly') activeOnly?: string) {
    return this.service.listCatalog(req.principal!, activeOnly !== 'false');
  }

  @Patch('treatments/:id/status')
  @RequirePermission('clinical', 'edit')
  setCatalogActive(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.setCatalogActive(req.principal!, id, body);
  }

  /* ---- prescriptions ---- */
  @Post('prescriptions')
  @RequirePermission('clinical', 'create')
  createPrescription(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createPrescription(req.principal!, body);
  }

  @Get('prescriptions')
  @RequirePermission('clinical', 'view')
  listPrescriptions(@Req() req: AuthedRequest, @Query('patientId') patientId?: string) {
    return this.service.listPrescriptions(req.principal!, { patientId });
  }

  /* ---- adverse events (immutable safety records) ---- */
  @Post('adverse-events')
  @RequirePermission('clinical', 'create')
  reportAdverseEvent(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.reportAdverseEvent(req.principal!, body);
  }

  @Get('adverse-events')
  @RequirePermission('clinical', 'view')
  listAdverseEvents(@Req() req: AuthedRequest, @Query('patientId') patientId?: string) {
    return this.service.listAdverseEvents(req.principal!, { patientId });
  }

  /* ---- referrals ---- */
  @Post('referrals')
  @RequirePermission('clinical', 'create')
  createReferral(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createReferral(req.principal!, body);
  }

  @Get('referrals')
  @RequirePermission('clinical', 'view')
  listReferrals(@Req() req: AuthedRequest, @Query('patientId') patientId?: string) {
    return this.service.listReferrals(req.principal!, { patientId });
  }

  @Patch('referrals/:id/status')
  @RequirePermission('clinical', 'edit')
  updateReferralStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.updateReferralStatus(req.principal!, id, body);
  }
}
