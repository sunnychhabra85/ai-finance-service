# Finance Platform — AI-Powered Transaction Analyzer

A production-ready microservices platform built with NestJS, PostgreSQL, AWS (S3, SQS, Textract), and Anthropic AI.

## Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │              ALB (AWS Load Balancer)         │
                         └────┬──────────┬──────────┬──────────┬───────┘
                              │          │          │          │
                    /api/v1/auth  /upload  /analytics  /chat  /notifications
                              │          │          │          │
                    ┌─────────┘  ┌───────┘  ┌───────┘  ┌─────┘
                    │            │          │          │
             ┌──────┴──┐  ┌─────┴───┐ ┌────┴────┐ ┌──┴────────────┐
             │  Auth   │  │ Upload  │ │Analytics│ │ Notification  │
             │ :3001   │  │  :3002  │ │  :3004  │ │    :3005      │
             └────┬────┘  └────┬────┘ └────┬────┘ └───────────────┘
                  │            │           │
           ┌──────┘    S3+SQS─┘           │ Redis Cache
           │                              │
    ┌──────┴──────────────────────────────┴──────┐
    │              PostgreSQL (RDS)               │
    └─────────────────────┬───────────────────────┘
                          │ SQS
                   ┌──────┴──────┐
                   │ Processing  │ ← SQS Worker
                   │   :3003     │   (Textract OCR)
                   └─────────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| auth-service | 3001 | JWT auth, register, login, refresh tokens |
| upload-service | 3002 | Presigned S3 URLs, upload confirmation, SQS trigger |
| processing-service | 3003 | SQS consumer, Textract OCR, transaction parsing, categorization |
| analytics-service | 3004 | Dashboard APIs, AI chatbot (Anthropic) |
| notification-service | 3005 | SSE real-time document status updates |

## Quick Start (Local Dev)

### 1. Clone & Install
```bash
git clone https://github.com/your-org/finance-platform
cd finance-platform
npm install
npx prisma generate --schema=libs/database/prisma/schema.prisma
```

### 2. Start Infrastructure
```bash
docker-compose up -d postgres redis localstack
```

### 3. Init LocalStack (S3 + SQS)
```bash
aws configure set aws_access_key_id test
aws configure set aws_secret_access_key test
aws configure set region ap-south-1
aws --endpoint-url=http://localhost:4566 s3 mb s3://finance-platform-uploads-dev
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name document-processing-dlq
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name document-processing --attributes VisibilityTimeout=300
```

### 4. Run Migrations
```bash
npm run prisma:migrate:dev
```

### 5. Start Services (5 terminals)
```bash
npm run start:auth          # http://localhost:3001
npm run start:upload        # http://localhost:3002
npm run start:processing    # http://localhost:3003
npm run start:analytics     # http://localhost:3004
npm run start:notification  # http://localhost:3005
```

### 6. (Optional) Run via Docker Compose
```bash
docker-compose up --build
```

## API Reference

### Auth Service — http://localhost:3001
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/v1/auth/register | No | Create account |
| POST | /api/v1/auth/login | No | Login, get tokens |
| POST | /api/v1/auth/refresh | Bearer refresh | Rotate tokens |
| POST | /api/v1/auth/logout | Bearer access | Revoke session |
| DELETE | /api/v1/auth/sessions | Bearer access | Revoke all sessions |
| GET | /api/v1/auth/me | Bearer access | Get current user |

### Upload Service — http://localhost:3002
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/v1/upload/presigned-url | Bearer | Step 1: Get S3 upload URL |
| PUT | {presignedUrl} (S3 direct) | None | Step 2: Upload file to S3 |
| POST | /api/v1/upload/confirm | Bearer | Step 3: Confirm + trigger processing |
| GET | /api/v1/upload/documents | Bearer | List documents (paginated) |
| GET | /api/v1/upload/documents/:id/status | Bearer | Poll status |
| DELETE | /api/v1/upload/documents/:id | Bearer | Delete document |

### Analytics Service — http://localhost:3004
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/v1/analytics/dashboard | Bearer | Full dashboard data |
| GET | /api/v1/analytics/summary | Bearer | Total debit/credit/count |
| GET | /api/v1/analytics/categories | Bearer | Category breakdown + % |
| GET | /api/v1/analytics/trends | Bearer | Monthly trends + spike detection |
| GET | /api/v1/analytics/transactions | Bearer | Paginated + filtered list |
| POST | /api/v1/chat | Bearer | AI chatbot question |

### Notification Service — http://localhost:3005
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET (SSE) | /api/v1/notifications/documents/:id/status-stream | Bearer | Real-time status updates |

## End-to-End Test Flow

```bash
# 1. Register & Login
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"SecureP@ss123"}' \
  | jq -r '.data.tokens.accessToken')

# 2. Get presigned upload URL
RESULT=$(curl -s -X POST http://localhost:3002/api/v1/upload/presigned-url \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"statement.pdf","contentType":"application/pdf","fileSize":102400}')
UPLOAD_URL=$(echo $RESULT | jq -r '.data.uploadUrl')
DOC_ID=$(echo $RESULT | jq -r '.data.documentId')

# 3. Upload file to S3
curl -X PUT "$UPLOAD_URL" -H "Content-Type: application/pdf" --data-binary @statement.pdf

# 4. Confirm upload (triggers processing)
curl -s -X POST http://localhost:3002/api/v1/upload/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"documentId\":\"$DOC_ID\"}"

# 5. Poll status until COMPLETED
curl -s "http://localhost:3002/api/v1/upload/documents/$DOC_ID/status" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 6. View dashboard
curl -s http://localhost:3004/api/v1/analytics/dashboard \
  -H "Authorization: Bearer $TOKEN" | jq .

# 7. Ask the AI chatbot
curl -s -X POST http://localhost:3004/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Where am I spending most of my money?"}' | jq .
```

## Running Tests
```bash
npm run test           # All services
npm run test:auth      # Auth only
npm run test:upload    # Upload only
```

## AWS Deployment
```bash
# 1. Bootstrap Terraform state
aws s3 mb s3://finance-platform-terraform-state
aws dynamodb create-table --table-name terraform-state-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# 2. Provision infrastructure
cd infrastructure/terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# 3. Configure kubectl
aws eks update-kubeconfig --name production-cluster --region ap-south-1

# 4. Deploy applications
kubectl apply -f ../k8s/namespace.yaml
kubectl apply -f ../k8s/ingress.yaml
for svc in auth-service upload-service processing-service analytics-service notification-service; do
  kubectl apply -f ../k8s/$svc/
done
```

## Swagger Docs (Dev Only)
- Auth: http://localhost:3001/api/docs
- Upload: http://localhost:3002/api/docs
- Analytics: http://localhost:3004/api/docs

## Environment Variables
See `.env.example` for all variables. For production, all secrets are stored in AWS Secrets Manager and synced via External Secrets Operator.
