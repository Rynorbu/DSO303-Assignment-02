# Step-by-step guide (follow in order)

This guide takes you from zero to a finished submission. It covers **every step**, **the screenshot to take at each step**, and **where to save it**.

**How to take a screenshot on Windows:** press **`Win + Shift + S`**, drag a box around the area, click the notification that pops up, and press **Save**.
Save every screenshot as **PNG** in `C:\Users\HP\OneDrive\Desktop\Assignment-2-AWS\evidence\` with the **exact file name** shown, for example `evidence/03-vpc-subnets.png`.

> 📸 = take a screenshot here.
> ⏱ = how long the step usually takes.
> 💰 = this step costs money. The whole graded deployment costs about **$4–5 per day**, so do it in **one or two days** and then tear it down (Phase 18).

**If you get stuck, paste the full error message to Claude.** Most problems are a missing setting, and you can see the exact error on screen.

## The big picture (the order you work in)

```
 PART A – LOCAL (free)            PART B – AWS (costs money)                 PART C – FINISH
 ─────────────────────            ──────────────────────────                 ───────────────
 Phase 0  prepare                 Phase 2   connect PC to AWS                Phase 14  record video
 Phase 1  check tools             Phase 3   push code to GitHub              Phase 15  diagram PNG
 Phase 1B run frontend +    ──►   Phase 4   bootstrap (state + OIDC)   ──►   Phase 16  Cloud Architecture Lab
          backend + database      Phase 5   GitHub variables                 Phase 17  hand in
          on your laptop          Phase 6   pipeline deploys everything      Phase 18  TEAR DOWN
                                  Phase 7-8 verify emails, create users
                                  Phase 9   console screenshots (28)
                                  Phase 10  both walkthroughs on AWS
                                  Phase 11  AZ failure test
                                  Phase 12  load test
                                  Phase 13  push to main → auto redeploy
```

| Rubric item (2 marks each) | Proved by phases |
|---|---|
| AWS architecture design | `architecture/README.md` (already written) + Phase 15 |
| AWS service documentation | `docs/services.md` (already written) |
| Cloud Architecture Lab | Phase 16 |
| AWS deployment | Phases 6, 9, 10, 11 + video (Phase 14) |
| IaC and CI/CD | Phases 4, 5, 6, 13, 18 |

Phase 1B (local) isn't in the rubric, but it lets you test everything for free first and gives you extra evidence.

---

## Phase 0 – Before you start (⏱ 20 min)

### Step 0.1 – Which AWS account?
- **Your own AWS account** (you sign in at `console.aws.amazon.com` with your own email): follow this guide as written.
- **AWS Academy Learner Lab** (you click "Start Lab" inside AWS Academy): **stop and tell Claude**. The code needs small changes for that kind of account.

### Step 0.2 – Create a budget alert (protects you from surprise bills)
1. Sign in to the **AWS Console**. In the top search bar, type **Budgets** and open it.
2. Click **Create budget**, choose **Use a template**, then **Monthly cost budget**.
3. Set the amount to **$20** and enter your email. Click **Create budget**.

📸 `evidence/00-budget-alert.png`: the budget list showing your $20 budget.

### Step 0.3 – Accounts you need
- An **AWS account** with administrator access
- A **GitHub account** (free): <https://github.com/signup>
- **One email address you can open.** It is used for the sender, the alarms and your test users.

> **Tip, test users from one inbox:** Gmail ignores anything after a `+`. If your email is `name@gmail.com`, you can use `name+admin@gmail.com`, `name+tutor@gmail.com` and `name+student@gmail.com`. All three land in the same inbox, but AWS treats them as different users.

---

## Phase 1 – Check your tools (⏱ 10 min)

Open **PowerShell** in the project folder: in File Explorer, open `Assignment-2-AWS`, click the address bar, type `powershell` and press Enter. Then run:

```powershell
node -v
terraform -version
aws --version
git --version
```

You already have all four installed: Node 24, Terraform 1.13, AWS CLI and Git.

📸 `evidence/01-tools-versions.png`: the terminal showing all four versions.

---

## Phase 1B – Run the frontend, backend and database locally (free, ⏱ 30 min)

This runs **the same Lambda code** on your laptop. The AWS services are replaced like this:

| On AWS | On your laptop |
|---|---|
| RDS PostgreSQL 16 | PostgreSQL 16 in **Docker** |
| API Gateway + Lambda | local Node server (`backend/local/server.js`) calling the same handlers |
| SQS + worker Lambdas | in-process queue calling the same worker handlers |
| S3 uploads | folder `local-data/uploads` |
| SES email | text files in `local-data/outbox` |
| Cognito | local sign-in where you choose the role |
| CloudFront + S3 website | the same local server, at `http://localhost:3000` |

