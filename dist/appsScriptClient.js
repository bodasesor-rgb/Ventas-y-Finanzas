"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFilaToAppsScript = writeFilaToAppsScript;
/**
 * Envía la fila al webhook de Google Apps Script.
 * El script en Sheets hace append o update por kommoDealId.
 */
async function writeFilaToAppsScript(dealId, values, sheetName = "Eventos 2026") {
    // Hostinger usa URL_BODASESOR_DIRECCION_SHEETS; APPS_SCRIPT_VENTAS_URL queda como alias
    const url = (process.env.URL_BODASESOR_DIRECCION_SHEETS ||
        process.env.APPS_SCRIPT_VENTAS_URL ||
        "").trim();
    if (!url) {
        throw new Error("Falta URL_BODASESOR_DIRECCION_SHEETS (URL /exec del Apps Script)");
    }
    if (!url.includes("script.google.com") || !url.includes("/exec")) {
        throw new Error("URL_BODASESOR_DIRECCION_SHEETS debe ser la URL de Apps Script que termina en /exec (no el link del Sheet ni el ID de implementación)");
    }
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, values, sheetName }),
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
//# sourceMappingURL=appsScriptClient.js.map