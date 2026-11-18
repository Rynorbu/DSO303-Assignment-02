# ---------------------------------------------------------------------------
# VPC: 2 AZs x (public subnet + private app subnet + private data subnet)
# ---------------------------------------------------------------------------
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index) # 10.20.0.0/24, 10.20.1.0/24
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-public-${local.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "app" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10 + count.index) # 10.20.10.0/24, 10.20.11.0/24
  availability_zone = local.azs[count.index]
  tags              = { Name = "${local.name}-app-${local.azs[count.index]}", Tier = "private-app" }
}

resource "aws_subnet" "data" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 20 + count.index) # 10.20.20.0/24, 10.20.21.0/24
  availability_zone = local.azs[count.index]
  tags              = { Name = "${local.name}-data-${local.azs[count.index]}", Tier = "private-data" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${local.name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  count  = var.nat_gateway_count
  domain = "vpc"
  tags   = { Name = "${local.name}-nat-eip-${count.index}" }
}

resource "aws_nat_gateway" "main" {
  count         = var.nat_gateway_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${local.name}-nat-${local.azs[count.index]}" }
  depends_on    = [aws_internet_gateway.main]
}

# One private route table per AZ so each AZ uses its own NAT (no cross-AZ dependency).
resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id
  dynamic "route" {
    for_each = var.nat_gateway_count > 0 ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.main[min(count.index, var.nat_gateway_count - 1)].id
    }
  }
  tags = { Name = "${local.name}-private-rt-${local.azs[count.index]}" }
}

resource "aws_route_table_association" "app" {
  count          = 2
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table_association" "data" {
  count          = 2
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# ---------------------------------------------------------------------------
# Security groups (least privilege chain: Lambda -> RDS Proxy -> RDS)
# ---------------------------------------------------------------------------
resource "aws_security_group" "lambda" {
  name        = "${local.name}-lambda-sg"
  description = "VPC Lambda functions"
  vpc_id      = aws_vpc.main.id
  egress {
    description = "HTTPS to VPC endpoints / AWS APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "PostgreSQL to RDS Proxy"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_security_group" "proxy" {
  name        = "${local.name}-rds-proxy-sg"
  description = "RDS Proxy"
  vpc_id      = aws_vpc.main.id
  ingress {
    description     = "PostgreSQL from Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
  egress {
    description = "PostgreSQL to RDS"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_security_group" "db" {
  name        = "${local.name}-rds-sg"
  description = "RDS PostgreSQL - only reachable from RDS Proxy"
  vpc_id      = aws_vpc.main.id
  ingress {
    description     = "PostgreSQL from RDS Proxy"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.proxy.id]
  }
  # Without RDS Proxy (AWS Free plan) the Lambdas connect to the database directly.
  dynamic "ingress" {
    for_each = var.enable_rds_proxy ? [] : [1]
    content {
      description     = "PostgreSQL from Lambda (no RDS Proxy)"
      from_port       = 5432
      to_port         = 5432
      protocol        = "tcp"
      security_groups = [aws_security_group.lambda.id]
    }
  }
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-vpce-sg"
  description = "Interface VPC endpoints"
  vpc_id      = aws_vpc.main.id
  ingress {
    description     = "HTTPS from Lambda"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}

# ---------------------------------------------------------------------------
# VPC endpoints: private Lambdas reach S3 and SQS without the internet
# ---------------------------------------------------------------------------
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id
  tags              = { Name = "${local.name}-s3-gw" }
}

# Only needed when the Lambdas read the DB secret themselves (no RDS Proxy) AND there is no NAT.
resource "aws_vpc_endpoint" "secretsmanager" {
  count               = !var.enable_rds_proxy && var.nat_gateway_count == 0 ? 1 : 0
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.app[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
  tags                = { Name = "${local.name}-secretsmanager-vpce" }
}

resource "aws_vpc_endpoint" "sqs" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.sqs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.app[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
  tags                = { Name = "${local.name}-sqs-vpce" }
}
