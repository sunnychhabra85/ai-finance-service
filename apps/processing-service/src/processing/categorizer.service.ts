// =============================================================
// apps/processing-service/src/processing/categorizer.service.ts
// Rule-based categorization with AI fallback via Anthropic
// =============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

type Category = 'Food' | 'Travel' | 'Shopping' | 'Bills' | 'Entertainment' | 'Others';

interface RuleSet {
  category: Category;
  keywords: string[];
}

const RULES: RuleSet[] = [
  {
    category: 'Food',
    keywords: [
      'swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'pizza', 'burger',
      'mcdonald', 'kfc', 'subway', 'dominos', 'starbucks', 'food', 'eat',
      'dining', 'bistro', 'bakery', 'grocery', 'supermarket', 'bigbasket',
      'dunzo', 'blinkit', 'zepto', 'instamart',
    ],
  },
  {
    category: 'Travel',
    keywords: [
      'uber', 'ola', 'rapido', 'irctc', 'railway', 'flight', 'airlines',
      'makemytrip', 'goibibo', 'yatra', 'redbus', 'metro', 'bus', 'cab',
      'taxi', 'petrol', 'fuel', 'parking', 'toll', 'indigo', 'spicejet',
      'air india', 'vistara', 'hotel', 'oyo', 'airbnb',
    ],
  },
  {
    category: 'Shopping',
    keywords: [
      'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'snapdeal',
      'shopify', 'retail', 'mall', 'store', 'purchase', 'market', 'shop',
      'fashion', 'clothing', 'apparel', 'shoes', 'electronics', 'croma',
      'reliance digital', 'vijay sales',
    ],
  },
  {
    category: 'Bills',
    keywords: [
      'electricity', 'water', 'gas', 'broadband', 'internet', 'airtel',
      'jio', 'vi ', 'vodafone', 'bsnl', 'dth', 'tata sky', 'dish tv',
      'emi', 'loan', 'insurance', 'premium', 'recharge', 'mobile', 'bill',
      'utility', 'maintenance', 'society', 'rent',
    ],
  },
  {
    category: 'Entertainment',
    keywords: [
      'netflix', 'amazon prime', 'hotstar', 'disney', 'spotify', 'youtube',
      'prime video', 'zee5', 'sonyliv', 'movie', 'cinema', 'pvr', 'inox',
      'gaming', 'steam', 'playstation', 'xbox', 'concert', 'event', 'show',
      'theatre', 'book', 'kindle', 'audible',
    ],
  },
];

@Injectable()
export class CategorizerService {
  private readonly logger = new Logger(CategorizerService.name);
  private readonly aiEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.aiEnabled = !!config.get<string>('processing.anthropicApiKey');
  }

  // ── Main categorization entry point ──────────────────────────
  async categorize(description: string): Promise<Category> {
    const lower = description.toLowerCase();

    // Step 1: Rule-based (fast, free, ~85% accurate)
    for (const rule of RULES) {
      if (rule.keywords.some((kw) => lower.includes(kw))) {
        return rule.category;
      }
    }

    // Step 2: AI fallback (slower, costs money — only for unknowns)
    if (this.aiEnabled) {
      try {
        return await this.categorizeWithAI(description);
      } catch (err) {
        this.logger.warn(`AI categorization failed, defaulting to Others: ${err.message}`);
      }
    }

    return 'Others';
  }

  // ── Bulk categorize (batch for efficiency) ───────────────────
  async categorizeBatch(
    descriptions: string[],
  ): Promise<Category[]> {
    return Promise.all(descriptions.map((d) => this.categorize(d)));
  }

  // ── AI fallback using Anthropic ───────────────────────────────
  private async categorizeWithAI(description: string): Promise<Category> {
    // Lazy import to avoid error if SDK not installed
    const client = new Anthropic({
      apiKey: this.config.get<string>('processing.anthropicApiKey'),
    });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Fastest + cheapest for categorization
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: `Categorize this bank transaction into exactly one category.
Categories: Food, Travel, Shopping, Bills, Entertainment, Others
Transaction: "${description}"
Reply with ONLY the category name, nothing else.`,
        },
      ],
    });

    const category = response.content[0].text.trim() as Category;
    const valid: Category[] = ['Food', 'Travel', 'Shopping', 'Bills', 'Entertainment', 'Others'];
    return valid.includes(category) ? category : 'Others';
  }
}
