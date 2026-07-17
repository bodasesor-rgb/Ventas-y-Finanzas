"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeLine = categorizeLine;
const store_1 = require("./store");
/** SPEI/transferencia a persona → revisar */
const PERSON_HINTS = /\b(spei|transferencia|traspaso|pago interbancario)\b.*\b(a favor|beneficiario|al benef)/i;
function categorizeLine(description, amount, direction, rules) {
    const desc = description.toLowerCase();
    // Solo buscar reglas de ingreso si el movimiento ES abono
    if (direction === "abono") {
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
        return {
            category: "ingreso",
            needsReview: false,
        };
    }
    // Cargos: reglas de gasto (nunca forzar ingreso por monto)
    const sorted = [...rules].sort((a, b) => b.match.length - a.match.length);
    for (const rule of sorted) {
        if ((0, store_1.isIncomeCategory)(rule.category))
            continue;
        const m = rule.match.toLowerCase().replace(/\*/g, "");
        if (m && m.length >= 3 && desc.includes(m)) {
            return {
                category: rule.category,
                matchedRuleId: rule.id,
                needsReview: rule.category === "transferencia_persona" ||
                    rule.category === "revisar",
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
        category: "revisar",
        needsReview: true,
    };
}
//# sourceMappingURL=categorize.js.map