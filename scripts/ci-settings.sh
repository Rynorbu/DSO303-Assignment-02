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
[[ $errors -eq 0 ]] || exit 1

{
  echo "AWS_REGION=$AWS_REGION"
  echo "AWS_DEPLOY_ROLE_ARN=$AWS_DEPLOY_ROLE_ARN"
  echo "TF_STATE_BUCKET=$TF_STATE_BUCKET"
  echo "TF_VAR_region=$AWS_REGION"
  echo "TF_VAR_ses_sender_email=$SES_SENDER_EMAIL"
  echo "TF_VAR_alarm_email=$ALARM_EMAIL"
  echo "TF_VAR_ses_test_recipients=$SES_TEST_RECIPIENTS"
} >> "$GITHUB_ENV"

echo "Settings OK: region=$AWS_REGION bucket=$TF_STATE_BUCKET role=${AWS_DEPLOY_ROLE_ARN##*/} sender=$SES_SENDER_EMAIL"
