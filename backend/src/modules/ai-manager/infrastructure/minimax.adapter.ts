import { Injectable, Logger } from '@nestjs/common';

import { AiProviderUnavailableError } from '../../../shared/errors/errors';

@Injectable()
export class MinimaxAdapter {
  private readonly logger = new Logger(MinimaxAdapter.name);

  /**
   * Which endpoint/model/key the RUNNING process resolved. `keySource` names
   * the env var, never the value — governance G9 keeps secret values out of
   * API responses.
   */
  describeConfig(): {
    configured: boolean;
    endpointHost: string;
    model: string;
    keySource: 'MINIMAX_API_KEY' | 'AI_PROVIDER_API_KEY' | 'none';
  } {
    const canonical = process.env.MINIMAX_API_KEY?.trim();
    const legacy = process.env.AI_PROVIDER_API_KEY?.trim();
    const url = this.baseUrl;
    let endpointHost = url;
    try {
      endpointHost = new URL(url).host;
    } catch {
      /* keep the raw string — surfaced so a malformed URL is visible */
    }
    return {
      configured: Boolean(canonical || legacy),
      endpointHost,
      model: process.env.MINIMAX_MODEL?.trim() || 'MiniMax-M3',
      keySource: canonical ? 'MINIMAX_API_KEY' : legacy ? 'AI_PROVIDER_API_KEY' : 'none',
    };
  }

  /* Canonical contract is MINIMAX_*; AI_PROVIDER_* is the legacy alias,
   * accepted as a fallback so a key set under either name is honoured. */
  private readonly baseUrl =
    process.env.MINIMAX_BASE_URL?.trim() ||
    process.env.AI_PROVIDER_BASE_URL?.trim() ||
    'https://api.minimax.io/v1/text/chatcompletion_v2';

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const key =
      process.env.MINIMAX_API_KEY?.trim() ||
      process.env.AI_PROVIDER_API_KEY?.trim();
    if (!key) {
      /* 503, not 500: the prompt is fine, the model is not configured. Saying
       * so plainly stops an operator from rewriting a good prompt. */
      throw new AiProviderUnavailableError(
        'Model AI belum dikonfigurasikan. Tetapkan MINIMAX_API_KEY pada pelayan sebelum menguji prompt.',
      );
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
        throw new AiProviderUnavailableError(
          `Model AI menolak permintaan (HTTP ${res.status}): ${reason}`,
        );
      }

      const reply = data.choices?.[0]?.message?.content;

      if (typeof reply !== 'string' || !reply.trim()) {
        const finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';
        const detail =
          `MiniMax returned no text: model=${model}; ` +
          `finish_reason=${finishReason}`;

        this.logger.error(detail);
        throw new AiProviderUnavailableError(
          `Model AI tidak memulangkan teks (sebab: ${finishReason}).`,
        );
      }

      return reply.trim();
    } catch (e) {
      /* A network-level failure (abort/timeout/DNS) must read the same way to
       * the operator as a provider rejection — never a bare 500. */
      if (e instanceof AiProviderUnavailableError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`MiniMax unreachable: model=${model}; reason=${message}`);
      throw new AiProviderUnavailableError(
        `Model AI tidak dapat dihubungi: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}