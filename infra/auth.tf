# ---------------------------------------------------------------------------
# Amazon Cognito: sign-in with role groups (students / tutors / admins)
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool" "main" {
  name                     = "${local.name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL" # staff can enable TOTP

  software_token_mfa_configuration {
    enabled = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true # accounts are provisioned by the university, no self sign-up
    invite_message_template {
      email_subject = "Your exam platform account"
      email_message = "Your username is {username} and temporary password is {####}. Sign in at ${local.app_url}"
      sms_message   = "Username {username}, temporary password {####}"
    }
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  deletion_protection = var.db_deletion_protection ? "ACTIVE" : "INACTIVE"
}

resource "aws_cognito_user_pool_client" "web" {
  name                          = "${local.name}-web"
  user_pool_id                  = aws_cognito_user_pool.main.id
  generate_secret               = false # browser app (public client)
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  id_token_validity             = 4 # hours: longer than the longest exam
  access_token_validity         = 4
  refresh_token_validity        = 1 # days
  token_validity_units {
    id_token      = "hours"
    access_token  = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "groups" {
  for_each     = { students = 3, tutors = 2, admins = 1 }
  name         = each.key
  user_pool_id = aws_cognito_user_pool.main.id
  precedence   = each.value
  description  = "Platform role: ${each.key}"
}
