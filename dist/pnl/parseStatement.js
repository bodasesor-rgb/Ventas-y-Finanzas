"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePdfToLines = parsePdfToLines;
exports.summarizeByCategory = summarizeByCategory;
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const categorize_1 = require("./categorize");
const crypto_1 = require("crypto");
/**
 * Extrae texto del PDF y arma líneas con fecha/monto heurísticos.
 * Determinista: regex + reglas, sin IA.
 */
async function parsePdfToLines(buffer, rules) {
    const result = await (0, pdf_parse_1.default)(buffer);
    const text = result.text || "";
    const lines = extractLinesFromText(text, rules);
    return { text, lines };
}
function extractLinesFromText(text, rules) {
    const rawLines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 4);
    const out = [];
    const dateAmount = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}).{0,80}?([-+]?\(?\$?\s*[\d,]+\.\d{2}\)?)/;
    for (const raw of rawLines) {
        const m = raw.match(dateAmount);
        if (!m)
            continue;
        const date = m[1];
        const amountStr = m[2]
            .replace(/[$\s,]/g, "")
            .replace(/^\(/, "-")
            .replace(/\)$/, "");
        const amount = Number(amountStr);
        if (!Number.isFinite(amount) || amount === 0)
            continue;
        const description = raw.replace(m[0], " ").replace(/\s+/g, " ").trim() || raw;
        const direction = amount < 0 || /\b(cargo|retiro|compra|pago)\b/i.test(raw)
            ? "cargo"
            : amount > 0 && /\b(abono|deposito|depósito|spei recibido)\b/i.test(raw)
                ? "abono"
                : amount < 0
                    ? "cargo"
                    : "unknown";
        const signed = direction === "cargo" ? -Math.abs(amount) : Math.abs(amount);
        const cat = (0, categorize_1.categorizeLine)(description, signed, direction, rules);
        out.push({
            id: (0, crypto_1.randomUUID)(),
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
function summarizeByCategory(lines) {
    const summary = {};
    for (const line of lines) {
        summary[line.category] = (summary[line.category] || 0) + line.amount;
    }
    return summary;
}
//# sourceMappingURL=parseStatement.js.map