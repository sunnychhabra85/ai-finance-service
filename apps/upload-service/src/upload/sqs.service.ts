// =============================================================
// apps/upload-service/src/upload/sqs.service.ts
// Publishes a message to SQS after a PDF is uploaded.
// The processing-service consumes these messages to run OCR.
//
// WHY SQS (not a direct HTTP call to processing-service)?
//   1. Decoupling — upload-service doesn't need to know about
//      processing-service's URL or availability
//   2. Resilience — if processing-service is down, the message
//      stays in queue and is retried automatically
//   3. Backpressure — SQS buffers bursts; processing-service
//      processes at its own pace
// =============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
  GetQueueUrlCommand,
  CreateQueueCommand,
} from '@aws-sdk/client-sqs';

// ── Message schema sent to the processing queue ───────────────
export interface ProcessingJobMessage {
  eventType: 'DOCUMENT_UPLOADED';
  documentId: string;
  userId: string;
  s3Key: string;
  fileName: string;
  correlationId: string;
  timestamp: string;
}

@Injectable()
export class SqsService {
  private readonly logger = new Logger(SqsService.name);
  private readonly sqs: SQSClient;
  private queueUrl: string;
  private readonly queueName: string;
  private readonly delaySeconds: number;
  private queueResolved = false;
  private queueResolutionPromise?: Promise<void>;

  constructor(private readonly config: ConfigService) {
    const region = config.get<string>('upload.sqs.region');
    const queueUrl = config.get<string>('upload.sqs.processingQueueUrl');

    if (!region || !queueUrl) {
      throw new Error('SQS configuration missing: region or processingQueueUrl');
    }

    this.queueUrl = queueUrl;
    this.queueName = this.extractQueueName(queueUrl);
    this.delaySeconds = config.get<number>('upload.sqs.delaySeconds', 5);

    // Uses IRSA credentials in production (no explicit keys needed)
    this.sqs = new SQSClient({
      region,
      ...(process.env.NODE_ENV !== 'production' && {
        endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      }),
    });
  }

  private extractQueueName(queueUrl: string): string {
    try {
      const parsed = new URL(queueUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
    } catch {
      return '';
    }
  }

  private async ensureQueueUrlResolved(): Promise<void> {
    if (this.queueResolved) return;
    if (this.queueResolutionPromise) {
      await this.queueResolutionPromise;
      return;
    }

    this.queueResolutionPromise = (async () => {
      const isLocal = process.env.NODE_ENV !== 'production' && !!process.env.AWS_ENDPOINT_URL;
      if (!isLocal || !this.queueName) {
        this.queueResolved = true;
        return;
      }

      try {
        const resolved = await this.sqs.send(
          new GetQueueUrlCommand({ QueueName: this.queueName }),
        );
        if (resolved.QueueUrl) {
          this.queueUrl = resolved.QueueUrl;
          this.logger.log(`Resolved SQS queue URL: ${this.queueUrl}`);
        }
      } catch (err) {
        if (err?.name !== 'QueueDoesNotExist') {
          throw err;
        }

        this.logger.warn(`SQS queue '${this.queueName}' missing. Creating it in local environment.`);
        await this.sqs.send(new CreateQueueCommand({ QueueName: this.queueName }));

        const created = await this.sqs.send(
          new GetQueueUrlCommand({ QueueName: this.queueName }),
        );

        if (created.QueueUrl) {
          this.queueUrl = created.QueueUrl;
          this.logger.log(`Created and resolved SQS queue URL: ${this.queueUrl}`);
        }
      } finally {
        this.queueResolved = true;
      }
    })();

    try {
      await this.queueResolutionPromise;
    } finally {
      this.queueResolutionPromise = undefined;
    }
  }

  // ── Publish a document-uploaded event ─────────────────────────
  async publishProcessingJob(
    job: Omit<ProcessingJobMessage, 'eventType' | 'timestamp'>,
  ): Promise<string> {
    await this.ensureQueueUrlResolved();

    const message: ProcessingJobMessage = {
      ...job,
      eventType: 'DOCUMENT_UPLOADED',
      timestamp: new Date().toISOString(),
    };

    const params: SendMessageCommandInput = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message),

      // ── Message deduplication ─────────────────────────────
      // MessageGroupId + MessageDeduplicationId prevent duplicate processing
      // (These are required if using FIFO queue)
      // For standard queue, use MessageDeduplicationId to avoid double-processing
      MessageAttributes: {
        documentId: {
          DataType: 'String',
          StringValue: job.documentId,
        },
        userId: {
          DataType: 'String',
          StringValue: job.userId,
        },
        correlationId: {
          DataType: 'String',
          StringValue: job.correlationId,
        },
      },

      // ── Delay delivery ─────────────────────────────────────
      // Wait 5 seconds before the message becomes visible.
      // This gives S3 time to finalize the multipart upload
      // before the processing-service tries to read the file.
      DelaySeconds: this.delaySeconds,
    };

    const response = await this.sqs.send(new SendMessageCommand(params));
    const messageId = response.MessageId;

    if (!messageId) {
      throw new Error('SQS send message failed: no MessageId returned');
    }

    this.logger.log(
      JSON.stringify({
        type: 'sqs_message_published',
        messageId,
        documentId: job.documentId,
        userId: job.userId,
        correlationId: job.correlationId,
        queueUrl: this.queueUrl,
      }),
    );

    return messageId;
  }
}
