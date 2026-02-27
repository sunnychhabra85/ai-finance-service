// =============================================================
// apps/analytics-service/src/analytics/analytics.controller.ts
// =============================================================

import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // GET /api/v1/analytics/dashboard?documentId=xxx
  @Get('dashboard')
  @ApiOperation({ summary: 'Full dashboard: summary + categories + trends + recent transactions' })
  async getDashboard(@Req() req: any, @Query('documentId') documentId?: string) {
    const data = await this.analyticsService.getDashboard(req.user.id, documentId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // GET /api/v1/analytics/summary
  @Get('summary')
  @ApiOperation({ summary: 'Summary cards: total debit, credit, transactions' })
  async getSummary(@Req() req: any, @Query('documentId') documentId?: string) {
    const data = await this.analyticsService.getSummary(req.user.id, documentId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // GET /api/v1/analytics/categories
  @Get('categories')
  @ApiOperation({ summary: 'Category-wise spending breakdown with percentages' })
  async getCategories(@Req() req: any, @Query('documentId') documentId?: string) {
    const data = await this.analyticsService.getCategoryBreakdown(req.user.id, documentId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // GET /api/v1/analytics/trends
  @Get('trends')
  @ApiOperation({ summary: 'Monthly spending trends with spike detection' })
  async getTrends(@Req() req: any, @Query('documentId') documentId?: string) {
    const data = await this.analyticsService.getMonthlyTrends(req.user.id, documentId);
    return { success: true, data, timestamp: new Date().toISOString() };
  }

  // GET /api/v1/analytics/transactions
  @Get('transactions')
  @ApiOperation({ summary: 'Paginated transactions list with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'category', required: false, enum: ['Food','Travel','Shopping','Bills','Entertainment','Others'] })
  @ApiQuery({ name: 'type', required: false, enum: ['DEBIT','CREDIT'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  async getTransactions(@Req() req: any, @Query() query: any) {
    const data = await this.analyticsService.getTransactions(req.user.id, {
      documentId: query.documentId,
      page: parseInt(query.page) || 1,
      pageSize: parseInt(query.pageSize) || 20,
      category: query.category,
      type: query.type,
      search: query.search,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    return { success: true, data, timestamp: new Date().toISOString() };
  }
}
