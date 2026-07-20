"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClosedWonLead = isClosedWonLead;
exports.getPollStatus = getPollStatus;
exports.pollClosedDealsOnce = pollClosedDealsOnce;
exports.syncLatestMissingClosedDeal = syncLatestMissingClosedDeal;
exports.startClosedDealsPoller = startClosedDealsPoller;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const kommoApi_1 = require("./kommoApi");
const ventasSync_1 = require("./ventasSync");
/** Status ganado por defecto en Kommo/amoCRM */
const DEFAULT_WON_STATUS_ID = 142;
const STATE_PATH = path_1.default.join(process.cwd(), "data", "ventas-poll.json");
/** Si un poll queda colgado más de esto, se destraba. */
const POLL_LOCK_MAX_MS = 90_000;
/** Si no hubo poll reciente, el watchdog fuerza uno. */
const POLL_STALE_MS = 3 * 60_000;
/**
 * Sin lastPollAt (cold start): solo considerar cierres de esta ventana.
 * Los cerrados más viejos se marcan en estado SIN escribir al Sheet.
 */
const COLD_START_LOOKBACK_MS = 30 * 60_000;
/** Solape contra lastPollAt para no perder un cierre en el borde. */
const POLL_OVERLAP_MS = 2 * 60_000;
let memoryState = {
    syncedUpdatedAt: {},
    lastPollAt: null,
    lastResult: null,
};
let pollTimer = null;
let watchdogTimer = null;
let polling = false;
let pollingStartedAt = 0;
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
    return {
        ...memoryState,
        polling,
        pollingStartedAt: polling ? pollingStartedAt : null,
        lockAgeMs: polling ? Date.now() - pollingStartedAt : null,
    };
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
/** Corte: solo cierres ≥ esto se escriben al Sheet. */
function writeCutoffSec_() {
    if (memoryState.lastPollAt) {
        const t = Date.parse(memoryState.lastPollAt);
        if (Number.isFinite(t)) {
            return Math.floor((t - POLL_OVERLAP_MS) / 1000);
        }
    }
    return Math.floor((Date.now() - COLD_START_LOOKBACK_MS) / 1000);
}
/**
 * Busca deals cerrados recientes y escribe al Sheet SOLO los que se
 * acabaron de cerrar (closed_at ≥ cutoff). Los cerrados anteriores se
 * marcan en estado sin tocar el Sheet — aunque Kommo los haya “tocado”
 * (updated_at nuevo).
 *
 * `force` solo destraba candado stuck.
 * `onlyLatestMissing`: como máximo 1 fila (el cierre más reciente elegible).
 * `lookbackMs`: override del cutoff (p. ej. recuperación).
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
        const cutoff = opts?.lookbackMs != null
            ? Math.floor((Date.now() - opts.lookbackMs) / 1000)
            : writeCutoffSec_();
        const leads = await (0, kommoApi_1.fetchRecentLeads)(limit);
        const closed = leads
            .filter(isClosedWonLead)
            .sort((a, b) => leadRecency_(b) - leadRecency_(a));
        for (const lead of closed) {
            const id = String(lead.id);
            const closedAt = closedAtSec_(lead);
            const prev = memoryState.syncedUpdatedAt[id] || 0;
            // Sin closed_at: no adivinamos; solo marcamos para no spamear Sheet
            if (!closedAt) {
                if (!prev) {
                    memoryState.syncedUpdatedAt[id] =
                        lead.updated_at || Math.floor(Date.now() / 1000);
                    seededOld++;
                }
                else {
                    skippedAlreadySynced++;
                }
                continue;
            }
            // Ya procesamos este cierre (ignore updated_at de Kommo)
            if (prev >= closedAt) {
                skippedAlreadySynced++;
                continue;
            }
            // Cierre viejo: recordar sin escribir (evita re-subir el histórico)
            if (closedAt < cutoff) {
                memoryState.syncedUpdatedAt[id] = closedAt;
                seededOld++;
                continue;
            }
            // Cierre nuevo en la ventana → una escritura
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
            // Nunca más de un deal por pasada de recuperación
            if (opts?.onlyLatestMissing)
                break;
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
            console.log(`[ventas-poll] OK sin nuevos · checked=${closed.length} · skipped=${skippedAlreadySynced} · seededOld=${seededOld}`);
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
 * Solo el cierre más reciente de las últimas 2h que aún no se subió.
 * No re-sube cerrados anteriores.
 */
async function syncLatestMissingClosedDeal(limit = 40) {
    return pollClosedDealsOnce(limit, {
        force: true,
        onlyLatestMissing: true,
        lookbackMs: 2 * 60 * 60_000,
    });
}
/** Arranca poll cada `intervalMs` (default 60s) + watchdog si se queda quieto. */
function startClosedDealsPoller(intervalMs = 60_000) {
    if (pollTimer)
        return;
    loadState();
    console.log(`[ventas-poll] activo cada ${Math.round(intervalMs / 1000)}s — solo cierres nuevos (no re-sube históricos)`);
    // Una sola escritura por pasada: el cierre más reciente elegible.
    // Cierres viejos se siembran en estado sin tocar el Sheet.
    const run = (force = false) => {
        void pollClosedDealsOnce(40, {
            force,
            onlyLatestMissing: true,
        }).catch((err) => {
            console.error("[ventas-poll] error", err);
            polling = false;
            pollingStartedAt = 0;
        });
    };
    setTimeout(() => run(false), 8_000);
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
        }, 60_000);
    }
}
//# sourceMappingURL=pollClosedDeals.js.map