### Step 1B.1 – Start Docker Desktop
Open **Docker Desktop** from the Start menu and wait until it says **Engine running**.

### Step 1B.2 – Start the database
In **PowerShell**, in the project folder:
```powershell
cd C:\Users\HP\OneDrive\Desktop\Assignment-2-AWS
docker compose up -d
docker ps
```
`docker ps` should show `exam-platform-db` with status **Up (healthy)**. Wait about 10 seconds if it still says *starting*.

📸 `evidence/L01-docker-db-running.png`: the `docker ps` output.

### Step 1B.3 – Install the backend and run the unit tests
```powershell
cd backend
npm install
npm test
```
You should see `pass 6` and `fail 0`.

📸 `evidence/L02-unit-tests.png`

### Step 1B.4 – Start the local server
```powershell
npm run local
```
You should see:
```
Database ready. Tables: assignments, attempts, exams, submissions
Exam platform running locally: http://localhost:3000
```
**Keep this window open.** It is your backend, and it prints every API request. Closing it stops the app.

📸 `evidence/L03-local-server-running.png`

### Step 1B.5 – Test walkthrough 1 locally
1. Open **http://localhost:3000** in Chrome. Use a normal window for the tutor.
2. Sign in with email `tutor@test.local`, any password, and Role **Tutor**.
3. Click **Exams → Create exam**, then **Load sample questions**. Type a title and click **Publish exam**.
   📸 `evidence/L04-local-tutor-exam-created.png`
4. Open an **Incognito window** (`Ctrl + Shift + N`), go to http://localhost:3000, and sign in as `student@test.local` with Role **Student**.
5. Click **Start exam → Start exam**. Answer the questions using the question map on the left or **Next**, and wait 30 seconds for **"Saved hh:mm:ss"** in the top bar.
   📸 `evidence/L05-local-autosave.png`
6. Press **F5**. The exam reopens with all your answers (the progress bar shows "4 of 4 answered").
7. Click **Submit → Submit exam**. In the tutor window, open the exam. The **Auto** column shows the MCQ score added by the marking worker.
   📸 `evidence/L06-local-auto-marked.png`
8. Click **Mark**, give the short answer a mark (for example **½**), add feedback, and click **Save marks**. Back on the exam, click **Release results**. Open the folder `local-data\outbox`, where a `.txt` email to the student has appeared. Open it.
   📸 `evidence/L07-local-result-email-file.png`

### Step 1B.6 – Test walkthrough 2 locally
1. Make a 40 MB test file:
   ```powershell
   fsutil file createnew "$HOME\Desktop\assignment-40mb.pdf" 41943040
   ```
2. **Tutor window:** create an assignment.
3. **Student window:** refresh, then upload `assignment-40mb.pdf` on that assignment.
   📸 `evidence/L08-local-upload.png`
4. Look at the server window. It prints `[local s3] stored …` and `[local email] to=tutor@test.local …`.
   📸 `evidence/L09-local-server-log.png`
5. The file is now in `local-data\uploads\assignments\…`, and the tutor email is in `local-data\outbox`.
   📸 `evidence/L10-local-tutor-email-file.png`
6. **Tutor window:** open **Assignments**, click the assignment card, then **Download**.

### Step 1B.7 – Look inside the database (optional, good evidence)
In a **second** PowerShell window:
```powershell
docker exec -it exam-platform-db psql -U exam -d exams -c "SELECT student_email, status, mcq_score, total_score, last_saved_at FROM attempts;"
docker exec -it exam-platform-db psql -U exam -d exams -c "SELECT student_email, s3_key, size_bytes FROM submissions;"
```
📸 `evidence/L11-local-database-rows.png`: the autosaved attempt and the upload row in PostgreSQL.

### Step 1B.8 – Stop
- Press **Ctrl + C** in the server window.
- Run `docker compose down` to stop the database. Your data is kept for next time.
- Run `docker compose down -v` instead if you want to delete all local data and start fresh.

> If `npm run local` says **"Could not start. Is the database running?"**, Docker Desktop isn't running or the container isn't healthy yet. Run `docker ps`, wait, and try again.

---

## Phase 2 – Connect your computer to AWS (⏱ 15 min)

