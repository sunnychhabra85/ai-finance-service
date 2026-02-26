#!/bin/bash
# =============================================================
# infrastructure/scripts/localstack-init.sh
# Runs automatically when LocalStack starts in docker-compose.
# Creates the S3 bucket and SQS queues for local development.
# =============================================================

echo "Initializing LocalStack resources..."

ENDPOINT=http://localhost:4566
REGION=ap-south-1

# ── Create S3 bucket ─────────────────────────────────────────
aws --endpoint-url=$ENDPOINT s3 mb s3://finance-platform-uploads-dev --region $REGION
aws --endpoint-url=$ENDPOINT s3api put-bucket-cors \
  --bucket finance-platform-uploads-dev \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT"],
      "AllowedOrigins": ["http://localhost:3000"],
      "ExposeHeaders": ["ETag"]
    }]
  }'

echo "✅ S3 bucket created: finance-platform-uploads-dev"

# ── Create SQS Dead Letter Queue first ───────────────────────
aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name document-processing-dlq \
  --region $REGION

DLQ_ARN=$(aws --endpoint-url=$ENDPOINT sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/document-processing-dlq \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

# ── Create main processing queue with DLQ ────────────────────
aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name document-processing \
  --region $REGION \
  --attributes "{
    \"VisibilityTimeout\": \"300\",
    \"ReceiveMessageWaitTimeSeconds\": \"20\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }"

echo "✅ SQS queue created: document-processing"
echo "✅ SQS DLQ created: document-processing-dlq"
echo "LocalStack initialization complete!"
