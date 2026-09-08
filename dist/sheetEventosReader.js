"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEventosSheetIndex = loadEventosSheetIndex;
exports.findDuplicateInSheet = findDuplicateInSheet;
exports.findDealRowInSheet = findDealRowInSheet;
exports.findEventoInSheet = findEventoInSheet;
exports.loadEventosProximos = loadEventosProximos;
const eventFingerprint_1 = require("./eventFingerprint");
const fingerprintStore_1 = require("./fingerprintStore");
const DEFAULT_SHEET_ID = "1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8";
function sheetId_() {
    return (process.env.GOOGLE_SHEET_ID ||
        process.env.VENTAS_SHEET_ID ||
        DEFAULT_SHEET_ID).trim();
}
/** Parse CSV simple con comillas. */
function parseCsv_(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (inQuotes) {
            if (ch === '"' && next === '"') {
                cur += '"';
                i++;
            }
            else if (ch === '"') {
                inQuotes = false;
            }
            else {
                cur += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            continue;
        }
        if (ch === ",") {
            row.push(cur);
            cur = "";
            continue;
        }
        if (ch === "\n") {
            row.push(cur.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            cur = "";
            continue;
        }
        if (ch === "\r")
            continue;
        cur += ch;
    }
    if (cur.length || row.length) {
        row.push(cur);
        rows.push(row);
    }
    return rows;
}
let cache = null;
/** Filas crudas A..T del último fetch, para leer fechas y datos del evento. */
let cacheRows = [];
const CACHE_TTL_MS = 45_000;
/**
 * Lee Eventos YYYY del Sheet (CSV público) y arma índice anti-duplicados.
 */
async function loadEventosSheetIndex(year = new Date().getUTCFullYear(), force = false) {
    if (!force &&
        cache &&
        Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache;
    }
    const id = sheetId_();
    const sheetName = encodeURIComponent(`Eventos ${year}`);
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
        throw new Error(`Sheet CSV HTTP ${res.status}`);
    }
    const text = await res.text();
    if (text.includes("<HTML>") || text.includes("<!DOCTYPE")) {
        throw new Error("Sheet CSV no accesible (HTML en vez de CSV)");
    }
    const rows = parseCsv_(text);
    const byFingerprint = {};
    const byDealId = {};
    const rawRows = [];
    // fila 0 = header
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        while (r.length < 20)
            r.push("");
        const cliente = (r[0] || "").trim();
        if (!cliente)
            continue;
        const dealId = String(r[19] || "").trim();
        const values = r.slice(0, 20);
        rawRows[i + 1] = values;
        const fp = (0, eventFingerprint_1.eventFingerprintFromValues)(values);
        if (fp && fp !== "||||") {
            // conservar el primer dealId visto para esa huella
            if (!byFingerprint[fp])
                byFingerprint[fp] = dealId;
        }
        if (dealId)
            byDealId[dealId] = i + 1; // 1-based con header
        if (fp && dealId)
            (0, fingerprintStore_1.rememberFingerprint)(fp, dealId);
    }
    cache = {
        byFingerprint,
        byDealId,
        fetchedAt: Date.now(),
        rowCount: Object.keys(byFingerprint).length,
    };
    cacheRows = rawRows;
    return cache;
}
/**
 * gviz devuelve lo que muestra la celda, y el Sheet mezcla formatos:
 * "10/9/2026", "9/10/26" (año corto) y a veces Date(2026,9,9).
 */
function normalizeSheetFecha_(raw) {
    const s = String(raw || "").trim();
    if (!s)
        return "";
    const gviz = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
    if (gviz) {
        const dd = String(Number(gviz[3])).padStart(2, "0");
        const mm = String(Number(gviz[2]) + 1).padStart(2, "0");
        return `${dd}/${mm}/${gviz[1]}`;
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso)
        return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (dmy) {
        const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
        return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${year}`;
    }
    return "";
}
function rowToEvento_(values, row) {
    return {
        row,
        dealId: String(values[19] || "").trim(),
        cliente: String(values[0] || "").trim(),
        fechaDelEvento: normalizeSheetFecha_(values[1]),
        tipoDeEvento: String(values[5] || "").trim(),
        invitados: String(values[6] || "").trim(),
        direccionDeEvento: String(values[7] || "").trim(),
        horario: String(values[8] || "").trim(),
    };
}
/** Datos del evento tal como están en el Sheet (donde se corrigen a mano). */
async function findEventoInSheet(dealId, year) {
    const id = String(dealId || "").trim();
    if (!id)
        return null;
    try {
        const idx = await loadEventosSheetIndex(year);
        const row = idx.byDealId[id];
        if (!row || !cacheRows[row])
            return null;
        return rowToEvento_(cacheRows[row], row);
    }
    catch (err) {
        console.warn("[ventas-sheet] no se pudo leer el evento del Sheet", err instanceof Error ? err.message : err);
        return null;
    }
}
/**
 * Filas con fecha de evento de hoy en adelante. Es la fuente correcta para
 * los recordatorios: Kommo ordena mal los cierres y muchas fechas solo
 * existen en el Sheet.
 */
async function loadEventosProximos(year) {
    await loadEventosSheetIndex(year, true);
    const hoy = new Date();
    const desde = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
    const out = [];
    for (let row = 0; row < cacheRows.length; row++) {
        const values = cacheRows[row];
        if (!values)
            continue;
        const evento = rowToEvento_(values, row);
        if (!evento.cliente || !evento.fechaDelEvento)
            continue;
        const m = evento.fechaDelEvento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!m)
            continue;
        const when = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        if (when < desde)
            continue;
        out.push(evento);
    }
    out.sort((a, b) => {
        const pa = a.fechaDelEvento.split("/").reverse().join("");
        const pb = b.fechaDelEvento.split("/").reverse().join("");
        return pa.localeCompare(pb);
    });
    return out;
}
/** Busca en el Sheet real si ya existe la misma huella con otro deal. */
async function findDuplicateInSheet(fingerprint, dealId, year) {
    if (!fingerprint || fingerprint === "||||")
        return null;
    try {
        const idx = await loadEventosSheetIndex(year);
        if (!Object.prototype.hasOwnProperty.call(idx.byFingerprint, fingerprint)) {
            return null;
        }
        const existing = idx.byFingerprint[fingerprint] || "";
        // Mismo deal → permitir update; otro deal o fila sin id → duplicado
        if (existing && existing === dealId)
            return null;
        if (!existing && !dealId)
            return null;
        if (existing === dealId)
            return null;
        return {
            dealId: existing || "(sin deal id)",
            row: existing ? idx.byDealId[existing] : undefined,
        };
    }
    catch (err) {
        console.warn("[ventas-sheet] no se pudo leer Eventos para dedupe", err instanceof Error ? err.message : err);
        return null;
    }
}
/** ¿Este Kommo Deal ID ya tiene fila en Eventos? */
async function findDealRowInSheet(dealId, year) {
    const id = String(dealId || "").trim();
    if (!id)
        return null;
    try {
        const idx = await loadEventosSheetIndex(year);
        const row = idx.byDealId[id];
        return row && row > 0 ? row : null;
    }
    catch (err) {
        console.warn("[ventas-sheet] no se pudo leer Eventos por dealId", err instanceof Error ? err.message : err);
        return null;
    }
}
//# sourceMappingURL=sheetEventosReader.js.map