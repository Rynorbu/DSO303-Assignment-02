# Phase 9 – AWS Console screenshots, click by click

Follow this **from top to bottom**. It is grouped by service, so you open each service only once.
Every resource Terraform creates starts with **`exam-platform-prod`**.

---

## Before you start (5 min)

1. Sign in at <https://console.aws.amazon.com>.
2. **Check the region** in the top-right corner, to the left of your account name. It must say **N. Virginia** (`us-east-1`). If not, click it and choose **US East (N. Virginia)**.
3. **To open any service**, click the **search bar** at the very top of the page, type the service name (for example `VPC`), and click the result under **Services**.
4. **Screenshot:** press **`Win + Shift + S`**, drag a box around the area, click the notification, and **Save as** a PNG in your project's `evidence` folder with the exact name given.
5. **Tips for clean screenshots:**
   - If a table is cut off, zoom the browser out with **`Ctrl` + `-`** (80–90% works well). Zoom back with **`Ctrl` + `0`**.
   - Close any blue "info" side panels (the **X** at their top).
   - Many lists have a **search/filter box**. Type `exam-platform` there so only your resources show.
   - Some tables hide columns. Click the **⚙ gear icon** (Preferences) at the table's top-right, switch on the column you need, and click **Confirm**.
6. ⚠️ **Never screenshot a password, secret value or access key.** The steps below warn you where.

> Tick each box as you go: `- [x]`.

---

## Part A – Networking (VPC) · 6 screenshots

Open the service: search **`VPC`** and click **VPC**.

### - [ ] 9.1 The VPC → `evidence/09-01-vpc.png`
1. In the left menu, under **Virtual private cloud**, click **Your VPCs**.
2. Find the row **`exam-platform-prod-vpc`**.
3. Make sure the **IPv4 CIDR** column shows **`10.20.0.0/16`** and **State** is **Available**.
4. 📸 Take the screenshot of the table with that row visible.

### - [ ] 9.2 Six subnets in two AZs → `evidence/09-02-subnets-2az.png`
1. Left menu, click **Subnets**.
2. Type **`exam-platform-prod`** in the filter box above the table and press Enter.
3. You should see **6 subnets**:
   - `exam-platform-prod-public-us-east-1a` and `…-public-us-east-1b`
   - `exam-platform-prod-app-us-east-1a` and `…-app-us-east-1b`
   - `exam-platform-prod-data-us-east-1a` and `…-data-us-east-1b`
4. Make sure the **Availability Zone** and **IPv4 CIDR** columns are visible. If not, use the ⚙ gear icon to switch them on.
5. 📸 The screenshot must show the names and **two different AZs** (`us-east-1a` and `us-east-1b`).

### - [ ] 9.3 NAT gateways → `evidence/09-03-nat-gateways.png`
1. Left menu, click **NAT gateways**.
2. You should see **2 rows**, `exam-platform-prod-nat-us-east-1a` and `exam-platform-prod-nat-us-east-1b`, both with **State: Available**.
3. 📸 Include the **Subnet** column, which shows each NAT sits in a different public subnet.

> If you set `nat_gateway_count = 0` to save money, this list is empty. Skip this screenshot and mention it in your report.

### - [ ] 9.4 Route tables → `evidence/09-04a-route-public.png` and `evidence/09-04b-route-private.png`
1. Left menu, click **Route tables**, and filter with `exam-platform-prod`. There are 3: one public and two private.
2. **Tick** the row **`exam-platform-prod-public-rt`**. A details panel opens at the **bottom** of the page.
3. Click the **Routes** tab in that bottom panel. You'll see **`0.0.0.0/0` → `igw-…`** (the Internet Gateway).
4. 📸 Save as `09-04a-route-public.png`.
5. Untick it, then tick **`exam-platform-prod-private-rt-us-east-1a`** and open the **Routes** tab again. You'll see **`0.0.0.0/0` → `nat-…`**, plus a `pl-…` route (the free S3 gateway endpoint).
6. 📸 Save as `09-04b-route-private.png`.

