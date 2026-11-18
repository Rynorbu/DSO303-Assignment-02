#!/usr/bin/env bash
# Creates demo users with permanent passwords so you can sign in straight away.
# Usage: scripts/seed-users.sh <admin-email> <tutor-email> <student-email> '<Password123>'
# Run from the repo root after `terraform apply` (reads the user pool ID from Terraform outputs).
set -euo pipefail

ADMIN_EMAIL=${1:?admin email}
TUTOR_EMAIL=${2:?tutor email}
STUDENT_EMAIL=${3:?student email}
PASSWORD=${4:?password (10+ chars, upper, lower, number)}

POOL_ID=$(terraform -chdir=infra output -raw user_pool_id)
REGION=$(terraform -chdir=infra output -raw region)

create() {
  local email=$1 group=$2
  echo "Creating $email in group $group"
  aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL_ID" --username "$email" \
    --user-attributes Name=email,Value="$email" Name=email_verified,Value=true \
    --message-action SUPPRESS >/dev/null 2>&1 || echo "  (already exists)"
  aws cognito-idp admin-set-user-password --region "$REGION" --user-pool-id "$POOL_ID" --username "$email" \
    --password "$PASSWORD" --permanent
  aws cognito-idp admin-add-user-to-group --region "$REGION" --user-pool-id "$POOL_ID" --username "$email" \
    --group-name "$group"
}

create "$ADMIN_EMAIL" admins
create "$TUTOR_EMAIL" tutors
create "$STUDENT_EMAIL" students
echo "Done. Sign in at: $(terraform -chdir=infra output -raw app_url)"
