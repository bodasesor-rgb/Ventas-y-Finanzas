"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLastVentasSync = getLastVentasSync;
exports.getLastWebhookAccepted = getLastWebhookAccepted;
exports.rememberWebhookAccepted = rememberWebhookAccepted;
exports.syncDealToSheet = syncDealToSheet;
const appsScriptClient_1 = require("./appsScriptClient");
const kommoApi_1 = require("./kommoApi");
const mapDealToFila_1 = require("./mapDealToFila");
/** Último resultado en memoria (se pierde al reiniciar Node). */
let lastSync = null;
let lastAccepted = null;
function getLastVentasSync() {
    return lastSync;
}
function getLastWebhookAccepted() {
    return lastAccepted;
}
function rememberWebhookAccepted(dealId, source) {
    lastAccepted = { at: new Date().toISOString(), dealId, source };
}
function appsScriptUrl() {
    return (process.env.URL_BODASESOR_DIRECCION_SHEETS ||
        process.env.APPS_SCRIPT_VENTAS_URL ||
        "").trim();
}
/**
 * Trae el deal de Kommo (o partial del webhook) y escribe Eventos YYYY.
 */
async function syncDealToSheet(leadId, webhookBody) {
    const startedAt = new Date().toISOString();
    let lead;
    let dataSource = "kommo_api";
    let kommoApiError = null;
    try {
        lead = await (0, kommoApi_1.fetchLeadWithContact)(leadId);
    }
    catch (apiErr) {
        dataSource = "webhook_partial";
        kommoApiError =
            apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.warn("[ventas] No se pudo fetch Kommo API; usando payload parcial", kommoApiError);
        lead = webhookBody
            ? (0, kommoApi_1.extractPartialLeadFromWebhook)(webhookBody, leadId)
            : { id: leadId };
    }
    const fila = (0, mapDealToFila_1.mapDealToFilaVentas)(lead);
    const values = (0, mapDealToFila_1.filaToOrderedValues)(fila);
    const sheetWrite = {
        attempted: false,
        ok: false,
    };
    if (appsScriptUrl()) {
        sheetWrite.attempted = true;
        try {
            const year = (0, mapDealToFila_1.yearFromFecha)(fila.fechaDeCierre) || new Date().getUTCFullYear();
            const sheetName = `Eventos ${year}`;
            const result = await (0, appsScriptClient_1.writeFilaToAppsScript)(fila.kommoDealId, values, sheetName);
            sheetWrite.ok = true;
            sheetWrite.action = result.action;
            sheetWrite.row = result.row;
            sheetWrite.version = result.version;
            console.log("[ventas][fase2] Sheet write OK", {
                dealId: fila.kommoDealId,
                action: result.action,
                row: result.row,
                sheetName,
            });
        }
        catch (writeErr) {
            sheetWrite.ok = false;
            sheetWrite.error =
                writeErr instanceof Error ? writeErr.message : String(writeErr);
            console.error("[ventas][fase2] Sheet write FAIL", sheetWrite.error);
        }
    }
    else {
        console.log("[ventas][fase1] FILA QUE SE APPENDARÍA (sin URL Apps Script /exec)");
    }
    const result = {
        startedAt,
        finishedAt: new Date().toISOString(),
        dealId: fila.kommoDealId,
        dataSource,
        kommoApiError,
        fila,
        values,
        sheetWrite,
        headers: mapDealToFila_1.SHEET_HEADERS,
    };
    lastSync = result;
    console.log(JSON.stringify({
        startedAt,
        dealId: result.dealId,
        dataSource,
        kommoApiError,
        sheetWrite: result.sheetWrite,
        cliente: fila.cliente,
        venta: fila.venta,
        fechaDeCierre: fila.fechaDeCierre,
    }, null, 2));
    return result;
}
//# sourceMappingURL=ventasSync.js.map