### - [ ] 9.5 VPC endpoints → `evidence/09-05-vpc-endpoints.png`
1. Left menu, click **Endpoints**. It's under **PrivateLink and Lattice** in newer consoles.
2. Filter with `exam-platform-prod`. You should see:
   - `exam-platform-prod-s3-gw`, type **Gateway**, service `com.amazonaws.us-east-1.s3`
   - `exam-platform-prod-sqs-vpce`, type **Interface**, service `com.amazonaws.us-east-1.sqs`
3. 📸 Make sure the **VPC endpoint type** and **Service name** columns are visible.

### - [ ] 9.6 Security groups → `evidence/09-06a-security-groups.png` and `evidence/09-06b-rds-sg-inbound.png`
1. Left menu, under **Security**, click **Security groups**, and filter with `exam-platform-prod`.
2. You'll see 4 groups: **lambda-sg**, **rds-proxy-sg**, **rds-sg**, **vpce-sg**.
3. 📸 Save the list as `09-06a-security-groups.png`.
4. Tick **`exam-platform-prod-rds-sg`** and click the **Inbound rules** tab at the bottom.
5. The single rule should be **Type PostgreSQL, Port 5432**, with **Source** set to `sg-…` (the **rds-proxy-sg**), **not** `0.0.0.0/0`. This proves the database is private.
6. 📸 Save as `09-06b-rds-sg-inbound.png`.

---

## Part B – Database (RDS) · 3–5 screenshots

Open the service: search **`RDS`** and click **Aurora and RDS** (or **RDS**).

### - [ ] 9.7 Multi-AZ database → `evidence/09-07a-rds-multi-az.png` and `evidence/09-07b-rds-private.png`
1. Left menu, click **Databases**, then click the name **`exam-platform-prod-db`** (the blue link).
2. In the **Summary** box at the top, check that **Status** is **Available**, **Engine** is PostgreSQL, and **Region & AZ** shows e.g. `us-east-1a`.
3. Click the **Configuration** tab (the row of tabs under the summary). Look for:
   - **Multi-AZ: Yes**
   - **Secondary Zone:** e.g. `us-east-1b` (a **different** AZ from the summary)
   - **Encryption: Enabled**, with an **AWS KMS key**
   - **Engine version:** 16.x
4. 📸 Capture the summary plus the Configuration section with those lines → `09-07a-rds-multi-az.png`.
5. Click the **Connectivity & security** tab. Look for:
   - **Publicly accessible: No**
   - **VPC:** `exam-platform-prod-vpc`
   - **Subnets:** the two **data** subnets
   - **VPC security groups:** `exam-platform-prod-rds-sg`
6. 📸 Save as `09-07b-rds-private.png`.

> 📝 **Write down the AZ in the summary now** (for example `us-east-1a`). You'll compare it after the failover test in Phase 11.

### - [ ] 9.8 RDS Proxy → `evidence/09-08-rds-proxy.png`
1. Left menu, click **Proxies**, then click **`exam-platform-prod-proxy`**.
2. Check these details:
   - **Status: Available**, **Engine family: PostgreSQL**
   - **Require Transport Layer Security: Yes / Enabled**
   - Under **Authentication**: **IAM authentication: Required**
   - Scroll to **Target groups**: the target `exam-platform-prod-db` should show state **Available**
3. 📸 Capture it. Take two screenshots (`09-08a`, `09-08b`) if it doesn't fit in one.

### - [ ] 9.9 Backups (RPO evidence) → `evidence/09-09-rds-backups.png`
1. Go back to **Databases → `exam-platform-prod-db`** and open the **Maintenance & backups** tab.
2. Check these details:
   - **Automated backups: Enabled (7 Days)**
   - **Latest restore time:** a time **within the last ~5 minutes**. This is your **RPO evidence**: the database can be restored to that point.
