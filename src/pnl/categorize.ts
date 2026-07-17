import type { BankLine, PnlCategory, RecurringRule } from "./types";

/** Heurística: SPEI a nombre propio / “a favor de” → revisar (persona) */
const PERSON_HINTS =
  /\b(spei|transferencia|traspaso)\b.*\b(a favor|beneficiario|nombre)\b|\b(nomina|nómina|sueldo|honorarios)\b/i;

export function categorizeLine(
  description: string,
  amount: number,
  direction: BankLine["direction"],
  rules: RecurringRule[]
): Pick<BankLine, "category" | "matchedRuleId" | "needsReview"> {
  const desc = description.toLowerCase();

  // Ingresos claros
  if (direction === "abono" || amount > 0) {
    for (const rule of rules) {
      if (rule.category === "ingreso" && desc.includes(rule.match.toLowerCase())) {
        return {
          category: "ingreso",
          matchedRuleId: rule.id,
          needsReview: false,
        };
      }
    }
  }

  // Reglas frecuentes (ads, pass, etc.) — match simple contains
  const sorted = [...rules].sort((a, b) => b.match.length - a.match.length);
  for (const rule of sorted) {
    const m = rule.match.toLowerCase().replace(/\*/g, "");
    if (m && desc.includes(m)) {
      return {
        category: rule.category,
        matchedRuleId: rule.id,
        needsReview: rule.category === "transferencia_persona",
      };
    }
  }

  if (PERSON_HINTS.test(description)) {
    return {
      category: "transferencia_persona",
      needsReview: true,
    };
  }

  return {
    category: "revisar" as PnlCategory,
    needsReview: true,
  };
}
