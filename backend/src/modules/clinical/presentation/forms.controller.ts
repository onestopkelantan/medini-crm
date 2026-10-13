import {
  Controller, Get, Post, Patch, Body, Req, Param, Query, ParseUUIDPipe,
} from '@nestjs/common';
import { FormsService } from '../application/forms.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * FormsController — printable forms beyond consent (Fasa 1G): MC, PDPA notice, time-off.
 *
 * WHY THESE ROUTES LIVE UNDER `clinical/forms` AND NOT `clinical/consents`
 *
 * A consent record is an immutable affirmation. An issued MC is a document with a serial
 * number that can be cancelled. Sharing a controller would mean one permission decision
 * covering two different acts — and the receptionist who prints an MC is not the doctor
 * who records consent.
 *
 * PERMISSIONS
 *
 *  - `view`   : read templates and issued forms (clinical:view).
 *  - `create` : issue a form (clinical:create).
 *  - `edit`   : cancel a form (clinical:edit).
 *
 * Templates are HQ-only, and that check lives in the SERVICE (`assertHq` equivalent)
 * rather than the coarse route guard. The matrix has not been changed for this work; see
 * the §9 governance finding in `verify-fasa1e-consent.sh`.
 */
@Controller({ path: 'clinical/forms', version: '1' })
export class FormsController {
  constructor(private readonly service: FormsService) {}

  /** GET /clinical/forms/templates?kind=mc&activeOnly=true */
  @Get('templates')
  @RequirePermission('clinical', 'view')
  listTemplates(
    @Req() req: AuthedRequest,
    @Query('kind') kind?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.service.listFormTemplates(req.principal!, {
      kind,
      activeOnly: activeOnly !== 'false',
    });
  }

  /** POST /clinical/forms/templates — HQ only; creates the next version within a family. */
  @Post('templates')
  @RequirePermission('clinical', 'view')
  createTemplate(@Req() req: AuthedRequest, @Body() body: unknown) {
    /* Guarded by `view` on purpose, then narrowed to HQ in the service.
     *
     * The coarse guard answers "may this role touch the clinical domain at all". Asking it
     * for `create` would grant the act to every role the matrix gives clinical:create —
     * which is the doctor alone — while the service refuses anyone but HQ. The result of
     * that mismatch is that NOBODY can create a template (the 1E governance finding). A
     * guard whose only permitted role is then rejected by the service is worse than a
     * broad guard with a precise service check, because the failure is invisible. */
    return this.service.createFormTemplate(req.principal!, body);
  }

  /** POST /clinical/forms — issue a form and claim its serial number. */
  @Post()
  @RequirePermission('clinical', 'create')
  issue(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.issueForm(req.principal!, body);
  }

  /** GET /clinical/forms?kind=&patientId=&staffId=&year=&limit= */
  @Get()
  @RequirePermission('clinical', 'view')
  list(
    @Req() req: AuthedRequest,
    @Query('kind') kind?: string,
    @Query('patientId') patientId?: string,
    @Query('staffId') staffId?: string,
    @Query('year') year?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listIssuedForms(req.principal!, { kind, patientId, staffId, year, limit });
  }

  /** GET /clinical/forms/:id */
  @Get(':id')
  @RequirePermission('clinical', 'view')
  getOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getIssuedForm(req.principal!, id);
  }

  /** PATCH /clinical/forms/:id/cancel — the row and its serial are KEPT. */
  @Patch(':id/cancel')
  @RequirePermission('clinical', 'edit')
  cancel(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.cancelIssuedForm(req.principal!, id, body);
  }
}