### Step 2.1 – Create an access key for your computer
1. In the AWS Console, search **IAM** and open **Users**, then **Create user**.
2. User name: `terraform-admin`. Click **Next**.
3. Choose **Attach policies directly**, tick **AdministratorAccess**, then click **Next** and **Create user**.
4. Open the user, go to the **Security credentials** tab, then **Create access key**.
5. Choose **Command Line Interface (CLI)**, tick the confirmation box, and click **Next** and then **Create access key**.
6. **Copy both the Access key ID and the Secret access key.** You will never see the secret again.

📸 `evidence/02-iam-user.png`: the IAM user page showing `terraform-admin` with AdministratorAccess. **Do NOT screenshot the secret key.**

### Step 2.2 – Configure the CLI
```powershell
aws configure
```
Enter these values when asked:
- **Access key ID:** the one you just copied
- **Secret access key:** the one you just copied
- **Default region:** `us-east-1`
- **Output format:** `json`

Test that it works:
```powershell
aws sts get-caller-identity
```
You should see your account number and `user/terraform-admin`.

📸 `evidence/02-aws-cli-connected.png`: the output of `get-caller-identity`.

---

## Phase 3 – Put the code on GitHub (⏱ 15 min)

### Step 3.1 – Create an empty repository
1. On GitHub, click **New repository**.
2. Name it `exam-platform-aws` (or any name you like).
3. Choose **Public** or **Private**, whichever your module asks for. **Do not** tick "Add a README".
4. Click **Create repository**.

### Step 3.2 – Commit and push
In PowerShell, inside `Assignment-2-AWS`:
```powershell
git config user.name "Your Name"
git config user.email "your-github-email@example.com"
git add .
git commit -m "Initial exam platform: architecture, docs, Terraform, Lambda, CI/CD"
git remote add origin https://github.com/<your-username>/exam-platform-aws.git
git push -u origin main
```
If a login window pops up, sign in to GitHub.

> The first pipeline run will **fail** at this point, because AWS isn't connected to GitHub yet. That is expected, and Phase 5 fixes it.

📸 `evidence/03-github-repo.png`: your repository page on GitHub showing the folders (`architecture`, `backend`, `docs`, `infra` and so on).

---

## Phase 4 – One-time setup: Terraform state and the GitHub → AWS login (⏱ 5 min)

This step creates two things in AWS:
- an **S3 bucket** that stores Terraform's state file
- an **IAM role** that GitHub Actions uses to sign in to AWS without stored passwords (OIDC)

```powershell
cd infra\bootstrap
terraform init
terraform apply -var="github_repo=<your-username>/exam-platform-aws"
# If you get "OIDC provider ... already exists", add:  -var="create_oidc_provider=false"
```
Type `yes` when asked. At the end you will see two outputs. **Copy both into Notepad**:

```
deploy_role_arn = "arn:aws:iam::123456789012:role/exam-platform-github-deploy"
state_bucket    = "exam-platform-tfstate-123456789012"
```

📸 `evidence/04-bootstrap-outputs.png`: the terminal showing `Apply complete!` and the two outputs.

Then go back to the project folder:
```powershell
cd ..\..
```

---

## Phase 5 – Tell GitHub your settings (⏱ 10 min)

On GitHub, open your repository. Go to **Settings → Secrets and variables → Actions**, select the **Variables** tab, and click **New repository variable** once for each row below:

| Name | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | the `deploy_role_arn` from Phase 4 |
| `TF_STATE_BUCKET` | the `state_bucket` from Phase 4 |
| `AWS_REGION` | `us-east-1` |
| `SES_SENDER_EMAIL` | `name@gmail.com` (your real email) |
| `SES_TEST_RECIPIENTS` | `["name+tutor@gmail.com","name+student@gmail.com","name+admin@gmail.com"]` |
| `ALARM_EMAIL` | `name@gmail.com` |

Type `SES_TEST_RECIPIENTS` exactly as shown: square brackets, double quotes, commas.

📸 `evidence/05-github-variables.png`: the Variables tab listing all 6 variables.

---

## Phase 6 – Deploy with the pipeline (⏱ 25–30 min, 💰 starts costing)

### Step 6.1 – Start the pipeline
1. On GitHub, open the **Actions** tab, then **CI/CD** on the left.
2. Click **Run workflow → Run workflow** on branch `main`. A push to `main` also triggers it.
3. Click the running job to watch it.

The run goes through two jobs:
- **test:** about 1 minute
- **deploy:** about 20–25 minutes. The database and CloudFront are slow to create, so this is normal.

📸 `evidence/06-pipeline-running.png`: the run in progress showing the step list.
📸 `evidence/06-pipeline-success.png`: the finished run with **every step green ✅**, including *Terraform apply* and *Smoke test*.

