import { registerAs } from '@nestjs/config';

/** Redis (queue + cache). No credentials in source. */
export default registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? '',
}));
