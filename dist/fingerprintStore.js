"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDuplicateDealId = findDuplicateDealId;
exports.rememberFingerprint = rememberFingerprint;
exports.getFingerprintStoreStatus = getFingerprintStoreStatus;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const STORE_PATH = path_1.default.join(process.cwd(), "data", "ventas-fingerprints.json");
let memory = { byFingerprint: {}, updatedAt: null };
let hydrated = false;
function load_() {
    if (hydrated)
        return memory;
    try {
        if (fs_1.default.existsSync(STORE_PATH)) {
            const raw = JSON.parse(fs_1.default.readFileSync(STORE_PATH, "utf8"));
            memory = {
                byFingerprint: raw.byFingerprint || {},
                updatedAt: raw.updatedAt || null,
            };
        }
    }
    catch (err) {
        console.warn("[ventas-fp] no se pudo leer store", err);
    }
    hydrated = true;
    return memory;
}
function save_() {
    try {
        hydrated = true;
        memory.updatedAt = new Date().toISOString();
        fs_1.default.mkdirSync(path_1.default.dirname(STORE_PATH), { recursive: true });
        fs_1.default.writeFileSync(STORE_PATH, JSON.stringify(memory, null, 2));
    }
    catch (err) {
        console.warn("[ventas-fp] no se pudo guardar store", err);
    }
}
/** Si otro deal ya subió la misma huella → dealId existente; si no, null. */
function findDuplicateDealId(fingerprint, dealId) {
    if (!fingerprint || fingerprint === "||||")
        return null;
    load_();
    const prev = memory.byFingerprint[fingerprint];
    if (prev && prev !== dealId)
        return prev;
    return null;
}
function rememberFingerprint(fingerprint, dealId) {
    if (!fingerprint || fingerprint === "||||" || !dealId)
        return;
    load_();
    memory.byFingerprint[fingerprint] = dealId;
    save_();
}
function getFingerprintStoreStatus() {
    load_();
    return {
        count: Object.keys(memory.byFingerprint).length,
        updatedAt: memory.updatedAt,
    };
}
//# sourceMappingURL=fingerprintStore.js.map