### Step 6.2 – If it fails
- Click the red ❌ step and copy the last 30 lines of the log to Claude.
- **Common cause:** the *migrate* step timed out the first time because the database was still starting. Click **Re-run failed jobs**. The second run usually passes.

### Step 6.3 – Get your website address
Open the successful run, then the **Smoke test** step. It prints `App: https://dxxxxxxxx.cloudfront.net`. **Save this URL.**

📸 `evidence/06-app-url.png`: the Smoke test log showing the URL and `{"status":"ok"...}`.

---

## Phase 7 – Click the verification emails (⏱ 5 min)

Check your inbox, including spam. You will get:
- **4 emails from Amazon Web Services:** "Email address verification request". **Click the link in every one.**
- **1 email from AWS Notifications:** "Subscription confirmation". Click **Confirm subscription**.

Then check that it worked: in the AWS Console, search **SES**, open **Identities**, and all 4 should show **Verified**.

📸 `evidence/07-ses-verified.png`: the SES identities list, all marked Verified.

---

## Phase 8 – Create the demo users (⏱ 5 min)

Your computer needs to read the deployment outputs, so connect Terraform to the same state as the pipeline. In PowerShell, in the project folder:

```powershell
cd infra
terraform init -backend-config="bucket=<state_bucket from Phase 4>" -backend-config="region=us-east-1"
terraform output
cd ..
```

You should see `app_url`, `user_pool_id`, `db_instance_id` and the other outputs.

📸 `evidence/08-terraform-outputs.png`: the output list.

Now create the three users. Open **Git Bash**: right-click inside the project folder, choose **Show more options → Open Git Bash here**. Then run:

```bash
bash scripts/seed-users.sh name+admin@gmail.com name+tutor@gmail.com name+student@gmail.com 'ExamDemo2026!'
```
The password must have 10 or more characters, with uppercase, lowercase and a number.

📸 `evidence/08-users-created.png`: the script output ending with "Done. Sign in at: …".

---

## Phase 9 – Screenshot every part of the architecture in the AWS Console (⏱ 40 min)

> 👉 **Detailed click-by-click instructions for every screenshot are in [`console-screenshots-guide.md`](console-screenshots-guide.md).** The table below is the short version.

This proves the **full build**. Make sure the region in the top-right corner is **N. Virginia (us-east-1)**. Every resource name starts with `exam-platform-prod`.

