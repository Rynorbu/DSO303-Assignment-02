# ---------------------------------------------------------------------------
# Email (SES)
# ---------------------------------------------------------------------------
resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.ses_sender_email
}

# Sandbox mode: recipients must be verified too (request production access for real use)
resource "aws_sesv2_email_identity" "test_recipients" {
  for_each       = toset([for e in var.ses_test_recipients : e if e != var.ses_sender_email])
  email_identity = each.value
}

# ---------------------------------------------------------------------------
# Monitoring: CloudWatch alarms -> SNS -> email, plus a dashboard
# ---------------------------------------------------------------------------
# Not KMS-encrypted on purpose: CloudWatch and RDS cannot publish to a topic using the
# AWS-managed SNS key, and alarm messages contain no student data.
resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "API returning server errors - exams may be affected"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.main.id }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "${local.name}-api-p95-latency"
  alarm_description   = "Autosave/start latency high (p95 > 1s)"
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  dimensions          = { ApiId = aws_apigatewayv2_api.main.id }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = local.functions
  alarm_name          = "${local.name}-${each.key}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.fn[each.key].function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "${local.name}-api-throttles"
  alarm_description   = "API Lambda is being throttled - raise account concurrency before exam week"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = aws_lambda_function.fn["api"].function_name }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each            = local.queues
  alarm_name          = "${local.name}-${each.key}-dlq-not-empty"
  alarm_description   = "Messages failed processing 5 times (${each.key})"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq[each.key].name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${local.name}-db-free-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2147483648 # 2 GB
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

# Notifies the alarm topic when RDS performs a Multi-AZ failover (AZ loss evidence)
resource "aws_db_event_subscription" "failover" {
  name             = "${local.name}-db-events"
  sns_topic        = aws_sns_topic.alarms.arn
  source_type      = "db-instance"
  source_ids       = [aws_db_instance.main.identifier]
  event_categories = ["failover", "failure", "availability"]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = [
      { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = {
        title = "API requests / errors", region = var.region, stat = "Sum", period = 60,
        metrics = [
          ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.main.id],
          [".", "4xx", ".", "."], [".", "5xx", ".", "."]
      ] } },
      { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = {
        title = "API latency p95 (ms)", region = var.region, stat = "p95", period = 60,
      metrics = [["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.main.id]] } },
      { type = "metric", x = 0, y = 6, width = 12, height = 6, properties = {
        title = "Lambda concurrency", region = var.region, stat = "Maximum", period = 60,
      metrics = [for k, f in aws_lambda_function.fn : ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", f.function_name]] } },
      { type = "metric", x = 12, y = 6, width = 12, height = 6, properties = {
        title = "Queue depth", region = var.region, stat = "Maximum", period = 60,
      metrics = [for k, q in aws_sqs_queue.main : ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", q.name]] } },
      { type = "metric", x = 0, y = 12, width = 12, height = 6, properties = {
        title = "RDS CPU / connections", region = var.region, stat = "Average", period = 60,
        metrics = [
          ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.identifier],
          [".", "DatabaseConnections", ".", "."]
      ] } },
      { type = "metric", x = 12, y = 12, width = 12, height = 6, properties = {
        title = "WAF blocked requests", region = "us-east-1", stat = "Sum", period = 300,
      metrics = [["AWS/WAFV2", "BlockedRequests", "WebACL", aws_wafv2_web_acl.main.name, "Rule", "ALL"]] } },
    ]
  })
}

# ---------------------------------------------------------------------------
# Audit trail (CloudTrail management events)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "trail" {
  count         = var.enable_cloudtrail ? 1 : 0
  bucket        = "${local.name}-trail-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "trail" {
  count                   = var.enable_cloudtrail ? 1 : 0
  bucket                  = aws_s3_bucket.trail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "AclCheck", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" },
      Action = "s3:GetBucketAcl", Resource = aws_s3_bucket.trail[0].arn },
      { Sid    = "Write", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" },
        Action = "s3:PutObject", Resource = "${aws_s3_bucket.trail[0].arn}/AWSLogs/${local.account_id}/*",
      Condition = { StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" } } },
    ]
  })
}

resource "aws_cloudtrail" "main" {
  count                         = var.enable_cloudtrail ? 1 : 0
  name                          = "${local.name}-trail"
  s3_bucket_name                = aws_s3_bucket.trail[0].id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  depends_on                    = [aws_s3_bucket_policy.trail]
}
