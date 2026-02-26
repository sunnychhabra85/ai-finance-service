# =============================================================
# infrastructure/terraform/modules/sqs/main.tf
# SQS queues for async document processing
#
# Pattern: Main Queue + Dead Letter Queue (DLQ)
# - Main queue: processing-service consumes from here
# - DLQ: receives messages that fail after 3 retries
#   (operator investigates DLQ messages to debug processing failures)
# =============================================================

# ── Dead Letter Queue ─────────────────────────────────────────
# Receives messages that the processing-service failed to process
# after maxReceiveCount attempts
resource "aws_sqs_queue" "processing_dlq" {
  name                      = "${var.env}-document-processing-dlq"
  message_retention_seconds = 1209600  # 14 days to investigate failures

  # Encryption at rest
  sqs_managed_sse_enabled = true

  tags = { Name = "${var.env}-processing-dlq" }
}

# ── Main Processing Queue ──────────────────────────────────────
resource "aws_sqs_queue" "processing" {
  name                       = "${var.env}-document-processing"
  visibility_timeout_seconds = 300  # 5 minutes: must finish processing before timeout
                                    # Set higher than max OCR processing time
  message_retention_seconds  = 86400  # 1 day
  receive_wait_time_seconds  = 20   # Long polling (reduces empty receives, saves cost)
  delay_seconds              = 5    # Give S3 5s to finalize before processing reads

  # Encryption
  sqs_managed_sse_enabled = true

  # ── Redrive to DLQ ──────────────────────────────────────────
  # After 3 failed processing attempts, move to DLQ for investigation
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.processing_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Name = "${var.env}-processing-queue" }
}

# ── Allow S3 to send messages (if using S3 event notifications) ──
resource "aws_sqs_queue_policy" "processing" {
  count = var.upload_service_role_arn != "" && var.processing_service_role_arn != "" ? 1 : 0

  queue_url = aws_sqs_queue.processing.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Allow upload-service (via IRSA) to send messages
      {
        Sid    = "AllowUploadService"
        Effect = "Allow"
        Principal = { AWS = var.upload_service_role_arn }
        Action = "sqs:SendMessage"
        Resource = aws_sqs_queue.processing.arn
      },
      # Allow processing-service (via IRSA) to receive and delete messages
      {
        Sid    = "AllowProcessingService"
        Effect = "Allow"
        Principal = { AWS = var.processing_service_role_arn }
        Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.processing.arn
      }
    ]
  })
}

# ── CloudWatch Alarm: DLQ not empty ──────────────────────────
# Alert if any messages end up in DLQ — means processing is failing
resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.env}-processing-dlq-not-empty"
  alarm_description   = "Messages in DLQ — document processing is failing!"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0  # Alert on ANY message in DLQ

  dimensions = {
    QueueName = aws_sqs_queue.processing_dlq.name
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

# ── Outputs ───────────────────────────────────────────────────
output "processing_queue_url" {
  value = aws_sqs_queue.processing.url
}

output "processing_queue_arn" {
  value = aws_sqs_queue.processing.arn
}

output "processing_dlq_arn" {
  value = aws_sqs_queue.processing_dlq.arn
}

# ── Variables ─────────────────────────────────────────────────
variable "env" {}
variable "upload_service_role_arn" { default = "" }
variable "processing_service_role_arn" { default = "" }
variable "alarm_sns_topic_arn" { default = "" }
