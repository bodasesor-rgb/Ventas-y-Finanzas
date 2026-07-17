"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClosedWonLead = isClosedWonLead;
exports.getPollStatus = getPollStatus;
exports.pollClosedDealsOnce = pollClosedDealsOnce;
exports.startClosedDealsPoller = startClosedDealsPoller;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const kommoApi_1 = require("./kommoApi");
const ventasSync_1 = require("./ventasSync");
/** Status ganado por defecto en Kommo/amoCRM */
const DEFAULT_WON_STATUS_ID = 142;
const STATE_PATH = path_1.default.join(process.cwd(), "data", "ventas-poll.json");
let memoryState = {
    syncedUpdatedAt: {},
    lastPollAt: null,
    lastResult: null,
};
let pollTimer = null;
let polling = false;
function loadState() {
    try {
        if (fs_1.default.existsSync(STATE_PATH)) {
            const raw = JSON.parse(fs_1.default.readFileSync(STATE_PATH, "utf8"));
            memoryState = {
                syncedUpdatedAt: raw.syncedUpdatedAt || {},
                lastPollAt: raw.lastPollAt || null,
                lastResult: raw.lastResult || null,
            };
        }
    }
    catch (err) {
        console.warn("[ventas-poll] No se pudo leer estado", err);
    }
    return memoryState;
}
function saveState() {
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(STATE_PATH), { recursive: true });
        fs_1.default.writeFileSync(STATE_PATH, JSON.stringify(memoryState, null, 2));
    }
    catch (err) {
        console.warn("[ventas-poll] No se pudo guardar estado", err);
    }
}
function isClosedWonLead(lead) {
    if (lead.closed_at && lead.closed_at > 0)
        return true;
    if (lead.status_id === DEFAULT_WON_STATUS_ID)
        return true;
    return false;
}
function getPollStatus() {
    return memoryState;
}
/**
 * Busca deals cerrados recientes en Kommo y los escribe al Sheet.
 * Compensa webhooks de Kommo que no llegan / están desactivados.
 */
async function pollClosedDealsOnce(limit = 30) {
    if (polling) {
        return (memoryState.lastResult || {
            at: new Date().toISOString(),
            checked: 0,
            synced: [],
            errors: ["poll ya en curso"],
        });
    }
    polling = true;
    const synced = [];
    const errors = [];
    try {
        loadState();
        const leads = await (0, kommoApi_1.fetchRecentLeads)(limit);
        const closed = leads.filter(isClosedWonLead);
        for (const lead of closed) {
            const id = String(lead.id);
            const updated = lead.updated_at || lead.closed_at || 0;
            const prev = memoryState.syncedUpdatedAt[id] || 0;
            if (prev && updated && prev >= updated) {
                continue; // sin cambios desde el último sync
            }
            try {
                const result = await (0, ventasSync_1.syncDealToSheet)(lead.id);
                if (result.sheetWrite.ok || !result.sheetWrite.attempted) {
                    memoryState.syncedUpdatedAt[id] = updated || Date.now() / 1000;
                    synced.push(id);
                }
                else {
                    errors.push(`${id}: ${result.sheetWrite.error || "sheet fail"}`);
                }
            }
            catch (err) {
                errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        memoryState.lastPollAt = new Date().toISOString();
        memoryState.lastResult = {
            at: memoryState.lastPollAt,
            checked: closed.length,
            synced,
            errors,
        };
        saveState();
        if (synced.length) {
            console.log("[ventas-poll] sincronizados", synced);
        }
        return memoryState.lastResult;
    }
    finally {
        polling = false;
    }
}
/** Arranca poll cada `intervalMs` (default 60s) + una pasada al inicio. */
function startClosedDealsPoller(intervalMs = 60_000) {
    if (pollTimer)
        return;
    loadState();
    console.log(`[ventas-poll] activo cada ${Math.round(intervalMs / 1000)}s (backup si falla webhook Kommo)`);
    const run = () => {
        void pollClosedDealsOnce().catch((err) => {
            console.error("[ventas-poll] error", err);
        });
    };
    // Primera pasada a los 8s (deja subir el server)
    setTimeout(run, 8_000);
    pollTimer = setInterval(run, intervalMs);
}
//# sourceMappingURL=pollClosedDeals.js.map