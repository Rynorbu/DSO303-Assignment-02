# ---------------------------------------------------------------------------
# API Gateway HTTP API with a Cognito JWT authorizer.
# Reached through CloudFront at /api/* (so WAF protects it and there is no CORS).
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "main" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each               = toset(["api", "admin"])
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 15000
}

locals {
  api_routes = {
    "GET /api/health"                       = { fn = "api", auth = false }
    "GET /api/exams"                        = { fn = "api", auth = true }
    "POST /api/exams"                       = { fn = "api", auth = true }
    "GET /api/exams/{id}"                   = { fn = "api", auth = true }
    "DELETE /api/exams/{id}"                = { fn = "api", auth = true }
    "PUT /api/exams/{id}/schedule"          = { fn = "api", auth = true }
    "POST /api/exams/{id}/start"            = { fn = "api", auth = true }
    "GET /api/exams/{id}/attempts"          = { fn = "api", auth = true }
    "POST /api/exams/{id}/release"          = { fn = "api", auth = true }
    "PUT /api/attempts/{id}/answers"        = { fn = "api", auth = true }
    "POST /api/attempts/{id}/submit"        = { fn = "api", auth = true }
    "POST /api/attempts/{id}/mark"          = { fn = "api", auth = true }
    "GET /api/results"                      = { fn = "api", auth = true }
    "GET /api/assignments"                  = { fn = "api", auth = true }
    "POST /api/assignments"                 = { fn = "api", auth = true }
    "POST /api/assignments/{id}/upload-url" = { fn = "api", auth = true }
    "GET /api/assignments/{id}/submissions" = { fn = "api", auth = true }
    "GET /api/admin/users"                  = { fn = "admin", auth = true }
    "POST /api/admin/users"                 = { fn = "admin", auth = true }
  }
}

resource "aws_apigatewayv2_route" "routes" {
  for_each           = local.api_routes
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.fn[each.value.fn].id}"
  authorization_type = each.value.auth ? "JWT" : "NONE"
  authorizer_id      = each.value.auth ? aws_apigatewayv2_authorizer.cognito.id : null
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit   = var.api_throttle_burst # absorbs 3,000 students clicking "start" together
    throttling_rate_limit    = var.api_throttle_rate
    detailed_metrics_enabled = true
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId = "$context.requestId", ip = "$context.identity.sourceIp", route = "$context.routeKey",
      status    = "$context.status", latency = "$context.responseLatency", user = "$context.authorizer.claims.sub",
      error     = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_lambda_permission" "apigw" {
  for_each      = toset(["api", "admin"])
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
