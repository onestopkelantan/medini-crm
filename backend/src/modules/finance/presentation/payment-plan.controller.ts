/**
 * PaymentPlanController — P4 (0028). Owns its path so route order with the
 * main finance controller's ':id'-free routes is not a concern.
 *
 *   GET    /finance/payment-plans            — list with balances
 *   GET    /finance/payment-plans/:id        — one plan + full schedule
 *   POST   /finance/payment-plans            — create (schedule generated)
 *   POST   /finance/payment-plans/:id/pay    — record an instalment payment
 *   POST   /finance/payment-plans/:id/waive  — waive an instalment (reason)
 *
 * Permission domain 'finance' throughout: view reads, create/pay/waive are
 * money movement (finance create/edit). Scope is enforced app-side by the
 * service (hq org-wide, manager own branch), same as the rest of finance.
 */
import { Controller, Get, Post, Body, Req, Query, Param, ParseUUIDPipe } from '@nestjs/common';
import { PaymentPlanService } from '../application/payment-plan.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

@Controller({ path: 'finance/payment-plans', version: '1' })
export class PaymentPlanController {
  constructor(private readonly service: PaymentPlanService) {}

  @Get()
  @RequirePermission('finance', 'view')
  list(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    return this.service.list(req.principal!, query);
  }

  /* NOTE: literal routes like 'collection-stats' MUST sit above ':id' —
   * Nest matches in declaration order, and ':id' with a UUID pipe would
   * otherwise swallow them with a 400 "uuid is expected". */
  /* P4-A — payment history for one patient (receipts view). Literal route:
   * MUST stay above ':id' like collection-stats. */
  @Get('patients/:patientId/history')
  @RequirePermission('finance', 'view')
  history(@Req() req: AuthedRequest, @Param('patientId', ParseUUIDPipe) patientId: string) {
    return this.service.history(req.principal!, patientId);
  }

  @Get('collection-stats')
  @RequirePermission('finance', 'view')
  collectionStats(
    @Req() req: AuthedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.collectionStats(req.principal!, from, to);
  }

  @Get(':id')
  @RequirePermission('finance', 'view')
  get(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(req.principal!, id);
  }

  @Post()
  @RequirePermission('finance', 'create')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.create(req.principal!, body);
  }

  @Post(':id/pay')
  @RequirePermission('finance', 'edit')
  pay(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.pay(req.principal!, id, body);
  }

  @Post(':id/waive')
  @RequirePermission('finance', 'edit')
  waive(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.waive(req.principal!, id, body);
  }
}
