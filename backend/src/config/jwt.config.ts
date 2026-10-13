import { registerAs } from '@nestjs/config';

/** Auth/JWT configuration. Secrets injected at runtime — never hardcoded. */
export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET ?? '',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
  refreshTtl: parseInt(process.env.JWT_REFRESH_TTL ?? '604800', 10),
}));
