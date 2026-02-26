# Finance Platform — Auth Service Setup Guide

## 📚 Documentation

- **[DATABASE.md](DATABASE.md)** - Complete guide for PostgreSQL database operations, queries, and troubleshooting
- **[README.md](README.md)** - This file (setup and deployment guide)

## 🌍 Environment Strategy

**Currently Active:**
- ✅ **Local Development** (Docker) - 100% FREE, use for daily development
- ✅ **Production** (AWS ap-south-1) - Ready to deploy when you go live

**Available (Commented Out):**
- ⏸️ **Staging** - Enable later in `infrastructure/terraform/variables.tf`
- ⏸️ **Development** - Enable later in `infrastructure/terraform/variables.tf`

**💰 Cost:** Production-only = ~₹10,000/month | With Staging+Dev = ~₹30,000/month

See [Environment Management](#environment-management) section for details on enabling additional environments.

---

## What's in this folder?

```
finance-platform/
├── apps/
│   └── auth-service/           # Auth microservice (NestJS)
│       ├── src/
│       │   ├── main.ts          # App entry point
│       │   ├── app.module.ts    # Root module
│       │   ├── auth/            # Auth feature module
│       │   │   ├── auth.controller.ts   # REST endpoints
│       │   │   ├── auth.service.ts      # Business logic
│       │   │   ├── auth.module.ts       # Module wiring
│       │   │   ├── dto/                 # Request body types
│       │   │   ├── guards/              # JWT guards
│       │   │   ├── strategies/          # Passport JWT strategies
│       │   │   └── decorators/          # @CurrentUser() decorator
│       │   ├── users/           # User management module
│       │   └── common/          # Config, health checks
│       └── Dockerfile           # Multi-stage production build
├── libs/
│   ├── database/                # Prisma client + schema (shared)
│   └── shared-types/            # Shared TypeScript types
├── infrastructure/
│   ├── terraform/               # All AWS infrastructure as code
│   └── k8s/auth-service/        # Kubernetes manifests
├── DATABASE.md                  # Database documentation & queries
├── test-api.ps1                 # API testing script (PowerShell)
├── db-inspect.ps1               # Database inspection script (PowerShell)
└── .github/workflows/           # CI/CD pipeline
```

## API Endpoints

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| POST | /api/v1/auth/register | No | Register new user |
| POST | /api/v1/auth/login | No | Login, get tokens |
| POST | /api/v1/auth/refresh | Refresh token in body | Get new access token |
| POST | /api/v1/auth/logout | Bearer token | Revoke current session |
| DELETE | /api/v1/auth/sessions | Bearer token | Revoke all sessions |
| GET | /api/v1/auth/me | Bearer token | Get current user |
| GET | /api/v1/health | No | Liveness probe |
| GET | /api/v1/health/ready | No | Readiness probe |

---

## Step 1: Local Development Setup

**🎉 100% FREE** - This entire local setup runs on Docker with no cloud costs!

### Prerequisites
```bash
# Install required tools
node --version     # Must be >= 20
docker --version   # Must be installed
```

### 1. Clone and install
```bash
git clone <your-repo-url>
cd finance-platform
npm install
```

### 2. Set up environment
```bash
# Copy the example env file
cp .env.example .env.local

# Edit .env.local — update these values:
# DATABASE_URL=postgresql://admin:localpassword123@localhost:5432/financedb
# JWT_ACCESS_SECRET=<run: openssl rand -base64 64>
# JWT_REFRESH_SECRET=<run: openssl rand -base64 64>
```

### 3. Start PostgreSQL locally
```bash
docker-compose up -d postgres redis
# Wait ~10 seconds for postgres to be ready
```

### 4. Run database migrations
```bash
# Generate Prisma client
npx prisma generate --schema=libs/database/prisma/schema.prisma

# Apply migrations to the Docker PostgreSQL (port 5433)
# For Windows PowerShell:
$env:DATABASE_URL="postgresql://admin:localpassword123@localhost:5433/financedb"
npx prisma migrate deploy --schema=libs/database/prisma/schema.prisma

# For Linux/Mac:
DATABASE_URL="postgresql://admin:localpassword123@localhost:5433/financedb" npx prisma migrate deploy --schema=libs/database/prisma/schema.prisma
```

**Note**: The Docker postgres runs on port **5433** (user: `admin`, password: `localpassword123`)

📖 **See [DATABASE.md](DATABASE.md) for complete database documentation, queries, and troubleshooting.**

### 5. Start the auth service
```bash
# Development mode (with hot reload)
npx nx serve auth-service

# OR with docker-compose (production-like)
docker-compose up auth-service
```

### 6. Test the API

#### **Important**: The service runs on port **3011** (mapped from container port 3001)

#### **For Windows PowerShell users:**
```powershell
# Register a user
Invoke-RestMethod -Uri "http://localhost:3011/api/v1/auth/register" -Method POST `
  -Body '{"email":"test@example.com","password":"SecureP@ss123","firstName":"John"}' `
  -ContentType "application/json"

# Login
$login = Invoke-RestMethod -Uri "http://localhost:3011/api/v1/auth/login" -Method POST `
  -Body '{"email":"test@example.com","password":"SecureP@ss123"}' `
  -ContentType "application/json"

# Get current user (using access token from login)
$headers = @{ Authorization = "Bearer $($login.data.tokens.accessToken)" }
Invoke-RestMethod -Uri "http://localhost:3011/api/v1/auth/me" -Method GET -Headers $headers

# OR: Use the test script
.\test-api.ps1
```

#### **For Linux/Mac (bash/curl):**
```bash
# Register a user
curl -X POST http://localhost:3011/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecureP@ss123","firstName":"John"}'

# Login
curl -X POST http://localhost:3011/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecureP@ss123"}'

# Use the accessToken from login response:
curl http://localhost:3011/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Swagger UI (Development only)
Open: http://localhost:3011/api/docs

**Note**: The service runs on port **3011** when using docker-compose (mapped from internal port 3001).

### 7. Inspect the Database
```powershell
# Run database inspection script (shows tables, users, logs, etc.)
.\db-inspect.ps1
```

📖 **For more database commands and queries, see [DATABASE.md](DATABASE.md)**

---

## Step 2: Run Tests
```bash
# Unit tests
npx nx test auth-service

# Tests with coverage report
npx nx test auth-service --coverage

# Watch mode during development
npx nx test auth-service --watch
```

---

## Step 3: AWS Infrastructure Setup (Production Only)

**🎯 Environment Strategy**:
- ✅ **Production**: Configured and ready to deploy
- ⏸️ **Staging**: Commented out (uncomment in `variables.tf` when needed)
- ⏸️ **Development**: Commented out (uncomment in `variables.tf` when needed)
- 💻 **Local Development**: Use Docker (100% FREE - recommended for daily work)

**💰 Cost Note**: 
- **Local Development (Docker)**: 100% FREE - Your current setup costs nothing!
- **AWS Production (Single Environment)**: 
  - **Free Tier** (First 12 months): RDS database is free, but EKS costs ~₹6,000/month
  - **After Free Tier**: ~₹10,000-12,000/month (~$120-150/month) in Mumbai region
  - **With Staging + Development**: ~₹30,000-36,000/month (3x cost)

**💡 Recommendation**: 
- ✅ Use **Docker for development** (free, fast, works great!)
- ✅ Deploy **only Production** to AWS initially
- ✅ Add Staging/Development environments later when you have revenue or team collaboration needs

### Prerequisites
```bash
# Install AWS CLI
brew install awscli   # macOS
# OR: https://aws.amazon.com/cli/

# Install Terraform
brew install terraform
# OR: https://developer.hashicorp.com/terraform/downloads

# Install kubectl
brew install kubectl

# Configure AWS credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (ap-south-1), Output (json)
```

**💡 Region Selection**: This guide uses **`ap-south-1` (Mumbai)** for better latency in India. You can use any AWS region by replacing `ap-south-1` throughout this guide with your preferred region:
- `ap-south-1` (N. Virginia)
- `eu-west-1` (Ireland)
- `ap-southeast-1` (Singapore)
- `ap-northeast-1` (Tokyo)

### 3.1 Create Terraform state bucket (one-time setup)
```bash
# Create the S3 bucket for Terraform state
aws s3 mb s3://finance-platform-terraform-state --region ap-south-1

# Enable versioning (allows rollback of state)
aws s3api put-bucket-versioning \
  --bucket finance-platform-terraform-state \
  --versioning-configuration Status=Enabled

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name terraform-state-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1
```

### 3.2 Deploy infrastructure (Production environment only)

**📊 Cost Breakdown (Single Production Environment):**
| Service | Free Tier Eligible | Monthly Cost After Free Tier (Mumbai) |
|---------|-------------------|--------------------------------------|
| RDS PostgreSQL (db.t3.micro) | ✅ Yes (12 months) | ~₹1,200-1,500 ($15-18) |
| EKS Cluster | ❌ No | ₹6,000 ($72) - cluster fee |
| EC2 for EKS Nodes (t3.medium x2) | ⚠️ Partial | ₹2,000-4,000 ($25-50) |
| S3 (state + uploads) | ✅ Yes (always) | Minimal (₹50-200) |
| Secrets Manager | ❌ No | ₹300-500 ($4-6) |
| **TOTAL (Production Only)** | | **₹10,000-12,000/month ($120-150)** |

**🔮 Future Environments** (currently commented out):
- **+ Staging**: Add ~₹10,000-12,000/month when needed
- **+ Development**: Add ~₹10,000-12,000/month when needed
- **Total with all 3**: ~₹30,000-36,000/month ($360-432)

**💡 Budget-Friendly Alternatives** (for small projects):
- **Railway.app**: ~₹800-1,500/month ($10-20) - includes database + service
- **AWS Lightsail**: ~₹1,500-3,000/month ($20-40) - simpler than EKS
- **Render.com**: ~₹800-1,500/month ($10-20) - easy deployment

```bash
cd infrastructure/terraform

# Initialize Terraform (downloads providers, sets up backend)
terraform init

# Preview what will be created — ALWAYS do this before apply
# This deploys ONLY production environment
terraform plan -var="github_org=YOUR_GITHUB_USERNAME"

# Apply — this takes ~20 minutes (EKS takes longest)
# Deploys: Production VPC, EKS cluster, RDS database, secrets
terraform apply -var="github_org=YOUR_GITHUB_USERNAME"
```

**📝 To enable Staging or Development later:**

1. Edit `infrastructure/terraform/variables.tf`
2. Update the `environment` validation:
   ```hcl
   # Change from:
   condition = contains(["production"], var.environment)
   
   # To:
   condition = contains(["production", "staging"], var.environment)
   ```
3. Deploy staging:
   ```bash
   terraform apply -var="github_org=YOUR_GITHUB_USERNAME" -var="environment=staging"
   ```

### 3.3 Update secrets in AWS Secrets Manager

#### **For Windows PowerShell:**
```powershell
# Navigate to terraform directory
cd infrastructure/terraform

# Generate strong secrets (PowerShell - no OpenSSL needed)
$ACCESS_SECRET = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
$REFRESH_SECRET = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# Or use .NET crypto (recommended - more secure)
$ACCESS_SECRET = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$REFRESH_SECRET = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))

