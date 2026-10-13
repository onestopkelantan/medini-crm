/**
 * WaitlistController — FASA E (0027).
 *
 * Mounted under the appointments module: the waitlist IS appointments work
 * ("patient could not get a slot"), not a separate domain. Route shape
 * `appointments/waitlist` (list + POST) and `appointments/waitlist/:id`
 * (status + delete) — the same surface the reference system exposes.
 *
 * Note the route ORDER matters: Nest matches in declaration order, so the
 * literal 'waitlist' paths must sit before any ':id' sibling in the module.
 */
import { Controller, Get, Post, Patch, Delete, Body, Req, Query, Param, ParseUUIDPipe } from '@nestjs/common';
import { WaitlistService } from '../application/waitlist.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

@Controller({ path: 'appointments/waitlist', version: '1' })
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}

  @Get()
  @RequirePermission('appointments', 'view')
  list(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    return this.service.list(req.principal!, query);
  }

  @Post()
  @RequirePermission('appointments', 'create')
  add(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.add(req.principal!, body);
  }

  @Patch(':id/status')
  @RequirePermission('appointments', 'edit')
  changeStatus(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.changeStatus(req.principal!, id, body);
  }

  @Delete(':id')
  @RequirePermission('appointments', 'edit')
  remove(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(req.principal!, id);
  }
}
