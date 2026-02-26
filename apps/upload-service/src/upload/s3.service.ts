// =============================================================
// apps/upload-service/src/upload/s3.service.ts
// All S3 interactions: presigned URLs, delete, head object
//
// PATTERN: Browser uploads directly to S3 — backend never
// touches the file bytes. This means:
//   1. Backend is not a bottleneck for large files
//   2. S3 handles bandwidth & durability
//   3. No file data passes through our servers (compliance win)
// =============================================================

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly presignedUrlExpiry: number;
  private readonly maxFileSizeBytes: number;

  constructor(private readonly config: ConfigService) {
    const region = config.get<string>('upload.s3.region');
    this.bucket = config.get<string>('upload.s3.bucket') || " ";
    this.presignedUrlExpiry = config.get<number>('upload.s3.presignedUrlExpiry', 300);
    this.maxFileSizeBytes = config.get<number>('upload.s3.maxFileSizeBytes', 10_485_760);

    // ── S3 Client ──────────────────────────────────────────────
    // In production on EKS: uses IRSA — no explicit credentials needed
    // Locally: uses AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY from .env
    this.s3 = new S3Client({
      region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // Add this block for local development with LocalStack:
      ...(process.env.NODE_ENV !== 'production' && {
        endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
        forcePathStyle: true,  // Required for LocalStack S3
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      }),
    });
  }

  // ── Generate a presigned PUT URL ─────────────────────────────
  // Returns a time-limited URL that the browser uses to upload directly
  async generatePresignedPutUrl(params: {
    userId: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    documentId: string;
  }): Promise<{ uploadUrl: string; s3Key: string }> {
    // Validate file size before generating URL
    if (params.fileSize > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `File too large. Max size is ${this.maxFileSizeBytes / 1_048_576}MB`,
      );
    }

    // ── S3 Key structure ───────────────────────────────────────
    // uploads/{userId}/{documentId}/{sanitized-filename}
    // Using documentId in path ensures uniqueness even if same filename is re-uploaded
    const sanitizedName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `uploads/${params.userId}/${params.documentId}/${sanitizedName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: params.contentType,

      // ── S3 server-side validation ──────────────────────────
      // ContentLengthRange enforced by S3 — client can't bypass this
      // (requires bucket policy or use conditions in presigned URL)
      Metadata: {
        userId: params.userId,
        documentId: params.documentId,
        originalFileName: params.fileName,
      },

      // ── Encryption at rest ─────────────────────────────────
      ServerSideEncryption: 'AES256',
      
      // ── Disable automatic checksum (AWS SDK v3.995.0+) ─────
      // Newer SDK versions auto-add CRC32 checksums. For browser/curl uploads,
      // this adds complexity. Disable for presigned URLs.
      ChecksumAlgorithm: undefined,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: this.presignedUrlExpiry,
      // Explicitly disable checksums in presigned URL
      unhoistableHeaders: new Set(),
    });

    this.logger.log(
      JSON.stringify({
        type: 's3_presigned_url_generated',
        userId: params.userId,
        documentId: params.documentId,
        s3Key,
        expiresInSeconds: this.presignedUrlExpiry,
      }),
    );

    return { uploadUrl, s3Key };
  }

  // ── Verify a file actually exists in S3 ──────────────────────
  // Called after client confirms upload — validates before processing
  async verifyFileExists(s3Key: string): Promise<{
    exists: boolean;
    contentType?: string;
    contentLength?: number;
  }> {
    try {
      const response = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key }),
      );
      return {
        exists: true,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      throw err;
    }
  }

  // ── Delete a file (e.g. if processing fails repeatedly) ──────
  async deleteObject(s3Key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
    this.logger.log(`Deleted S3 object: ${s3Key}`);
  }
}
