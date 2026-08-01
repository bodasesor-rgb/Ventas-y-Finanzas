"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SA_FILE_PATH = void 0;
exports.listGaEnvKeysPresent = listGaEnvKeysPresent;
exports.loadServiceAccountJson = loadServiceAccountJson;
exports.saveServiceAccountJson = saveServiceAccountJson;
exports.hasGoogleCredentials = hasGoogleCredentials;
exports.getGoogleAuthClient = getGoogleAuthClient;
exports.ga4PropertyId = ga4PropertyId;
exports.metricasSheetId = metricasSheetId;
exports.metricasSheetName = metricasSheetName;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const google_auth_library_1 = require("google-auth-library");
const SA_ENV_KEYS_ = [
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GA4_SERVICE_ACCOUNT_JSON",
    "GOOGLE_SERVICE_ACCOUNT",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
];
/** Archivo en disco — Hostinger a menudo trunca env vars largas. */
exports.SA_FILE_PATH = path_1.default.join(process.cwd(), "data", "google-service-account.json");
/** Nombres de env relacionados (sin valores) — para diagnosticar Hostinger. */
function listGaEnvKeysPresent() {
    const keys = [
        ...SA_ENV_KEYS_,
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GA4_PROPERTY_ID",
        "GA4_MEASUREMENT_ID",
        "GOOGLE_SHEET_ID",
        "METRICAS_SHEET_NAME",
    ];
    const present = keys.filter((k) => Boolean(String(process.env[k] || "").trim()));
    if (fs_1.default.existsSync(exports.SA_FILE_PATH))
        present.push("FILE:data/google-service-account.json");
    return present;
}
function parseSaJson_(raw, label) {
    const text = raw.trim();
    try {
        return JSON.parse(text);
    }
    catch {
        try {
            return JSON.parse(Buffer.from(text, "base64").toString("utf8"));
        }
        catch {
            throw new Error(`${label} no es JSON válido (ni base64 JSON)`);
        }
    }
}
/** Lee JSON de service account: archivo en disco → env → path. */
function loadServiceAccountJson() {
    // 1) Archivo local (más fiable en Hostinger)
    try {
        if (fs_1.default.existsSync(exports.SA_FILE_PATH)) {
            return parseSaJson_(fs_1.default.readFileSync(exports.SA_FILE_PATH, "utf8"), exports.SA_FILE_PATH);
        }
    }
    catch (err) {
        console.warn("[ga4] no se pudo leer", exports.SA_FILE_PATH, err instanceof Error ? err.message : err);
    }
    for (const key of SA_ENV_KEYS_) {
        const inline = String(process.env[key] || "").trim();
        if (!inline)
            continue;
        if ((inline.startsWith("/") || inline.endsWith(".json")) &&
            !inline.startsWith("{")) {
            if (fs_1.default.existsSync(inline)) {
                return parseSaJson_(fs_1.default.readFileSync(inline, "utf8"), inline);
            }
        }
        return parseSaJson_(inline, key);
    }
    const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
    if (credPath && fs_1.default.existsSync(credPath)) {
        return parseSaJson_(fs_1.default.readFileSync(credPath, "utf8"), credPath);
    }
    return null;
}
/**
 * Guarda el service account en data/ (evita límite de env en Hostinger).
 */
function saveServiceAccountJson(raw) {
    let sa;
    if (typeof raw === "string") {
        sa = parseSaJson_(raw, "body");
    }
    else if (raw && typeof raw === "object") {
        sa = raw;
    }
    else {
        throw new Error("Body debe ser el JSON del service account");
    }
    if (!sa.client_email || !sa.private_key) {
        throw new Error("JSON incompleto: faltan client_email o private_key");
    }
    // private_key a veces llega con \\n literales
    if (sa.private_key.includes("\\n") && !sa.private_key.includes("\n")) {
        sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    }
    fs_1.default.mkdirSync(path_1.default.dirname(exports.SA_FILE_PATH), { recursive: true });
    fs_1.default.writeFileSync(exports.SA_FILE_PATH, JSON.stringify(sa, null, 2), {
        encoding: "utf8",
        mode: 0o600,
    });
    return {
        ok: true,
        client_email: sa.client_email,
        path: "data/google-service-account.json",
    };
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
        throw new Error("Falta service account: sube el JSON a POST /api/ventas/ga4-setup-sa o define GOOGLE_SERVICE_ACCOUNT_JSON");
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