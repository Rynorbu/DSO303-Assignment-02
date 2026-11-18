# One-time bootstrap (run locally with your own AWS credentials):
#   - S3 bucket for Terraform remote state
#   - GitHub OIDC identity provider + deploy role (no long-lived AWS keys in GitHub)
#
#   cd infra/bootstrap
#   terraform init
#   terraform apply -var="github_repo=<your-github-user>/<repo-name>"
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_repo" {
  description = "GitHub repository allowed to deploy, as owner/name"
  type        = string
}

# GitHub now puts immutable numeric IDs in the OIDC "sub" claim:
#   repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:refs/heads/main
# Find them in CloudTrail (failed AssumeRoleWithWebIdentity events) or with:
#   curl https://api.github.com/repos/<owner>/<repo>  -> "id" and "owner.id"
variable "github_owner_id" {
  description = "Numeric GitHub account ID of the repo owner"
  type        = string
  default     = "*"
}

variable "github_repo_id" {
  description = "Numeric GitHub repository ID"
  type        = string
  default     = "*"
}

variable "project" {
  type    = string
  default = "exam-platform"
}

locals {
  repo_owner = split("/", var.github_repo)[0]
  repo_name  = split("/", var.github_repo)[1]
  # Both claim formats are accepted: the classic one and the one with immutable IDs.
  repo_subjects = [
    "repo:${var.github_repo}",
    "repo:${local.repo_owner}@${var.github_owner_id}/${local.repo_name}@${var.github_repo_id}",
  ]
  allowed_subjects = flatten([for r in local.repo_subjects : [
    "${r}:ref:refs/heads/main",
    "${r}:pull_request",
    "${r}:environment:*",
  ]])
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# An AWS account can only have ONE GitHub OIDC provider. If another project already
# created it, run with -var="create_oidc_provider=false" to reuse the existing one.
variable "create_oidc_provider" {
  type    = bool
  default = true
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS no longer validates this thumbprint for GitHub, but the argument is still accepted
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

resource "aws_iam_role" "deploy" {
  name = "${var.project}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = local.allowed_subjects }
      }
    }]
  })
}

# Broad permissions because the pipeline creates IAM roles, VPCs, RDS, etc.
# For a real university account, replace with a scoped policy + permissions boundary.
resource "aws_iam_role_policy_attachment" "deploy" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}
