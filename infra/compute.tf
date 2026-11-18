# ---------------------------------------------------------------------------
# Lambda functions (Node.js 22, arm64/Graviton). One deployment package,
# one IAM role per function (least privilege).
# Run `npm ci --omit=dev` in backend/ before plan (CI does this).
# ---------------------------------------------------------------------------
data "archive_file" "backend" {
  type        = "zip"
  source_dir  = "${path.module}/../backend"
  output_path = "${path.module}/.build/backend.zip"
  excludes    = ["test", "test/marking.test.js", "local", "local/server.js", "package-lock.json"]
}

locals {
  db_env = merge({
    DB_HOST = local.db_host
    DB_USER = aws_db_instance.main.username
    DB_NAME = aws_db_instance.main.db_name
  }, var.enable_rds_proxy ? {} : { DB_SECRET_ARN = local.db_secret_arn })

  functions = {
    api = {
      handler = "src/handlers/api.handler"
      vpc     = true
      timeout = 15
      memory  = 512
      env = merge(local.db_env, {
        MARKING_QUEUE_URL = aws_sqs_queue.main["marking"].url
        UPLOADS_BUCKET    = aws_s3_bucket.uploads.bucket
      })
      statements = [
        { Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.main["marking"].arn] },
        { Action = ["s3:PutObject", "s3:GetObject"], Resource = ["${aws_s3_bucket.uploads.arn}/assignments/*"] },
        { Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = [aws_kms_key.main.arn] },
      ]
    }
    admin = {
      handler = "src/handlers/admin.handler"
      vpc     = false
      timeout = 10
      memory  = 256
      env     = { USER_POOL_ID = aws_cognito_user_pool.main.id }
      statements = [
        { Action = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup", "cognito-idp:ListUsersInGroup"], Resource = [aws_cognito_user_pool.main.arn] },
      ]
    }
    marking = {
      handler = "src/handlers/markingWorker.handler"
      vpc     = true
      timeout = 60
      memory  = 512
      env = merge(local.db_env, {
        MARKING_QUEUE_URL = aws_sqs_queue.main["marking"].url
        NOTIFY_QUEUE_URL  = aws_sqs_queue.main["notify"].url
      })
      statements = [
        { Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.main["marking"].arn, aws_sqs_queue.main["notify"].arn] },
        { Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = [aws_sqs_queue.main["marking"].arn] },
      ]
    }
    upload = {
      handler = "src/handlers/uploadProcessor.handler"
      vpc     = true
      timeout = 30
      memory  = 256
      env     = merge(local.db_env, { NOTIFY_QUEUE_URL = aws_sqs_queue.main["notify"].url })
      statements = [
        { Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.uploads.arn}/assignments/*"] },
        { Action = ["kms:Decrypt"], Resource = [aws_kms_key.main.arn] },
        { Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.main["notify"].arn] },
        { Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = [aws_sqs_queue.main["uploads"].arn] },
      ]
    }
    notify = {
      handler = "src/handlers/notifyWorker.handler"
      vpc     = false
      timeout = 30
      memory  = 256
      env     = { SENDER_EMAIL = var.ses_sender_email }
      statements = [
        { Action = ["ses:SendEmail"], Resource = ["*"], Condition = { StringEquals = { "ses:FromAddress" = var.ses_sender_email } } },
        { Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = [aws_sqs_queue.main["notify"].arn] },
      ]
    }
    migrate = {
      handler    = "src/handlers/migrate.handler"
      vpc        = true
      timeout    = 300
      memory     = 256
      env        = local.db_env
      statements = []
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each = local.functions
  name     = "${local.name}-${each.key}-fn"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "fn_basic" {
  for_each   = local.functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = each.value.vpc ? "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole" : "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.functions
  role     = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [for s in concat(each.value.vpc ? local.db_access_statements : [], each.value.statements) : merge({ Effect = "Allow" }, s)]
  })
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each         = local.functions
  function_name    = "${local.name}-${each.key}"
  role             = aws_iam_role.fn[each.key].arn
  handler          = each.value.handler
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.backend.output_path
  source_code_hash = data.archive_file.backend.output_base64sha256
  timeout          = each.value.timeout
  memory_size      = each.value.memory

  environment {
    variables = merge(each.value.env, { NODE_OPTIONS = "--enable-source-maps" })
  }

  dynamic "vpc_config" {
    for_each = each.value.vpc ? [1] : []
    content {
      subnet_ids         = aws_subnet.app[*].id # spread across both AZs
      security_group_ids = [aws_security_group.lambda.id]
    }
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.fn_basic, aws_iam_role_policy.fn]
}

# ---------------------------------------------------------------------------
# Event sources
# ---------------------------------------------------------------------------
locals {
  queue_consumers = {
    marking = { fn = "marking", max_concurrency = 20 } # caps DB load from marking at peak
    uploads = { fn = "upload", max_concurrency = 10 }
    notify  = { fn = "notify", max_concurrency = 5 } # stays under the SES send rate
  }
}

resource "aws_lambda_event_source_mapping" "queues" {
  for_each                           = local.queue_consumers
  event_source_arn                   = aws_sqs_queue.main[each.key].arn
  function_name                      = aws_lambda_function.fn[each.value.fn].arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 1
  function_response_types            = ["ReportBatchItemFailures"]
  scaling_config {
    maximum_concurrency = each.value.max_concurrency
  }
}

# Every minute: auto-submit attempts whose timer has expired (student closed the browser, etc.)
resource "aws_cloudwatch_event_rule" "auto_submit" {
  name                = "${local.name}-auto-submit"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "auto_submit" {
  rule = aws_cloudwatch_event_rule.auto_submit.name
  arn  = aws_lambda_function.fn["marking"].arn
}

resource "aws_lambda_permission" "auto_submit" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["marking"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.auto_submit.arn
}

# Apply the database schema on deploy whenever schema.sql changes (reproducible from code).
resource "aws_lambda_invocation" "migrate" {
  function_name = aws_lambda_function.fn["migrate"].function_name
  input         = jsonencode({ action = "migrate" })
  triggers = {
    schema = filesha256("${path.module}/../backend/src/schema.sql")
    code   = data.archive_file.backend.output_base64sha256
  }
  depends_on = [aws_db_proxy_target.main, aws_vpc_endpoint.sqs, aws_vpc_endpoint.secretsmanager, aws_nat_gateway.main, aws_security_group.db]
}
