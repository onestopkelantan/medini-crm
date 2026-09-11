import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MinimaxAdapter {
  private readonly logger = new Logger(MinimaxAdapter.name);
  private readonly baseUrl =
    'https://api.minimax.io/v1/text/chatcompletion_v2';

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const key = process.env.MINIMAX_API_KEY?.trim();
    if (!key) {
      throw new Error('MINIMAX_API_KEY not set');
    }

    const model = process.env.MINIMAX_MODEL?.trim() || 'MiniMax-M3';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      });

      const data = (await res.json()) as {
        base_resp?: {
          status_code?: number;
          status_msg?: string;
        };
        error?: {
          code?: string | number;
          message?: string;
        };
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: unknown };
        }>;
      };

      const statusCode = data.base_resp?.status_code;
      const apiFailed = statusCode !== undefined && statusCode !== 0;

      if (!res.ok || apiFailed || data.error) {
        const code = statusCode ?? data.error?.code ?? res.status;
        const reason =
          data.base_resp?.status_msg ??
          data.error?.message ??
          'Request rejected';

        // Log provider error only; do not log API key, prompt or chat.
        const detail =
          `MiniMax request failed: HTTP=${res.status}; ` +
          `code=${code}; model=${model}; reason=${reason}`;

        this.logger.error(detail);
        throw new Error(detail);
      }

      const reply = data.choices?.[0]?.message?.content;

      if (typeof reply !== 'string' || !reply.trim()) {
        const finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';
        const detail =
          `MiniMax returned no text: model=${model}; ` +
          `finish_reason=${finishReason}`;

        this.logger.error(detail);
        throw new Error(detail);
      }

      return reply.trim();
    } finally {
      clearTimeout(timeout);
    }
  }
}