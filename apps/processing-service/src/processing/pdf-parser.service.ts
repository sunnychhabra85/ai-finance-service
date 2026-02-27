// =============================================================
// apps/processing-service/src/processing/pdf-parser.service.ts
// Parses raw OCR text into structured Transaction objects
// =============================================================

import { Injectable, Logger } from '@nestjs/common';

export interface ParsedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: 'DEBIT' | 'CREDIT';
  rawText: string;
}

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  // Common date patterns in bank statements
  private readonly DATE_PATTERNS = [
    /(\d{2}[-\/]\d{2}[-\/]\d{4})/,    // DD-MM-YYYY or DD/MM/YYYY
    /(\d{4}[-\/]\d{2}[-\/]\d{2})/,    // YYYY-MM-DD
    /(\d{2}\s+\w{3}\s+\d{4})/,        // 01 Jan 2024
    /(\w{3}\s+\d{2},?\s+\d{4})/,      // Jan 01, 2024
  ];

  // Amount patterns: handles INR, USD, commas, decimals
  private readonly AMOUNT_PATTERN = /(?:Rs\.?|INR|₹|\$)?\s*([\d,]+\.?\d{0,2})/i;

  // ── Main parse entry point ────────────────────────────────────
  parse(rawText: string): ParsedTransaction[] {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 5);

    const transactions: ParsedTransaction[] = [];

    for (const line of lines) {
      const tx = this.parseLine(line);
      if (tx) transactions.push(tx);
    }

    this.logger.log(`Parsed ${transactions.length} transactions from ${lines.length} lines`);
    return transactions;
  }

  // ── Try to parse a single line as a transaction ───────────────
  private parseLine(line: string): ParsedTransaction | null {
    // Must contain a date and an amount to be a transaction
    const date = this.extractDate(line);
    if (!date) return null;

    const amountMatch = line.match(this.AMOUNT_PATTERN);
    if (!amountMatch) return null;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return null;

    // Detect debit vs credit by keywords
    const lower = line.toLowerCase();
    const type: 'DEBIT' | 'CREDIT' =
      lower.includes('cr') ||
      lower.includes('credit') ||
      lower.includes('received') ||
      lower.includes('refund') ||
      lower.includes('cashback')
        ? 'CREDIT'
        : 'DEBIT';

    // Description: everything between date and amount
    const description = this.extractDescription(line, date.raw, amountMatch[0]);

    return {
      date,
      description: description || line.substring(0, 80),
      amount,
      type,
      rawText: line,
    };
  }

  private extractDate(line: string): (Date & { raw: string }) | null {
    for (const pattern of this.DATE_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const raw = match[1];
        const parsed = new Date(raw.replace(/(\d{2})[-\/](\d{2})[-\/](\d{4})/, '$3-$2-$1'));
        if (!isNaN(parsed.getTime())) {
          (parsed as any).raw = raw;
          return parsed as Date & { raw: string };
        }
      }
    }
    return null;
  }

  private extractDescription(line: string, dateStr: string, amountStr: string): string {
    const desc = line
      .replace(dateStr, '')
      .replace(amountStr, '')
      .replace(/\s+(CR|DR|CREDIT|DEBIT)\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return desc.substring(0, 200);
  }
}
