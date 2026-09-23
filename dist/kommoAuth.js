"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveKommoTokenStore = saveKommoTokenStore;
exports.getKommoAccessToken = getKommoAccessToken;
exports.getKommoBaseUrl = getKommoBaseUrl;
exports.hasKommoCredentials = hasKommoCredentials;
exports.kommoCredentialsSource = kommoCredentialsSource;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hostSecretsArchive_1 = require("./hostSecretsArchive");
const KOMMO_FILE = path_1.default.join(process.cwd(), "data", "kommo-token.json");
function readStore_() {
    try {
        if (fs_1.default.existsSync(KOMMO_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(KOMMO_FILE, "utf8"));
        }
    }
    catch (err) {
        console.warn("[kommo] no se pudo leer token file", err);
    }
    return null;
}
function saveKommoTokenStore(raw) {
    const prev = readStore_() || { access_token: "" };
    const next = {
        access_token: String(raw.access_token || prev.access_token).trim(),
        base_url: String(raw.base_url || prev.base_url || "").trim().replace(/\/$/, "") ||
            undefined,
        savedAt: new Date().toISOString(),
    };
    if (!next.access_token) {
        throw new Error("Falta access_token de Kommo");
    }
    fs_1.default.mkdirSync(path_1.default.dirname(KOMMO_FILE), { recursive: true });
    fs_1.default.writeFileSync(KOMMO_FILE, JSON.stringify(next, null, 2), {
        encoding: "utf8",
        mode: 0o600,
    });
    void (0, hostSecretsArchive_1.persistHostSecret)("kommo-token", next).catch((err) => {
        console.warn("[kommo] backup Drive token:", err instanceof Error ? err.message : err);
    });
    return next;
}
/** Archivo primero: Hostinger trunca tokens largos en env. */
function getKommoAccessToken() {
    const store = readStore_();
    if (store?.access_token)
        return store.access_token;
    return String(process.env.KOMMO_ACCESS_TOKEN || "").trim();
}
function getKommoBaseUrl() {
    const store = readStore_();
    if (store?.base_url)
        return store.base_url.replace(/\/$/, "");
    return String(process.env.KOMMO_BASE_URL || "")
        .trim()
        .replace(/\/$/, "");
}
function hasKommoCredentials() {
    return Boolean(getKommoBaseUrl() && getKommoAccessToken());
}
function kommoCredentialsSource() {
    const store = readStore_();
    if (store?.access_token) {
        return {
            hasToken: true,
            hasBase: Boolean(getKommoBaseUrl()),
            tokenFrom: "file",
        };
    }
    if (process.env.KOMMO_ACCESS_TOKEN) {
        return {
            hasToken: true,
            hasBase: Boolean(getKommoBaseUrl()),
            tokenFrom: "env",
        };
    }
    return { hasToken: false, hasBase: Boolean(getKommoBaseUrl()), tokenFrom: "none" };
}
//# sourceMappingURL=kommoAuth.js.map