"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRunToBancoSheet = sendRunToBancoSheet;
exports.sendYearAnalysisToSheet = sendYearAnalysisToSheet;
const appsScriptClient_1 = require("../appsScriptClient");
const providerAnalysis_1 = require("./providerAnalysis");
const store_1 = require("./store");
const CATEGORY_COLS = [
    "ads",
    "apps",
    "pass",
    "comisiones",
    "servicios",
    "pago",
    "transferencia_persona",
    "socio",
    "proveedor",
    "evento",
    "revisar",
    "otro",
    "ingreso",
    "venta",
];
async function sendRunToBancoSheet(run) {
    const periodKey = run.periodKey || "";
    if (!/^\d{4}-\d{2}$/.test(periodKey)) {
        throw new Error("El estado no tiene mes válido (periodKey YYYY-MM)");
    }
    const year = Number(periodKey.slice(0, 4));
    const month = Number(periodKey.slice(5, 7));
    const totals = run.totals || { ingresos: 0, gastos: 0, neto: 0 };
    const summary = run.summaryByCategory || {};
    const cats = (0, store_1.loadCategories)();
    const labelOf = (id) => cats.find((c) => c.id === id)?.label || id;
    const byCategory = CATEGORY_COLS.map((id) => ({
        id,
        label: labelOf(id),
        amount: Math.round((summary[id] || 0) * 100) / 100,
    }));
    // Resto de categorías no listadas
    const known = new Set(CATEGORY_COLS);
    let otros = 0;
    for (const [id, amt] of Object.entries(summary)) {
        if (!known.has(id))
            otros += amt;
    }
    const oficial = run.reconciliation?.oficial;
    const payload = {
        action: "upsertEstadoResultados",
        year,
        month,
        periodKey,
        periodLabel: run.periodLabel || periodKey,
        ingresos: totals.ingresos,
        // Sheet: gastos como positivo (monto salido)
        gastos: Math.abs(totals.gastos),
        neto: totals.neto,
        byCategory,
        otros: Math.round(otros * 100) / 100,
        depositosOficiales: oficial?.ingresosOficiales ?? oficial?.depositos ?? null,
        retirosOficiales: oficial?.gastosOficiales == null
            ? null
            : Math.abs(oficial.gastosOficiales),
        cuadra: Boolean(run.reconciliation?.matchCompleto),
        runId: run.id,
        filename: run.storedName || run.filename || "",
    };
    let result;
    try {
        result = await (0, appsScriptClient_1.postToAppsScript)(payload);
    }
    catch (err) {
        // Compat: Scripts viejos solo conocen upsertBanco
        result = await (0, appsScriptClient_1.postToAppsScript)({ ...payload, action: "upsertBanco" });
    }
    const erSheet = result.erSheet || result.sheetName || `Estado de Resultados ${year}`;
    const erCol = result.erMonthCol || "";
    const monthNames = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ];
    const monthLabel = monthNames[month - 1] || String(month);
    const sheetTitle = result.spreadsheetName || "Google Sheet vinculado al Apps Script";
    const msg = result.message ||
        `Enviado a Sheet «${sheetTitle}» → ${erSheet} · ${monthLabel}${erCol ? ` (${erCol})` : ""} · v${result.version || "?"}`;
    return {
        sheetName: erSheet,
        erSheet,
        erMonthCol: erCol,
        erExists: result.erExists,
        spreadsheetId: result.spreadsheetId,
        spreadsheetName: result.spreadsheetName,
        spreadsheetUrl: result.spreadsheetUrl,
        existingSheets: result.existingSheets,
        row: result.row,
        action: result.action,
        version: result.version,
        message: msg,
    };
}
/** Escribe pestaña Análisis YYYY con ranking proveedores + mensual/anual. */
async function sendYearAnalysisToSheet(year = 2026) {
    const analysis = (0, providerAnalysis_1.buildYearAnalysis)((0, store_1.loadRuns)(), year);
    const result = await (0, appsScriptClient_1.postToAppsScript)({
        action: "upsertAnalisis",
        year,
        analysis,
    });
    return {
        sheetName: result.sheetName || `Analisis ${year}`,
        version: result.version,
        analysis,
    };
}
//# sourceMappingURL=sendToSheet.js.map