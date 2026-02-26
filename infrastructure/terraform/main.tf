# =============================================================
# infrastructure/terraform/main.tf
# Root Terraform — provisions ALL AWS infrastructure
# Usage: terraform init && terraform plan -out=tfplan && terraform apply tfplan
# =============================================================

module "vpc" {
  source             = "./modules/vpc"
  env                = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

module "eks" {
  source             = "./modules/eks"
  env                = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  instance_type      = var.eks_node_instance_type
  min_nodes          = var.eks_min_nodes
  max_nodes          = var.eks_max_nodes
  depends_on         = [module.vpc]
}

# Create the finance namespace for our application
resource "kubernetes_namespace" "finance" {
  metadata {
    name = "finance"
    labels = {
      name        = "finance"
      environment = var.environment
    }
  }
  depends_on = [module.eks]
}

module "rds" {
  source         = "./modules/rds"
  env            = var.environment
  vpc_id         = module.vpc.vpc_id
  subnet_ids     = module.vpc.private_subnet_ids
  allowed_sg_id  = module.eks.node_security_group_id
  instance_class = var.rds_instance_class
  db_name        = var.db_name
  db_secret_id   = module.secrets.db_secret_id
  depends_on     = [module.vpc, module.secrets]
}

module "elasticache" {
  source        = "./modules/elasticache"
  env           = var.environment
  vpc_id        = module.vpc.vpc_id
  subnet_ids    = module.vpc.private_subnet_ids
  allowed_sg_id = module.eks.node_security_group_id
  depends_on    = [module.vpc]
}

module "s3" {
  source          = "./modules/s3"
  env             = var.environment
  allowed_origins = var.allowed_origins
}

module "sqs" {
  source                      = "./modules/sqs"
  env                         = var.environment
  upload_service_role_arn     = ""
  processing_service_role_arn = ""
}

module "secrets" {
  source = "./modules/secrets"
  env    = var.environment
}

module "iam" {
  source              = "./modules/iam"
  env                 = var.environment
  oidc_provider_arn   = module.eks.oidc_provider_arn
  oidc_provider_url   = module.eks.oidc_provider_url
  s3_bucket_arn       = module.s3.uploads_bucket_arn
  sqs_queue_arn       = module.sqs.processing_queue_arn
  secrets_arns        = module.secrets.all_secret_arns
  github_org          = var.github_org
  github_repo         = var.github_repo
  depends_on          = [module.eks, module.s3, module.sqs, module.secrets, kubernetes_namespace.finance]
}

# ── ECR Repositories — one per service ────────────────────────
module "ecr_auth" {
  source       = "./modules/ecr"
  env          = var.environment
  service_name = "auth-service"
}
module "ecr_upload" {
  source       = "./modules/ecr"
  env          = var.environment
  service_name = "upload-service"
}
module "ecr_processing" {
  source       = "./modules/ecr"
  env          = var.environment
  service_name = "processing-service"
}
module "ecr_analytics" {
  source       = "./modules/ecr"
  env          = var.environment
  service_name = "analytics-service"
}
module "ecr_notification" {
  source       = "./modules/ecr"
  env          = var.environment
  service_name = "notification-service"
}

# ── Install Helm Charts on EKS ──────────────────────────────
resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = "1.7.1"
  namespace  = "kube-system"
  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.iam.alb_controller_role_arn
  }
  depends_on = [module.eks, module.iam]
}

resource "helm_release" "external_secrets" {
  name       = "external-secrets"
  repository = "https://charts.external-secrets.io"
  chart      = "external-secrets"
  version    = "0.9.11"
  namespace  = "external-secrets"
  create_namespace = true
  depends_on = [module.eks]
}

# ── Outputs ──────────────────────────────────────────────────
output "eks_cluster_name"            { value = module.eks.cluster_name }
output "rds_endpoint"                { value = module.rds.endpoint }
output "redis_endpoint"              { value = module.elasticache.primary_endpoint }
output "s3_bucket"                   { value = module.s3.uploads_bucket_name }
output "sqs_queue_url"               { value = module.sqs.processing_queue_url }
output "external_secrets_role_arn"   { value = module.iam.external_secrets_role_arn }
