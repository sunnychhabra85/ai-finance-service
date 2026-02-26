// =============================================================
// apps/processing-service/src/processing/worker.service.ts
// SQS long-poll consumer — processes documents from the queue
// Flow: Receive → OCR via Textract → Parse → Categorize → Save → Delete
// =============================================================

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
  GetQueueUrlCommand,
  CreateQueueCommand,
} from '@aws-sdk/client-sqs';
import {
  TextractClient,
  DetectDocumentTextCommand,
} from '@aws-sdk/client-textract';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DatabaseService } from '@finance/database';
import { PdfParserService } from './pdf-parser.service';
import { CategorizerService } from './categorizer.service';
import { PDFParse } from 'pdf-parse';

interface ProcessingJobMessage {
  eventType: string;
  documentId: string;
  userId: string;
  s3Key: string;
  fileName: string;
  correlationId: string;
}

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly sqs: SQSClient;
  private readonly textract: TextractClient;
  private readonly s3: S3Client;
  private queueUrl: string;
  private readonly queueName: string;
  private readonly s3Bucket: string;
  private isRunning = false;
  private queueResolved = false;
  private queueResolutionPromise?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly parser: PdfParserService,
    private readonly categorizer: CategorizerService,
  ) {
    const region = config.get<string>('processing.aws.region');
    const endpoint = config.get<string>('processing.aws.endpointUrl');
    this.queueUrl = config.get<string>('processing.aws.sqsQueueUrl') || "";
    this.queueName = this.extractQueueName(this.queueUrl);
    this.s3Bucket = config.get<string>('processing.aws.s3Bucket') || "";

    const awsConfig: any = { region };
    if (endpoint) {
      // LocalStack override for local dev
      awsConfig.endpoint = endpoint;
      awsConfig.forcePathStyle = true;
      awsConfig.credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
    }

    this.sqs = new SQSClient(awsConfig);
    this.textract = new TextractClient({ region });
    this.s3 = new S3Client(awsConfig);
  }

  async onModuleInit() {
    this.isRunning = true;
    await this.ensureQueueUrlResolved();
    this.logger.log('SQS worker started — polling for messages');
    this.poll(); // Start polling loop (non-blocking)
  }

  async onModuleDestroy() {
    this.isRunning = false;
    this.logger.log('SQS worker shutting down gracefully');
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
      const isLocal = !!this.config.get<string>('processing.aws.endpointUrl');
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

  // ── Long-poll loop ────────────────────────────────────────────
  private async poll() {
    while (this.isRunning) {
      try {
        await this.ensureQueueUrlResolved();

        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: this.config.get('processing.sqsMaxMessages', 10),
            WaitTimeSeconds: this.config.get('processing.sqsWaitTimeSeconds', 20),
            MessageAttributeNames: ['All'],
          }),
        );

        const messages = response.Messages || [];
        if (messages.length > 0) {
          this.logger.log(`Received ${messages.length} messages from SQS`);
          // Process in parallel (up to concurrency limit)
          await Promise.allSettled(messages.map((msg) => this.handleMessage(msg)));
        }
      } catch (err) {
        if (this.isRunning) {
          this.logger.error(`SQS poll error: ${err.message}`);
          await this.sleep(5000); // Backoff before retrying
        }
      }
    }
  }

  // ── Process a single SQS message ─────────────────────────────
  private async handleMessage(message: Message) {
    if (!message || !message.Body || !message.ReceiptHandle) return;
    let job: ProcessingJobMessage;
    try {
      job = JSON.parse(message.Body);
    } catch {
      this.logger.error(`Invalid message body: ${message.Body}`);
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    const { documentId, userId, s3Key, correlationId } = job;
    this.logger.log(JSON.stringify({ type: 'processing_start', documentId, correlationId }));

    try {
      // ── Step 1: Update status → EXTRACTING ────────────────────
      await this.updateDocumentStatus(documentId, 'EXTRACTING');

      // ── Step 2: Extract text from PDF using Textract ───────────
      const rawText = await this.extractTextFromS3(s3Key);

      // ── Step 3: Parse transactions from raw text ───────────────
      const parsed = this.parser.parse(rawText);
      if (parsed.length === 0) {
        throw new Error('No transactions found in document');
      }

      // ── Step 4: Categorize each transaction ────────────────────
      const categories = await this.categorizer.categorizeBatch(
        parsed.map((t) => t.description),
      );

      // ── Step 5: Bulk insert transactions ──────────────────────
      await this.db.transaction.createMany({
        data: parsed.map((tx, i) => ({
          documentId,
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          type: tx.type,
          category: categories[i],
          rawText: tx.rawText,
        })),
      });

      // ── Step 6: Update status → COMPLETED ─────────────────────
      await this.updateDocumentStatus(documentId, 'COMPLETED');

      // ── Step 7: ACK the message (delete from queue) ────────────
      await this.deleteMessage(message.ReceiptHandle);

      this.logger.log(
        JSON.stringify({
          type: 'processing_complete',
          documentId,
          transactionCount: parsed.length,
          correlationId,
        }),
      );
    } catch (err) {
      this.logger.error(
        JSON.stringify({ type: 'processing_error', documentId, error: err.message, correlationId }),
      );
      await this.updateDocumentStatus(documentId, 'FAILED', err.message);
      // Do NOT delete message — SQS will retry (up to maxReceiveCount), then move to DLQ
    }
  }

  // ── Extract text using AWS Textract ──────────────────────────
  private async extractTextFromS3(s3Key: string): Promise<string> {
    // For local dev with LocalStack: Textract is not emulated,
    // so we fall back to reading the file directly
    const isLocal = !!this.config.get<string>('processing.aws.endpointUrl');
    if (isLocal) {
      return this.readS3FileAsText(s3Key);
    }

    // Production: use AWS Textract for accurate OCR
    const response = await this.textract.send(
      new DetectDocumentTextCommand({
        Document: {
          S3Object: {
            Bucket: this.s3Bucket,
            Name: s3Key,
          },
        },
      }),
    );

    const lines = (response.Blocks || [])
      .filter((b) => b.BlockType === 'LINE')
      .map((b) => b.Text || '');

    return lines.join('\n');
  }

  // ── Local dev fallback: read PDF and extract text using pdf-parse ─
  private async readS3FileAsText(s3Key: string): Promise<string> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.s3Bucket, Key: s3Key }),
    );
    
    // Collect chunks into a buffer
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);
    
    // Use pdf-parse to extract text from the PDF
    try {
      const parser = new PDFParse({ data: pdfBuffer });
      const data = await parser.getText();
      await parser.destroy();
      this.logger.log(`Extracted ${data.text.length} characters from PDF using pdf-parse`);
      return data.text;
    } catch (err) {
      this.logger.error(`Failed to parse PDF: ${err.message}`);
      throw new Error(`PDF parsing failed: ${err.message}`);
    }
  }

  private async updateDocumentStatus(id: string, status: string, errorMsg?: string) {
    await this.db.document.update({
      where: { id },
      data: { status: status as any, errorMsg: errorMsg || null },
    });
  }

  private async deleteMessage(receiptHandle: string) {
    await this.sqs.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
