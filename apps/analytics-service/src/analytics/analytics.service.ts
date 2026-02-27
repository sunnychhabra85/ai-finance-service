// =============================================================
// apps/analytics-service/src/analytics/analytics.service.ts
// Dashboard aggregations: summary cards, categories, monthly trends
// All expensive queries are cached in Redis (5min TTL)
// =============================================================

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@finance/database';
import { CacheService } from './cache.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  // ── Full Dashboard ────────────────────────────────────────────
  async getDashboard(userId: string, documentId?: string) {
    const cacheKey = `dashboard:${userId}:${documentId || 'all'}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const [summary, categories, monthlyTrends, recentTransactions] = await Promise.all([
      this.getSummary(userId, documentId),
      this.getCategoryBreakdown(userId, documentId),
      this.getMonthlyTrends(userId, documentId),
      this.getRecentTransactions(userId, documentId, 10),
    ]);

    const result = { summary, categories, monthlyTrends, recentTransactions };
    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  // ── Summary Cards (Total Debit / Credit / Count) ──────────────
  async getSummary(userId: string, documentId?: string) {
    const where = this.buildWhere(userId, documentId);

    const [debits, credits, total] = await Promise.all([
      this.db.transaction.aggregate({
        where: { ...where, type: 'DEBIT' },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.transaction.aggregate({
        where: { ...where, type: 'CREDIT' },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.transaction.count({ where }),
    ]);

    return {
      totalDebit: Number(debits._sum.amount || 0),
      totalCredit: Number(credits._sum.amount || 0),
      totalTransactions: total,
      debitCount: debits._count,
      creditCount: credits._count,
      netBalance: Number(credits._sum.amount || 0) - Number(debits._sum.amount || 0),
    };
  }

  // ── Category Breakdown ────────────────────────────────────────
  async getCategoryBreakdown(userId: string, documentId?: string) {
    const where = this.buildWhere(userId, documentId, 'DEBIT'); // Only debits for spending

    const raw = await this.db.transaction.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
    });

    const total = raw.reduce((acc, r) => acc + Number(r._sum.amount || 0), 0);

    return raw.map((r) => ({
      category: r.category,
      total: Number(r._sum.amount || 0),
      count: r._count,
      percentage: total > 0 ? Math.round((Number(r._sum.amount || 0) / total) * 100) : 0,
    }));
  }

  // ── Monthly Trends with Anomaly Detection ────────────────────
  async getMonthlyTrends(userId: string, documentId?: string) {
    const where = this.buildWhere(userId, documentId, 'DEBIT');

    // Get all debit transactions grouped by month
    const transactions = await this.db.transaction.findMany({
      where,
      select: { date: true, amount: true, category: true },
      orderBy: { date: 'asc' },
    });

    // Group by month manually (Prisma doesn't have native month groupBy for all DBs)
    const monthMap = new Map<string, { total: number; categories: Map<string, number> }>();

    for (const tx of transactions) {
      const monthKey = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { total: 0, categories: new Map() });
      }
      const month = monthMap.get(monthKey)!;
      const amount = Number(tx.amount);
      month.total += amount;
      month.categories.set(tx.category, (month.categories.get(tx.category) || 0) + amount);
    }

    const months = Array.from(monthMap.entries()).map(([month, data]) => {
      const topCategory = Array.from(data.categories.entries()).sort((a, b) => b[1] - a[1])[0];
      return {
        month,
        totalSpending: Math.round(data.total),
        topCategory: topCategory?.[0] || 'Others',
        topCategoryAmount: Math.round(topCategory?.[1] || 0),
      };
    });

    // Anomaly detection: flag months > 1.5x average
    const avg = months.reduce((s, m) => s + m.totalSpending, 0) / (months.length || 1);
    return months.map((m) => ({
      ...m,
      isSpike: m.totalSpending > avg * 1.5,
      percentVsAverage: Math.round((m.totalSpending / avg - 1) * 100),
    }));
  }

  // ── Transactions List (paginated + filterable) ────────────────
  async getTransactions(
    userId: string,
    opts: {
      documentId?: string;
      page?: number;
      pageSize?: number;
      category?: string;
      type?: 'DEBIT' | 'CREDIT';
      search?: string;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    const page = opts.page || 1;
    const pageSize = Math.min(opts.pageSize || 20, 100);
    const skip = (page - 1) * pageSize;

    const where: any = { document: { userId } };
    if (opts.documentId) where.documentId = opts.documentId;
    if (opts.category) where.category = opts.category;
    if (opts.type) where.type = opts.type;
    if (opts.search) where.description = { contains: opts.search, mode: 'insensitive' };
    if (opts.fromDate || opts.toDate) {
      where.date = {};
      if (opts.fromDate) where.date.gte = new Date(opts.fromDate);
      if (opts.toDate) where.date.lte = new Date(opts.toDate);
    }

    const [items, total] = await Promise.all([
      this.db.transaction.findMany({
        where,
        select: { id: true, date: true, description: true, amount: true, type: true, category: true },
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
      }),
      this.db.transaction.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // ── Build AI context summary ──────────────────────────────────
  // Used by chatbot to provide spending context to the AI
  async getAISummary(userId: string) {
    const [summary, categories, trends] = await Promise.all([
      this.getSummary(userId),
      this.getCategoryBreakdown(userId),
      this.getMonthlyTrends(userId),
    ]);
    return { summary, categories: categories.slice(0, 5), trends: trends.slice(-3) };
  }

  // ── Helpers ───────────────────────────────────────────────────
  private buildWhere(userId: string, documentId?: string, type?: 'DEBIT' | 'CREDIT') {
    const where: any = { document: { userId } };
    if (documentId) where.documentId = documentId;
    if (type) where.type = type;
    return where;
  }

  private async getRecentTransactions(userId: string, documentId?: string, limit = 10) {
    return this.db.transaction.findMany({
      where: this.buildWhere(userId, documentId),
      select: { id: true, date: true, description: true, amount: true, type: true, category: true },
      orderBy: { date: 'desc' },
      take: limit,
    });
  }
}
