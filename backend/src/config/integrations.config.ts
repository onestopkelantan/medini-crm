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
    /* FASA 1C: tarik jualan dari Bukku masuk ke sale_records.
       MATI secara lalai — supaya sistem yang belum ada kredensial tidak
       sesekali cuba sync dan gagal senyap. Hidupkan secara sedar:
         BUKKU_SYNC_ENABLED=true
       Perbandingan sengaja 'true' sahaja; '1'/'yes' yang tersasar tidak
       akan menghidupkan integrasi kewangan secara tidak sengaja. */
    syncEnabled: (process.env.BUKKU_SYNC_ENABLED ?? '').toLowerCase() === 'true',
  },
  ai: {
    baseUrl: process.env.AI_PROVIDER_BASE_URL ?? '',
    apiKey: process.env.AI_PROVIDER_API_KEY ?? '',
  },
}));
