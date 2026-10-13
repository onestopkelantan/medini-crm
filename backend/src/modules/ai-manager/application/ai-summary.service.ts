import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DbContextService } from '../../../core/auth/db-context.service';
import { Principal } from '../../../core/auth/principal';
import { AuditService } from '../../../shared/audit/audit.service';
import { NotFoundError } from '../../../shared/errors/errors';
import { waConversations, waMessages } from '../../../infrastructure/database/schema';

export interface ConversationSummary {
  conversationId: string;
  simulated: true;
  generatedAt: string;
  status: string;
  contactPhone: string;
  patientId: string | null;
  messageCount: number;
  inbound: number;
  outbound: number;
  bySender: Record<string, number>;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  summary: string;
}

/**
 * AiSummaryService — summarize a WhatsApp conversation thread.
 *
 * There is no LLM runtime in this codebase (AI Manager is governance-only), so
 * this produces a DETERMINISTIC, extractive summary (counts, participants,
 * span, last message) rather than a generated narrative. Marked
 * `simulated: true` so callers never mistake it for model output. Reads run
 * under the caller's RLS context (branch-scoped; doctors have no wa access).
 */
@Injectable()
export class AiSummaryService {
  constructor(
    private readonly dbCtx: DbContextService,
    private readonly audit: AuditService,
  ) {}

  async summarize(principal: Principal, conversationId: string): Promise<ConversationSummary> {
    return this.dbCtx.runAs(principal, async (tx) => {
      const convRows = await tx.select().from(waConversations)
        .where(and(eq(waConversations.orgId, principal.orgId), eq(waConversations.id, conversationId), isNull(waConversations.deletedAt)))
        .limit(1);
      const conv = convRows[0];
      if (!conv) throw new NotFoundError('conversation', conversationId);

      const msgs = await tx.select().from(waMessages)
        .where(and(eq(waMessages.orgId, principal.orgId), eq(waMessages.conversationId, conversationId), isNull(waMessages.deletedAt)))
        .orderBy(asc(waMessages.sentAt));

      let inbound = 0, outbound = 0;
      const bySender: Record<string, number> = {};
      const stamps: number[] = [];
      let lastBody: string | null = null;
      let lastStamp = -Infinity;
      for (const m of msgs) {
        if (m.direction === 'in') inbound++; else if (m.direction === 'out') outbound++;
        bySender[m.senderType] = (bySender[m.senderType] ?? 0) + 1;
        const t = m.sentAt ? new Date(m.sentAt).getTime() : null;
        if (t !== null) {
          stamps.push(t);
          if (t >= lastStamp) { lastStamp = t; lastBody = m.body ?? null; }
        }
      }
      const firstAt = stamps.length ? new Date(Math.min(...stamps)).toISOString() : null;
      const lastAt = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
      const preview = lastBody ? (lastBody.length > 200 ? `${lastBody.slice(0, 200)}…` : lastBody) : null;

      const summary =
        `Conversation with ${conv.contactPhone} is '${conv.status}' with ${msgs.length} message(s) ` +
        `(${inbound} in / ${outbound} out)` +
        (lastAt ? `; last activity ${lastAt}.` : '.');

      await this.audit.record(
        {
          actorId: principal.staffId, actorRole: principal.role,
          action: 'ai_conversation_summarized', entity: 'wa_conversations', entityId: conversationId,
          orgId: principal.orgId, branchId: conv.branchId, source: 'api',
          after: { messageCount: msgs.length },
        },
        tx,
      );

      return {
        conversationId,
        simulated: true,
        generatedAt: new Date().toISOString(),
        status: conv.status,
        contactPhone: conv.contactPhone,
        patientId: conv.patientId ?? null,
        messageCount: msgs.length,
        inbound,
        outbound,
        bySender,
        firstMessageAt: firstAt,
        lastMessageAt: lastAt,
        lastMessagePreview: preview,
        summary,
      };
    });
  }
}