3. 📸 Capture it.

---

## Part C – Compute (Lambda) · 2–3 screenshots

Open the service: search **`Lambda`** and click **Lambda**.

### - [ ] 9.10 The six functions → `evidence/09-10-lambda-functions.png`
1. Left menu, click **Functions**, then type `exam-platform-prod` in the search box.
2. You should see **6 functions**: `-api`, `-admin`, `-marking`, `-upload`, `-notify`, `-migrate`. **Runtime** should be **Node.js 22.x**.
3. 📸 Capture it.

### - [ ] 9.11 Lambda in two AZs → `evidence/09-11-lambda-vpc.png`
1. Click **`exam-platform-prod-api`**.
2. Click the **Configuration** tab (below the function diagram), then **VPC** in its left-side list.
3. You'll see the **VPC** `exam-platform-prod-vpc`, **2 subnets** (the two **app** subnets, `us-east-1a` and `us-east-1b`), and the **security group** `exam-platform-prod-lambda-sg`.
4. 📸 Capture it.

**Optional extra:** still in the api function, click the **Monitor** tab and scroll to the graphs (Invocations, Duration). Take the screenshot after you've used the app → `09-11b-lambda-monitor.png`.

---

## Part D – API Gateway · 2 screenshots

Open the service: search **`API Gateway`**.

### - [ ] 9.12 Routes → `evidence/09-12-api-routes.png`
1. In the **APIs** list, click **`exam-platform-prod-api`** (Protocol: **HTTP**).
2. Left menu, click **Routes**. You'll see the tree of `/api/...` routes, e.g. `GET /api/exams`, `PUT /api/attempts/{id}/answers`, `POST /api/assignments/{id}/upload-url`.
3. 📸 Expand a few branches by clicking them so the methods show, then capture it.

### - [ ] 9.13 JWT authorizer (Cognito) → `evidence/09-13-api-authorizer.png`
1. Left menu, click **Authorization**, then the **Manage authorizers** tab.
2. Click the authorizer **`cognito`**. You'll see **Type: JWT**, an **Issuer URL** ending in your user pool ID (`https://cognito-idp.us-east-1.amazonaws.com/us-east-1_…`), and **Audience** (the app client ID).
3. 📸 Capture it.

**Optional:** left menu **Throttling** (under **Protect**) shows burst **5000** and rate **2000** → `09-13b-api-throttling.png`. This is peak-load evidence.

---

## Part E – Authentication (Cognito) · 1–2 screenshots

Open the service: search **`Cognito`**.

### - [ ] 9.14 User pool groups → `evidence/09-14-cognito-groups.png`
1. Click **User pools**, then **`exam-platform-prod-users`**.
2. Left menu, under **User management**, click **Groups**. You'll see **admins**, **students** and **tutors**.
3. 📸 Capture it.

**Optional:** **Users** in the same menu shows the 3 test users you created → `09-14b-cognito-users.png`.

---

## Part F – Edge (CloudFront and WAF) · 3 screenshots

### - [ ] 9.15 CloudFront distribution → `evidence/09-15a-cloudfront.png` and `evidence/09-15b-cloudfront-behaviors.png`
1. Search **`CloudFront`**, then click **Distributions** in the left menu.
2. Click the **ID** of the row whose description is **`exam-platform-prod frontend + API`**.
3. On the **General** tab, note the **Distribution domain name** (`d….cloudfront.net`, your app URL) and that **AWS WAF** shows as enabled/attached under Security.
4. Click the **Origins** tab. You'll see **2 origins**: `…-web-….s3.us-east-1.amazonaws.com` (the website) and `….execute-api.us-east-1.amazonaws.com` (the API).
5. 📸 Save as `09-15a-cloudfront.png`.
6. Click the **Behaviors** tab: **`/api/*`** goes to the **api** origin, and **Default (*)** goes to the **frontend** origin.
7. 📸 Save as `09-15b-cloudfront-behaviors.png`.

