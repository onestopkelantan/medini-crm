import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { Principal } from '../../../core/auth/principal';
import { ForbiddenError, ValidationError } from '../../../shared/errors/errors';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';
import { WhatsappPromptSlotsService } from './whatsapp-prompt-slots.service';

/**
 * Playground — test a prompt against the real LLM before making it live.
 *
 * Uses the same provider the WhatsApp bot uses, so what an operator sees here
 * is what a patient would get. Nothing is sent to WhatsApp and no conversation
 * is created: this is a closed-loop rehearsal.
 */

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8000),
});

const testSchema = z.object({
  slot: z.number().int().min(1).max(3),
  message: z.string().trim().min(1).max(4000),
  history: z.array(turnSchema).max(40).default([]),
}).strict();

export interface PlaygroundReply {
  slot: number;
  promptName: string;
  reply: string;
  model: string;
  latencyMs: number;
}

@Injectable()
export class WhatsappPlaygroundService {
  constructor(
    private readonly prompts: WhatsappPromptSlotsService,
    private readonly minimax: MinimaxAdapter,
  ) {}

  /**
   * Runs one turn. The conversation history is sent as context so the model
   * behaves like it would mid-thread, not on a cold first message.
   */
  async test(
    principal: Principal,
    raw: unknown,
    requestedBranchId?: string,
  ): Promise<PlaygroundReply> {
    if (principal.role !== 'hq' && principal.role !== 'branch_manager') {
      throw new ForbiddenError(
        'Hanya HQ dan pengurus cawangan boleh menggunakan Playground',
      );
    }

    const parsed = testSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'message';
        errors[key] = [...(errors[key] ?? []), issue.message];
      }
      throw new ValidationError(errors);
    }

    const { slot, message, history } = parsed.data;

    const configured = await this.prompts.getSlotForTest(
      principal,
      slot,
      requestedBranchId,
    );

    if (!configured.configured || !configured.prompt.trim()) {
      throw new ValidationError({
        slot: [`Slot ${slot} belum mempunyai prompt. Simpan prompt dahulu sebelum menguji.`],
      });
    }

    /* Replay prior turns so the model answers in context. MinimaxAdapter takes
     * a system prompt + single user message; we fold the history into the user
     * turn, which keeps the adapter unchanged and the transcript auditable. */
    const historyBlock = history.length
      ? '\n\nPERBUALAN SEBELUM INI:\n' +
        history
          .map((t) => `${t.role === 'user' ? 'Pelanggan' : 'Anda'}: ${t.content}`)
          .join('\n')
      : '';

    const userMessage =
      `${historyBlock}\n\nMESEJ BAHARU PELANGGAN:\n${message}`.trim();

    const started = Date.now();
    const reply = await this.minimax.chat(configured.prompt, userMessage);
    const latencyMs = Date.now() - started;

    return {
      slot,
      promptName: configured.name || `Prompt ${slot}`,
      reply,
      model: process.env.MINIMAX_MODEL?.trim() || 'MiniMax-M3',
      latencyMs,
    };
  }
}
