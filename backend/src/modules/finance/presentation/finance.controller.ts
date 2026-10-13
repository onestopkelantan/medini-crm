import {
  Controller, Get, Post, Patch, Body, Req, Query, Param,
  ParseUUIDPipe } from '@nestjs/common';
import { FinanceService } from '../application/finance.service';
import { ClinicalFinanceService } from '../application/clinical-finance.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v);
}

/**
 * FinanceController — S4-T4 Finance operational API.
 * Permission domain key: 'finance'. ROLE_DOMAIN_MATRIX: hq full (all),
 * branch_manager view/submit (branch), branch_admin/doctor NONE.
 * The services enforce scope (hq org-wide, bm own branch) + audit same-tx.
 *
 * CRM is NOT the POS/accounting — these endpoints record/monitor operational
 * finance only; no payment processing, no invoice issuing.
 */
@Controller({ path: 'finance', version: '1' })
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly clinical: ClinicalFinanceService,
  ) {}

  /* ---------- SALE / REVENUE ---------- */
  @Post('sales')
  @RequirePermission('finance', 'create')
  recordSale(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.finance.recordSale(req.principal!, body);
  }

  @Get('sales')
  @RequirePermission('finance', 'view')
  listSales(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.finance.listSales(req.principal!, {
      branchId, from, to, limit: num(limit), offset: num(offset),
    });
  }

  @Get('revenue')
  @RequirePermission('finance', 'view')
  revenue(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.finance.revenueSummary(req.principal!, { branchId, from, to });
  }

  /* ---------- EXPENSES ---------- */
  @Post('expenses')
  @RequirePermission('finance', 'create')
  createExpense(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.finance.createExpense(req.principal!, body);
  }

  @Get('expenses')
  @RequirePermission('finance', 'view')
  listExpenses(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.finance.listExpenses(req.principal!, {
      branchId, category, status, limit: num(limit), offset: num(offset),
    });
  }

  @Get('expenses/by-category')
  @RequirePermission('finance', 'view')
  expenseByCategory(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.finance.expenseByCategory(req.principal!, { branchId, from, to });
  }

  @Patch('expenses/:id')
  @RequirePermission('finance', 'edit')
  updateExpense(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.finance.updateExpense(req.principal!, id, body);
  }

  @Patch('expenses/:id/status')
  @RequirePermission('finance', 'edit')
  changeExpenseStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.finance.changeExpenseStatus(req.principal!, id, body);
  }

  /* ---------- RECURRING ---------- */
  @Post('recurring')
  @RequirePermission('finance', 'create')
  createRecurring(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.finance.createRecurring(req.principal!, body);
  }

  @Get('recurring')
  @RequirePermission('finance', 'view')
  listRecurring(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.finance.listRecurring(req.principal!, {
      branchId, status, limit: num(limit), offset: num(offset),
    });
  }

  @Patch('recurring/:id')
  @RequirePermission('finance', 'edit')
  updateRecurring(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.finance.updateRecurring(req.principal!, id, body);
  }

  @Patch('recurring/:id/status')
  @RequirePermission('finance', 'edit')
  changeRecurringStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.finance.changeRecurringStatus(req.principal!, id, body);
  }

  @Post('recurring/:id/advance')
  @RequirePermission('finance', 'edit')
  advanceRecurring(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.advanceRecurring(req.principal!, id);
  }

  /* ---------- RADAR / ALERTS ---------- */
  @Get('alerts')
  @RequirePermission('finance', 'view')
  listAlerts(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.finance.listAlerts(req.principal!, {
      branchId, status, severity, limit: num(limit), offset: num(offset),
    });
  }

  @Patch('alerts/:id/status')
  @RequirePermission('finance', 'edit')
  updateAlertStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.finance.updateAlertStatus(req.principal!, id, body);
  }

  @Post('radar/generate')
  @RequirePermission('finance', 'view')
  generateRadar(@Req() req: AuthedRequest) {
    return this.finance.generateRadar(req.principal!);
  }

  /* ---------- TREATMENT COSTS ---------- */
  @Post('treatment-costs')
  @RequirePermission('finance', 'create')
  createTreatmentCost(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.clinical.createTreatmentCost(req.principal!, body);
  }

  @Get('treatment-costs')
  @RequirePermission('finance', 'view')
  listTreatmentCosts(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('planId') planId?: string,
    @Query('patientId') patientId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.clinical.listTreatmentCosts(req.principal!, {
      branchId, planId, patientId, limit: num(limit), offset: num(offset),
    });
  }

  @Get('top-treatments')
  @RequirePermission('finance', 'view')
  topTreatments(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clinical.topTreatments(req.principal!, { branchId, limit: num(limit) });
  }

  /* ---------- LAB PAYABLES ---------- */
  @Post('lab-payables')
  @RequirePermission('finance', 'create')
  createLabPayable(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.clinical.createLabPayable(req.principal!, body);
  }

  @Get('lab-payables')
  @RequirePermission('finance', 'view')
  listLabPayables(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.clinical.listLabPayables(req.principal!, {
      branchId, status, limit: num(limit), offset: num(offset),
    });
  }

  @Post('lab-payables/:id/payment')
  @RequirePermission('finance', 'edit')
  applyLabPayment(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.clinical.applyLabPayment(req.principal!, id, body);
  }

  @Patch('lab-payables/:id/status')
  @RequirePermission('finance', 'edit')
  changeLabPayableStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.clinical.changeLabPayableStatus(req.principal!, id, body);
  }

  /* ---------- COMMISSION ---------- */
  @Post('commissions/calculate')
  @RequirePermission('finance', 'create')
  calculateCommission(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.clinical.calculateCommission(req.principal!, body);
  }

  @Get('commissions')
  @RequirePermission('finance', 'view')
  listCommissions(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('doctorId') doctorId?: string,
    @Query('period') period?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.clinical.listCommissions(req.principal!, {
      branchId, doctorId, period, status, limit: num(limit), offset: num(offset),
    });
  }

  @Patch('commissions/:id/status')
  @RequirePermission('finance', 'approve')
  changeCommissionStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.clinical.changeCommissionStatus(req.principal!, id, body);
  }

  @Post('commissions/:id/payouts')
  @RequirePermission('finance', 'create')
  recordPayout(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.clinical.recordPayout(req.principal!, id, body);
  }

  @Get('commissions/:id/payouts')
  @RequirePermission('finance', 'view')
  listPayouts(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.clinical.listPayouts(req.principal!, id);
  }
}
