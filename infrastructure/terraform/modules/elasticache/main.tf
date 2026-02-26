# =============================================================
# infrastructure/terraform/modules/elasticache/main.tf
# ElastiCache Redis for analytics caching
# =============================================================

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.env}-redis-subnet-group"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
  name   = "${var.env}-redis-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.allowed_sg_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.env}-finance-redis"
  description          = "Redis for finance platform analytics caching"
  node_type            = var.node_type  # cache.t3.micro = ~$12/mo
  num_cache_clusters   = 1  # LEARNING: Single node for cost savings
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  # LEARNING: Encryption disabled for t3.micro compatibility
  # PRODUCTION: Enable for compliance (requires cache.t3.medium+)
  at_rest_encryption_enabled = false  # Enable in production
  transit_encryption_enabled = false  # Enable in production

  # LEARNING: No automatic failover (requires 2+ nodes)
  # PRODUCTION: Set to true with num_cache_clusters = 2
  automatic_failover_enabled = false

  tags = { Name = "${var.env}-redis" }
}

output "primary_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_url" {
  value     = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
  sensitive = true
}

variable "env" {}
variable "vpc_id" {}
variable "subnet_ids" { type = list(string) }
variable "allowed_sg_id" {}
variable "node_type" { default = "cache.t3.micro" }
