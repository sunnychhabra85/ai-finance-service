variable "environment"            { default = "production" }
variable "aws_region"             { default = "ap-south-1" }

variable "vpc_cidr"               { default = "10.0.0.0/16" }
# COST: Use 2 AZs for learning ($64/mo for 2 NATs vs $96/mo for 3 NATs)
# For production HA: use ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
variable "availability_zones"     { default = ["ap-south-1a", "ap-south-1b"] }

# Instance sizes — MINIMUM COST for learning
# EKS: t3.small = $0.0208/hr (~$15/mo per node)
# RDS: db.t3.micro = $0.017/hr (~$12.50/mo) - Free tier eligible!
variable "eks_node_instance_type" { default = "t3.small" }    # $0.0208/hr (~$30/mo for 2 nodes)
variable "rds_instance_class"     { default = "db.t3.micro" }  # $0.017/hr - FREE TIER for 1 year!
variable "eks_min_nodes"          { default = 2 }  # Minimum for HA
variable "eks_max_nodes"          { default = 4 }  # Lower max for cost control

variable "db_name"                { default = "financedb" }

# YOUR GitHub org and repo name (for OIDC trust)
variable "github_org"   { default = "sunnychhabra85" }  # ← update
variable "github_repo"  { default = "ai-finance-service" }              # ← update


# Your domain name for HTTPS (get cert from ACM first)
# Leave as-is if you don't have a domain yet
variable "allowed_origins" { default = ["https://yourdomain.com"] }


