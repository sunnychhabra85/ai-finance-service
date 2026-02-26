# infrastructure/terraform/modules/iam/main.tf
# IAM: GitHub OIDC, all IRSA roles for microservices

# ── GitHub Actions OIDC ────────────────────────────────────────
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.env}-github-actions-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchGetImage","ecr:BatchCheckLayerAvailability","ecr:CompleteLayerUpload","ecr:GetDownloadUrlForLayer","ecr:InitiateLayerUpload","ecr:PutImage","ecr:UploadLayerPart"], Resource = "arn:aws:ecr:*:*:repository/*" },
      { Effect = "Allow", Action = ["eks:DescribeCluster"], Resource = "*" }
    ]
  })
}

# ── Auth Service IRSA ──────────────────────────────────────────
resource "aws_iam_role" "auth_service" {
  name = "${var.env}-auth-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:finance:auth-service-sa"
          "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}
resource "aws_iam_role_policy" "auth_service" {
  role = aws_iam_role.auth_service.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue","secretsmanager:DescribeSecret"], Resource = var.secrets_arns },
      { Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "arn:aws:logs:*:*:*" }
    ]
  })
}
resource "kubernetes_service_account" "auth_service" {
  metadata {
    name      = "auth-service-sa"
    namespace = "finance"
    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.auth_service.arn
    }
  }
}

# ── Analytics Service IRSA ─────────────────────────────────────
resource "aws_iam_role" "analytics_service" {
  name = "${var.env}-analytics-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:finance:analytics-service-sa"
        "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
      }}
    }]
  })
}
resource "aws_iam_role_policy" "analytics_service" {
  role = aws_iam_role.analytics_service.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue","secretsmanager:DescribeSecret"], Resource = var.secrets_arns },
    { Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "arn:aws:logs:*:*:*" }
  ]})
}
resource "kubernetes_service_account" "analytics_service" {
  metadata {
    name      = "analytics-service-sa"
    namespace = "finance"
    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.analytics_service.arn
    }
  }
}

# ── Notification Service IRSA ──────────────────────────────────
resource "aws_iam_role" "notification_service" {
  name = "${var.env}-notification-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:finance:notification-service-sa"
        "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
      }}
    }]
  })
}
resource "aws_iam_role_policy" "notification_service" {
  role = aws_iam_role.notification_service.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue","secretsmanager:DescribeSecret"], Resource = var.secrets_arns },
    { Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "arn:aws:logs:*:*:*" }
  ]})
}
resource "kubernetes_service_account" "notification_service" {
  metadata {
    name      = "notification-service-sa"
    namespace = "finance"
    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.notification_service.arn
    }
  }
}

# ── Processing Service IRSA ────────────────────────────────────
resource "aws_iam_role" "processing_service" {
  name = "${var.env}-processing-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:finance:processing-service-sa"
        "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
      }}
    }]
  })
}
resource "aws_iam_role_policy" "processing_service" {
  role = aws_iam_role.processing_service.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject","s3:HeadObject"], Resource = "${var.s3_bucket_arn}/*" },
    { Effect = "Allow", Action = ["sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"], Resource = var.sqs_queue_arn },
    { Effect = "Allow", Action = ["textract:DetectDocumentText","textract:StartDocumentTextDetection","textract:GetDocumentTextDetection"], Resource = "*" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue","secretsmanager:DescribeSecret"], Resource = var.secrets_arns },
    { Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "arn:aws:logs:*:*:*" }
  ]})
}
resource "kubernetes_service_account" "processing_service" {
  metadata {
    name      = "processing-service-sa"
    namespace = "finance"
    annotations = {
      "eks.amazonaws.com/role-arn" = aws_iam_role.processing_service.arn
    }
  }
}

# ── ALB Controller IRSA ────────────────────────────────────────
resource "aws_iam_role" "alb_controller" {
  name = "${var.env}-alb-controller-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:kube-system:aws-load-balancer-controller"
        "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
      }}
    }]
  })
}
resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = "arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess"
}

# ── External Secrets IRSA ──────────────────────────────────────
resource "aws_iam_role" "external_secrets" {
  name = "${var.env}-external-secrets-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:external-secrets:external-secrets"
        "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
      }}
    }]
  })
}
resource "aws_iam_role_policy" "external_secrets" {
  role = aws_iam_role.external_secrets.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue","secretsmanager:DescribeSecret","secretsmanager:ListSecrets"], Resource = var.secrets_arns }
  ]})
}

output "alb_controller_role_arn"      { value = aws_iam_role.alb_controller.arn }
output "external_secrets_role_arn"    { value = aws_iam_role.external_secrets.arn }
output "processing_service_role_arn"  { value = aws_iam_role.processing_service.arn }

variable "env" {}
variable "oidc_provider_arn" {}
variable "oidc_provider_url" {}
variable "s3_bucket_arn" {}
variable "sqs_queue_arn" {}
variable "secrets_arns" { type = list(string) }
variable "github_org" {}
variable "github_repo" {}
