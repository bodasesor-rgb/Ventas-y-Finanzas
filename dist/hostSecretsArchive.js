"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localSecretPath = localSecretPath;
exports.archiveHostSecret = archiveHostSecret;
exports.fetchHostSecret = fetchHostSecret;
exports.restoreHostSecretIfMissing = restoreHostSecretIfMissing;
exports.restoreHostSecretsOnBoot = restoreHostSecretsOnBoot;
exports.persistHostSecret = persistHostSecret;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const appsScriptClient_1 = require("./appsScriptClient");
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const LOCAL_PATH = {
    "google-service-account": path_1.default.join(DATA_DIR, "google-service-account.json"),
    "meta-token": path_1.default.join(DATA_DIR, "meta-token.json"),
    brevo: path_1.default.join(DATA_DIR, "brevo.json"),
    "google-ads": path_1.default.join(DATA_DIR, "google-ads.json"),
};
function localSecretPath(key) {
    return LOCAL_PATH[key];
}
async function archiveHostSecret(secretKey, json) {
    try {
        const payload = typeof json === "string" ? json : JSON.stringify(json, null, 2);
        const result = await (0, appsScriptClient_1.postToAppsScript)({
            action: "saveHostSecret",
            secretKey,
            jsonBase64: Buffer.from(payload, "utf8").toString("base64"),
        });
        if (!result.ok) {
            return { ok: false, error: result.error || "saveHostSecret falló" };
        }
        return { ok: true, fileId: result.fileId };
    }
    catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
async function fetchHostSecret(secretKey) {
    try {
        const result = await (0, appsScriptClient_1.postToAppsScript)({
            action: "getHostSecret",
            secretKey,
        });
        if (!result.ok || !result.jsonBase64) {
            return {
                ok: false,
                error: result.error || `Sin backup Drive de ${secretKey}`,
            };
        }
        const text = Buffer.from(String(result.jsonBase64), "base64").toString("utf8");
        return { ok: true, json: JSON.parse(text) };
    }
    catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
/** Escribe en data/ si falta el archivo (tras deploy). */
async function restoreHostSecretIfMissing(secretKey) {
    const dest = LOCAL_PATH[secretKey];
    if (fs_1.default.existsSync(dest))
        return "present";
    const fetched = await fetchHostSecret(secretKey);
    if (!fetched.ok) {
        if (/no hay backup|Sin backup/i.test(fetched.error))
            return "missing";
        console.warn(`[secrets] restore ${secretKey}:`, fetched.error);
        return "error";
    }
    fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
    fs_1.default.writeFileSync(dest, JSON.stringify(fetched.json, null, 2), {
        encoding: "utf8",
        mode: 0o600,
    });
    console.log(`[secrets] restaurado ${secretKey} desde Drive → ${dest}`);
    return "restored";
}
let restoreOnce = null;
/** Una vez por proceso Node: intenta recuperar SA/Meta/Brevo tras deploy. */
function restoreHostSecretsOnBoot() {
    if (!restoreOnce) {
        restoreOnce = (async () => {
            const keys = [
                "google-service-account",
                "meta-token",
                "brevo",
                "google-ads",
            ];
            const out = {};
            for (const key of keys) {
                out[key] = await restoreHostSecretIfMissing(key);
            }
            return out;
        })().catch((err) => {
            console.warn("[secrets] restore on boot falló", err instanceof Error ? err.message : err);
            restoreOnce = null;
            return {
                "google-service-account": "error",
                "meta-token": "error",
                brevo: "error",
                "google-ads": "error",
            };
        });
    }
    return restoreOnce;
}
/** Guarda local + intenta Drive (no bloquea si Apps Script aún no es v32). */
async function persistHostSecret(secretKey, json) {
    const dest = LOCAL_PATH[secretKey];
    fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
    const text = typeof json === "string" ? json : JSON.stringify(json, null, 2);
    fs_1.default.writeFileSync(dest, text, { encoding: "utf8", mode: 0o600 });
    const archived = await archiveHostSecret(secretKey, JSON.parse(text));
    if (!archived.ok) {
        console.warn(`[secrets] Drive backup ${secretKey} falló (¿Apps Script v32?):`, archived.error);
        return { localPath: dest, driveOk: false, driveError: archived.error };
    }
    return { localPath: dest, driveOk: true };
}
//# sourceMappingURL=hostSecretsArchive.js.map