#!/usr/bin/env bash
# Used by the GitHub Actions workflows. Reads the repository variables (passed in as RAW_*),
# removes stray spaces/line breaks that come from copy-paste, validates them, and exports
# clean values (and the TF_VAR_* inputs for Terraform) to the following steps via $GITHUB_ENV.
set -euo pipefail

clean() { printf '%s' "$1" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

AWS_REGION=$(clean "${RAW_AWS_REGION:-}")
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_DEPLOY_ROLE_ARN=$(clean "${RAW_AWS_DEPLOY_ROLE_ARN:-}")
TF_STATE_BUCKET=$(clean "${RAW_TF_STATE_BUCKET:-}")
SES_SENDER_EMAIL=$(clean "${RAW_SES_SENDER_EMAIL:-}")
ALARM_EMAIL=$(clean "${RAW_ALARM_EMAIL:-}")
SES_TEST_RECIPIENTS=$(clean "${RAW_SES_TEST_RECIPIENTS:-}")
SES_TEST_RECIPIENTS=${SES_TEST_RECIPIENTS:-[]}
# Optional (AWS Free plan accounts): DB_BACKUP_RETENTION_DAYS=1, DB_USE_RDS_PROXY=false, DB_MULTI_AZ=true|false
DB_BACKUP_RETENTION_DAYS=$(clean "${RAW_DB_BACKUP_RETENTION_DAYS:-}")
DB_MULTI_AZ=$(clean "${RAW_DB_MULTI_AZ:-}" | tr '[:upper:]' '[:lower:]')
DB_USE_RDS_PROXY=$(clean "${RAW_DB_USE_RDS_PROXY:-}" | tr '[:upper:]' '[:lower:]')

errors=0
fail() { echo "::error::$1"; errors=$((errors + 1)); }

[[ "$AWS_DEPLOY_ROLE_ARN" =~ ^arn:aws:iam::[0-9]{12}:role/.+ ]] || fail "AWS_DEPLOY_ROLE_ARN is missing or not a role ARN (Settings > Secrets and variables > Actions > Variables)"
[[ "$TF_STATE_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "TF_STATE_BUCKET is missing or not a valid bucket name"
[[ "$AWS_REGION" =~ ^[a-z]{2}-[a-z]+-[0-9]$ ]] || fail "AWS_REGION is not a valid region, e.g. us-east-1"
[[ "$SES_SENDER_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fail "SES_SENDER_EMAIL is missing or not an email address"
if [[ -n "$ALARM_EMAIL" && ! "$ALARM_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then fail "ALARM_EMAIL is not an email address"; fi
if ! printf '%s' "$SES_TEST_RECIPIENTS" | python3 -c 'import json,sys; v=json.load(sys.stdin); assert isinstance(v,list) and all(isinstance(x,str) for x in v)' 2>/dev/null; then
  fail 'SES_TEST_RECIPIENTS must be a JSON list, e.g. ["a@example.com","b@example.com"]'
fi
if [[ -n "$DB_BACKUP_RETENTION_DAYS" ]] && ! [[ "$DB_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ && "$DB_BACKUP_RETENTION_DAYS" -ge 1 && "$DB_BACKUP_RETENTION_DAYS" -le 35 ]]; then
  fail "DB_BACKUP_RETENTION_DAYS must be a whole number from 1 to 35"
fi
if [[ -n "$DB_MULTI_AZ" && "$DB_MULTI_AZ" != "true" && "$DB_MULTI_AZ" != "false" ]]; then fail "DB_MULTI_AZ must be true or false"; fi
if [[ -n "$DB_USE_RDS_PROXY" && "$DB_USE_RDS_PROXY" != "true" && "$DB_USE_RDS_PROXY" != "false" ]]; then fail "DB_USE_RDS_PROXY must be true or false"; fi
[[ $errors -eq 0 ]] || exit 1

{
  echo "AWS_REGION=$AWS_REGION"
  echo "AWS_DEPLOY_ROLE_ARN=$AWS_DEPLOY_ROLE_ARN"
  echo "TF_STATE_BUCKET=$TF_STATE_BUCKET"
  echo "TF_VAR_region=$AWS_REGION"
  echo "TF_VAR_ses_sender_email=$SES_SENDER_EMAIL"
  echo "TF_VAR_alarm_email=$ALARM_EMAIL"
  echo "TF_VAR_ses_test_recipients=$SES_TEST_RECIPIENTS"
  if [[ -n "$DB_BACKUP_RETENTION_DAYS" ]]; then echo "TF_VAR_db_backup_retention_days=$DB_BACKUP_RETENTION_DAYS"; fi
  if [[ -n "$DB_MULTI_AZ" ]]; then echo "TF_VAR_db_multi_az=$DB_MULTI_AZ"; fi
  if [[ -n "$DB_USE_RDS_PROXY" ]]; then echo "TF_VAR_enable_rds_proxy=$DB_USE_RDS_PROXY"; fi
} >> "$GITHUB_ENV"

echo "Settings OK: region=$AWS_REGION bucket=$TF_STATE_BUCKET role=${AWS_DEPLOY_ROLE_ARN##*/} sender=$SES_SENDER_EMAIL backup_days=${DB_BACKUP_RETENTION_DAYS:-7 (default)} multi_az=${DB_MULTI_AZ:-true (default)} rds_proxy=${DB_USE_RDS_PROXY:-true (default)}"
