import { registerAs } from '@nestjs/config';

/**
 * S3-compatible object storage. Credentials injected at runtime.
 *
 * TWO ENDPOINTS, AND THEY ARE NOT INTERCHANGEABLE
 *
 * `endpoint` is where the BACKEND talks to storage — an internal Docker name
 * (`http://garage:3900`) that resolves only inside the compose network.
 *
 * `publicEndpoint` is the host that a PRESIGNED URL must be valid for — the one a
 * BROWSER can reach (`https://files.example.com` or, locally, through Caddy at
 * `/files`).
 *
 * Why this exists at all: an S3 presigned URL is a SIGNATURE OVER THE HOST AND
 * PATH. Signing against `garage:3900` produces a URL the browser cannot even
 * resolve, which is exactly the bug this split fixes. Signing against the public
 * host while still SENDING to the internal one is the only arrangement that works
 * in a container, and it is why these cannot be one variable.
 *
 * Fallback: when `publicEndpoint` is unset, signing uses `endpoint` — correct for
 * a deployment where storage is already publicly addressed (plain AWS S3), so an
 * existing install does not have to set anything new.
 */
export default registerAs('s3', () => {
  const endpoint = process.env.S3_ENDPOINT ?? '';
  return {
    endpoint,
    /* Defaults to `endpoint` so nothing changes for a deployment that never needed
     * the split. An empty explicit value (S3_PUBLIC_ENDPOINT="") is treated the
     * same as unset, because a blank host cannot be signed against. */
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || endpoint,
    region: process.env.S3_REGION ?? '',
    bucket: process.env.S3_BUCKET ?? '',
    accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '',
  };
});
