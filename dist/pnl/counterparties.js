"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARTNER_NAMES = void 0;
exports.normalizePersonKey = normalizePersonKey;
exports.matchPartner = matchPartner;
exports.extractBeneficiary = extractBeneficiary;
exports.looksLikeOutboundTransfer = looksLikeOutboundTransfer;
exports.classifyCounterparty = classifyCounterparty;
exports.applyCounterpartyCategories = applyCounterpartyCategories;
/** Socios — solo estos dos; el resto de traspasos con beneficiario = proveedor */
exports.PARTNER_NAMES = [
    "Luis Alejandro Sanchez Campbell",
    "Alejandro Zorrilla Elorza",
];
function stripAccents(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
/** Normaliza nombre Banamex: "LUIS ALEJANDRO,SANCHEZ/CAMPBELL" → "luis alejandro sanchez campbell" */
function normalizePersonKey(raw) {
    return stripAccents(String(raw || ""))
        .toLowerCase()
        .replace(/\(dato[^)]*\)/gi, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function titleName(raw) {
    return String(raw || "")
        .replace(/\(dato[^)]*\)/gi, " ")
        .replace(/[,/]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}
const PARTNER_KEYS = exports.PARTNER_NAMES.map((n) => ({
    name: n,
    key: normalizePersonKey(n),
    // tokens fuertes para matching flexible (orden Banamex apellido/nombre)
    tokens: normalizePersonKey(n).split(" ").filter((t) => t.length >= 4),
}));
function matchPartner(nameOrDesc) {
    const key = normalizePersonKey(nameOrDesc);
    if (!key)
        return null;
    for (const p of PARTNER_KEYS) {
        if (key.includes(p.key) || p.key.includes(key))
            return p.name;
        // "luis alejandro sanchez campbell" vs "sanchez campbell" + luis
        const hits = p.tokens.filter((t) => key.includes(t)).length;
        if (hits >= Math.min(3, p.tokens.length))
            return p.name;
    }
    // Formato Banamex APELLIDO/APELLIDO con nombre corto
    if (/sanchez/.test(key) &&
        /campbell/.test(key) &&
        /luis/.test(key)) {
        return "Luis Alejandro Sanchez Campbell";
    }
    if (/zorrilla/.test(key) && /elorza/.test(key)) {
        return "Alejandro Zorrilla Elorza";
    }
    return null;
}
/**
 * Extrae beneficiario de cargos SPEI / interbancario / terceros.
 * Ej: "AL BENEF. LUIS ALEJANDRO,SANCHEZ/CAMPBELL (DATO…"
 */
function extractBeneficiary(description) {
    const d = String(description || "");
    const patterns = [
        /AL\s+BENEF\.?\s*([^()]{3,90}?)(?:\s*\(|\s*CTA\.|$)/i,
        /BENEF\.?\s*([A-ZÁÉÍÓÚÑ][^()]{3,90}?)(?:\s*\(|\s*CTA\.|\s*SU\s+REF|$)/i,
    ];
    for (const re of patterns) {
        const m = d.match(re);
        if (!m)
            continue;
        let name = titleName(m[1]);
        // Quita basura de banco al final
        name = name
            .replace(/\b(Dato|No|Verificado|Por|Esta|Institucion|Institución)\b.*$/i, "")
            .replace(/\bCta\b.*$/i, "")
            .trim();
        if (name.length >= 3 && /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(name)) {
            return name;
        }
    }
    return null;
}
function looksLikeOutboundTransfer(description) {
    const d = String(description || "");
    return (/\bPAGO INTERBANCARIO A\b/i.test(d) ||
        /\bPAGO A TERCEROS\b/i.test(d) ||
        /\bAL BENEF\b/i.test(d) ||
        (/\b(SPEI|TRANSFERENCIA|TRASPASO)\b/i.test(d) &&
            /\b(BENEF|A FAVOR)\b/i.test(d)));
}
function classifyCounterparty(description) {
    if (!looksLikeOutboundTransfer(description))
        return null;
    const extracted = extractBeneficiary(description);
    const partner = matchPartner(extracted || description);
    if (partner) {
        return { name: partner, kind: "socio", category: "socio" };
    }
    if (extracted) {
        return {
            name: extracted,
            kind: "proveedor",
            category: "proveedor",
        };
    }
    return null;
}
/** Reescribe categoría de cargos: socios vs proveedores (resto de traspasos). */
function applyCounterpartyCategories(lines) {
    return lines.map((line) => {
        if (line.direction === "abono")
            return line;
        // No pisar categorías de gasto ya claras (ads, apps…)
        const locked = new Set([
            "ads",
            "apps",
            "pass",
            "comisiones",
            "servicios",
            "renta",
            "nomina",
            "impuestos",
            "evento",
            "ingreso",
            "venta",
        ]);
        if (locked.has(line.category) && !looksLikeOutboundTransfer(line.description)) {
            return line;
        }
        if (!looksLikeOutboundTransfer(line.description)) {
            // Si ya era transferencia_persona sin nombre usable, dejar
            return line;
        }
        const hit = classifyCounterparty(line.description);
        if (!hit) {
            return {
                ...line,
                category: "transferencia_persona",
                needsReview: true,
                counterparty: undefined,
                counterpartyKind: undefined,
            };
        }
        return {
            ...line,
            category: hit.category,
            needsReview: false,
            counterparty: hit.name,
            counterpartyKind: hit.kind,
        };
    });
}
//# sourceMappingURL=counterparties.js.map