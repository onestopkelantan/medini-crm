import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * DocumentStorageService — S3-compatible object storage adapter.
 *
 * Reads the `s3` config namespace (src/config/s3.config.ts). Works with AWS S3,
 * Cloudflare R2, Garage, MinIO, etc. When an explicit endpoint is set, path-style
 * addressing is used.
 *
 * This is the ONLY place that talks to object storage — swap this file to move
 * to local disk / GCS without touching the service or repository.
 *
 * TWO CLIENTS, ONE JOB EACH — AND WHY
 *
 * A presigned URL is a SIGNATURE OVER THE HOST. This service originally signed with
 * the same client it uploaded with, so in a container every presigned URL came out
 * as `http://garage:3900/...` — a host that resolves only INSIDE the Docker
 * network. The backend could read its own URLs; no browser could. Every X-ray link
 * handed to a doctor was dead, and nothing errored, because generating the URL
 * succeeded.
 *
 * So:
 *   `client`        — REACH. Talks to `s3.endpoint` (internal). Used by put/delete.
 *   `signingClient` — ADDRESSING. Signs for `s3.publicEndpoint` (what the browser
 *                     uses). Only constructed when the two actually differ, so the
 *                     common single-endpoint deployment keeps one client and no
 *                     extra object.
 *
 * The pair must agree on credentials, region and bucket style, or the signature
 * will not validate; they differ ONLY in the host that is signed.
 */
@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly client: S3Client;
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const s3 = this.config.get<{
      endpoint: string;
      publicEndpoint: string;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
    }>('s3');

    this.bucket = s3?.bucket ?? '';

    const opts = {
      region: s3?.region || 'auto',
      ...(s3?.endpoint ? { forcePathStyle: true } : {}),
      ...(s3?.accessKey && s3?.secretKey
        ? { credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey } }
        : {}),
    };

    this.client = new S3Client({ ...opts, ...(s3?.endpoint ? { endpoint: s3.endpoint } : {}) });

    /* Reuse the same client when there is nothing to split — avoids a second
     * connection pool for no benefit, and keeps behaviour byte-identical for a
     * deployment that never sets S3_PUBLIC_ENDPOINT. */
    const publicEndpoint = s3?.publicEndpoint ?? '';
    this.signingClient =
      publicEndpoint && publicEndpoint !== s3?.endpoint
        ? new S3Client({ ...opts, endpoint: publicEndpoint })
        : this.client;

    if (this.signingClient !== this.client) {
      this.logger.log(
        `Presigned URLs will be signed for ${publicEndpoint} while uploads go to ${s3?.endpoint}`,
      );
    }
  }

  /** Deterministic object key: org/branch scoped, uuid-prefixed to avoid collisions. */
  buildKey(orgId: string, branchId: string, id: string, safeName: string): string {
    return `org/${orgId}/branch/${branchId}/documents/${id}-${safeName}`;
  }

  /** True when storage is configured enough to actually store anything. Callers
   * use this to report "not configured" instead of failing on the first upload. */
  isConfigured(): boolean {
    return Boolean(this.bucket && this.config.get<{ endpoint: string }>('s3')?.endpoint);
  }

  async put(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  /**
   * Short-lived presigned GET url. `download` forces an attachment disposition.
   *
   * Signed with `signingClient` — the PUBLIC host — so the URL is usable by the
   * person who asked for it. See the class comment: signing with the reach client
   * produces a URL that only the server can follow.
   */
  async signedGetUrl(
    key: string,
    opts: { filename?: string; download?: boolean; expiresIn?: number } = {},
  ): Promise<string> {
    const disposition = opts.filename
      ? `${opts.download ? 'attachment' : 'inline'}; filename="${opts.filename.replace(/"/g, '')}"`
      : undefined;
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(disposition ? { ResponseContentDisposition: disposition } : {}),
      }),
      { expiresIn: opts.expiresIn ?? 300 },
    );
  }

  /** Not used by soft-delete flow; provided for a future hard-purge job. */
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      this.logger.warn(`Failed to delete object ${key}: ${(e as Error).message}`);
    }
  }
}