# Get RDS details from Terraform
$DB_HOST = terraform output -raw rds_endpoint
$DB_PASSWORD = terraform output -raw rds_password

# Store JWT secrets
aws secretsmanager put-secret-value `
  --secret-id production/finance-platform/jwt `
  --secret-string "{`"accessSecret`":`"$ACCESS_SECRET`",`"refreshSecret`":`"$REFRESH_SECRET`"}" `
  --region ap-south-1

# Store database connection string
aws secretsmanager put-secret-value `
  --secret-id production/finance-platform/db `
  --secret-string "{`"url`":`"postgresql://dbadmin:$DB_PASSWORD@${DB_HOST}:5432/financedb`"}" `
  --region ap-south-1

# Verify secrets were created
aws secretsmanager list-secrets --region ap-south-1 --query "SecretList[?contains(Name,'finance-platform')].Name"
```

#### **For Linux/Mac (bash):**
```bash
# Navigate to terraform directory
cd infrastructure/terraform

# Generate strong secrets
ACCESS_SECRET=$(openssl rand -base64 64)
REFRESH_SECRET=$(openssl rand -base64 64)

# Get RDS details from Terraform
DB_HOST=$(terraform output -raw rds_endpoint)
DB_PASSWORD=$(terraform output -raw rds_password)

