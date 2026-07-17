"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeLine = categorizeLine;
const store_1 = require("./store");
/** Heurística: SPEI a nombre propio / “a favor de” → revisar (persona) */
const PERSON_HINTS = /\b(spei|transferencia|traspaso)\b.*\b(a favor|beneficiario|nombre)\b|\b(nomina|nómina|sueldo|honorarios)\b/i;
function categorizeLine(description, amount, direction, rules) {
    const desc = description.toLowerCase();
    // Ingresos claros (categoría kind=ingreso)
    if (direction === "abono" || amount > 0) {
        for (const rule of rules) {
            if ((0, store_1.isIncomeCategory)(rule.category) &&
                desc.includes(rule.match.toLowerCase())) {
                return {
                    category: rule.category,
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
                needsReview: rule.category === "transferencia_persona" ||
                    rule.category === "revisar",
            };
        }
    }
    if (PERSON_HINTS.test(description)) {
        return {
            category: "transferencia_persona",
            needsReview: true,
        };
    }
    // Abono sin regla → ingreso genérico (verde), no “revisar”
    if (direction === "abono" || amount > 0) {
        return {
            category: "ingreso",
            needsReview: false,
        };
    }
    return {
        category: "revisar",
        needsReview: true,
    };
}
//# sourceMappingURL=categorize.js.map