| # | Search the console for → open | What must be visible in the screenshot | File name |
|---|---|---|---|
| 9.1 | **VPC → Your VPCs** | `exam-platform-prod-vpc`, `10.20.0.0/16` | `evidence/09-01-vpc.png` |
| 9.2 | **VPC → Subnets** (filter by the VPC) | **6 subnets**: public, app and data in **two different AZs** (show the *Availability Zone* column) | `evidence/09-02-subnets-2az.png` |
| 9.3 | **VPC → NAT gateways** | 2 NAT gateways, one per AZ | `evidence/09-03-nat-gateways.png` |
| 9.4 | **VPC → Route tables** | public route table (0.0.0.0/0 → igw) and private route tables (→ nat) | `evidence/09-04-route-tables.png` |
| 9.5 | **VPC → Endpoints** | S3 (Gateway) and SQS (Interface) | `evidence/09-05-vpc-endpoints.png` |
| 9.6 | **VPC → Security groups** | lambda-sg, rds-proxy-sg, rds-sg, vpce-sg. Open **rds-sg → Inbound rules** to show 5432 allowed only from the proxy SG | `evidence/09-06-security-groups.png` |
| 9.7 | **RDS → Databases → exam-platform-prod-db**, *Configuration* tab | **Multi-AZ: Yes**, *Availability zone* and *Secondary zone* both shown, **Publicly accessible: No**, **Encryption: Enabled** | `evidence/09-07-rds-multi-az.png` |
| 9.8 | **RDS → Proxies** | `exam-platform-prod-proxy` Available, IAM auth Required, TLS required | `evidence/09-08-rds-proxy.png` |
| 9.9 | **RDS → Databases → db → Maintenance & backups** | Automated backups enabled, 7 days | `evidence/09-09-rds-backups.png` |
| 9.10 | **Lambda → Functions** | the 6 functions (api, admin, marking, upload, notify, migrate) | `evidence/09-10-lambda-functions.png` |
| 9.11 | **Lambda → exam-platform-prod-api → Configuration → VPC** | 2 subnets in 2 AZs | `evidence/09-11-lambda-vpc.png` |
| 9.12 | **API Gateway → exam-platform-prod-api → Routes** | the `/api/...` routes | `evidence/09-12-api-routes.png` |
| 9.13 | **API Gateway → Authorization** | the JWT authorizer using Cognito | `evidence/09-13-api-authorizer.png` |
| 9.14 | **Cognito → User pools → exam-platform-prod-users → Groups** | students, tutors, admins | `evidence/09-14-cognito-groups.png` |
| 9.15 | **CloudFront → Distributions** | the distribution with 2 origins (open it, **Origins** tab) | `evidence/09-15-cloudfront.png` |
| 9.16 | **WAF & Shield → Web ACLs** (switch the region dropdown to **Global (CloudFront)**) | `exam-platform-prod-waf` with 3 rules | `evidence/09-16-waf.png` |
| 9.17 | **S3 → Buckets** | uploads, web, trail buckets (and the tfstate bucket) | `evidence/09-17-s3-buckets.png` |
| 9.18 | **S3 → uploads bucket → Management** | the lifecycle rule `records-retention-5-years` (open it to show the 30 / 180 / 365 / 1825-day transitions) | `evidence/09-18-s3-lifecycle.png` |
| 9.19 | **S3 → uploads bucket → Properties** | Default encryption **SSE-KMS**, Bucket Versioning **Enabled**, Event notification → SQS | `evidence/09-19-s3-encryption-events.png` |
| 9.20 | **SQS → Queues** | 6 queues: marking, uploads, notify, plus 3 `-dlq` | `evidence/09-20-sqs-queues.png` |
| 9.21 | **Amazon EventBridge → Rules** | `exam-platform-prod-auto-submit`, rate(1 minute) | `evidence/09-21-eventbridge.png` |
| 9.22 | **KMS → Customer managed keys** | `alias/exam-platform-prod`, key rotation enabled | `evidence/09-22-kms.png` |
| 9.23 | **Secrets Manager** | the `rds!db-...` secret (managed by RDS) | `evidence/09-23-secrets-manager.png` |
| 9.24 | **CloudWatch → Dashboards → exam-platform-prod** | the dashboard graphs | `evidence/09-24-cloudwatch-dashboard.png` |
| 9.25 | **CloudWatch → Alarms** | the list of alarms (OK or Insufficient data is fine) | `evidence/09-25-cloudwatch-alarms.png` |
| 9.26 | **AWS Backup → Backup plans** | `exam-platform-prod-plan` with *daily* and *monthly-5-years* rules | `evidence/09-26-aws-backup.png` |
| 9.27 | **CloudTrail → Trails** | `exam-platform-prod-trail`, logging on | `evidence/09-27-cloudtrail.png` |
| 9.28 | **SNS → Topics → alarms → Subscriptions** | your email, **Confirmed** | `evidence/09-28-sns-alarm-subscription.png` |

---

## Phase 10 – Run and screenshot the two walkthroughs (⏱ 40 min)

Open the **app URL** from Phase 6. Use a normal browser window for the tutor, and an **Incognito/Private window** for the student, so you can be signed in as both at the same time.

### Walkthrough 1 – Student opens an exam and answers autosave

1. **Tutor window:** sign in as `name+tutor@gmail.com`.
   📸 `evidence/10-01-tutor-dashboard.png`
2. Click **Exams → Create exam**. Enter the title `Cloud Computing Mid-term` and a duration of `30`, and leave the dates empty. Click **Load sample questions**, then **Publish exam**.
   📸 `evidence/10-02-exam-created.png`: the exam listed under "My exams".
3. **Student window (Incognito):** sign in as `name+student@gmail.com`. The exam is on the dashboard. Click **Start exam**, read the instructions box, and click **Start exam** again.
   📸 `evidence/10-03-student-exam-list.png`
4. Answer question 1, choose an option for question 2, and type a sentence for question 3. **Wait about 30 seconds** until the top-right shows **"Saved hh:mm:ss"** in green.
   📸 `evidence/10-04-autosave-saved.png`: the questions, the timer and **"Saved …"** must all be visible.
5. Press **F5** to refresh. The exam reopens with your answers loaded from the database. This shows autosave works.
   📸 `evidence/10-05-answers-restored.png`
6. Optional, shows the request path: press **F12**, open the **Network** tab, and wait for the next autosave. Click the `answers` request: it's a `PUT /api/attempts/.../answers`, Status **200**.
   📸 `evidence/10-06-autosave-network.png`
