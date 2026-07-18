"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppsScriptUrl = getAppsScriptUrl;
exports.postToAppsScript = postToAppsScript;
exports.writeFilaToAppsScript = writeFilaToAppsScript;
function appsScriptUrl() {
    return (process.env.URL_BODASESOR_DIRECCION_SHEETS ||
        process.env.APPS_SCRIPT_VENTAS_URL ||
        "").trim();
}
function getAppsScriptUrl() {
    return appsScriptUrl();
}
/**
 * POST genérico al Apps Script /exec (Eventos, Banco, etc.).
 */
async function postToAppsScript(payload) {
    const url = appsScriptUrl();
    if (!url) {
        throw new Error("Falta URL_BODASESOR_DIRECCION_SHEETS (URL /exec del Apps Script)");
    }
    if (!url.includes("script.google.com") || !url.includes("/exec")) {
        throw new Error("URL_BODASESOR_DIRECCION_SHEETS debe ser la URL de Apps Script que termina en /exec");
    }
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow",
    });
    const text = await res.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(`Apps Script respondió no-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (!res.ok || parsed.ok === false) {
        throw new Error(parsed.error ||
            `Apps Script error HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return { ...parsed, raw: text.slice(0, 500) };
}
/**
 * Envía la fila al webhook de Google Apps Script (Eventos).
 */
async function writeFilaToAppsScript(dealId, values, sheetName = "Eventos 2026") {
    return postToAppsScript({ dealId, values, sheetName });
}
//# sourceMappingURL=appsScriptClient.js.map