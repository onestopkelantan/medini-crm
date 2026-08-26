import { describe, it, expect } from 'vitest';
import { PasswordService } from '@core/auth/password.service';

describe('PasswordService (Argon2id)', () => {
  const svc = new PasswordService();

  it('hashes with argon2id (never plaintext)', async () => {
    const hash = await svc.hash('secret-pw');
    expect(hash).not.toBe('secret-pw');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies a correct password', async () => {
    const hash = await svc.hash('correct-horse');
    expect(await svc.verify(hash, 'correct-horse')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('right');
    expect(await svc.verify(hash, 'wrong')).toBe(false);
  });

  it('verifyLogin returns false for unknown user (null hash) without throwing', async () => {
    expect(await svc.verifyLogin(null, 'anything')).toBe(false);
  });

  it('verifyLogin returns false for malformed hash (no throw)', async () => {
    expect(await svc.verifyLogin('not-a-real-hash', 'x')).toBe(false);
  });
});
