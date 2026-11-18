# Copy to terraform.tfvars (git-ignored) for local deploys. CI sets these via GitHub variables.
region              = "us-east-1"
ses_sender_email    = "you@example.com"
ses_test_recipients = ["student1@example.com", "tutor1@example.com"]
alarm_email         = "you@example.com"

# Cost savers for the demo (defaults shown):
# nat_gateway_count = 2          # set 0 to save ~$65/month; Lambdas use VPC endpoints anyway
# db_instance_class = "db.t4g.micro"

# Optional custom domain:
# domain_name    = "exams.example.ac.uk"
# hosted_zone_id = "Z0123456789ABC"
