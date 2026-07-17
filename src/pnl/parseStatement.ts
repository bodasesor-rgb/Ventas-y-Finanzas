import { PDFParse } from "pdf-parse";
import { categorizeLine } from "./categorize";
import type { BankLine, RecurringRule } from "./types";
import { randomUUID } from "crypto";

/**
 * Extrae texto del PDF y arma líneas con fecha/monto heurísticos.
 * Determinista: regex + reglas, sin IA.
 */
export async function parsePdfToLines(
  buffer: Buffer,
  rules: RecurringRule[]
): Promise<{ text: string; lines: BankLine[] }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = result.text || "";
    const lines = extractLinesFromText(text, rules);
    return { text, lines };
  } finally {
    await parser.destroy();
  }
}

function extractLinesFromText(text: string, rules: RecurringRule[]): BankLine[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 4);

  const out: BankLine[] = [];

  // Ejemplos: 15/01/2026 ... 1,234.56 | 15-01-2026 | 2026-01-15
  const dateAmount =
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}).{0,80}?([-+]?\(?\$?\s*[\d,]+\.\d{2}\)?)/;

  for (const raw of rawLines) {
    const m = raw.match(dateAmount);
    if (!m) continue;

    const date = m[1];
    const amountStr = m[2].replace(/[$\s,]/g, "").replace(/^\(/, "-").replace(/\)$/, "");
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const description = raw.replace(m[0], " ").replace(/\s+/g, " ").trim() || raw;
    const direction: BankLine["direction"] =
      amount < 0 || /\b(cargo|retiro|compra|pago)\b/i.test(raw)
        ? "cargo"
        : amount > 0 && /\b(abono|deposito|depósito|spei recibido)\b/i.test(raw)
          ? "abono"
          : amount < 0
            ? "cargo"
            : "unknown";

    const signed =
      direction === "cargo" ? -Math.abs(amount) : Math.abs(amount);

    const cat = categorizeLine(description, signed, direction, rules);

    out.push({
      id: randomUUID(),
      raw,
      date,
      description,
      amount: signed,
      direction,
      category: cat.category,
      matchedRuleId: cat.matchedRuleId,
      needsReview: cat.needsReview,
    });
  }

  return out;
}

export function summarizeByCategory(
  lines: BankLine[]
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const line of lines) {
    summary[line.category] = (summary[line.category] || 0) + line.amount;
  }
  return summary;
}
