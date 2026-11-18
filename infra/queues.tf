# ---------------------------------------------------------------------------
# SQS queues (each with a dead-letter queue) for asynchronous work
#   marking : submit -> auto-mark MCQs; release -> fan out result emails
#   uploads : S3 ObjectCreated -> record submission -> notify tutor
#   notify  : outgoing emails sent with SES
# ---------------------------------------------------------------------------
locals {
  queues = {
    marking = { visibility = 120 }
    uploads = { visibility = 60 }
    notify  = { visibility = 60 }
  }
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.queues
  name                      = "${local.name}-${each.key}-dlq"
  message_retention_seconds = 1209600 # 14 days to investigate failures
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "main" {
  for_each                   = local.queues
  name                       = "${local.name}-${each.key}"
  visibility_timeout_seconds = each.value.visibility # >= 6x would be ideal; Lambda timeouts are well below this
  message_retention_seconds  = 345600                # 4 days
  receive_wait_time_seconds  = 20                    # long polling
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 5
  })
}

locals {
  uploads_queue = aws_sqs_queue.main["uploads"]
}

resource "aws_sqs_queue_policy" "uploads" {
  queue_url = local.uploads_queue.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowS3Events"
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = local.uploads_queue.arn
      Condition = {
        ArnEquals    = { "aws:SourceArn" = aws_s3_bucket.uploads.arn }
        StringEquals = { "aws:SourceAccount" = local.account_id }
      }
    }]
  })
}