### - [ ] 9.16 WAF → `evidence/09-16-waf.png`
1. Search **`WAF`** and click **WAF & Shield**.
2. In the left menu, click **Web ACLs**. Newer consoles call it **Protection packs (web ACLs)**.
3. ⚠️ At the top of the list there's a **region dropdown**. Change it to **Global (CloudFront)**, because CloudFront web ACLs only appear there.
4. Click **`exam-platform-prod-waf`**.
5. Open the **Rules** tab. You'll see **3 rules**: `AWSCommonRules`, `AWSKnownBadInputs`, `RateLimitPerIp`.
6. 📸 Capture it.

**Optional:** the **Associated AWS resources** tab shows the CloudFront distribution → `09-16b-waf-association.png`.

---

## Part G – File storage (S3) · 3–4 screenshots

Open the service: search **`S3`**.

### - [ ] 9.17 Buckets → `evidence/09-17-s3-buckets.png`
1. In **General purpose buckets**, type `exam-platform` in the search box.
2. You'll see:
   - `exam-platform-prod-uploads-<account>` (assignments)
   - `exam-platform-prod-web-<account>` (website)
   - `exam-platform-prod-trail-<account>` (CloudTrail logs)
   - `exam-platform-tfstate-<account>` (Terraform state)
3. 📸 Capture it.

### - [ ] 9.18 Lifecycle rule (5-year retention) → `evidence/09-18-s3-lifecycle.png`
1. Click the **uploads** bucket, then open the **Management** tab.
2. Under **Lifecycle rules**, click the rule **`records-retention-5-years`**.
3. The page shows the transitions: **Day 30 → Standard-IA**, **Day 180 → Glacier Instant Retrieval**, **Day 365 → Glacier Deep Archive**, and **expire at Day 1825** (5 years).
4. 📸 Capture the timeline or diagram.

### - [ ] 9.19 Encryption, versioning and events → `evidence/09-19a-s3-properties.png`, `evidence/09-19b-s3-events.png`, `evidence/09-19c-s3-permissions.png`
1. Go back to the uploads bucket and open the **Properties** tab.
2. **Bucket Versioning:** **Enabled**.
3. Scroll to **Default encryption**: **Server-side encryption with AWS Key Management Service keys (SSE-KMS)**, with **Bucket Key: Enabled**.
4. 📸 Save as `09-19a-s3-properties.png`.
5. Keep scrolling to **Event notifications**. There's one notification for **All object create events**, prefix `assignments/`, destination **SQS queue `exam-platform-prod-uploads`**.
6. 📸 Save as `09-19b-s3-events.png`.
7. Open the **Permissions** tab. **Block all public access** should be **On**, and the **Bucket policy** contains `DenyInsecureTransport`, which means HTTPS only (encryption in transit).
8. 📸 Save as `09-19c-s3-permissions.png`.

---

## Part H – Async processing (SQS and EventBridge) · 2–3 screenshots

### - [ ] 9.20 Queues → `evidence/09-20-sqs-queues.png`
1. Search **`SQS`** and open **Queues**. Type `exam-platform-prod` in the search box.
2. You'll see **6 queues**: `marking`, `uploads`, `notify`, plus `marking-dlq`, `uploads-dlq` and `notify-dlq`. The **Encryption** column shows **SSE-SQS**.
3. 📸 Capture it.

**Optional (good evidence):** click **`exam-platform-prod-uploads`** and:
- open the **Lambda triggers** tab, which shows `exam-platform-prod-upload` → `09-20b-sqs-trigger.png`
- open the **Dead-letter queue** tab, which shows the redrive to `uploads-dlq` with max receives **5**.

