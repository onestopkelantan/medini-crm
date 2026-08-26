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
 * Cloudflare R2, MinIO, etc. When an explicit endpoint is set (R2/MinIO),
 * path-style addressing is used.
 *
 * This is the ONLY place that talks to object storage — swap this file to move
 * to local disk / GCS without touching the service or repository.
 */
@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const s3 = this.config.get<{
      endpoint: string;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
    }>('s3');

    this.bucket = s3?.bucket ?? '';
    this.client = new S3Client({
      region: s3?.region || 'auto',
      ...(s3?.endpoint ? { endpoint: s3.endpoint, forcePathStyle: true } : {}),
      ...(s3?.accessKey && s3?.secretKey
        ? { credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey } }
        : {}),
    });
  }

  /** Deterministic object key: org/branch scoped, uuid-prefixed to avoid collisions. */
  buildKey(orgId: string, branchId: string, id: string, safeName: string): string {
    return `org/${orgId}/branch/${branchId}/documents/${id}-${safeName}`;
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

  /** Short-lived presigned GET url. `download` forces an attachment disposition. */
  async signedGetUrl(
    key: string,
    opts: { filename?: string; download?: boolean; expiresIn?: number } = {},
  ): Promise<string> {
    const disposition = opts.filename
      ? `${opts.download ? 'attachment' : 'inline'}; filename="${opts.filename.replace(/"/g, '')}"`
      : undefined;
    return getSignedUrl(
      this.client,
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
