variable "project" {
  description = "Short project name used as a prefix for resources"
  type        = string
  default     = "exam-platform"
}

variable "environment" {
  description = "Environment name (prod, dev)"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "nat_gateway_count" {
  description = "NAT gateways (one per AZ = 2 for full AZ independence). Lambdas reach AWS services through VPC endpoints, so 0 also works and saves cost."
  type        = number
  default     = 2
  validation {
    condition     = contains([0, 1, 2], var.nat_gateway_count)
    error_message = "nat_gateway_count must be 0, 1 or 2."
  }
}

variable "db_instance_class" {
  description = "RDS instance class. Use db.m6g.large (or larger) for real exam week; db.t4g.micro is enough for the demo."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_backup_retention_days" {
  description = "Automated backup + point-in-time-recovery window. Any value >= 1 gives the ~5 minute RPO (PITR); the length only sets how far back you can restore. AWS Free plan accounts must use 1."
  type        = number
  default     = 7
  validation {
    condition     = var.db_backup_retention_days >= 1 && var.db_backup_retention_days <= 35
    error_message = "db_backup_retention_days must be between 1 and 35 (0 would disable backups and break the RPO)."
  }
}

variable "enable_rds_proxy" {
  description = "Connection pooling between Lambda and RDS (production design). AWS Free plan accounts cannot create RDS Proxy: set false and the Lambdas connect directly (TLS + RDS-managed secret)."
  type        = bool
  default     = true
}

variable "db_multi_az" {
  description = "Synchronous standby in a second AZ. Keep true (required to survive the loss of an AZ); set false only if the AWS account plan refuses it."
  type        = bool
  default     = true
}

variable "db_deletion_protection" {
  description = "Set true for real production. False so the assignment stack can be torn down."
  type        = bool
  default     = false
}

variable "records_retention_days" {
  description = "How long submissions and monthly DB backups are kept (5 years)"
  type        = number
  default     = 1825
}

variable "ses_sender_email" {
  description = "Verified SES sender address (a verification email is sent on first apply)"
  type        = string
}

variable "ses_test_recipients" {
  description = "While SES is in sandbox mode, every recipient must be verified. List test student/tutor emails here."
  type        = list(string)
  default     = []
}

variable "alarm_email" {
  description = "Email that receives CloudWatch alarm notifications (empty = no subscription)"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Optional custom domain, e.g. exams.example.ac.uk. Leave empty to use the CloudFront domain."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for domain_name (required if domain_name is set)"
  type        = string
  default     = ""
}

variable "waf_rate_limit_per_ip" {
  description = "Requests per 5 minutes per IP. Kept high because a whole campus may share one NAT IP."
  type        = number
  default     = 20000
}

variable "api_throttle_burst" {
  type    = number
  default = 5000
}

variable "api_throttle_rate" {
  type    = number
  default = 2000
}

variable "enable_cloudtrail" {
  type    = bool
  default = true
}

variable "log_retention_days" {
  type    = number
  default = 90
}