### - [ ] 9.21 Auto-submit schedule → `evidence/09-21-eventbridge.png`
1. Search **`EventBridge`**.
2. Left menu, under **Buses**, click **Rules**. Make sure **Event bus** is **default**.
3. Click **`exam-platform-prod-auto-submit`**. It shows **Status: Enabled**, **Schedule: rate(1 minute)**, and on the **Targets** tab the Lambda **`exam-platform-prod-marking`**.
4. 📸 Capture it.

> If the console offers to move you to "EventBridge Scheduler", ignore it. Our rule lives under **Rules**.

---

## Part I – Security (KMS and Secrets Manager) · 2 screenshots

### - [ ] 9.22 Encryption key → `evidence/09-22-kms.png`
1. Search **`KMS`**, then click **Customer managed keys** in the left menu.
2. Click the key with alias **`exam-platform-prod`**.
3. Open the **Key rotation** tab: **Automatically rotate this KMS key every year** is ticked or enabled.
4. 📸 Capture it.

### - [ ] 9.23 Database secret → `evidence/09-23-secrets-manager.png`
1. Search **`Secrets Manager`**, then click **Secrets**.
2. You'll see a secret named **`rds!db-…`**. Its description says it was created by RDS. Click it.
3. The page shows **Encryption key** (your KMS key) and **Rotation**, which is managed by RDS.
4. 📸 Capture the **overview only**.

> ⚠️ **Do NOT click "Retrieve secret value"**, and never screenshot the password.

---

## Part J – Monitoring (CloudWatch, SNS, CloudTrail) · 4 screenshots

### - [ ] 9.24 Dashboard → `evidence/09-24-cloudwatch-dashboard.png`
1. Search **`CloudWatch`**, then click **Dashboards** in the left menu.
2. Click **`exam-platform-prod`**.
3. At the top right, set the time range to **1h** (or **3h** if you used the app earlier).
4. 📸 Capture the graphs. They show data after you use the app in Phase 10, so you can retake this screenshot later.

### - [ ] 9.25 Alarms → `evidence/09-25-cloudwatch-alarms.png`
1. In the CloudWatch left menu, click **Alarms → All alarms**.
2. Type `exam-platform-prod` in the search box.
3. You'll see alarms such as `api-5xx`, `api-p95-latency`, `…-errors`, `…-dlq-not-empty`, `db-cpu` and `db-free-storage`. **OK** or **Insufficient data** is normal.
4. 📸 Capture it.

**Optional:** **Logs → Log groups**, filtered with `exam-platform-prod`, lists the log group for each Lambda and the API → `09-25b-log-groups.png`.

### - [ ] 9.26 AWS Backup (5-year retention) → `evidence/09-26-aws-backup.png`
1. Search **`AWS Backup`**, then click **Backup plans** in the left menu.
2. Click **`exam-platform-prod-plan`**. Under **Backup rules** you'll see:
   - **daily**, with retention **35 days**
   - **monthly-5-years**, with retention **1825 days** (cold storage after 90 days)
3. Scroll to **Resource assignments**, where `exam-platform-prod-db` is listed.
4. 📸 Capture it.

### - [ ] 9.27 CloudTrail → `evidence/09-27-cloudtrail.png`
1. Search **`CloudTrail`**, then click **Trails** in the left menu.
2. The row **`exam-platform-prod-trail`** shows **Status: Logging**, **Multi-region trail: Yes**, and the S3 bucket `exam-platform-prod-trail-…`.
3. 📸 Capture it.

### - [ ] 9.28 Alarm emails → `evidence/09-28-sns-alarm-subscription.png`
1. Search **`SNS`**, then click **Topics** in the left menu.
2. Click **`exam-platform-prod-alarms`**.
3. In the **Subscriptions** section, your email shows **Protocol: EMAIL**, **Status: Confirmed**.
   - If it says **Pending confirmation**, find the "AWS Notification – Subscription Confirmation" email (check spam) and click **Confirm subscription**.
4. 📸 Capture it.

---

## Part K – Bonus: proof that everything is built from code · 3 screenshots (recommended)

These help the **IaC** rubric row.

