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
  @RequirePermission('clinical', 'view')
  /* The treatment catalogue is HQ's pricing master, and `createCatalogEntry` asserts HQ.
   * The matrix gives `clinical:create` to the DOCTOR alone, so guarding this with `create`
   * made the catalogue MANAGEABLE BY NOBODY — and Fasa 3 (billing) needs it. The coarse
   * guard now admits the clinical domain; the service decides the role.
   *
   * A guard whose only permitted role the service then rejects is worse than a broad guard
   * with a precise service check: the failure is invisible, reading as "not for you" rather
   * than "misconfigured". Same fix as consent templates. */
  createCatalogEntry(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createCatalogEntry(req.principal!, body);
  }

  @Get('treatments')
  @RequirePermission('clinical', 'view')
  listCatalog(@Req() req: AuthedRequest, @Query('activeOnly') activeOnly?: string) {
    return this.service.listCatalog(req.principal!, activeOnly !== 'false');
  }

  @Patch('treatments/:id/status')
  @RequirePermission('clinical', 'view')
  /* Same reason as createCatalogEntry above: the service asserts HQ, so the coarse guard
   * must not narrow to a role the service then rejects. */
  setCatalogActive(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.setCatalogActive(req.principal!, id, body);
  }

  /**
   * Fasa 1b — set a treatment's PRICES.
   *
   * Without this the catalogue has no number, so `treatment_costs` can record
   * what was done but never how much to charge and every bill totals RM0.00.
   *
   * The coarse guard is `clinical:view` for the same reason as
   * `createCatalogEntry`: the service asserts HQ, and a guard narrowed to a role
   * the service then rejects makes the endpoint reachable by nobody while
   * reporting "not for you". The service is where the role decision belongs.
   *
   * NOTE — this is deliberately NOT `finance:create`. Pricing a treatment is
   * editing the clinical catalogue; `finance:create` governs recording money
   * against a patient (`treatment-costs`), which is a different act by a
   * different person. Conflating them would have made the catalogue writable by
   * whatever role eventually gains billing rights.
   */
  @Patch('treatments/:id')
  @RequirePermission('clinical', 'view')
  updateCatalogPricing(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateCatalogPricing(req.principal!, id, body);
  }

  /* ---- chart symbols (Fasa 1B — the clinic's own chart legend) ---- */
  /**
   * The legend the chart draws with. Registered on the `clinical` path with a
   * distinct segment rather than under `clinical/plans` or similar so a route
   * cannot be shadowed by an `:id` parameter elsewhere in this controller.
   */
  @Get('chart-symbols')
  @RequirePermission('clinical', 'view')
  listChartSymbols(@Req() req: AuthedRequest, @Query('activeOnly') activeOnly?: string) {
    return this.service.listChartSymbols(req.principal!, activeOnly !== 'false');
  }

  /* ---- patient allergies (Fasa 1C — the safety record) ---- */

  /**
   * Allergies for one patient.
   *
   * `clinical:view` — the SAME permission the rest of the clinical read surface
   * uses. Reading an allergy list is not privileged: a receptionist answering the
   * phone needs to know a patient is allergic to penicillin, and hiding it behind
   * a doctor-only permission is how a safety fact goes unseen.
   */
  @Get('patients/:patientId/allergies')
  @RequirePermission('clinical', 'view')
  listAllergies(@Req() req: AuthedRequest, @Param('patientId', ParseUUIDPipe) patientId: string) {
    return this.service.listAllergies(req.principal!, patientId);
  }

  /**
   * Record an allergy.
   *
   * `clinical:create` — which, per `ROLE_DOMAIN_MATRIX`, means the **doctor** role:
   * every other role is view-only or has no clinical access at all. So a
   * receptionist cannot record an allergy here, and that is a governance boundary
   * rather than an oversight — flag it to the user rather than widening the matrix
   * quietly, because widening `clinical:create` would also open treatments,
   * prescriptions and adverse events to whoever gained it.
   *
   * The consequence to be aware of: a patient who volunteers "I'm allergic to
   * penicillin" on the phone has nowhere to be recorded until a doctor enters it.
   */
  @Post('patients/:patientId/allergies')
  @RequirePermission('clinical', 'create')
  createAllergy(
    @Req() req: AuthedRequest,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: unknown,
  ) {
    return this.service.createAllergy(req.principal!, patientId, body);
  }

  /**
   * Retire an allergy — the only way it stops being active.
   *
   * `clinical:edit` and NOT `delete`: there is no delete. A retired row keeps its
   * author, its timestamp and the reason, because an allergy that vanishes
   * silently is indistinguishable from one removed by mistake.
   */
  @Post('allergies/:id/retire')
  @RequirePermission('clinical', 'edit')
  retireAllergy(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.retireAllergy(req.principal!, id, body);
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
