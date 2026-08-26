import { registerAs } from '@nestjs/config';

/** S3-compatible object storage. Credentials injected at runtime. */
export default registerAs('s3', () => ({
  endpoint: process.env.S3_ENDPOINT ?? '',
  region: process.env.S3_REGION ?? '',
  bucket: process.env.S3_BUCKET ?? '',
  accessKey: process.env.S3_ACCESS_KEY ?? '',
  secretKey: process.env.S3_SECRET_KEY ?? '',
}));
