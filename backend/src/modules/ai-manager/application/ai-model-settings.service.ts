import { Injectable } from '@nestjs/common';

import { Principal } from '../../../core/auth/principal';
import { ForbiddenError } from '../../../shared/errors/errors';
import { MinimaxAdapter } from '../infrastructure/minimax.adapter';

/**
 * AI model settings — read-only status for the AI Manager screen.
 *
 * GOVERNANCE G9: the platform stores secret REFERENCES, never secret VALUES.
 * So this service reports WHETHER the model is wired up (and against which
 * endpoint), but never the key itself — not even truncated. The key is set on
 * the server (MINIMAX_API_KEY); the UI's job is to tell an operator plainly
 * whether AI can answer yet, and if not, exactly what to arrange.
 */
export interface AiModelStatus {
  configured: boolean;
  /** Host only — never the full URL with any query/credentials attached. */
  endpointHost: string;
  model: string;
  /** Which env var the running process actually resolved the key from. */
  keySource: 'MINIMAX_API_KEY' | 'AI_PROVIDER_API_KEY' | 'none';
  statusLabel: string;
  guidance: string;
}

@Injectable()
export class AiModelSettingsService {
  constructor(private readonly adapter: MinimaxAdapter) {}

  get(principal: Principal): AiModelStatus {
    /* Technical/provider configuration — same tier as integration testing,
     * which this codebase already restricts to HQ. */
    if (principal.role !== 'hq') {
      throw new ForbiddenError('Tetapan model AI hanya untuk HQ');
    }

    const status = this.adapter.describeConfig();

    return {
      configured: status.configured,
      endpointHost: status.endpointHost,
      model: status.model,
      keySource: status.keySource,
      statusLabel: status.configured ? 'Sedia' : 'Belum dikonfigurasikan',
      guidance: status.configured
        ? 'Model AI sedia digunakan. Uji prompt dalam Playground sebelum mengaktifkannya.'
        : 'Kunci API belum ditetapkan pada pelayan. Hubungi pentadbir sistem untuk ' +
          'menetapkan MINIMAX_API_KEY, kemudian muat semula halaman ini.',
    };
  }
}
