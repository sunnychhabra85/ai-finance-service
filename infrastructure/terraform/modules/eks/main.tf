# =============================================================
# infrastructure/terraform/modules/eks/main.tf
# EKS cluster with managed node group
# =============================================================

resource "aws_iam_role" "eks_cluster" {
  name = "${var.env}-eks-cluster-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "eks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "eks_cluster" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role" "eks_nodes" {
  name = "${var.env}-eks-node-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "eks_nodes_worker" {
  role = aws_iam_role.eks_nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}
resource "aws_iam_role_policy_attachment" "eks_nodes_cni" {
  role = aws_iam_role.eks_nodes.name 
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}
resource "aws_iam_role_policy_attachment" "eks_nodes_ecr" {
  role = aws_iam_role.eks_nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_eks_cluster" "main" {
  name     = "${var.env}-cluster"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.29"

  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster]
}

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.env}-main-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = var.private_subnet_ids
  instance_types  = [var.instance_type]

  scaling_config {
    desired_size = 2
    min_size     = var.min_nodes
    max_size     = var.max_nodes
  }

  update_config { max_unavailable = 1 }

  depends_on = [
    aws_iam_role_policy_attachment.eks_nodes_worker,
    aws_iam_role_policy_attachment.eks_nodes_cni,
    aws_iam_role_policy_attachment.eks_nodes_ecr,
  ]
}

data "tls_certificate" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

output "cluster_name"            { value = aws_eks_cluster.main.name }
output "cluster_endpoint"        { value = aws_eks_cluster.main.endpoint }
output "cluster_ca_cert"         { value = aws_eks_cluster.main.certificate_authority[0].data }
output "oidc_provider_arn"       { value = aws_iam_openid_connect_provider.eks.arn }
output "oidc_provider_url"       { value = aws_eks_cluster.main.identity[0].oidc[0].issuer }
output "node_security_group_id"  { value = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id }

variable "env" {}
variable "vpc_id" {}
variable "private_subnet_ids" { type = list(string) }
variable "instance_type" { default = "t3.medium" }
variable "min_nodes" { default = 2 }
variable "max_nodes" { default = 10 }
