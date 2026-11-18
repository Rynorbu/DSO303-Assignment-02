# ---------------------------------------------------------------------------
# Encryption key (customer managed, yearly rotation) for RDS, S3, secrets, backups
# ---------------------------------------------------------------------------
resource "aws_kms_key" "main" {
  description             = "${local.name} data encryption key"
  enable_key_rotation     = true
  deletion_window_in_days = 7
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}

# ---------------------------------------------------------------------------
# RDS PostgreSQL Multi-AZ (synchronous standby in the second AZ)
# ---------------------------------------------------------------------------
resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name                       = "exams"
  username                      = "examadmin"
  manage_master_user_password   = true # password generated and stored in Secrets Manager
  master_user_secret_kms_key_id = aws_kms_key.main.arn

  multi_az               = var.db_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.pg16.name

  allocated_storage     = 20
  max_allocated_storage = 200
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  backup_retention_period         = var.db_backup_retention_days # PITR: restore to any second, ~5 min RPO
  backup_window                   = "02:00-03:00"
  maintenance_window              = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.main.arn
  auto_minor_version_upgrade      = true

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = !var.db_deletion_protection
  final_snapshot_identifier = var.db_deletion_protection ? "${local.name}-final" : null
  apply_immediately         = true
}

# ---------------------------------------------------------------------------
# RDS Proxy: pools connections so thousands of Lambda invocations don't
# exhaust PostgreSQL, and fails over to the standby faster than DNS alone.
# ---------------------------------------------------------------------------
resource "aws_iam_role" "rds_proxy" {
  name = "${local.name}-rds-proxy"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "rds.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "rds_proxy" {
  role = aws_iam_role.rds_proxy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_db_instance.main.master_user_secret[0].secret_arn },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.main.arn },
    ]
  })
}

resource "aws_db_proxy" "main" {
  count                  = var.enable_rds_proxy ? 1 : 0
  name                   = "${local.name}-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.rds_proxy.arn
  vpc_subnet_ids         = aws_subnet.data[*].id
  vpc_security_group_ids = [aws_security_group.proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "REQUIRED" # Lambdas connect with IAM tokens, never a stored password
    secret_arn  = aws_db_instance.main.master_user_secret[0].secret_arn
  }
}

resource "aws_db_proxy_default_target_group" "main" {
  count         = var.enable_rds_proxy ? 1 : 0
  db_proxy_name = aws_db_proxy.main[0].name
  connection_pool_config {
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "main" {
  count                  = var.enable_rds_proxy ? 1 : 0
  db_proxy_name          = aws_db_proxy.main[0].name
  target_group_name      = aws_db_proxy_default_target_group.main[0].name
  db_instance_identifier = aws_db_instance.main.identifier
}

# ---------------------------------------------------------------------------
# How the Lambdas reach PostgreSQL
#   enable_rds_proxy = true : RDS Proxy endpoint + IAM auth (production design)
#   enable_rds_proxy = false: RDS endpoint directly + password from the RDS-managed
#                             secret (AWS Free plan accounts cannot create RDS Proxy)
# ---------------------------------------------------------------------------
locals {
  db_secret_arn = aws_db_instance.main.master_user_secret[0].secret_arn
  db_host       = var.enable_rds_proxy ? aws_db_proxy.main[0].endpoint : aws_db_instance.main.address
  db_access_statements = var.enable_rds_proxy ? [
    { Action = ["rds-db:connect"], Resource = ["arn:aws:rds-db:${var.region}:${local.account_id}:dbuser:${element(split(":", aws_db_proxy.main[0].arn), 6)}/${aws_db_instance.main.username}"] },
    ] : [
    { Action = ["secretsmanager:GetSecretValue"], Resource = [local.db_secret_arn] },
    { Action = ["kms:Decrypt"], Resource = [aws_kms_key.main.arn] },
  ]
}
