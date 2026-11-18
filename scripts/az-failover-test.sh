#!/usr/bin/env bash
# Simulates the loss of the Availability Zone that hosts the primary database.
# RDS Multi-AZ promotes the standby in the other AZ; RDS Proxy reconnects automatically.
# Meanwhile the script calls /api/health every 2 seconds so you can see (and record) the impact.
#
# Usage (repo root, after deploy): scripts/az-failover-test.sh
set -euo pipefail

DB_ID=$(terraform -chdir=infra output -raw db_instance_id)
APP_URL=$(terraform -chdir=infra output -raw app_url)

az_of_primary() {
  aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
    --query 'DBInstances[0].[AvailabilityZone,SecondaryAvailabilityZone,DBInstanceStatus]' --output text
}

echo "== Before failover (primary AZ, standby AZ, status) =="
az_of_primary

echo "== Forcing failover: rebooting $DB_ID with --force-failover =="
aws rds reboot-db-instance --db-instance-identifier "$DB_ID" --force-failover \
  --query 'DBInstance.DBInstanceStatus' --output text

echo "== Probing $APP_URL/api/health every 2s (Ctrl+C to stop) =="
START=$(date +%s)
FAILS=0
while true; do
  NOW=$(date +%s)
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$APP_URL/api/health" || echo "000")
  [ "$CODE" != "200" ] && FAILS=$((FAILS + 1))
  STATUS=$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].DBInstanceStatus' --output text)
  printf '%s  t+%3ss  health=%s  db=%s  failed_probes=%s\n' "$(date +%T)" "$((NOW - START))" "$CODE" "$STATUS" "$FAILS"
  if [ "$STATUS" = "available" ] && [ "$CODE" = "200" ] && [ $((NOW - START)) -gt 60 ]; then break; fi
  sleep 2
done

echo "== After failover (primary should now be in the other AZ) =="
az_of_primary
echo "Recent RDS events:"
aws rds describe-events --source-identifier "$DB_ID" --source-type db-instance --duration 30 \
  --query 'Events[].[Date,Message]' --output table