# Store JWT secrets
aws secretsmanager put-secret-value \
  --secret-id production/finance-platform/jwt \
  --secret-string "{\"accessSecret\":\"$ACCESS_SECRET\",\"refreshSecret\":\"$REFRESH_SECRET\"}" \
  --region ap-south-1

# Store database connection string
aws secretsmanager put-secret-value \
  --secret-id production/finance-platform/db \
  --secret-string "{\"url\":\"postgresql://dbadmin:$DB_PASSWORD@${DB_HOST}:5432/financedb\"}" \
  --region ap-south-1

# Verify secrets
aws secretsmanager list-secrets --region ap-south-1 --query "SecretList[?contains(Name,'finance-platform')].Name"
```

### 3.4 Connect to EKS cluster

#### **For Windows PowerShell:**
```powershell
# Get kubeconfig
aws eks update-kubeconfig --name production-cluster --region ap-south-1

# Verify connection
kubectl get nodes
```

#### **For Linux/Mac (bash):**
```bash
# Get kubeconfig
aws eks update-kubeconfig --name production-cluster --region ap-south-1

# Verify connection
kubectl get nodes
```

---

## Step 4: Deploy Auth Service to Kubernetes

```bash
# Install External Secrets Operator (syncs AWS secrets to K8s)
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace

