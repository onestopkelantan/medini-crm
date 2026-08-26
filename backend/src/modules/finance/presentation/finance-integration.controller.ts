import {
  Controller, Get, Post, Patch, Body, Req, Query, Param,
  ParseUUIDPipe } from '@nestjs/common';
import { FinanceIntegrationService } from '../application/finance-integration.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v);
}

/**
 * FinanceIntegrationController — S4-T4 Bukku integration boundary API.
 * External invoice refs (POS/Bukku reference) = hq/bm. Sync queue +
 * reconciliation = HQ-only. The real Bukku HTTP adapter is Sprint 8; the
 * boundary returns an honest "not configured" state — never a fabricated sync.
 */
@Controller({ path: 'finance/integration', version: '1' })
export class FinanceIntegrationController {
  constructor(private readonly integration: FinanceIntegrationService) {}

  /* ---------- EXTERNAL INVOICE REFERENCES ---------- */
  @Post('external-invoices')
  @RequirePermission('finance', 'create')
  recordExternalInvoice(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.integration.recordExternalInvoice(req.principal!, body);
  }

  @Get('external-invoices')
  @RequirePermission('finance', 'view')
  listExternalInvoices(
    @Req() req: AuthedRequest,
    @Query('branchId') branchId?: string,
    @Query('sourceSystem') sourceSystem?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.integration.listExternalInvoices(req.principal!, {
      branchId, sourceSystem, limit: num(limit), offset: num(offset),
    });
  }

  /* ---------- BUKKU SYNC BOUNDARY (HQ) ---------- */
  @Post('sync/enqueue')
  @RequirePermission('finance', 'create')
  enqueueSync(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.integration.enqueueSync(req.principal!, body);
  }

  @Post('sync/:id/push')
  @RequirePermission('finance', 'create')
  pushSync(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.integration.pushSync(req.principal!, id);
  }

  @Get('sync')
  @RequirePermission('finance', 'view')
  listSync(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.integration.listSync(req.principal!, {
      status, entityType, limit: num(limit), offset: num(offset),
    });
  }

  @Get('sync/status')
  @RequirePermission('finance', 'view')
  syncStatus(@Req() req: AuthedRequest) {
    return this.integration.syncStatus(req.principal!);
  }

  /* ---------- RECONCILIATION (HQ) ---------- */
  @Get('reconciliation')
  @RequirePermission('finance', 'view')
  listReconciliation(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.integration.listReconciliation(req.principal!, {
      status, limit: num(limit), offset: num(offset),
    });
  }

  @Patch('reconciliation/:id/resolve')
  @RequirePermission('finance', 'approve')
  resolveReconciliation(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.integration.resolveReconciliation(req.principal!, id, body);
  }
}
