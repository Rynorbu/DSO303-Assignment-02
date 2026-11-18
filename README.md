# Online Exam & Assignment Platform on AWS

A serverless, two-Availability-Zone platform for a university with 8,000 students and 400 staff. It supports timed MCQ and short-answer exams with **30-second autosave**, automatic MCQ marking, assignment uploads up to 50 MB, and email notifications. The whole stack is built from **Terraform**, and every push to `main` redeploys it through **GitHub Actions**.

| Deliverable | Location |
|---|---|
| **Step-by-step deployment and evidence guide** | [`docs/step-by-step-guide.md`](docs/step-by-step-guide.md) |
| Architecture diagram (Mermaid + [PNG](architecture/architecture-diagram.png)), two walkthroughs, peak/AZ explanation, [Cloud Architecture Lab files](architecture/lab) | [`architecture/README.md`](architecture/README.md) |
| Service table (role, why over an alternative, connections, configuration) | [`docs/services.md`](docs/services.md) |
| **Implementation report** (Cloud Architecture Lab, AWS deployment, IaC + CI/CD evidence) | [`evidence/README.md`](evidence/README.md) |
| Infrastructure as code (Terraform) | [`infra/`](infra) |
| Lambda backend (Node.js 22) | [`backend/`](backend) |
| Frontend single-page app | [`frontend/`](frontend) |
| CI/CD pipelines | [`.github/workflows/`](.github/workflows) |
| Failover, load test and seeding scripts | [`scripts/`](scripts) |

## Summary

```
Browser ─► Route 53 ─► CloudFront + WAF ─┬─► S3 (static SPA)
                                          └─► /api/* ─► API Gateway (Cognito JWT) ─► Lambda (private subnets, AZ A + B)
                                                                                        │
              TLS (RDS Proxy in exam week) ─► RDS PostgreSQL Multi-AZ (primary AZ A ⇄ sync standby AZ B) ◄─┘
Student ─► presigned POST ─► S3 uploads (KMS, lifecycle 5 y) ─► SQS ─► Lambda ─► SQS ─► Lambda ─► SES email
Submit / release ─► SQS marking ─► Lambda (auto-mark, email fan-out)        EventBridge 1 min ─► auto-submit
```

| Requirement | How it is met |
|---|---|
| Role-based sign-in | Cognito user pool with groups `students`, `tutors` and `admins`. API Gateway JWT authorizer plus role checks in each route |
| Timed exams, 30 s autosave | Server-side deadline per attempt. Browser autosaves every 30 s and also keeps a `localStorage` copy. EventBridge auto-submits expired attempts |
| Auto-marking MCQs | SQS marking queue → marking Lambda |
| 50 MB PDF/ZIP uploads | S3 presigned POST with `content-length-range ≤ 50 MB`, so uploads never pass through the API |
| Email on results release | Marking worker fan-out → SQS notify → Lambda → SES |
| Peak of 3,000 starts in 5 minutes | CloudFront caching, Lambda auto-scaling, API throttling with burst 5,000, 1 DB connection per Lambda (RDS Proxy pooling for exam week), SQS buffering |
| 99.9% availability and AZ loss | Everything spans 2 AZs. RDS Multi-AZ synchronous standby with automatic failover. One NAT per AZ |
| RPO ≤ 5 minutes, RTO ≤ 1 hour | Synchronous Multi-AZ (RPO ≈ 0 on AZ loss). Point-in-time restore (about 5-minute RPO on corruption; 7 days in production, 1 day on the Free plan). AWS Backup. Terraform rebuild in about 20 minutes |
| 5-year records | S3 lifecycle (IA → Glacier IR → Deep Archive → delete after 5 years). AWS Backup monthly copies kept 1,825 days |
| Encryption in transit and at rest | TLS everywhere (CloudFront, API, `rds.force_ssl`, S3 TLS-only policy). KMS CMK for RDS, S3, secrets and backups. SSE-SQS |

## AWS Free plan deployment

The demo account runs on the **AWS Free account plan**, which blocks two features of the production design. Three optional GitHub variables switch the deployment into a Free-plan-compatible mode **without changing the architecture's guarantees**:

| GitHub variable | Production design | Free plan demo | Effect on requirements |
|---|---|---|---|
| `DB_BACKUP_RETENTION_DAYS` | 7 | `1` | None. Point-in-time restore still gives an RPO of about 5 minutes, and 5-year retention comes from AWS Backup and S3 lifecycle rules |
| `DB_USE_RDS_PROXY` | true | `false` | Lambdas connect **directly** to RDS over verified TLS, using the RDS-managed secret. Each Lambda instance holds at most 1 connection. At exam-week scale, RDS Proxy is re-enabled on a paid plan for connection pooling and faster failover |
| `DB_MULTI_AZ` | true | *(unset → true)* | **Multi-AZ stays on.** Accepted by the Free plan, so the database survives the loss of an AZ |

## Run locally (frontend + backend + database, no AWS needed)

Requires Docker Desktop and Node.js 20 or later. This runs the same Lambda handlers against PostgreSQL 16 in Docker. Queues, file storage and email are emulated locally.

```powershell
docker compose up -d          # PostgreSQL 16 on localhost:55432
cd backend
npm install
npm test                      # unit tests
npm run local                 # http://localhost:3000
```

