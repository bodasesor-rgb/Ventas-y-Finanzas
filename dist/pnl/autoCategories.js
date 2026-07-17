"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMerchantLabel = extractMerchantLabel;
exports.autoCreateCategoriesFromLines = autoCreateCategoriesFromLines;
const crypto_1 = require("crypto");
const categoryColors_1 = require("./categoryColors");
const store_1 = require("./store");
const STOP = new Set([
    "compra",
    "pago",
    "pagos",
    "cargo",
    "abono",
    "spei",
    "transferencia",
    "traspaso",
    "deposito",
    "depósito",
    "recibido",
    "enviado",
    "mexico",
    "méxico",
    "mx",
    "cdmx",
    "tarjeta",
    "debito",
    "débito",
    "credito",
    "crédito",
    "pos",
    "atm",
    "banamex",
    "banco",
    "comision",
    "comisión",
    "iva",
    "ref",
    "folio",
    "autorizacion",
    "autorización",
    "a",
    "de",
    "del",
    "la",
    "el",
    "en",
    "por",
    "con",
    "favor",
    "beneficiario",
    "nombre",
    "cuenta",
    "clabe",
    "efectivo",
    "retiro",
]);
/**
 * Extrae un nombre de comercio / concepto usable como categoría.
 * Ej: "COMPRA FACEBK *ADS 9001/.." → "Facebk"
 *     "PAGO TELCEL DIGITAL" → "Telcel"
 */
function extractMerchantLabel(description) {
    let s = String(description || "")
        .replace(/\*/g, " ")
        .replace(/\b\d{4,}\b/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!s)
        return null;
    const tokens = s
        .split(" ")
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOP.has(t.toLowerCase()) && !/^\d+$/.test(t));
    if (!tokens.length)
        return null;
    // Preferir token después de COMPRA/PAGO si existe
    const upper = s.toUpperCase();
    const afterPago = upper.match(/\b(?:COMPRA|PAGO|CARGO|ABONO)\s+([A-ZÁÉÍÓÚÑ0-9]{3,}(?:\s+[A-ZÁÉÍÓÚÑ0-9]{3,}){0,2})/);
    if (afterPago) {
        const chunk = afterPago[1]
            .split(/\s+/)
            .filter((t) => !STOP.has(t.toLowerCase()) && t.length >= 3)
            .slice(0, 2)
            .join(" ");
        if (chunk) {
            return titleCase(chunk.slice(0, 40));
        }
    }
    return titleCase(tokens.slice(0, 2).join(" ").slice(0, 40));
}
function titleCase(s) {
    return s
        .toLowerCase()
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}
function ensureCategory(label, kind) {
    const cats = (0, store_1.loadCategories)();
    const id = (0, store_1.slugCategory)(label);
    const existing = cats.find((c) => c.id === id);
    if (existing) {
        if (!existing.color) {
            existing.color = (0, categoryColors_1.colorForCategoryId)(existing.id, cats.indexOf(existing));
            (0, store_1.saveCategories)(cats);
        }
        return existing;
    }
    const created = {
        id,
        label,
        kind,
        color: (0, categoryColors_1.colorForCategoryId)(id, cats.length),
        builtin: false,
        autoCreated: true,
    };
    cats.push(created);
    (0, store_1.saveCategories)(cats);
    return created;
}
function ensureRule(match, categoryId, label) {
    const rules = (0, store_1.loadRules)();
    const m = match.toLowerCase();
    if (rules.some((r) => r.match === m && r.category === categoryId))
        return;
    const rule = {
        id: `auto-${(0, crypto_1.randomUUID)().slice(0, 8)}`,
        match: m,
        category: categoryId,
        label,
        frecuente: true,
        notes: "Creada automáticamente desde PDF",
    };
    rules.push(rule);
    (0, store_1.saveRules)(rules);
}
/**
 * Para líneas en "revisar" / sin match: crea categoría (y regla) desde el comercio.
 * También asegura categoría "pago" y colores en todas.
 */
function autoCreateCategoriesFromLines(lines) {
    // Asegura categoría base "pago"
    ensureCategory("Pago", "gasto");
    const cats = (0, store_1.loadCategories)();
    let dirtyCats = false;
    cats.forEach((c, i) => {
        if (!c.color) {
            c.color = (0, categoryColors_1.colorForCategoryId)(c.id, i);
            dirtyCats = true;
        }
    });
    if (dirtyCats)
        (0, store_1.saveCategories)(cats);
    const created = [];
    const out = lines.map((line) => {
        // Abonos reales → ingreso (nunca inventar abono desde un cargo)
        if (line.direction === "abono" && line.amount > 0) {
            if (line.category === "revisar" || !line.category) {
                return { ...line, category: "ingreso", needsReview: false };
            }
            return line;
        }
        // Si el parser dijo cargo pero el monto quedó positivo, forzar gasto
        if (line.direction === "cargo" && line.amount > 0) {
            line = { ...line, amount: -Math.abs(line.amount) };
        }
        // Ya tiene categoría real de gasto
        if (line.category &&
            line.category !== "revisar" &&
            line.category !== "otro") {
            const exists = (0, store_1.loadCategories)().some((c) => c.id === line.category);
            if (!exists) {
                const label = titleCase(line.category.replace(/_/g, " "));
                const cat = ensureCategory(label, "gasto");
                if (!created.includes(cat.label))
                    created.push(cat.label);
                return { ...line, category: cat.id };
            }
            return line;
        }
        // Solo auto-crear si hay comercio claro y el monto no es sospechoso
        if (Math.abs(line.amount) > 150_000) {
            return { ...line, category: "revisar", needsReview: true };
        }
        const merchant = extractMerchantLabel(line.description);
        if (!merchant) {
            if (/\bpago\b/i.test(line.description) && line.direction === "cargo") {
                return { ...line, category: "pago", needsReview: true };
            }
            return { ...line, needsReview: true };
        }
        // Evitar categorías basura de 1 token genérico
        const bad = /^(pago|cargo|compra|mexico|dublin|paris|suc)$/i;
        if (bad.test(merchant)) {
            return { ...line, category: "pago", needsReview: true };
        }
        const cat = ensureCategory(merchant, "gasto");
        const matchToken = merchant.split(/\s+/)[0].toLowerCase();
        if (matchToken.length >= 4)
            ensureRule(matchToken, cat.id, merchant);
        if (!created.includes(cat.label))
            created.push(cat.label);
        return {
            ...line,
            category: cat.id,
            // Deja en revisar montos altos para doble check humano
            needsReview: Math.abs(line.amount) >= 20_000,
            matchedRuleId: line.matchedRuleId,
        };
    });
    return { lines: out, created };
}
//# sourceMappingURL=autoCategories.js.map