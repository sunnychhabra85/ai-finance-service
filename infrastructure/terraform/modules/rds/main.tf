# =============================================================
# infrastructure/terraform/modules/rds/main.tf
# RDS PostgreSQL — encrypted, Multi-AZ, automated backups
# =============================================================

resource "aws_db_subnet_group" "main" {
  name       = "${var.env}-db-subnet-group"
  subnet_ids = var.subnet_ids
  tags       = { Name = "${var.env}-db-subnet-group" }
}

resource "aws_security_group" "rds" {
  name        = "${var.env}-rds-sg"
  description = "Allow PostgreSQL from EKS nodes only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.allowed_sg_id] # EKS node SG only
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.env}-rds-sg" }
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_db_instance" "postgres" {
  identifier        = "${var.env}-finance-postgres"
  engine            = "postgres"
  engine_version    = "16.12"
  instance_class    = var.instance_class
  allocated_storage = 20  # FREE TIER: 20GB included for 12 months
  max_allocated_storage = 100  # Auto-scaling storage up to 100GB

  db_name  = var.db_name
  username = "dbadmin"
  password = random_password.db_password.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # LEARNING: Single-AZ (FREE TIER compatible)
  # PRODUCTION: Change to true for Multi-AZ HA (~2x cost)
  multi_az = false  # Set to true for production HA

  # Encryption at rest
  storage_encrypted = true

  # Backups
  backup_retention_period = 7       # Keep 7 days of backups
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  # Performance
  performance_insights_enabled = true

  # Safety
  deletion_protection = var.env == "production"
  skip_final_snapshot = var.env != "production"
  final_snapshot_identifier = var.env == "production" ? "${var.env}-final-snapshot" : null

  apply_immediately = false

  tags = { Name = "${var.env}-postgres" }
}

# Store password in Secrets Manager
resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id = var.db_secret_id
  secret_string = jsonencode({
    url      = "postgresql://dbadmin:${random_password.db_password.result}@${aws_db_instance.postgres.endpoint}/${var.db_name}"
    host     = aws_db_instance.postgres.address
    port     = aws_db_instance.postgres.port
    username = "dbadmin"
    password = random_password.db_password.result
    dbname   = var.db_name
  })
  lifecycle { ignore_changes = [secret_string] }
}

output "endpoint" { value = aws_db_instance.postgres.endpoint }
output "address"  { value = aws_db_instance.postgres.address }

variable "env" {}
variable "vpc_id" {}
variable "subnet_ids" { type = list(string) }
variable "allowed_sg_id" {}
variable "instance_class" { default = "db.t3.micro" }
variable "db_name" { default = "financedb" }
variable "db_secret_id" { default = "" }
