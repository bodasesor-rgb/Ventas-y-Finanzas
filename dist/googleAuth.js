"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadServiceAccountJson = loadServiceAccountJson;
exports.hasGoogleCredentials = hasGoogleCredentials;
exports.getGoogleAuthClient = getGoogleAuthClient;
exports.ga4PropertyId = ga4PropertyId;
exports.metricasSheetId = metricasSheetId;
exports.metricasSheetName = metricasSheetName;
const google_auth_library_1 = require("google-auth-library");
/** Lee JSON de service account desde env (string o path). */
function loadServiceAccountJson() {
    const inline = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        process.env.GA4_SERVICE_ACCOUNT_JSON ||
        "").trim();
    if (inline) {
        try {
            return JSON.parse(inline);
        }
        catch {
            // a veces viene base64
            try {
                return JSON.parse(Buffer.from(inline, "base64").toString("utf8"));
            }
            catch {
                throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no es JSON válido (ni base64 JSON)");
            }
        }
    }
    const path = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
    if (path) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        return JSON.parse(fs.readFileSync(path, "utf8"));
    }
    return null;
}
function hasGoogleCredentials() {
    try {
        return Boolean(loadServiceAccountJson());
    }
    catch {
        return false;
    }
}
/** Auth para GA4 Data API + Sheets. */
async function getGoogleAuthClient(scopes) {
    const sa = loadServiceAccountJson();
    if (!sa?.client_email || !sa?.private_key) {
        throw new Error("Falta service account: define GOOGLE_SERVICE_ACCOUNT_JSON (JSON) o GOOGLE_APPLICATION_CREDENTIALS (ruta)");
    }
    const jwt = new google_auth_library_1.JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes,
    });
    await jwt.authorize();
    return jwt;
}
function ga4PropertyId() {
    const raw = (process.env.GA4_PROPERTY_ID || "").trim();
    if (!raw) {
        throw new Error("Falta GA4_PROPERTY_ID (número de propiedad GA4)");
    }
    return raw.replace(/^properties\//, "");
}
function metricasSheetId() {
    return (process.env.GOOGLE_SHEET_ID ||
        process.env.VENTAS_SHEET_ID ||
        "1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8").trim();
}
function metricasSheetName() {
    return (process.env.METRICAS_SHEET_NAME ||
        `Metricas ${new Date().getUTCFullYear()} Auto`).trim();
}
//# sourceMappingURL=googleAuth.js.map