7. Click **Submit** (top right). The summary shows answered, unanswered and flagged questions. Click **Submit exam**.
8. **Tutor window:** open **Exams** and click the exam. In the **Students** table, the **Auto** column has a score that the marking worker added automatically through SQS.
   📸 `evidence/10-07-auto-marked.png`
9. In **AWS Console → CloudWatch → Log groups → `/aws/lambda/exam-platform-prod-marking`**, open the newest log stream. Look for the line `"event":"marked"`.
   📸 `evidence/10-08-marking-log.png`

### Walkthrough 2 – Student uploads a 40 MB assignment and the tutor is notified

1. **Make a 40 MB test file.** In PowerShell:
   ```powershell
   fsutil file createnew "$HOME\Desktop\assignment-40mb.pdf" 41943040
   ```
   This creates a file exactly 40 MB in size. Any real PDF also works.
2. **Tutor window:** go to **Assignments → New assignment**, enter the title `Assignment 1 – AWS Report`, and click **Create assignment**.
   📸 `evidence/11-01-assignment-created.png`
3. **Student window:** open **Assignments**. **Drag** `assignment-40mb.pdf` onto the upload box, or click the box and choose it. Take the screenshot **while the progress bar is moving**: it shows %, speed and time left.
   📸 `evidence/11-02-upload-progress.png`
   Then wait for the message "Uploaded … Your tutor will be notified."
   📸 `evidence/11-03-upload-done.png`
4. Optional: in the browser's **F12 → Network** tab, the upload request goes to `...s3.amazonaws.com` and **not** to `/api`. This shows the file skipped the API.
   📸 `evidence/11-04-upload-direct-to-s3.png`
5. **AWS Console → S3 → uploads bucket → `assignments/` →** keep clicking into the folders until you reach the file. Open it and check the size (about 40 MB) and **Server-side encryption: SSE-KMS**.
   📸 `evidence/11-05-s3-object-kms.png`
6. **Check your inbox.** The tutor email "New submission: Assignment 1 – AWS Report" arrives within about a minute.
   📸 `evidence/11-06-tutor-email.png`
7. **CloudWatch → Log groups → `/aws/lambda/exam-platform-prod-upload`**: look for the line `"event":"submission_recorded"`.
   📸 `evidence/11-07-upload-lambda-log.png`
8. **Tutor window:** in **Assignments**, click the assignment card. The submission is listed (On time or Late) with a **Download** button. Click it and the file downloads.
   📸 `evidence/11-08-tutor-download.png`

### Results release email (the async email step)

