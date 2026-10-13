import { describe, it, expect } from 'vitest';
import { InMemoryIdempotencyAdapter, IdempotencyService } from '@shared/idempotency/idempotency.service';

describe('idempotency', () => {
  function makeService() {
    const adapter = new InMemoryIdempotencyAdapter();
    const svc = new IdempotencyService(adapter as never);
    return svc;
  }

  it('executes once and replays the stored result on duplicate key', async () => {
    const svc = makeService();
    let calls = 0;
    const fn = async () => { calls++; return { ok: true, n: calls }; };
    const first = await svc.execute('k1', 'route:actor', fn);
    const second = await svc.execute('k1', 'route:actor', fn);
    expect(calls).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
  });

  it('treats a different scope as a new operation', async () => {
    const svc = makeService();
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    await svc.execute('k1', 'a', fn);
    const r = await svc.execute('k1', 'b', fn);
    expect(calls).toBe(2);
    expect(r.replayed).toBe(false);
  });

  it('marks failed and allows retry after an exception', async () => {
    const svc = makeService();
    let calls = 0;
    await expect(svc.execute('k2', 's', async () => { calls++; throw new Error('x'); })).rejects.toThrow('x');
    const r = await svc.execute('k2', 's', async () => { calls++; return 'recovered'; });
    expect(calls).toBe(2);
    expect(r.result).toBe('recovered');
  });
});
