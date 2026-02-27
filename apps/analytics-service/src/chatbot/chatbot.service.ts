// =============================================================
// apps/analytics-service/src/chatbot/chatbot.service.ts
// AI Spending Assistant — RAG pattern using Anthropic Claude
// =============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../analytics/analytics.service';
import Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly analytics: AnalyticsService,
  ) {}

  async chat(userId: string, userMessage: string, history: ChatMessage[] = []): Promise<string> {
    const apiKey = this.config.get<string>('analytics.anthropicApiKey');
    if (!apiKey) {
      return this.mockResponse(userMessage);
    }

    // ── Step 1: Retrieve user spending context (RAG) ───────────
    const context = await this.analytics.getAISummary(userId);

    // ── Step 2: Build system prompt with spending data ─────────
    const systemPrompt = `You are a friendly personal finance assistant helping users understand their spending patterns.

Here is the user's current spending data:

SUMMARY:
- Total Spent (Debits): ₹${context.summary.totalDebit.toLocaleString()}
- Total Received (Credits): ₹${context.summary.totalCredit.toLocaleString()}
- Total Transactions: ${context.summary.totalTransactions}
- Net Balance: ₹${context.summary.netBalance.toLocaleString()}

TOP SPENDING CATEGORIES:
${context.categories.map((c) => `- ${c.category}: ₹${c.total.toLocaleString()} (${c.percentage}%)`).join('\n')}

RECENT MONTHLY TRENDS:
${context.trends.map((t) => `- ${t.month}: ₹${t.totalSpending.toLocaleString()} (Top: ${t.topCategory})${t.isSpike ? ' ⚠️ HIGH SPENDING' : ''}`).join('\n')}

IMPORTANT RULES:
1. Answer ONLY about the data above. Do not make up numbers.
2. Do NOT give financial advice (what to invest in, specific stocks, etc.)
3. You CAN suggest general saving tips like "You could reduce food spending"
4. Keep responses concise and friendly (2-4 sentences max unless explaining trends)
5. Use ₹ symbol for Indian Rupees`;

    // ── Step 3: Call Anthropic with conversation history ───────
    const client = new Anthropic({ apiKey });

    const messages = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMessage },
    ];

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Fast + cheap for chat
      max_tokens: this.config.get<number>('analytics.chatMaxTokens', 500),
      system: systemPrompt,
      messages,
    });

    return response.content[0].text;
  }

  // ── Fallback when no API key is configured ────────────────────
  private async mockResponse(question: string): Promise<string> {
    const q = question.toLowerCase();
    if (q.includes('most') || q.includes('where')) {
      return "Based on your transactions, Food & Dining is your highest spending category. Consider setting a monthly budget for it.";
    }
    if (q.includes('save') || q.includes('saving')) {
      return "You could save by reducing Entertainment subscriptions and ordering food less frequently. Try cooking at home a few extra days per week!";
    }
    if (q.includes('high') || q.includes('last month')) {
      return "Your spending last month was higher than average, mainly driven by Shopping. This may be seasonal — check if there were any one-time purchases.";
    }
    return "I can help you understand your spending patterns. Try asking 'Where am I spending most?' or 'How can I save money?'";
  }
}
