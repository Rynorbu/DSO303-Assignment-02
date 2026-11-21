# Evidence

This folder proves the **implementation** part of the assignment. 

- Every AWS screenshot was taken in **US East (N. Virginia), `us-east-1`**.
- The account is on the AWS Free plan – see [README › How the work was done](../README.md#9-how-the-work-was-done).
- Screenshots are grouped in folders that follow the marking rubric.

| Rubric row | Section | Folder |
|---|---|---|
| Implementation – Cloud Architecture Lab | [1. Cloud Architecture Lab](#1-cloud-architecture-lab) | [`1-cloud-architecture-lab/`](1-cloud-architecture-lab) |
| Implementation – AWS deployment | [2. The app working](#2-aws-deployment--the-app-working) · [3. Every component](#3-aws-deployment--every-component-in-the-console) | [`2-aws-app/`](2-aws-app) · [`3-aws-console/`](3-aws-console) |
| Implementation – IaC and CI/CD | [4. IaC and CI/CD](#4-infrastructure-as-code-and-cicd) | [`4-iac-cicd/`](4-iac-cicd) |
| Supporting | [5. Local run](#5-local-run-supporting) | [`5-local-run/`](5-local-run) |

---

## 1. Cloud Architecture Lab

The full production architecture was built in the Cloud Architecture Lab, then both walkthroughs and the loss of one Availability Zone were simulated. The lab files can be imported again from [`../architecture/lab`](../architecture/lab).

### 1.1 The full build

**Final full architecture (with DNS)**

The final build, exported from the lab: Route 53 and the ACM certificate in the edge layer, then CloudFront and WAF, the VPC across **us-east-1a and us-east-1b**, the regional services on the right and the CI/CD pipeline at the bottom.

![Final full architecture (with DNS)](1-cloud-architecture-lab/full-architecture-final.png)

**Full architecture (light view)**

Everything in one view: the VPC `10.20.0.0/16` with public, private app and private data subnets in **us-east-1a and us-east-1b**, the edge layer on the left, regional services on the right and the CI/CD pipeline at the bottom.

![Full architecture (light view)](1-cloud-architecture-lab/full-architecture.png)

**Edge layer and sign-in**

Users reach **CloudFront**, protected by **WAF**. CloudFront serves the website from the private **S3** bucket and sends `/api/*` to **API Gateway**, which checks the **Cognito** token. The admin Lambda handles `/api/admin/*`.

![Edge layer and sign-in](1-cloud-architecture-lab/edge-layer.png)

**Network across two Availability Zones**

Each AZ has a public subnet (NAT gateway), a private app subnet (Lambdas and the SQS endpoint) and a private data subnet (RDS). The **RDS primary is in 1a and the standby in 1b**. The red boxes are the security groups `lambda-sg`, `vpce-sg` and `rds-sg`.

![Network across two Availability Zones](1-cloud-architecture-lab/network-two-azs.png)

**Routing**

The internet gateway, the public route table, **one private route table per AZ pointing to its own NAT gateway**, and the S3 gateway endpoint.

![Routing](1-cloud-architecture-lab/routing.png)

**Storage, async processing, security and operations**

The uploads bucket, the uploads / marking / notify queues and their dead-letter queues, the notify Lambda and SES, EventBridge auto-submit, KMS, the RDS secret, AWS Backup, CloudWatch with SNS alarms, and CloudTrail.

![Storage, async processing, security and operations](1-cloud-architecture-lab/storage-async-ops.png)

### 1.2 Walkthrough 1 – a student opens an exam and answers autosave

**Request path**

The blue path: student → CloudFront → API Gateway → api Lambda in AZ A → RDS primary.

![Request path](1-cloud-architecture-lab/wt1-exam-autosave.png)

**Steps 1 to 4**

The request leaves the browser, passes CloudFront (cache miss for `/api/*`) and reaches API Gateway.

![Steps 1 to 4](1-cloud-architecture-lab/wt1-timeline-1.png)

**Steps 5 to 8**

`lambda-sg` allows the call, API Gateway routes it to the api Lambda, and `rds-sg` allows the SQL connection.

![Steps 5 to 8](1-cloud-architecture-lab/wt1-timeline-2.png)

**Steps 8 to 11**

The Lambda sends the query, the RDS primary commits it, and the response returns. **Result: HTTP 200 in 138 ms, all 11 steps OK.**

![Steps 8 to 11](1-cloud-architecture-lab/wt1-timeline-3.png)

### 1.3 Walkthrough 2 – a student uploads a 40 MB assignment and the tutor is notified

**Request path**

The blue path: the browser uploads **straight to the S3 uploads bucket**, S3 sends an event to the SQS uploads queue, and the worker Lambdas pick it up.

![Request path](1-cloud-architecture-lab/wt2-upload-notify.png)

**Steps 1 to 4**

The file goes to S3 (not through the API), S3 sends the message to SQS, and the Lambda event source mapping polls the queue.

![Steps 1 to 4](1-cloud-architecture-lab/wt2-timeline-1.png)

**Steps 5 to 8**

The worker Lambdas in **AZ A and AZ B** receive the message. **Result: HTTP 202 Accepted, all 8 steps OK.** The next hop is notify queue → notify Lambda → SES email to the tutor.

![Steps 5 to 8](1-cloud-architecture-lab/wt2-timeline-2.png)

### 1.4 Loss of Availability Zone us-east-1a

**us-east-1a marked as failed**

The api Lambda, worker Lambda, NAT gateway, SQS endpoint and **RDS primary in us-east-1a** are failed (red dots). The request is now routed to AZ B.

![us-east-1a marked as failed](1-cloud-architecture-lab/az-failure.png)

**Steps 1 to 4**

The autosave `PUT /api/attempts/{id}/answers` enters through CloudFront and API Gateway as normal.

![Steps 1 to 4](1-cloud-architecture-lab/az-failure-timeline-1.png)

**Steps 5 to 8**

API Gateway sends the request to the **api Lambda in AZ B**, and the timeline shows **"Multi-AZ Automated Database Failover"**. **Result: HTTP 200** – the student keeps working while one AZ is down.

![Steps 5 to 8](1-cloud-architecture-lab/az-failure-timeline-2.png)

---

## 2. AWS deployment – the app working

The rubric asks for the **frontend, API, two-AZ database, S3 uploads and the async step** working on AWS. Every one is shown here.

### 2.1 Frontend and sign-in

**Demo users created**

`scripts/seed-users.sh` created an admin, a tutor and a student in Cognito, and all email identities show as verified in SES.

![Demo users created](2-aws-app/users-created.png)

**Login page on CloudFront**

The app is served over **HTTPS from the CloudFront URL**. The page files come from the private S3 bucket.

![Login page on CloudFront](2-aws-app/app-login-page.png)

**Tutor dashboard**

After signing in, a user in the `tutors` group sees the tutor view – role-based access from the Cognito group.

![Tutor dashboard](2-aws-app/tutor-dashboard.png)

**API health check**

`GET /api/health` answers through CloudFront → API Gateway → Lambda.

![API health check](2-aws-app/api-health.png)

### 2.2 Exam and 30-second autosave

**Tutor creates an exam**

The tutor created *Cloud Computing Mid-term* (4 questions, 12 marks) – served from the CloudFront URL.

![Tutor creates an exam](2-aws-app/exam-created.png)

**Student sees the exam**

The student signs in and sees the exam that is open.

![Student sees the exam](2-aws-app/student-exam-list.png)

**Answers autosaved**

While the student answers, the screen shows **"Saved hh:mm:ss"** – the answers are sent to the API every 30 seconds and stored in RDS.

![Answers autosaved](2-aws-app/autosave-saved.png)

### 2.3 Two-AZ database – a real forced failover

**Before the failover – configuration**

**Multi-AZ: Yes**, with the standby (secondary zone) in **us-east-1a**.

![Before the failover – configuration](2-aws-app/before-failover.png)

**Before the failover – replication**

The primary instance is running in **us-east-1b**.

![Before the failover – replication](2-aws-app/before-failover-a.png)

**Failover running**

`scripts/az-failover-test.sh` reboots the database with `--force-failover` and calls `/api/health` every 2 seconds.

![Failover running](2-aws-app/failover-terminal-during.png)

**Failover finished**

Only **2 health checks failed** during the switch; the API answered HTTP 200 again and the database was available after **61 seconds**. The RDS events at the bottom show *failover started* and *failover completed*.

![Failover finished](2-aws-app/failover-terminal-after.png)

**After the failover – replication**

The primary instance is now in **us-east-1a** – the AZs have swapped.

![After the failover – replication](2-aws-app/after-failover.png)

**After the failover – configuration**

The standby (secondary zone) is now in **us-east-1b**.

![After the failover – configuration](2-aws-app/after-failover-a.png)

**RDS events**

RDS recorded *Multi-AZ instance failover started*, *DB instance restarted* and *Multi-AZ instance failover completed*.

![RDS events](2-aws-app/rds-events.png)

**Failover email to the team**

The RDS event subscription emailed the team through **SNS**: *Multi-AZ instance failover started*.

![Failover email to the team](2-aws-app/failover-alarm-email.png)

### 2.4 S3 uploads

**Tutor creates an assignment**

The tutor created *Assignment 1 – AWS Report*, open for uploads.

![Tutor creates an assignment](2-aws-app/assignment-created.png)

**Upload in progress**

The student uploads a large file with a progress bar.

![Upload in progress](2-aws-app/upload-progress.png)

**Upload goes straight to S3**

The browser network tab shows the file going to `…s3.amazonaws.com` with a **presigned POST** – not through API Gateway or Lambda.

![Upload goes straight to S3](2-aws-app/upload-direct-to-s3.png)

**Upload finished**

The student’s file `Lab-07.pdf` shows as **Submitted**; the network tab shows the upload-url call and the POST to S3.

![Upload finished](2-aws-app/upload-done.png)

**Stored file is encrypted**

The object in the uploads bucket is encrypted with **SSE-KMS** using the project key.

![Stored file is encrypted](2-aws-app/s3-object-kms.png)

### 2.5 Async step – SQS → Lambda → SES

**Upload Lambda log**

The upload Lambda logged `submission_recorded` with the S3 key and file size – the S3 event came through the uploads queue.

![Upload Lambda log](2-aws-app/upload-lambda-log.png)

**Notify Lambda log**

The notify Lambda logged `email_sent` with the subject *New submission: Assignment 1 – AWS Report*.

![Notify Lambda log](2-aws-app/notify-lambda-log.png)

**Tutor receives the email**

The tutor gets the **"new submission"** email.

![Tutor receives the email](2-aws-app/tutor-email.png)

**MCQs auto-marked**

After submit, a message goes to the SQS marking queue and the marking Lambda scores the MCQs automatically.

![MCQs auto-marked](2-aws-app/auto-marked.png)

**Marking Lambda log**

The marking Lambda logged `marked` with the attempt ID and the MCQ score.

![Marking Lambda log](2-aws-app/marking-log.png)

**Marking queue metrics**

SQS metrics show messages sent and received on the marking queue.

![Marking queue metrics](2-aws-app/sqs-marking-monitoring.png)

**Tutor marks short answers**

The MCQs were auto-marked (6 / 6); the tutor marks the short answer by hand. Total 67 %.

![Tutor marks short answers](2-aws-app/manual-marking.png)

**Exam after marking**

The exam list shows 1 of 1 submitted with an average of 66.7 %. Releasing results queues an email to each student.

![Exam after marking](2-aws-app/results-released.png)

### 2.6 Peak load test and monitoring

**Load test**

`scripts/load-test.mjs` sent **1,000 autosaves, 50 at a time**, at **55.8 requests per second**. 963 reached Lambda and the database and returned 409 *"attempt is closed"* (the test student had already submitted, so the app correctly refused the change). 37 (3.7 %) were throttled with 503 by the new account’s **limit of 10 Lambdas at once** – the only bottleneck found.

![Load test](2-aws-app/load-test.png)

**CloudWatch alarm during the load test**

The **api-throttles** alarm fired and emailed the team during the test. Monitoring caught the quota limit, which is why the design raises Lambda concurrency and switches on RDS Proxy before exam week.

![CloudWatch alarm during the load test](2-aws-app/cloudwatch-alarm-email.png)

---

## 3. AWS deployment – every component in the Console

One screenshot per AWS component, grouped by tier.

### 3.1 Network

**VPC**

`exam-platform-prod-vpc` with CIDR `10.20.0.0/16`.

![VPC](3-aws-console/vpc.png)

**Six subnets in two AZs**

Public, private app and private data subnets in **us-east-1a and us-east-1b**.

![Six subnets in two AZs](3-aws-console/subnets-2az.png)

**Subnet in us-east-1b**

Details of a subnet in the second Availability Zone.

![Subnet in us-east-1b](3-aws-console/subnet-us-east-1b.png)

**NAT gateways**

**One NAT gateway per AZ**, each in its own public subnet.

![NAT gateways](3-aws-console/nat-gateways.png)

**Public route table**

Public subnets send `0.0.0.0/0` to the internet gateway.

![Public route table](3-aws-console/route-public.png)

**Private route table**

Each private route table sends internet traffic to the NAT gateway in its own AZ, plus the S3 gateway endpoint route.

![Private route table](3-aws-console/route-private.png)

**S3 gateway endpoint**

Lambdas reach S3 privately, without the internet.

![S3 gateway endpoint](3-aws-console/s3-gateway-endpoint.png)

**SQS interface endpoint**

An SQS endpoint in both app subnets with private DNS.

![SQS interface endpoint](3-aws-console/sqs-interface-endpoint.png)

**Security groups**

`lambda-sg`, `rds-sg`, `vpce-sg` and the RDS Proxy group.

![Security groups](3-aws-console/security-groups.png)

**Database security group**

PostgreSQL 5432 is allowed **only from the Lambda security group** – nothing from the internet.

![Database security group](3-aws-console/rds-sg-inbound.png)

### 3.2 Database

**RDS database**

`exam-platform-prod-db`, PostgreSQL 16, available.

![RDS database](3-aws-console/rds-database.png)

**Multi-AZ configuration**

**Multi-AZ: Yes** – a synchronous standby in the second AZ.

![Multi-AZ configuration](3-aws-console/database-configuration.png)

**Not publicly accessible**

The database has **no public access** and sits in the private data subnets.

![Not publicly accessible](3-aws-console/rds-private.png)

**Connectivity**

Endpoint, port 5432, VPC, subnet group and security group.

![Connectivity](3-aws-console/db-connection.png)

**Automated backups**

Automated backups with point-in-time restore, encrypted with the KMS key.

![Automated backups](3-aws-console/rds-backups.png)

**Secrets Manager**

The RDS-managed master password, encrypted with KMS. The value was never shown.

![Secrets Manager](3-aws-console/secrets-manager.png)

### 3.3 Compute and API

**Lambda functions**

The six functions: api, admin, marking, upload, notify and migrate (Node.js 22, arm64).

![Lambda functions](3-aws-console/lambda-functions.png)

**Lambda inside the VPC**

The api Lambda runs in **two private subnets in two AZs** with `lambda-sg`.

![Lambda inside the VPC](3-aws-console/lambda-vpc.png)

**Lambda monitoring**

Invocations, duration and errors for the api Lambda.

![Lambda monitoring](3-aws-console/lambda-monitor.png)

**API Gateway routes**

The HTTP API routes for exams, attempts, autosave, results, assignments and admin.

![API Gateway routes](3-aws-console/api-routes.png)

**JWT authorizer**

API Gateway checks the **Cognito JWT** before any Lambda runs.

![JWT authorizer](3-aws-console/api-authorizer.png)

**Cognito groups**

The user pool has three groups: `students`, `tutors` and `admins`.

![Cognito groups](3-aws-console/cognito-groups.png)

### 3.4 Edge

**CloudFront origins**

Two origins: the S3 website bucket (with Origin Access Control) and API Gateway.

![CloudFront origins](3-aws-console/cloudfront-origins.png)

**CloudFront behaviours**

`/api/*` goes to API Gateway with caching off; everything else is served from S3 and cached.

![CloudFront behaviours](3-aws-console/cloudfront-behaviours.png)

**WAF rules**

AWS managed common rules, known bad inputs, and a rate limit per IP.

![WAF rules](3-aws-console/waf-rules.png)

### 3.5 Storage and async processing

**S3 buckets**

The website, uploads and CloudTrail buckets, plus the Terraform state bucket.

![S3 buckets](3-aws-console/s3-buckets.png)

**Uploads bucket properties**

Versioning on and default encryption with the KMS key.

![Uploads bucket properties](3-aws-console/s3-properties.png)

**Uploads bucket permissions**

All public access blocked; the bucket policy denies non-TLS requests.

![Uploads bucket permissions](3-aws-console/s3-permissions.png)

**Lifecycle rules – 5 years**

Standard-IA after 30 days → Glacier Instant Retrieval after 180 → Deep Archive after 365 → **deleted after 5 years**.

![Lifecycle rules – 5 years](3-aws-console/s3-lifecycle.png)

**S3 event notification**

New uploads under `assignments/` send an event to the SQS uploads queue.

![S3 event notification](3-aws-console/s3-events.png)

**SQS queues**

The marking, uploads and notify queues and their dead-letter queues.

![SQS queues](3-aws-console/sqs-queues.png)

**Dead-letter queues**

After 5 failed attempts a message moves to its DLQ, so nothing is lost.

![Dead-letter queues](3-aws-console/sqs-dead-letter-queues.png)

**SQS → Lambda trigger**

The event source mapping that lets a Lambda read from its queue.

![SQS → Lambda trigger](3-aws-console/sqs-trigger.png)

**EventBridge schedule**

A `rate(1 minute)` rule that runs the auto-submit job.

![EventBridge schedule](3-aws-console/eventbridge.png)

**SES identities verified**

The sender and test recipients are verified, so SES can send emails.

![SES identities verified](3-aws-console/ses-verified.png)

### 3.6 Security and operations

**KMS key**

`alias/exam-platform-prod`, a customer-managed key with yearly rotation.

![KMS key](3-aws-console/kms.png)

**IAM roles**

One least-privilege role per Lambda, plus the GitHub deploy role.

![IAM roles](3-aws-console/iam-roles.png)

**GitHub OIDC provider**

GitHub Actions signs in to AWS with OIDC – **no access keys stored in GitHub**.

![GitHub OIDC provider](3-aws-console/iam-oidc.png)

**IAM user**

The IAM user used for the assignment.

![IAM user](3-aws-console/iam-user.png)

**CloudWatch dashboard**

API requests, latency, Lambda concurrency, queue depth, RDS and WAF on one page.

![CloudWatch dashboard](3-aws-console/cloudwatch-dashboard.png)

**CloudWatch alarms**

Alarms for API errors and latency, Lambda errors and throttles, DLQ messages and RDS CPU and storage.

![CloudWatch alarms](3-aws-console/cloudwatch-alarms.png)

**SNS alarm topic**

Alarms are sent to the team by email through SNS.

![SNS alarm topic](3-aws-console/sns-alarm-subscription.png)

**SNS subscription confirmed**

The alarm email address confirmed the subscription.

![SNS subscription confirmed](3-aws-console/subscription-confirmed.png)

**CloudTrail**

Every API call is logged for audit.

![CloudTrail](3-aws-console/cloudtrail.png)

**AWS Backup**

Backup vault and plan: daily backups for 35 days, monthly backups kept for 5 years.

![AWS Backup](3-aws-console/aws-backup.png)

**All resources tagged**

Tag Editor lists every resource of the project, all created by Terraform.

![All resources tagged](3-aws-console/tag-editor.png)

---

## 4. Infrastructure as code and CI/CD

The whole stack is built from Terraform in [`../infra`](../infra), and every push to `main` redeploys it through GitHub Actions ([`deploy.yml`](../.github/workflows/deploy.yml)).

### 4.1 Terraform

**AWS CLI connected**

`aws sts get-caller-identity` confirms the account and user before deploying.

![AWS CLI connected](4-iac-cicd/aws-cli-connected.png)

**Bootstrap apply**

The one-time bootstrap creates the Terraform state bucket and the GitHub OIDC deploy role.

![Bootstrap apply](4-iac-cicd/bootstrap-apply.png)

**Bootstrap outputs**

The outputs `deploy_role_arn` and `state_bucket` are copied into the GitHub variables.

![Bootstrap outputs](4-iac-cicd/bootstrap-outputs.png)

**Terraform init**

Terraform connects to the remote S3 backend.

![Terraform init](4-iac-cicd/terraform-init.png)

**Remote state in S3**

The state file is stored in the versioned, encrypted S3 bucket.

![Remote state in S3](4-iac-cicd/terraform-backend.png)

**Stack outputs**

After the deploy: the app URL, API endpoint, **both AZs**, the database, Cognito IDs, and `migration_result` showing the tables were created.

![Stack outputs](4-iac-cicd/terraform-output.png)

### 4.2 Push to main redeploys automatically

**GitHub repository variables**

The settings the pipeline reads: deploy role, state bucket, region and email addresses. No secrets or keys are stored.

![GitHub repository variables](4-iac-cicd/github-variables.png)

**Pipeline triggered by a push to main**

A push to `main` started the **CI/CD** workflow automatically.

![Pipeline triggered by a push to main](4-iac-cicd/pipeline-push-to-main.png)

**Every deploy step green**

Tests → OIDC sign-in → Terraform fmt, init, validate, plan → **apply** → CloudFront invalidation → smoke test.

![Every deploy step green](4-iac-cicd/pipeline-steps.png)

**Terraform plan and apply in GitHub Actions**

The plan output and the apply creating resources, all inside the pipeline.

![Terraform plan and apply in GitHub Actions](4-iac-cicd/terraform-apply-log.png)

### 4.3 Tear down

**Tear down workflow succeeded**

The *Tear down* workflow ran `terraform destroy` and finished successfully.

![Tear down workflow succeeded](4-iac-cicd/teardown-success.png)

**No project NAT gateways left**

No `exam-platform-prod` NAT gateways remain. The `yonten-*` gateways belong to another student in the shared class account.

![No project NAT gateways left](4-iac-cicd/teardown-check-nat.png)

**No project database left**

No `exam-platform-prod` database remains. The `yonten-db` instance belongs to another student.

![No project database left](4-iac-cicd/teardown-check-rds.png)

---

## 5. Local run (supporting)

The same Lambda code also runs on a laptop with PostgreSQL in Docker. This was used to build and test before deploying.

**Docker Compose**

`docker compose up -d` creates the network, the data volume and the PostgreSQL container.

![Docker Compose](5-local-run/docker-compose.png)

**Container running**

Docker Desktop shows the `exam-platform-db` PostgreSQL container on port 55432.

![Container running](5-local-run/docker-ps.png)

**Unit tests pass**

`npm test` – **6 of 6 tests pass**: exam validation, MCQ checks, hiding correct answers, auto-marking, Cognito group parsing and upload keys.

![Unit tests pass](5-local-run/unit-tests.png)

**Local server running**

`npm run local` serves the app on `http://localhost:3000`.

![Local server running](5-local-run/local-service-running.png)

**Local login page**

In local mode there is no Cognito, so the role (student, tutor or admin) is chosen on the login page.

![Local login page](5-local-run/login-page.png)

**Tutor dashboard**

The tutor view running locally.

![Tutor dashboard](5-local-run/tutor-dashboard.png)

**Exam created**

The tutor builds the *Mid term* exam with MCQ and short-answer questions.

![Exam created](5-local-run/local-tutor-exam-created.png)

**Student dashboard**

The student sees the open exam.

![Student dashboard](5-local-run/student-dashboard.png)

**Student taking the exam**

The timed exam with the countdown clock.

![Student taking the exam](5-local-run/student-taking-exam.png)

**Autosave**

The header shows **"Saved 11:32 AM"** – answers are saved every 30 seconds.

![Autosave](5-local-run/auto-save.png)

**Exam submitted**

The exam appears under *Completed* as **Submitted**.

![Exam submitted](5-local-run/exam-done.png)

**Marking**

MCQs are marked automatically (4 / 6); the tutor marks the short answer.

![Marking](5-local-run/marking.png)

**Assignment created**

The tutor’s *LAB 3* assignment, waiting for submissions.

![Assignment created](5-local-run/assignment-created.png)

**Assignment submitted**

The student uploaded a PDF and it shows as **Submitted**.

![Assignment submitted](5-local-run/assignment-submitted.png)

**Tables and indexes**

The schema in PostgreSQL: the four tables and their indexes.

![Tables and indexes](5-local-run/data.png)

**Tables and exams**

Row counts for each table, and the two exams created by the tutor.

![Tables and exams](5-local-run/database-local.png)

**Submission row**

The uploaded file is recorded with its storage key and size.

![Submission row](5-local-run/database-local-exam.png)

**Questions and scores**

The questions with their correct answers and marks, and each attempt’s score.

![Questions and scores](5-local-run/database-questions.png)

**Attempts**

Each attempt’s status (*marked* / *awaiting_manual*), scores and `last_saved_at` from autosave.

![Attempts](5-local-run/database-row.png)
