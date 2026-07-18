import type { BankLine, PnlCategory, RecurringRule } from "./types";
import { isIncomeCategory } from "./store";

/** SPEI/transferencia a persona → revisar */
const PERSON_HINTS =
  /\b(spei|transferencia|traspaso|pago interbancario)\b.*\b(a favor|beneficiario|al benef)/i;

export function categorizeLine(
  description: string,
  amount: number,
  direction: BankLine["direction"],
  rules: RecurringRule[]
): Pick<BankLine, "category" | "matchedRuleId" | "needsReview"> {
  const desc = description.toLowerCase();

  // Solo buscar reglas de ingreso si el movimiento ES abono
  if (direction === "abono") {
    for (const rule of rules) {
      if (
        isIncomeCategory(rule.category) &&
        desc.includes(rule.match.toLowerCase())
      ) {
        return {
          category: rule.category,
          matchedRuleId: rule.id,
          needsReview: false,
        };
      }
    }
    return {
      category: "ingreso" as PnlCategory,
      needsReview: false,
    };
  }

  // Cargos: reglas de gasto (nunca forzar ingreso por monto)
  const sorted = [...rules].sort((a, b) => b.match.length - a.match.length);
  for (const rule of sorted) {
    if (isIncomeCategory(rule.category)) continue;
    const m = rule.match.toLowerCase().replace(/\*/g, "");
    if (m && m.length >= 3 && desc.includes(m)) {
      return {
        category: rule.category,
        matchedRuleId: rule.id,
        needsReview:
          rule.category === "transferencia_persona" ||
          rule.category === "revisar" ||
          rule.category === "proveedor",
      };
    }
  }

  if (PERSON_HINTS.test(description) || /\bpago interbancario a\b/i.test(desc)) {
    return {
      category: "transferencia_persona",
      needsReview: true,
    };
  }

  if (/\bcomisi[oó]n\b|\biva comisi/i.test(desc)) {
    return { category: "comisiones", needsReview: false };
  }

  return {
    category: "revisar" as PnlCategory,
    needsReview: true,
  };
}