### - [ ] 9.29 Every resource tagged by Terraform → `evidence/09-29-tag-editor.png`
1. Search **`Tag Editor`** and click **Resource Groups & Tag Editor**.
2. In the left menu, click **Tag Editor**.
3. Set **Regions** to `us-east-1` and **Resource types** to **All supported resource types**.
4. Under **Tags**, enter **key** `ManagedBy` and **value** `terraform`.
5. Click **Search resources**. You get a long list of everything Terraform created (VPC, subnets, Lambda, RDS, S3, SQS and more).
6. 📸 Capture it, including the result count.

### - [ ] 9.30 IAM roles (least privilege) → `evidence/09-30-iam-roles.png`
1. Search **`IAM`** and click **Roles**. Type `exam-platform` in the search box.
2. You'll see one role per Lambda (`exam-platform-prod-api-fn`, `…-marking-fn` and so on), plus `…-rds-proxy`, `…-backup` and **`exam-platform-github-deploy`** (used by GitHub Actions).
3. 📸 Capture it.

### - [ ] 9.31 GitHub OIDC login → `evidence/09-31-iam-oidc.png`
1. In IAM, click **Identity providers** in the left menu.
2. You'll see **`token.actions.githubusercontent.com`**, type **OpenID Connect**.
3. 📸 Capture it. This shows GitHub deploys **without stored AWS keys**.

---

## Not in this deployment (and why)

| Service | Why there's no screenshot |
|---|---|
| **Route 53** and **ACM** | Only created when you set a custom domain (`domain_name`). The app uses the CloudFront address instead. Write in your report: *"Route 53 alias + ACM certificate are defined in `infra/edge.tf` and enabled with the `domain_name` variable."* |
| **SES** | Already captured in Phase 7 (`07-ses-verified.png`). |

---

## Finished? Check your evidence folder

You should now have these files in `evidence/`:

```
09-01-vpc.png                 09-12-api-routes.png             09-21-eventbridge.png
09-02-subnets-2az.png         09-13-api-authorizer.png         09-22-kms.png
09-03-nat-gateways.png        09-14-cognito-groups.png         09-23-secrets-manager.png
09-04a-route-public.png       09-15a-cloudfront.png            09-24-cloudwatch-dashboard.png
09-04b-route-private.png      09-15b-cloudfront-behaviors.png  09-25-cloudwatch-alarms.png
09-05-vpc-endpoints.png       09-16-waf.png                    09-26-aws-backup.png
09-06a-security-groups.png    09-17-s3-buckets.png             09-27-cloudtrail.png
09-06b-rds-sg-inbound.png     09-18-s3-lifecycle.png           09-28-sns-alarm-subscription.png
09-07a-rds-multi-az.png       09-19a-s3-properties.png         09-29-tag-editor.png   (bonus)
09-07b-rds-private.png        09-19b-s3-events.png             09-30-iam-roles.png    (bonus)
09-08-rds-proxy.png           09-19c-s3-permissions.png        09-31-iam-oidc.png     (bonus)
09-09-rds-backups.png         09-20-sqs-queues.png
09-10-lambda-functions.png
09-11-lambda-vpc.png
```

**Next:** Phase 10 in [`step-by-step-guide.md`](step-by-step-guide.md), the walkthroughs in the app.

### If something is missing
| Problem | Fix |
|---|---|
| A list is empty | Check the region is **N. Virginia**. For WAF, the dropdown must be **Global (CloudFront)**. |
| Nothing has `exam-platform-prod` in its name | The pipeline (Phase 6) hasn't finished. Check that GitHub **Actions** shows green. |
| RDS shows **Multi-AZ: No** | Wait. The status may still be "Modifying". Refresh after a few minutes. |
| SNS shows **Pending confirmation** | Click the confirmation link in your email (check spam). |
| A column you need is hidden | Click the **⚙ gear icon** at the top-right of the table and switch the column on. |