# Apply K8s manifests
kubectl apply -f infrastructure/k8s/namespace.yaml
kubectl apply -f infrastructure/k8s/auth-service/secrets.yaml
kubectl apply -f infrastructure/k8s/auth-service/deployment.yaml
kubectl apply -f infrastructure/k8s/auth-service/ingress.yaml

# Check deployment status
kubectl get pods -n finance
kubectl logs -n finance -l app=auth-service --follow
```

---

## Step 5: CI/CD Setup (GitHub Actions)

### 5.1 Create ECR repository
```bash
aws ecr create-repository \
  --repository-name auth-service \
  --region ap-south-1 \
  --image-scanning-configuration scanOnPush=true
```

### 5.2 Add GitHub Secrets
In GitHub repo → Settings → Secrets and variables → Actions:
- `AWS_ACCOUNT_ID` = your 12-digit AWS account ID

That's it! GitHub Actions uses OIDC (configured by Terraform) — no AWS keys in GitHub.

### 5.3 Push to trigger pipeline
```bash
git add .
git commit -m "feat: add auth service"
git push origin main
# Watch the Actions tab in GitHub!
```

---

## Security Notes

- **Passwords**: Stored as bcrypt hashes (rounds=12). Never stored in plain text.
- **JWT Access Tokens**: 15-minute TTL. Short-lived to limit exposure.
- **JWT Refresh Tokens**: 7-day TTL. Stored as SHA-256 hashes in DB. Rotated on every refresh.
- **Rate Limiting**: 10 requests/minute per IP on auth endpoints. Prevents brute-force.
- **IRSA**: Auth service pod has minimum IAM permissions (read secrets + write logs only).
- **No root**: Docker container runs as non-root user (UID 1001).
- **Audit Logs**: Every login, logout, and refresh is logged to the `audit_logs` table.

---

## Environment Management

### Current Configuration

This project is configured for **production-only deployment** to minimize AWS costs. Staging and development environments are commented out but can be enabled when needed.

**Active Environments:**
- ✅ **Production** (`ap-south-1`) - AWS deployment ready
- 💻 **Local Development** - Docker (free, recommended for daily work)

**Available (Commented Out):**
- ⏸️ **Staging** - Uncomment in `variables.tf` when team grows
- ⏸️ **Development** - Uncomment in `variables.tf` for cloud-based dev testing

### Environment URLs (Production Only)

Once deployed, your production URLs will be:
- **API Base**: `https://api.your-domain.com`
- **Health Check**: `https://api.your-domain.com/api/v1/health`
- **Swagger Docs**: `https://api.your-domain.com/api/docs` (disable in production!)

**Local Development URLs:**
- **API Base**: `http://localhost:3011`
- **Health Check**: `http://localhost:3011/api/v1/health`
- **Swagger Docs**: `http://localhost:3011/api/docs`

### Adding Staging/Development Environments

When your project grows, enable additional environments:

**Step 1: Update Terraform Variables**

Edit `infrastructure/terraform/variables.tf`:

```hcl
variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
  validation {
    # Add staging and/or development:
    condition = contains(["production", "staging", "development"], var.environment)
    error_message = "Environment must be production, staging, or development."
  }
}
```

**Step 2: Deploy Additional Environments**

```bash
# Deploy staging
cd infrastructure/terraform
terraform workspace new staging  # Create new workspace
terraform apply -var="environment=staging" -var="github_org=YOUR_GITHUB_USERNAME"

# Deploy development
terraform workspace new development
terraform apply -var="environment=development" -var="github_org=YOUR_GITHUB_USERNAME"
```

**Step 3: Update DNS (per environment)**

Add CNAME records for each environment:
- Production: `api.your-domain.com` → ALB DNS
- Staging: `api-staging.your-domain.com` → Staging ALB DNS
- Development: `api-dev.your-domain.com` → Dev ALB DNS

### Environment Variables by Environment

| Variable | Local | Production | Staging | Development |
|----------|-------|------------|---------|-------------|
| `NODE_ENV` | development | production | production | development |
| `DATABASE_URL` | Docker postgres:5433 | RDS endpoint | RDS endpoint | RDS endpoint |
| `JWT_ACCESS_SECRET` | Local secret | AWS Secrets Manager | AWS Secrets Manager | AWS Secrets Manager |
| `ALLOWED_ORIGINS` | localhost:3000 | your-domain.com | staging.your-domain.com | dev.your-domain.com |

**Cost Impact of Multiple Environments:**
- Production only: ~₹10,000/month
- + Staging: ~₹20,000/month total
- + Development: ~₹30,000/month total
