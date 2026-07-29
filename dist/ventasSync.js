"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLastVentasSync = getLastVentasSync;
exports.getLastWebhookAccepted = getLastWebhookAccepted;
exports.rememberWebhookAccepted = rememberWebhookAccepted;
exports.syncDealToSheet = syncDealToSheet;
const appsScriptClient_1 = require("./appsScriptClient");
const eventFingerprint_1 = require("./eventFingerprint");
const fingerprintStore_1 = require("./fingerprintStore");
const kommoApi_1 = require("./kommoApi");
const mapDealToFila_1 = require("./mapDealToFila");
const sheetEventosReader_1 = require("./sheetEventosReader");
/** Evita import circular: poller marca estado tras sync exitoso. */
function markPollSyncedSafe_(dealId, closedAt) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { markDealSynced } = require("./pollClosedDeals");
        markDealSynced(dealId, closedAt);
    }
    catch {
        // poller opcional en tests
    }
}
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
            const fp = (0, eventFingerprint_1.eventFingerprintFromFila)(fila);
            // 1) cache local  2) leer Eventos del Sheet (CSV)  3) Apps Script
            let dupDeal = (0, fingerprintStore_1.findDuplicateDealId)(fp, fila.kommoDealId);
            let dupSource = dupDeal ? "cache" : "";
            if (!dupDeal) {
                const inSheet = await (0, sheetEventosReader_1.findDuplicateInSheet)(fp, fila.kommoDealId, year);
                if (inSheet) {
                    dupDeal = inSheet.dealId;
                    dupSource = "sheet_csv";
                    sheetWrite.row = inSheet.row;
                }
            }
            if (dupDeal) {
                sheetWrite.ok = true;
                sheetWrite.action = "skipped_duplicate";
                (0, fingerprintStore_1.rememberFingerprint)(fp, dupDeal);
                console.log("[ventas][fase2] DUPLICADO omitido", {
                    source: dupSource,
                    dealId: fila.kommoDealId,
                    duplicateOfDealId: dupDeal,
                    fingerprint: fp,
                    cliente: fila.cliente,
                    fechaDelEvento: fila.fechaDelEvento,
                    fechaDeCierre: fila.fechaDeCierre,
                    horario: fila.horario,
                    tipoDeEvento: fila.tipoDeEvento,
                });
            }
            else {
                const result = await (0, appsScriptClient_1.writeFilaToAppsScript)(fila.kommoDealId, values, sheetName);
                sheetWrite.ok = true;
                sheetWrite.action = result.action;
                sheetWrite.row = result.row;
                sheetWrite.version = result.version;
                if (result.action === "skipped_duplicate") {
                    const other = result.duplicateOfDealId ||
                        fila.kommoDealId;
                    (0, fingerprintStore_1.rememberFingerprint)(fp, other);
                    console.log("[ventas][fase2] DUPLICADO omitido (Apps Script)", {
                        dealId: fila.kommoDealId,
                        row: result.row,
                        duplicateOfDealId: other,
                        cliente: fila.cliente,
                    });
                }
                else {
                    (0, fingerprintStore_1.rememberFingerprint)(fp, fila.kommoDealId);
                    console.log("[ventas][fase2] Sheet write OK", {
                        dealId: fila.kommoDealId,
                        action: result.action,
                        row: result.row,
                        sheetName,
                    });
                }
            }
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
    if (result.sheetWrite.ok || !result.sheetWrite.attempted) {
        markPollSyncedSafe_(result.dealId, lead.closed_at ?? null);
    }
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