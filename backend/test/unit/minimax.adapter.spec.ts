import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MinimaxAdapter } from '@modules/ai-manager/infrastructure/minimax.adapter';

/**
 * FASA 0 — AI provider contract.
 *
 * The adapter is the single place a patient-facing reply is produced. Two
 * properties must never regress:
 *
 *  1. FAIL LOUD: with no API key configured it throws. It must NEVER return a
 *     canned/empty string that the WhatsApp bot would send to a real patient
 *     as if it were an answer.
 *  2. KEY NAMING: MINIMAX_API_KEY is canonical; AI_PROVIDER_API_KEY is the
 *     legacy alias honoured as a fallback, so a deployment that set the old
 *     name keeps working instead of silently losing its AI.
 *
 * No network call is made — fetch is stubbed.
 */

const ENV_KEYS = [
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'MINIMAX_MODEL',
  'AI_PROVIDER_API_KEY',
  'AI_PROVIDER_BASE_URL',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function stubFetch(ok: boolean, body: unknown, status = 200) {
  const fn = vi.fn(async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const HAPPY = {
  base_resp: { status_code: 0 },
  choices: [{ message: { content: 'Salam! Boleh saya dapatkan nama penuh anda?' } }],
};

describe('MinimaxAdapter (FASA 0 AI provider contract)', () => {
  it('throws when no key is configured — never fabricates a reply', async () => {
    const adapter = new MinimaxAdapter();
    await expect(adapter.chat('system', 'hello')).rejects.toThrow(
      /Model AI belum dikonfigurasikan/,
    );
  });

  it('reports a missing key as 503 AI_PROVIDER_UNAVAILABLE, not a bare 500', async () => {
    const adapter = new MinimaxAdapter();
    await expect(adapter.chat('system', 'hello')).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('does not call the network when the key is missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const adapter = new MinimaxAdapter();
    await expect(adapter.chat('system', 'hello')).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts the legacy AI_PROVIDER_API_KEY alias as a fallback', async () => {
    process.env.AI_PROVIDER_API_KEY = 'legacy-key';
    const fetchSpy = stubFetch(true, HAPPY);

    const adapter = new MinimaxAdapter();
    const reply = await adapter.chat('system', 'hello');

    expect(reply).toBe('Salam! Boleh saya dapatkan nama penuh anda?');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('prefers MINIMAX_API_KEY over the legacy alias when both are set', async () => {
    process.env.MINIMAX_API_KEY = 'canonical-key';
    process.env.AI_PROVIDER_API_KEY = 'legacy-key';
    const fetchSpy = stubFetch(true, HAPPY);

    await new MinimaxAdapter().chat('system', 'hello');

    const headers = (fetchSpy.mock.calls[0] as unknown[])[1] as {
      headers: Record<string, string>;
    };
    expect(headers.headers.Authorization).toBe('Bearer canonical-key');
  });

  it('defaults to the MiniMax cloud endpoint and MiniMax-M3 model', async () => {
    process.env.MINIMAX_API_KEY = 'k';
    const fetchSpy = stubFetch(true, HAPPY);

    await new MinimaxAdapter().chat('system', 'hello');

    const call = fetchSpy.mock.calls[0] as unknown as [string, { body: string }];
    const [url, init] = call;
    expect(url).toContain('api.minimax.io');
    expect(JSON.parse(init.body).model).toBe('MiniMax-M3');
  });

  it('surfaces a provider-level error instead of returning the error text', async () => {
    process.env.MINIMAX_API_KEY = 'k';
    stubFetch(true, {
      base_resp: { status_code: 1004, status_msg: 'invalid api key' },
      choices: [],
    });

    await expect(new MinimaxAdapter().chat('system', 'hello')).rejects.toThrow(
      /Model AI menolak permintaan/,
    );
  });

  it('surfaces a non-2xx HTTP response as a failure', async () => {
    process.env.MINIMAX_API_KEY = 'k';
    stubFetch(false, { error: { code: 429, message: 'rate limited' } }, 429);

    await expect(new MinimaxAdapter().chat('system', 'hello')).rejects.toThrow(/Model AI menolak permintaan/);
  });
});