Sign in with any email and password, and choose the role (student, tutor or admin) on the login page. Uploaded files go to `local-data/uploads` and emails to `local-data/outbox`. Stop with `Ctrl+C` and `docker compose down`. See [Phase 1B of the guide](docs/step-by-step-guide.md#phase-1b--run-the-frontend-backend-and-database-locally-free--30-min) for details.

## Prerequisites

- An AWS account and the AWS CLI, signed in with an administrator profile (`aws sts get-caller-identity` works)
- Terraform 1.10 or later, and Node.js 20 or later
- A GitHub repository for this code
- An email address you can receive mail at (for SES verification)

> **New AWS accounts** may have a Lambda concurrency limit of 10. That is enough for the demo, but request an increase (Service Quotas → Lambda → Concurrent executions) before any real load test. SES starts in **sandbox** mode, where every recipient must be verified. List your test emails in `ses_test_recipients`.

## Deploy

### 1. One-time bootstrap (Terraform state bucket and GitHub OIDC role)

```bash
cd infra/bootstrap
terraform init
terraform apply -var="github_repo=<github-user>/<repo-name>"
# note the outputs: state_bucket, deploy_role_arn
```

### 2. Configure GitHub (Settings → Secrets and variables → Actions → **Variables**)

| Variable | Example |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/exam-platform-github-deploy` |
| `TF_STATE_BUCKET` | `exam-platform-tfstate-123456789012` |
| `AWS_REGION` | `us-east-1` |
| `SES_SENDER_EMAIL` | `you@example.com` |
| `SES_TEST_RECIPIENTS` | `["student@example.com","tutor@example.com"]` |
| `ALARM_EMAIL` | `you@example.com` |

### 3. Push to `main`

```bash
git push origin main
```

The **CI/CD** workflow then runs these steps:

1. Unit tests
2. `terraform fmt`, `validate` and `plan`
3. **`terraform apply`**
4. CloudFront invalidation
5. `/api/health` smoke test

The first deploy takes about 20–25 minutes, mostly because RDS Multi-AZ and CloudFront are slow to create. After that, every push to `main` redeploys automatically. Pull requests only run the plan.

After the first deploy:

- Click the **SES verification links** emailed to the sender and test recipients, and the SNS alarm subscription link.
- Create demo users:

```bash
bash scripts/seed-users.sh admin@example.com tutor@example.com student@example.com 'Passw0rd1234'
terraform -chdir=infra output app_url
```

### Deploy from your laptop instead (optional)

```bash
cd backend && npm ci --omit=dev && cd ../infra
cp example.tfvars terraform.tfvars        # edit the emails
terraform init -backend-config="bucket=<state_bucket>" -backend-config="region=us-east-1"
terraform apply
```

## Test the flows

| Flow | How |
|---|---|
| Exam and autosave | Tutor creates an exam (sample questions are pre-filled). Student starts it, answers, and sees "Saved hh:mm:ss" every 30 s. Refreshing restores the answers |
| Upload and notify | Student uploads a PDF or ZIP on the Assignments card. The tutor receives an email and can download the file from *View* |
| Results email | Tutor opens *Attempts*, enters manual marks, then *Release results*. Students receive an email |
| AZ failure | `bash scripts/az-failover-test.sh` forces an RDS Multi-AZ failover and probes `/api/health` throughout |
| Peak load | `node scripts/load-test.mjs <app_url> <client_id> us-east-1 <student> <password> <exam_id> 3000 100` |
| Unit tests | `cd backend && npm test` |

## Tear down

**Option A – GitHub:** Actions → **Tear down** → *Run workflow* → type `DESTROY`.

**Option B – laptop:**

```bash
cd backend && npm ci --omit=dev && cd ../infra
terraform destroy
# optional: remove the bootstrap resources (empty the state bucket's versions first)
cd bootstrap && terraform destroy -var="github_repo=<github-user>/<repo-name>"
```

The demo defaults (`db_deletion_protection = false`, `force_destroy` on buckets) allow a clean destroy. For real production, set `db_deletion_protection = true`. The KMS key enters a 7-day pending-deletion window.

## Cost (demo, us-east-1, approximate)

| Item | ≈ per day |
|---|---|
| RDS `db.t4g.micro` Multi-AZ (RDS Proxy only on a paid plan) | $1.60 |
| 2 NAT gateways (set `nat_gateway_count = 0` to save) | $2.20 |
| SQS interface endpoint (2 AZ) | $0.50 |
| WAF (web ACL + rules) | $0.30 |
| Lambda, API Gateway, S3, SQS, SES, CloudFront at demo volume | ≈ $0 (free tier) |

That is about **$4–5 per day**. Destroy the stack as soon as all evidence screenshots are taken.

## Repository layout

```
architecture/       diagram (Mermaid), walkthroughs, peak/AZ explanation
docs/services.md    service table
evidence/           Cloud Architecture Lab + deployment screenshots (replace the video, as agreed with the tutor)
infra/              Terraform: network, database, storage, auth, compute, api, edge, monitoring, backup
infra/bootstrap/    Terraform state bucket + GitHub OIDC deploy role
backend/            Lambda handlers, schema.sql, unit tests
frontend/           index.html, app.js, styles.css (config.js generated by Terraform)
scripts/            seed-users.sh, az-failover-test.sh, load-test.mjs
.github/workflows/  deploy.yml (CI/CD), destroy.yml (teardown)
```
