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
/**
 * Extrae texto del PDF y arma líneas con fecha/monto.
 * Incluye heurísticas para estados Citibanamex / Banamex.
 */
async function parsePdfToLines(buffer, rules) {
    const result = await (0, pdf_parse_1.default)(buffer);
    const text = result.text || "";
    const lines = extractLinesFromText(text, rules);
    return { text, lines };
}
const MONTHS = {
    ene: "01",
    jan: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dic: "12",
    dec: "12",
};
function normalizeAmount(raw) {
    let s = raw.replace(/[$\s]/g, "").replace(/^\(/, "-").replace(/\)$/, "");
    // 1.234,56 → 1234.56 | 1,234.56 → 1234.56
    if (/\d,\d{2}$/.test(s) && s.includes(".")) {
        s = s.replace(/\./g, "").replace(",", ".");
    }
    else if (/\d,\d{2}$/.test(s)) {
        s = s.replace(",", ".");
    }
    else {
        s = s.replace(/,/g, "");
    }
    const n = Number(s);
    return Number.isFinite(n) && n !== 0 ? n : null;
}
function looksLikeHeaderNoise(line) {
    return /saldo anterior|saldo al corte|saldo promedio|p[aá]gina \d|clabe|n[uú]mero de cuenta|gat nominal|comisiones efectivamente|fecha de corte|per[ií]odo|contrato|sucursal|rfc|cliente/i.test(line);
}
function extractLinesFromText(text, rules) {
    // Unir saltos raros del PDF Banamex
    const normalized = text
        .replace(/\r/g, "\n")
        .replace(/([^\n])\n(?!\d{1,2}[\/\-\s])/g, "$1 ")
        .replace(/[ \t]+/g, " ");
    const rawLines = normalized
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 6);
    const out = [];
    const seen = new Set();
    // 01/06/2026 DESC 1,234.56
    const reFull = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})$/i;
    // 01/06 DESC 1234.56
    const reShort = /^(\d{1,2}[\/\-]\d{1,2})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})$/i;
    // 01 JUN DESC 1,234.56
    const reMon = /^(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]{3})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})$/i;
    // DESC...$1,234.56 con fecha embebida al inicio o en medio
    const reLoose = /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{1,2}\s+[A-Za-z]{3}).{3,120}?(-?\$?\s*[\d,]+\.\d{2})/;
    function pushLine(date, description, amountRaw, raw) {
        if (looksLikeHeaderNoise(raw) || looksLikeHeaderNoise(description))
            return;
        const amountAbs = normalizeAmount(amountRaw);
        if (amountAbs == null)
            return;
        const desc = description.replace(/\s+/g, " ").trim();
        if (desc.length < 3)
            return;
        const key = `${date}|${desc}|${amountAbs}`;
        if (seen.has(key))
            return;
        seen.add(key);
        const isCargoHint = /\b(cargo|retiro|compra|pago|comisi[oó]n|spei enviado|pos)\b/i.test(raw) ||
            amountRaw.trim().startsWith("-") ||
            amountRaw.includes("(");
        const isAbonoHint = /\b(abono|dep[oó]sito|spei recibido|transferencia recibida)\b/i.test(raw);
        let direction = "unknown";
        let signed = Math.abs(amountAbs);
        if (isCargoHint && !isAbonoHint) {
            direction = "cargo";
            signed = -signed;
        }
        else if (isAbonoHint) {
            direction = "abono";
        }
        else {
            // Banamex: cargos suelen ir en columna "cargos"; sin pista → cargo si hay palabras comunes de gasto
            direction = "cargo";
            signed = -signed;
        }
        const cat = (0, categorize_1.categorizeLine)(desc, signed, direction, rules);
        out.push({
            id: (0, crypto_1.randomUUID)(),
            raw,
            date,
            description: desc,
            amount: signed,
            direction,
            category: cat.category,
            matchedRuleId: cat.matchedRuleId,
            needsReview: cat.needsReview,
        });
    }
    for (const raw of rawLines) {
        let m = raw.match(reFull);
        if (m) {
            pushLine(m[1], m[2], m[3], raw);
            continue;
        }
        m = raw.match(reShort);
        if (m) {
            pushLine(m[1], m[2], m[3], raw);
            continue;
        }
        m = raw.match(reMon);
        if (m) {
            const mon = MONTHS[m[2].slice(0, 3).toLowerCase()] || m[2];
            pushLine(`${m[1]}/${mon}`, m[3], m[4], raw);
            continue;
        }
        m = raw.match(reLoose);
        if (m) {
            const date = m[1].replace(/\s+/g, " ");
            const amountRaw = m[2];
            const desc = raw
                .replace(m[1], " ")
                .replace(m[2], " ")
                .replace(/\$/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            pushLine(date, desc || raw, amountRaw, raw);
        }
    }
    // Fallback: escanear todo el texto por bloques fecha…monto
    if (out.length === 0) {
        const global = /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{1,2}\s+(?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|JAN|APR|AUG|DEC)[A-Z]*)\s+([A-ZÁÉÍÓÚ0-9][^\n$]{5,100}?)(-?\$?\s*[\d,]+\.\d{2})/gi;
        let gm;
        while ((gm = global.exec(text)) !== null) {
            pushLine(gm[1], gm[2], gm[3], gm[0]);
        }
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