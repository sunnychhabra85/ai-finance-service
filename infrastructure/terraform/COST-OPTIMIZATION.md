# 💰 Cost-Optimized Learning Setup

## Current Monthly Cost Estimate: ~$90-120/month

### ✅ What's Running (Learning Mode)
| Service | Configuration | Cost/Month | Notes |
|---------|--------------|------------|-------|
| **EKS Control Plane** | Always on | **$72** | Fixed cost (no free tier) |
| **EKS Worker Nodes** | 2x t3.small | **~$30** | ~$0.0208/hr × 2 × 730hrs |
| **NAT Gateway** | 1 shared (not per-AZ) | **~$32** | $0.045/hr + data transfer |
| **RDS PostgreSQL** | db.t3.micro, single-AZ | **FREE** 🎉 | Free tier: 750hrs/mo for 12 months |
| **ElastiCache Redis** | cache.t3.micro, single node | **~$12** | $0.017/hr |
| **S3 Storage** | Uploads bucket | **~$1** | $0.023/GB (first 50GB/mo) |
| **SQS** | Document processing | **~$0** | First 1M requests free |
| **Secrets Manager** | 5 secrets | **~$2** | $0.40/secret/month |
| **ECR Repositories** | 5 Docker repos | **~$1** | $0.10/GB/month |
| **CloudWatch Logs** | Application logs | **~$5** | $0.50/GB ingestion |
| **Elastic IPs** | 2 (for NAT + spare) | **~$7** | $0.005/hr if unattached |

### 💡 Total: ~$162/month → **~$90/month** (after RDS free tier)

---

## 🔧 Cost Optimizations Applied

### 1. **NAT Gateway: 1 instead of 3** → **Saves $64/month**
- **Current:** Single NAT shared across all availability zones
- **Trade-off:** If NAT fails, all private resources lose internet
- **Upgrade path:** In `modules/vpc/main.tf`, change:
  ```hcl
  # Change this:
  count = 1
  # To this:
  count = length(var.availability_zones)
  ```

### 2. **Availability Zones: 2 instead of 3** → **Saves $32/month**
- **Current:** 2 AZs (ap-south-1a, ap-south-1b)
- **Trade-off:** Less fault tolerance
- **Upgrade path:** In `variables.tf`, change:
  ```hcl
  variable "availability_zones" { 
    default = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
  }
  ```

### 3. **EKS Nodes: t3.small instead of t3.medium** → **Saves $30/month**
- **Current:** 2x t3.small (2 vCPU, 2GB RAM each)
- **Trade-off:** Less memory for AI/ML workloads
- **Upgrade path:** In `variables.tf`, change:
  ```hcl
  variable "eks_node_instance_type" { default = "t3.medium" }
  ```

### 4. **RDS: Single-AZ** → **FREE (first 12 months)**
- **Current:** db.t3.micro, single-AZ
- **Trade-off:** ~30 seconds downtime during maintenance
- **Upgrade path:** In `modules/rds/main.tf`, change:
  ```hcl
  multi_az = true  # Doubles cost to ~$25/mo
  ```

### 5. **ElastiCache: 1 node, no encryption** → **Saves $12/month**
- **Current:** Single node, no encryption (t3.micro doesn't support it)
- **Trade-off:** No automatic failover, unencrypted cache
- **Upgrade path:** In `modules/elasticache/main.tf`, change:
  ```hcl
  node_type = "cache.t3.small"  # Supports encryption
  num_cache_clusters = 2
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = true
  ```

---

## 📈 Production-Ready Upgrade Checklist

When you're ready to scale for production, uncomment/change:

- [ ] **NAT Gateway:** 3 NATs (one per AZ) for HA
- [ ] **Availability Zones:** Add 3rd AZ
- [ ] **EKS Nodes:** Upgrade to t3.medium or larger
- [ ] **RDS:** Enable Multi-AZ (`multi_az = true`)
- [ ] **ElastiCache:** 2+ nodes with encryption
- [ ] **EKS Autoscaling:** Increase max_nodes to 10+
- [ ] **Monitoring:** Enable detailed CloudWatch metrics
- [ ] **Backups:** Review RDS backup retention (currently 7 days)
- [ ] **SSL/TLS:** Add ACM certificate for HTTPS

### Estimated Production Cost: **~$250-350/month**

---

## 🆓 Free Tier Resources (12 months)

- **RDS:** 750hrs/month of db.t3.micro (single-AZ only)
- **EC2:** 750hrs/month of t2.micro/t3.micro (but EKS uses t3.small)
- **S3:** 5GB storage, 20,000 GET, 2,000 PUT requests
- **CloudWatch:** 10 custom metrics, 10 alarms
- **Secrets Manager:** 30-day trial (then $0.40/secret/month)

---

## 💸 Further Cost Reductions (if needed)

### Option A: Stop EKS at night (-40% cost)
```bash
# Stop nodes at night (EKS control plane still charges $72/mo)
aws eks update-nodegroup-config \
  --cluster-name production-cluster \
  --nodegroup-name production-nodes \
  --scaling-config minSize=0,maxSize=0,desiredSize=0
```

### Option B: Use Local Development Only
- Keep LocalStack + Docker Compose for learning
- Only deploy to AWS when testing production features
- **Cost:** $0/month for development

### Option C: Spot Instances for EKS (-70% cost)
- Use spot instances for worker nodes
- **Risk:** Nodes can be terminated with 2-minute warning
- Edit `modules/eks/main.tf` to add spot configuration

---

## 📊 Cost Monitoring

### Set up billing alerts:
```bash
aws budgets create-budget \
  --account-id YOUR_ACCOUNT_ID \
  --budget file://budget.json
```

### Check current spending:
```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-02-01,End=2026-02-28 \
  --granularity MONTHLY \
  --metrics BlendedCost
```

---

## 🎓 Learning Tips

1. **Destroy infra when not using it:**
   ```bash
   terraform destroy  # Saves everything except $72 EKS control plane
   ```

2. **Use LocalStack for most development:**
   - S3, SQS, Secrets Manager work locally
   - Only test on real AWS when needed

3. **Monitor your Free Tier usage:**
   - AWS Console → Billing → Free Tier
   - Set up alerts at 80% usage

4. **Tag everything for cost tracking:**
   - Already configured in `providers.tf`
   - View costs by tag in AWS Cost Explorer

---

## 📞 Need Help?

- **Cost Explorer:** [AWS Console → Billing → Cost Explorer](https://console.aws.amazon.com/cost-management/home)
- **Free Tier Usage:** [AWS Console → Billing → Free Tier](https://console.aws.amazon.com/billing/home#/freetier)
- **AWS Calculator:** https://calculator.aws/