1. **Tutor window:** open the exam and click **Mark** next to the student. Give the short answer a mark (type `5` or click **½**/**Full**), add feedback, and click **Save marks**.
2. Back on the exam page, click **Release results → Release and email students**.
   📸 `evidence/12-01-results-released.png`
3. The student email "Results released: Cloud Computing Mid-term" arrives in your inbox.
   📸 `evidence/12-02-student-result-email.png`
4. **Student window:** refresh. The **Released results** section shows the score.
   📸 `evidence/12-03-student-results.png`
5. **Admin:** sign in as `name+admin@gmail.com` and show the user lists and exam schedules.
   📸 `evidence/12-04-admin-view.png`

---

## Phase 11 – Simulate losing one Availability Zone (⏱ 15 min)

You force the database to fail over from one AZ to the other while the app keeps running.

1. **Before:** in **RDS → Databases → exam-platform-prod-db → Configuration**, note the **Availability zone** (for example `us-east-1a`) and the **Secondary zone** (for example `us-east-1b`).
   📸 `evidence/13-01-before-failover.png`
2. **Student window:** start a new exam, or keep one open, so autosave is running during the test.
3. In **Git Bash**, in the project folder, run:
   ```bash
   bash scripts/az-failover-test.sh
   ```
   The script prints a line every 2 seconds. You will see the database status change to `rebooting` and then back to `available`, while `health=200` continues or recovers within about a minute. At the end it prints the AZs again, now **swapped**.
   📸 `evidence/13-02-failover-terminal-during.png`: taken while the status shows `rebooting`.
   📸 `evidence/13-03-failover-terminal-after.png`: the end of the output, showing the AZ changed and the event "Multi-AZ instance failover completed".
4. **After:** in **RDS → Configuration**, the **Availability zone** and **Secondary zone** have swapped.
   📸 `evidence/13-04-after-failover.png`
5. **RDS → Events** (left menu): look for "Multi-AZ instance failover started" and "...completed".
   📸 `evidence/13-05-rds-events.png`
6. **Student window:** autosave shows **"Saved …"** again. If it briefly said "Offline – saved on this device", that is the safety net doing its job.
   📸 `evidence/13-06-autosave-after-failover.png`
7. Check your inbox: there is an RDS failover notification from SNS.
   📸 `evidence/13-07-failover-email.png`

---

## Phase 12 – Peak load test (optional but strong evidence, ⏱ 10 min)

1. Find the exam ID: as the tutor, open the exam. The ID is the last part of the address bar (`…/#/exams/<THIS-IS-THE-ID>`).
2. Get the client ID from `terraform -chdir=infra output -raw user_pool_client_id`.
3. In Git Bash, run:
   ```bash
   node scripts/load-test.mjs https://dxxxx.cloudfront.net <client_id> us-east-1 name+student@gmail.com 'ExamDemo2026!' <exam_id> 1000 50
   ```
   📸 `evidence/14-01-load-test.png`: the result line (requests per second, status 200 counts, p95 latency).
4. CloudWatch dashboard after the test (requests and Lambda concurrency graphs go up):
   📸 `evidence/14-02-dashboard-after-load.png`

> A new AWS account may only allow about 10 Lambdas running at once, so with a concurrency of 50 you may see some `429`/`503` responses. That is fine to show. Mention that production would raise the limit.

---

## Phase 13 – Prove that "push to main redeploys automatically" (⏱ 30 min)

1. Open `frontend/index.html` and change `<h1>University Exam Platform</h1>` to `<h1>University Exam Platform – v2</h1>`.
2. In PowerShell:
   ```powershell
   git add .
   git commit -m "Change heading to v2 (CI/CD demo)"
   git push
   ```
3. On GitHub, open the **Actions** tab. A new run starts **by itself**, without you clicking anything.
   📸 `evidence/15-01-auto-triggered-run.png`: the run showing the commit message "Change heading to v2".
4. Wait for it to finish (a few minutes this time), then refresh the website. The heading now says **v2**.
   📸 `evidence/15-02-pipeline-success-v2.png`
   📸 `evidence/15-03-site-shows-v2.png`

---

## Phase 14 – Record the video (⏱ 1 hour)

Use the Windows **Snipping Tool**: open it, click the **video camera icon**, then **New** and select the screen. Alternatively use **Xbox Game Bar** (`Win + G`) or OBS Studio. Aim for **6–8 minutes** and talk through what you are doing.

| Time | Show |
|---|---|
| 0:00–0:45 | The GitHub repo, then a push (or the run from Phase 13) and the Actions run going green |
| 0:45–1:15 | Open the CloudFront URL, show the padlock 🔒, and sign in as the tutor |
| 1:15–2:30 | **Frontend + API + DB:** create an exam. As the student, start it, answer, wait for **"Saved"**, refresh to show the answers are restored, then submit |
| 2:30–3:15 | **Async:** the tutor sees the auto MCQ mark. Release results, then show the student email |
| 3:15–4:30 | **S3 upload:** upload the 40 MB PDF with the progress bar, show the object in S3 (SSE-KMS, lifecycle rule), then the tutor email and download |
| 4:30–6:30 | **Two-AZ database:** RDS console showing Multi-AZ Yes and two AZs. Run `az-failover-test.sh`, show the AZ swap and the app still working |
| 6:30–7:30 | CloudWatch dashboard and alarms, and the empty SQS DLQs |

Upload the video to YouTube as **Unlisted**, or to OneDrive with a share link. Paste the link into `evidence/README.md` where it says *Video link*.

📸 `evidence/16-video-uploaded.png`: the video page showing its title.

---

## Phase 15 – Export the diagram as an image (⏱ 10 min)

1. Open `architecture/README.md` and copy everything **between** the line ` ```mermaid ` and the closing ` ``` `.
2. Go to <https://mermaid.live>, delete the example code on the left, and paste yours.
3. Click **Actions → PNG** to download it, and save it as `architecture/architecture.png`.
4. Optionally do the same with **SVG**, saved as `architecture/architecture.svg`.

> If your lecturer prefers icon-style AWS diagrams, open <https://app.diagrams.net>, add the AWS shape libraries, and redraw the same diagram using the Mermaid one as your guide. Export it as `architecture/architecture-aws-icons.png`.

---

## Phase 16 – Cloud Architecture Lab (⏱ 1–2 hours)

This is the lab tool your module provides. Claude can't see it, so build it yourself using the diagram as your map. Work in this order and take a screenshot after each stage:

| Stage | Build | 📸 File |
|---|---|---|
| 1 | Region, VPC `10.20.0.0/16`, **AZ A + AZ B**, in each AZ: public, private-app and private-data subnets | `evidence/lab-01-vpc-subnets.png` |
| 2 | Internet Gateway, **1 NAT Gateway in each public subnet**, route tables | `evidence/lab-02-routing.png` |
| 3 | Route 53 → CloudFront (+ WAF) → S3 frontend bucket | `evidence/lab-03-edge.png` |
| 4 | Cognito; API Gateway; Lambda placed in **both** private-app subnets | `evidence/lab-04-api-compute.png` |
| 5 | RDS Proxy + **RDS PostgreSQL primary in AZ A and standby in AZ B** (private-data subnets) | `evidence/lab-05-database.png` |
| 6 | S3 uploads bucket (lifecycle), SQS queues + DLQs, SES, EventBridge | `evidence/lab-06-storage-async.png` |
| 7 | KMS, Secrets Manager, CloudWatch, SNS, CloudTrail, AWS Backup, CI/CD (GitHub Actions → Terraform) | `evidence/lab-07-security-ops-cicd.png` |
| 8 | **Whole architecture zoomed out** | `evidence/lab-08-full-architecture.png` |

Then run the simulations. Use the lab's "simulate request", "trace" or "run" feature, whatever it is called in your tool:

| Simulation | What to show | 📸 File |
|---|---|---|
| Walkthrough 1 | Student → Route 53 → CloudFront/WAF → API Gateway → Lambda → RDS Proxy → RDS (replicates to standby) | `evidence/lab-sim-1-exam-autosave.png` |
| Walkthrough 2 | Student → API (get URL) → **directly to S3** → SQS → Lambda → RDS → SQS → Lambda → SES → Tutor | `evidence/lab-sim-2-upload-notify.png` |
| AZ failure, before | Everything healthy, primary DB in AZ A | `evidence/lab-sim-3-az-failure-before.png` |
| AZ failure, after | AZ A failed or disabled, standby in AZ B promoted, traffic still flowing through AZ B | `evidence/lab-sim-3-az-failure-after.png` |

If the lab can export or save the design, also save that file in `evidence/` as well.

---

## Phase 17 – Hand in (⏱ 15 min)

1. Check that every screenshot file is in `evidence/`.
2. Push everything:
   ```powershell
   git add .
   git commit -m "Add evidence screenshots, diagram image and video link"
   git push
   ```
   This push also runs the pipeline. That's fine: there are no infrastructure changes, so it finishes quickly.
3. Open your GitHub repo in a browser and check that the README, the diagram and the screenshots all display.
   📸 `evidence/17-final-repo.png`
4. Submit your GitHub repo link.

---

## Phase 18 – Tear down (do this as soon as the video is recorded, ⏱ 20 min) 💰

1. On GitHub, go to **Actions → Tear down → Run workflow**, type `DESTROY`, and click **Run workflow**.
2. Wait for it to turn green (about 15–20 minutes).
   📸 `evidence/18-01-teardown-success.png`: the run showing "Destroy complete! Resources: … destroyed".
3. Check that nothing is left: **RDS → Databases** (empty), **VPC → NAT gateways** (deleted), **CloudFront** (no distribution).
   📸 `evidence/18-02-resources-gone.png`
4. Optional, removes the last small pieces (the state bucket and the deploy role), in PowerShell:
   ```powershell
   aws s3 rm s3://<state_bucket> --recursive
   cd infra\bootstrap
   terraform destroy -var="github_repo=<your-username>/exam-platform-aws" -var="create_oidc_provider=false"
   ```
   If it complains that the bucket is not empty, it is because of old versions. Empty it in the S3 console with **Empty**, then re-run the command.
5. A few days later, check **Billing → Bills** to confirm the charges have stopped.

> To redeploy later, run **Actions → CI/CD → Run workflow**. Everything comes back from code, which is the point of IaC.

---

## Final checklist

- [ ] `README.md`, `architecture/README.md` (+ `architecture.png`) and `docs/services.md` are in the repo
- [ ] Phase 9: 28 console screenshots (full build)
- [ ] Phase 10: walkthrough 1 screenshots, including autosave "Saved"
- [ ] Phase 10: walkthrough 2 screenshots, including the S3 object and tutor email
- [ ] Phase 10: results email screenshot
- [ ] Phase 11: AZ failover screenshots (before and after, terminal, RDS events)
- [ ] Phase 13: auto-triggered pipeline screenshots
- [ ] Phase 16: Cloud Architecture Lab screenshots (8 build + 4 simulation)
- [ ] Video link in `evidence/README.md`
- [ ] Stack torn down (Phase 18)
