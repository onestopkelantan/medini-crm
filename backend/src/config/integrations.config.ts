import { registerAs } from '@nestjs/config';

/** Integration configs. Secrets injected at runtime — never hardcoded. */
export default registerAs('integrations', () => ({
  waha: {
    baseUrl: process.env.WAHA_BASE_URL ?? '',
    apiKey: process.env.WAHA_API_KEY ?? '',
  },
  bukku: {
    baseUrl: process.env.BUKKU_BASE_URL ?? '',
    apiKey: process.env.BUKKU_API_KEY ?? '',
    companySubdomain: process.env.BUKKU_COMPANY_SUBDOMAIN ?? '',
  },
  ai: {
    baseUrl: process.env.AI_PROVIDER_BASE_URL ?? '',
    apiKey: process.env.AI_PROVIDER_API_KEY ?? '',
  },
}));
