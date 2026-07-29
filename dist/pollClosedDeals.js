"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClosedWonLead = isClosedWonLead;
exports.getPollStatus = getPollStatus;
exports.markDealSynced = markDealSynced;
exports.pollClosedDealsOnce = pollClosedDealsOnce;
exports.syncLatestMissingClosedDeal = syncLatestMissingClosedDeal;
exports.kickPollIfStale = kickPollIfStale;
exports.runPollTick = runPollTick;
exports.startClosedDealsPoller = startClosedDealsPoller;
exports.getWriteLookbackMs = getWriteLookbackMs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const kommoApi_1 = require("./kommoApi");
const ventasSync_1 = require("./ventasSync");
/** Status ganado / perdido por defecto en Kommo/amoCRM */
const DEFAULT_WON_STATUS_ID = 142;
const DEFAULT_LOST_STATUS_ID = 143;
const STATE_PATH = path_1.default.join(process.cwd(), "data", "ventas-poll.json");
/** Si un poll queda colgado más de esto, se destraba. */
const POLL_LOCK_MAX_MS = 90_000;
/** Si no hubo poll reciente, el watchdog / request fuerza uno. */
const POLL_STALE_MS = 90_000;
/**
 * Ventana de escritura: cierres dentro de estas horas que falten → Sheet.
 * Hostinger puede congelar Node muchas horas; 6h no bastaba.
 */
const WRITE_LOOKBACK_MS = 72 * 60 * 60_000;
/** Máx. cierres nuevos por pasada (evita timeout; tick/cron sigue enseguida). */
const MAX_SYNC_PER_POLL = 15;
let memoryState = {
    syncedUpdatedAt: {},
    lastPollAt: null,
    lastResult: null,
};
let stateHydrated = false;
let pollTimer = null;
let watchdogTimer = null;
let polling = false;
let pollingStartedAt = 0;
function loadState() {
    if (stateHydrated)
        return memoryState;
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
    stateHydrated = true;
    return memoryState;
}
function saveState() {
    try {
        stateHydrated = true;
        fs_1.default.mkdirSync(path_1.default.dirname(STATE_PATH), { recursive: true });
        fs_1.default.writeFileSync(STATE_PATH, JSON.stringify(memoryState, null, 2));
    }
    catch (err) {
        console.warn("[ventas-poll] No se pudo guardar estado", err);
    }
}
function isClosedWonLead(lead) {
    if (lead.status_id === DEFAULT_LOST_STATUS_ID)
        return false;
    if (lead.status_id === DEFAULT_WON_STATUS_ID)
        return true;
    // Sin status 142 no asumimos ganado solo por closed_at (puede ser perdido).
    return false;
}
function getPollStatus() {
    loadState();
    const last = memoryState.lastPollAt
        ? Date.parse(memoryState.lastPollAt)
        : NaN;
    return {
        ...memoryState,
        polling,
        pollingStartedAt: polling ? pollingStartedAt : null,
        lockAgeMs: polling ? Date.now() - pollingStartedAt : null,
        lookbackHours: Math.round(WRITE_LOOKBACK_MS / 3600000),
        pollAgeMs: Number.isFinite(last) ? Date.now() - last : null,
    };
}
/**
 * Marca un deal como ya subido (webhook / sync manual / poll).
 * No re-lee disco si el estado ya está en memoria (evita pisar un poll en curso).
 */
function markDealSynced(dealId, closedAtSec) {
    loadState();
    const id = String(dealId);
    const ts = closedAtSec && closedAtSec > 0
        ? closedAtSec
        : Math.floor(Date.now() / 1000);
    const prev = memoryState.syncedUpdatedAt[id] || 0;
    if (ts >= prev) {
        memoryState.syncedUpdatedAt[id] = ts;
        saveState();
    }
}
/** Libera el candado si un poll anterior se quedó colgado. */
function releaseStuckLock_(force = false) {
    if (!polling)
        return false;
    const age = Date.now() - pollingStartedAt;
    if (force || age >= POLL_LOCK_MAX_MS) {
        console.warn(`[ventas-poll] liberando candado stuck (age=${Math.round(age / 1000)}s, force=${force})`);
        polling = false;
        pollingStartedAt = 0;
        return true;
    }
    return false;
}
/** Momento de cierre en unix seconds (0 si no hay closed_at). */
function closedAtSec_(lead) {
    return lead.closed_at && lead.closed_at > 0 ? lead.closed_at : 0;
}
function leadRecency_(lead) {
    return closedAtSec_(lead) || lead.updated_at || 0;
}
/**
 * Busca deals ganados recientes y escribe al Sheet los que falten
 * dentro de la ventana de lookback.
 */
