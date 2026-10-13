import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../src/infrastructure/database/database', () => ({
  createDatabase: vi.fn(() => { throw new Error('Database must not be opened'); }),
}));

import { createDatabase } from '../../src/infrastructure/database/database';
import { seed } from '../../src/infrastructure/database/seed';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('rejects a missing demo password before accessing the database', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('SEED_DEMO_PASSWORD', '');

  await expect(seed('mysql://unused')).rejects.toThrow('SEED_DEMO_PASSWORD is required');
  expect(createDatabase).not.toHaveBeenCalled();
});
