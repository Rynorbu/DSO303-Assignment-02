output "app_url" {
  description = "Open this in a browser"
  value       = local.app_url
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "api_endpoint" {
  description = "Direct API Gateway endpoint (normally reached via CloudFront /api)"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "uploads_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.bucket
}

output "db_instance_id" {
  description = "Use with scripts/az-failover-test.sh"
  value       = aws_db_instance.main.identifier
}

output "db_endpoint_used_by_lambda" {
  description = "RDS Proxy endpoint, or the RDS endpoint when enable_rds_proxy = false"
  value       = local.db_host
}

output "availability_zones" {
  value = local.azs
}

output "migration_result" {
  value = jsondecode(aws_lambda_invocation.migrate.result)
}

output "dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards:name=${local.name}"
}

output "region" {
  value = var.region
}