async function pollClosedDealsOnce(limit = 40, opts) {
    releaseStuckLock_(Boolean(opts?.force));
    if (polling) {
        return {
            at: new Date().toISOString(),
            checked: 0,
            synced: [],
            errors: [
                `poll ya en curso (desde hace ${Math.round((Date.now() - pollingStartedAt) / 1000)}s)`,
            ],
            skippedAlreadySynced: 0,
            seededOld: 0,
        };
    }
    polling = true;
    pollingStartedAt = Date.now();
    const synced = [];
    const errors = [];
    let skippedAlreadySynced = 0;
    let seededOld = 0;
    try {
        loadState();
        const lookbackMs = opts?.lookbackMs ?? WRITE_LOOKBACK_MS;
        const cutoff = Math.floor((Date.now() - lookbackMs) / 1000);
        const maxSync = opts?.maxSync ??
            (opts?.onlyLatestMissing ? 1 : MAX_SYNC_PER_POLL);
        let leads;
        try {
            leads = await (0, kommoApi_1.fetchRecentlyClosedLeads)(limit, lookbackMs);
        }
        catch (err) {
            console.warn("[ventas-poll] fetchRecentlyClosedLeads falló, fallback recent", err instanceof Error ? err.message : err);
            leads = await (0, kommoApi_1.fetchRecentLeads)(limit);
        }
        const closed = leads
            .filter(isClosedWonLead)
            .sort((a, b) => leadRecency_(b) - leadRecency_(a));
        for (const lead of closed) {
            if (synced.length >= maxSync)
                break;
            const id = String(lead.id);
            const closedAt = closedAtSec_(lead);
            const prev = memoryState.syncedUpdatedAt[id] || 0;
            // Ganado sin closed_at: intentar subir (no marcar con updated_at).
            if (!closedAt) {
                if (prev > 0) {
                    skippedAlreadySynced++;
                    continue;
                }
                const touched = lead.updated_at || 0;
                if (touched > 0 && touched < cutoff) {
                    seededOld++;
                    continue;
                }
                try {
                    const result = await (0, ventasSync_1.syncDealToSheet)(lead.id);
                    if (result.sheetWrite.ok || !result.sheetWrite.attempted) {
                        memoryState.syncedUpdatedAt[id] = Math.floor(Date.now() / 1000);
                        synced.push(id);
                    }
                    else {
                        errors.push(`${id}: ${result.sheetWrite.error || "sheet fail"}`);
                    }
                }
                catch (err) {
                    errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
                }
                continue;
            }
            if (prev >= closedAt) {
                skippedAlreadySynced++;
                continue;
            }
            // Histórico fuera de ventana: recordar sin escribir
            if (closedAt < cutoff) {
                memoryState.syncedUpdatedAt[id] = closedAt;
                seededOld++;
                continue;
            }
            try {
                const result = await (0, ventasSync_1.syncDealToSheet)(lead.id);
                if (result.sheetWrite.ok || !result.sheetWrite.attempted) {
                    memoryState.syncedUpdatedAt[id] = closedAt;
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
            skippedAlreadySynced,
            seededOld,
        };
        saveState();
        if (synced.length) {
            console.log("[ventas-poll] sincronizados (solo cierres nuevos)", synced);
        }
        else {
            console.log(`[ventas-poll] OK sin nuevos · checked=${closed.length} · skipped=${skippedAlreadySynced} · seededOld=${seededOld} · lookbackH=${Math.round(lookbackMs / 3600000)}`);
        }
        return memoryState.lastResult;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        memoryState.lastPollAt = new Date().toISOString();
        memoryState.lastResult = {
            at: memoryState.lastPollAt,
            checked: 0,
            synced,
            errors: [...errors, `poll fatal: ${msg}`],
            skippedAlreadySynced,
            seededOld,
        };
        saveState();
        console.error("[ventas-poll] fatal", msg);
        return memoryState.lastResult;
    }
    finally {
        polling = false;
        pollingStartedAt = 0;
    }
}
/**
 * Solo el cierre más reciente de las últimas 48h que aún no se subió.
 */
async function syncLatestMissingClosedDeal(limit = 40) {
    return pollClosedDealsOnce(limit, {
        force: true,
        onlyLatestMissing: true,
        lookbackMs: 48 * 60 * 60_000,
    });
}
/**
 * Si el poll está viejo (Hostinger congela timers), dispara uno en background.
 * Llamar desde cada request HTTP.
 */
function kickPollIfStale(staleMs = POLL_STALE_MS) {
    loadState();
    releaseStuckLock_(false);
    const last = memoryState.lastPollAt
        ? Date.parse(memoryState.lastPollAt)
        : 0;
    const stale = !last || Date.now() - last > staleMs;
    if (!stale || polling)
        return false;
    console.log("[ventas-poll] kick por request (poll stale)");
    void pollClosedDealsOnce(50, {
        force: false,
        onlyLatestMissing: false,
    }).catch((err) => {
        console.error("[ventas-poll] kick error", err);
        polling = false;
        pollingStartedAt = 0;
    });
    return true;
}
/**
 * Tick síncrono para cron externo: sube TODOS los faltantes de la ventana ya.
 * Pensado para GitHub Actions / Apps Script cada 1–5 min.
 */
async function runPollTick() {
    return pollClosedDealsOnce(50, {
        force: true,
        onlyLatestMissing: false,
        maxSync: MAX_SYNC_PER_POLL,
    });
}
/** Arranca poll cada `intervalMs` + watchdog + listo para kick por request. */
function startClosedDealsPoller(intervalMs = 60_000) {
    if (pollTimer)
        return;
    loadState();
    console.log(`[ventas-poll] activo cada ${Math.round(intervalMs / 1000)}s — lookback ${Math.round(WRITE_LOOKBACK_MS / 3600000)}h, hasta ${MAX_SYNC_PER_POLL} cierres/pasada + kick por request`);
    const run = (force = false) => {
        void pollClosedDealsOnce(40, {
            force,
            onlyLatestMissing: false,
        }).catch((err) => {
            console.error("[ventas-poll] error", err);
            polling = false;
            pollingStartedAt = 0;
        });
    };
    setTimeout(() => run(false), 3_000);
    pollTimer = setInterval(() => run(false), intervalMs);
    if (!watchdogTimer) {
        watchdogTimer = setInterval(() => {
            releaseStuckLock_(false);
            const last = memoryState.lastPollAt
                ? Date.parse(memoryState.lastPollAt)
                : 0;
            const stale = !last || Date.now() - last > POLL_STALE_MS;
            if (stale && !polling) {
                console.warn("[ventas-poll] watchdog: poll stale → forzando pasada");
                run(false);
            }
        }, 45_000);
    }
}
function getWriteLookbackMs() {
    return WRITE_LOOKBACK_MS;
}
//# sourceMappingURL=pollClosedDeals.js.map