"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRunToBancoSheet = sendRunToBancoSheet;
const appsScriptClient_1 = require("../appsScriptClient");
const store_1 = require("./store");
const CATEGORY_COLS = [
    "ads",
    "apps",
    "pass",
    "comisiones",
    "servicios",
    "pago",
    "transferencia_persona",
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
    const result = await (0, appsScriptClient_1.postToAppsScript)({
        action: "upsertBanco",
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
    });
    return {
        sheetName: result.sheetName || `Banco ${year}`,
        row: result.row,
        action: result.action,
        version: result.version,
    };
}
//# sourceMappingURL=sendToSheet.js.map