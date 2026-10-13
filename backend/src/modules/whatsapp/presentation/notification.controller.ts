import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';

import { AuthedRequest } from '../../../core/auth/auth.guard';
import { RequirePermission } from '../../../core/auth/decorators';
import { NotFoundError, ValidationError } from '../../../shared/errors/errors';
import { NotificationService } from '../application/notification.service';
import { NOTIFICATION_RULES, NotificationKind } from '../domain/notification';

/**
 * FASA 5D-B — the operator's notification bell.
 *
 * Sits in the WhatsApp domain because every notification it carries is about
 * WhatsApp work: a patient waiting for a human, a stopped channel, a refused
 * blast. A generic notifications module would invite non-WhatsApp events into
 * the same list before there is any reason for them.
 *
 * Permission is `whatsapp:view` — the bell is part of reading the inbox, not a
 * separate capability to grant.
 */
/** The kinds the seed seam accepts, taken from the rules so the two cannot drift. */
const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_RULES) as NotificationKind[];

@Controller({
  path: 'whatsapp/notifications',
  version: '1',
})
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  @RequirePermission('whatsapp', 'view')
  list(@Req() req: AuthedRequest, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.service.list(req.principal!, Number.isFinite(n) && n > 0 ? n : 30);
  }

  /** Unread count for the badge. Polled, so it stays a single indexed count. */
  @Get('unread-count')
  @RequirePermission('whatsapp', 'view')
  async unread(@Req() req: AuthedRequest) {
    return { unread: await this.service.unreadCount(req.principal!) };
  }

/**
   * Raise a notification directly. TEST SEAM — disabled in production.
   *
   * The notification path is otherwise only reachable from an inbound WhatsApp
   * message, and no number is linked yet, so without this the whole feature is
   * unverifiable. It is guarded rather than left open: a clinic's bell must not
   * be something a stray request can fill.
   */
  @Post('_seed')
  @RequirePermission('whatsapp', 'view')
  async seed(
    @Req() req: AuthedRequest,
    @Body() body: { branchId?: string; kind?: string; entityId?: string; branchName?: string },
  ) {
    /* Guarded by an explicit opt-in flag, not NODE_ENV.
     *
     * NODE_ENV is 'production' in the local docker-compose stack too, so gating
     * on it made this seam unreachable exactly where it is needed for
     * verification. WA_NOTIFICATION_SEED must be set deliberately, so a real
     * clinic cannot have its bell filled by a stray request. */
    if (process.env.WA_NOTIFICATION_SEED !== '1') {
      throw new NotFoundError('endpoint', '_seed');
    }

    const kind = (body?.kind ?? 'human_needed') as NotificationKind;
    if (!NOTIFICATION_KINDS.includes(kind)) {
      throw new ValidationError({ kind: [`Jenis tidak dikenali: ${kind}`] });
    }

    await this.service.raise({
      orgId: req.principal!.orgId,
      branchId: body?.branchId ?? req.principal!.branchId,
      kind,
      entityId: body?.entityId ?? null,
      branchName: body?.branchName ?? null,
    });

    return { ok: true };
  }

  @Post('read-all')
  @RequirePermission('whatsapp', 'view')
  async markAllRead(@Req() req: AuthedRequest) {
    const count = await this.service.markAllRead(req.principal!);
    return { ok: true, marked: count };
  }

  @Post(':id/read')
  @RequirePermission('whatsapp', 'view')
  async markRead(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.service.markRead(req.principal!, id);
    return { ok: true };
  }
}
