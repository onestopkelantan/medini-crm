import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';

import { AuthedRequest } from '../../../core/auth/auth.guard';
import { RequirePermission } from '../../../core/auth/decorators';
import { InventoryService } from '../application/inventory.service';

/**
 * P6 Inventory — per Invelli PRD, di dalam CRM (bukan AppSheet).
 * Peranan: HQ master data + pengiraan; manager kelulusan kiraan;
 * staf kiraan & restock; semua baca cawangan sendiri (HQ semua).
 */
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  /* ---- master (HQ) ---- */
  @Post('items') @RequirePermission('operations', 'create')
  createItem(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createItem(req.principal!, body);
  }
  @Get('items') @RequirePermission('operations', 'view')
  listItems(@Req() req: AuthedRequest) {
    return this.service.listItems(req.principal!);
  }
  @Post('rooms') @RequirePermission('operations', 'create')
  createRoom(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createRoom(req.principal!, body);
  }
  @Get('rooms') @RequirePermission('operations', 'view')
  listRooms(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) {
    return this.service.listRooms(req.principal!, branchId);
  }
  @Post('bom') @RequirePermission('operations', 'create')
  upsertBom(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.upsertBom(req.principal!, body);
  }
  @Get('bom') @RequirePermission('operations', 'view')
  listBom(@Req() req: AuthedRequest) {
    return this.service.listBom(req.principal!);
  }

  /* ---- transaksi ---- */
  @Post('restocks') @RequirePermission('operations', 'create')
  createRestock(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createRestock(req.principal!, body);
  }
  @Get('restocks') @RequirePermission('operations', 'view')
  listRestocks(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) {
    return this.service.listRestocks(req.principal!, branchId);
  }
  @Post('counts') @RequirePermission('operations', 'create')
  saveCount(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.saveCount(req.principal!, body);
  }
  @Post('counts/decision') @RequirePermission('operations', 'approve')
  decideCount(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.decideCount(req.principal!, body);
  }
  @Get('counts') @RequirePermission('operations', 'view')
  listCounts(@Req() req: AuthedRequest, @Query('week') week?: string) {
    return this.service.listCounts(req.principal!, week);
  }

  /* ---- enjin variance (HQ) ---- */
  @Post('compute-week') @RequirePermission('operations', 'submit')
  computeWeek(@Req() req: AuthedRequest, @Body() body: { branchId?: string; week?: string }) {
    return this.service.computeWeek(req.principal!, body?.branchId, body?.week);
  }
  @Get('flags') @RequirePermission('operations', 'view')
  listFlags(@Req() req: AuthedRequest, @Query('week') week?: string, @Query('branchId') branchId?: string) {
    return this.service.listFlags(req.principal!, week, branchId);
  }
}
