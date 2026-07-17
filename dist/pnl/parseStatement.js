"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePdfToLines = parsePdfToLines;
exports.extractLinesFromText = extractLinesFromText;
exports.summarizeByCategory = summarizeByCategory;
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const categorize_1 = require("./categorize");
const crypto_1 = require("crypto");
const MONTH_RE = "ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC";
const MONTH_NUM = {
    ene: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dic: "12",
};
async function parsePdfToLines(buffer, rules) {
    const result = await (0, pdf_parse_1.default)(buffer);
    const text = result.text || "";
    const lines = extractLinesFromText(text, rules);
    return { text, lines };
}
function cleanBlock(body) {
    return body
        // Tipo de cambio Banamex: T.C. 17.321300 pegado al monto MXN
        .replace(/U\.S\.\s*Dollar\s*T\.C\.\s*\d+\.\d{6}/gi, " ")
        .replace(/\bT\.C\.\s*\d+\.\d{6}/gi, " ")
        .replace(/\b\d{12,}\b/g, " ")
        .replace(/\b20\d{6}\b/g, " ")
        .replace(/\b900[01]\/\d+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/** Encuentra montos MXN; soporta concatenados 2,500.009,990.05 */
function findMoneyAmounts(s) {
    const re = /(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g;
    const out = [];
    let m;
    while ((m = re.exec(s)) !== null) {
        const n = Number(m[0].replace(/,/g, ""));
        if (Number.isFinite(n) && n > 0)
            out.push(n);
    }
    return out;
}
function extractBanamex(text, rules) {
    const out = [];
    const seen = new Set();
    const blockRe = new RegExp(`(\\d{1,2})(${MONTH_RE})([\\s\\S]*?)(?=\\d{1,2}(?:${MONTH_RE})|$)`, "gi");
    let m;
    while ((m = blockRe.exec(text)) !== null) {
        const day = m[1].padStart(2, "0");
        const mon = MONTH_NUM[m[2].toLowerCase()] || m[2];
        const date = `${day}/${mon}`;
        const rawBody = (m[3] || "").replace(/\s+/g, " ").trim();
        if (!rawBody)
            continue;
        if (/^SALDO ANTERIOR/i.test(rawBody))
            continue;
        const body = cleanBlock(rawBody);
        const amounts = findMoneyAmounts(body);
        if (amounts.length === 0)
            continue;
        // Último = saldo; penúltimo = movimiento (si solo hay 1, es el movimiento)
        let move = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
        // Descartar movimientos absurdos (ruido de parseo)
        if (move > 2_000_000)
            continue;
        let desc = body;
        const moneyBits = body.match(/(?:(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\s*)+$/);
        if (moneyBits && moneyBits.index != null) {
            desc = body.slice(0, moneyBits.index).trim();
        }
        desc = desc
            .replace(/(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (desc.length < 3)
            continue;
        if (/^SALDO ANTERIOR/i.test(desc))
            continue;
        if (/^P[aá]gina\b/i.test(desc))
            continue;
        const isAbono = /PAGO RECIBIDO|DEP[OÓ]SITO|ABONO|SPEI RECIBIDO|TRANSFER[A-ZÁÉÍÓÚ ]*RECIB/i.test(desc);
        const signed = isAbono ? Math.abs(move) : -Math.abs(move);
        const direction = isAbono ? "abono" : "cargo";
        const key = `${date}|${desc.slice(0, 50)}|${signed.toFixed(2)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const cat = (0, categorize_1.categorizeLine)(desc, signed, direction, rules);
        out.push({
            id: (0, crypto_1.randomUUID)(),
            raw: `${day}${m[2].toUpperCase()} ${rawBody.slice(0, 140)}`,
            date,
            description: desc.slice(0, 220),
            amount: Math.round(signed * 100) / 100,
            direction,
            category: cat.category,
            matchedRuleId: cat.matchedRuleId,
            needsReview: cat.needsReview,
        });
    }
    return out;
}
function extractLinesFromText(text, rules) {
    const banamexHits = (text.match(new RegExp(`\\d{1,2}(?:${MONTH_RE})`, "gi")) || []).length;
    if (banamexHits >= 5) {
        const lines = extractBanamex(text, rules);
        if (lines.length > 0)
            return lines;
    }
    return extractGeneric(text, rules);
}
function extractGeneric(text, rules) {
    const out = [];
    const seen = new Set();
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 5);
    const re = /^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+(-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/;
    for (const raw of lines) {
        const m = raw.match(re);
        if (!m)
            continue;
        const amount = Number(m[3].replace(/[$,]/g, ""));
        if (!Number.isFinite(amount) || amount === 0)
            continue;
        const desc = m[2].trim();
        const key = `${m[1]}|${desc}|${amount}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const isAbono = /PAGO RECIBIDO|DEP[OÓ]SITO|ABONO/i.test(desc);
        const signed = isAbono ? Math.abs(amount) : -Math.abs(amount);
        const direction = isAbono ? "abono" : "cargo";
        const cat = (0, categorize_1.categorizeLine)(desc, signed, direction, rules);
        out.push({
            id: (0, crypto_1.randomUUID)(),
            raw,
            date: m[1],
            description: desc,
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