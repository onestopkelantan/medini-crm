import { Body, Controller, Get, Param, Patch, Post, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { FinanceConfigService } from '../application/finance-config.service';

/**
 * FinanceConfigController — managed finance config (Sprint 10).
 * Shares the `finance` path prefix with FinanceController; no route overlap.
 * view = HQ + branch_manager; create/edit = HQ only (matches finance matrix).
 */
@Controller({ path: 'finance', version: '1' })
export class FinanceConfigController {
  constructor(private readonly service: FinanceConfigService) {}

  /* ---- expense categories ---- */
  @Get('expense-categories')
  @RequirePermission('finance', 'view')
  listCategories(@Req() req: AuthedRequest, @Query('status') status?: string, @Query('branchId') branchId?: string) {
    return this.service.listCategories(req.principal!, { status, branchId });
  }

  @Post('expense-categories')
  @RequirePermission('finance', 'create')
  createCategory(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createCategory(req.principal!, body);
  }

  @Patch('expense-categories/:id/status')
  @RequirePermission('finance', 'edit')
  setCategoryStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.setCategoryStatus(req.principal!, id, body);
  }

  /* ---- payment methods ---- */
  @Get('payment-methods')
  @RequirePermission('finance', 'view')
  listMethods(@Req() req: AuthedRequest, @Query('status') status?: string, @Query('branchId') branchId?: string) {
    return this.service.listMethods(req.principal!, { status, branchId });
  }

  @Post('payment-methods')
  @RequirePermission('finance', 'create')
  createMethod(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createMethod(req.principal!, body);
  }

  @Patch('payment-methods/:id/status')
  @RequirePermission('finance', 'edit')
  setMethodStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.setMethodStatus(req.principal!, id, body);
  }

  /* ---- alert rules ---- */
  @Get('alert-rules')
  @RequirePermission('finance', 'view')
  listRules(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) {
    return this.service.listRules(req.principal!, { branchId });
  }

  @Post('alert-rules')
  @RequirePermission('finance', 'create')
  createRule(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createRule(req.principal!, body);
  }

  @Patch('alert-rules/:id')
  @RequirePermission('finance', 'edit')
  updateRule(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.updateRule(req.principal!, id, body);
  }
}
