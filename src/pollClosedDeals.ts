import fs from "fs";
import path from "path";
import { fetchRecentLeads, fetchRecentlyClosedLeads } from "./kommoApi";
import type { KommoLead } from "./types";
import { syncDealToSheet } from "./ventasSync";

/** Status ganado por defecto en Kommo/amoCRM */
const DEFAULT_WON_STATUS_ID = 142;

const STATE_PATH = path.join(process.cwd(), "data", "ventas-poll.json");
/** Si un poll queda colgado más de esto, se destraba. */
const POLL_LOCK_MAX_MS = 90_000;
/** Si no hubo poll reciente, el watchdog fuerza uno. */
const POLL_STALE_MS = 3 * 60_000;
/**
 * Ventana de escritura: cualquier cierre dentro de estas horas que aún
 * no esté en estado se sube al Sheet. Más allá = histórico (solo marcar).
 *
 * Antes usábamos lastPollAt − 2 min: si el poll fallaba un momento,
 * el cierre se “sembraba” como viejo y nunca se subía.
 */
const WRITE_LOOKBACK_MS = 6 * 60 * 60_000;

interface PollState {
  /**
   * dealId → closed_at (unix sec) ya procesado (escrito o histórico).
   * Nunca guardar updated_at aquí: bloquearía el sync cuando llegue closed_at.
   */
  syncedUpdatedAt: Record<string, number>;
  lastPollAt: string | null;
  lastResult: {
    at: string;
    checked: number;
    synced: string[];
    errors: string[];
    skippedAlreadySynced?: number;
    seededOld?: number;
  } | null;
}

let memoryState: PollState = {
  syncedUpdatedAt: {},
  lastPollAt: null,
  lastResult: null,
};

let stateHydrated = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let pollingStartedAt = 0;

function loadState(): PollState {
  if (stateHydrated) return memoryState;
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as PollState;
      memoryState = {
        syncedUpdatedAt: raw.syncedUpdatedAt || {},
        lastPollAt: raw.lastPollAt || null,
        lastResult: raw.lastResult || null,
      };
    }
  } catch (err) {
    console.warn("[ventas-poll] No se pudo leer estado", err);
  }
  stateHydrated = true;
  return memoryState;
}

function saveState(): void {
  try {
    stateHydrated = true;
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(memoryState, null, 2));
  } catch (err) {
    console.warn("[ventas-poll] No se pudo guardar estado", err);
  }
}

export function isClosedWonLead(lead: KommoLead): boolean {
  if (lead.closed_at && lead.closed_at > 0) return true;
  if (lead.status_id === DEFAULT_WON_STATUS_ID) return true;
  return false;
}

export function getPollStatus(): PollState & {
  polling: boolean;
  pollingStartedAt: number | null;
  lockAgeMs: number | null;
} {
  return {
    ...memoryState,
    polling,
    pollingStartedAt: polling ? pollingStartedAt : null,
    lockAgeMs: polling ? Date.now() - pollingStartedAt : null,
  };
}

/**
 * Marca un deal como ya subido (webhook / sync manual / poll).
 * Evita que el poller lo re-suba o lo ignore por estado inconsistente.
 * No re-lee disco si el estado ya está en memoria (evita pisar un poll en curso).
 */
export function markDealSynced(
  dealId: string | number,
  closedAtSec?: number | null
): void {
  loadState();
  const id = String(dealId);
  const ts =
    closedAtSec && closedAtSec > 0
      ? closedAtSec
      : Math.floor(Date.now() / 1000);
  const prev = memoryState.syncedUpdatedAt[id] || 0;
  if (ts >= prev) {
    memoryState.syncedUpdatedAt[id] = ts;
    saveState();
  }
}

/** Libera el candado si un poll anterior se quedó colgado. */
function releaseStuckLock_(force = false): boolean {
  if (!polling) return false;
  const age = Date.now() - pollingStartedAt;
  if (force || age >= POLL_LOCK_MAX_MS) {
    console.warn(
      `[ventas-poll] liberando candado stuck (age=${Math.round(age / 1000)}s, force=${force})`
    );
    polling = false;
    pollingStartedAt = 0;
    return true;
  }
  return false;
}

/** Momento de cierre en unix seconds (0 si no hay closed_at). */
function closedAtSec_(lead: KommoLead): number {
  return lead.closed_at && lead.closed_at > 0 ? lead.closed_at : 0;
}

function leadRecency_(lead: KommoLead): number {
  return closedAtSec_(lead) || lead.updated_at || 0;
}

/**
 * Busca deals cerrados recientes y escribe al Sheet los que falten
 * dentro de la ventana de lookback. Más viejos: solo marcar estado
 * (no re-subir histórico).
 *
 * `force` solo destraba candado stuck.
 * `onlyLatestMissing`: como máximo 1 fila (el cierre más reciente elegible).
 * `lookbackMs`: override de la ventana de escritura.
 */
export async function pollClosedDealsOnce(
  limit = 40,
  opts?: {
    force?: boolean;
    onlyLatestMissing?: boolean;
    lookbackMs?: number;
  }
): Promise<PollState["lastResult"]> {
  releaseStuckLock_(Boolean(opts?.force));

  if (polling) {
    return {
      at: new Date().toISOString(),
      checked: 0,
      synced: [],
      errors: [
        `poll ya en curso (desde hace ${Math.round(
          (Date.now() - pollingStartedAt) / 1000
        )}s)`,
      ],
      skippedAlreadySynced: 0,
      seededOld: 0,
    };
  }

  polling = true;
  pollingStartedAt = Date.now();
  const synced: string[] = [];
  const errors: string[] = [];
  let skippedAlreadySynced = 0;
  let seededOld = 0;

  try {
    loadState();
    const lookbackMs = opts?.lookbackMs ?? WRITE_LOOKBACK_MS;
    const cutoff = Math.floor((Date.now() - lookbackMs) / 1000);

    let leads: KommoLead[];
    try {
      leads = await fetchRecentlyClosedLeads(limit, lookbackMs);
    } catch (err) {
      console.warn(
        "[ventas-poll] fetchRecentlyClosedLeads falló, fallback recent",
        err instanceof Error ? err.message : err
      );
      leads = await fetchRecentLeads(limit);
    }

    const closed = leads
      .filter(isClosedWonLead)
      .sort((a, b) => leadRecency_(b) - leadRecency_(a));

    for (const lead of closed) {
      const id = String(lead.id);
      const closedAt = closedAtSec_(lead);
      const prev = memoryState.syncedUpdatedAt[id] || 0;

      // Ganado sin closed_at aún: intentar subir (no marcar con updated_at —
      // eso bloqueaba el sync cuando Kommo rellenaba closed_at después).
      if (!closedAt) {
        if (prev > 0) {
          skippedAlreadySynced++;
          continue;
        }
        // Si updated_at es viejo fuera de lookback, no spamear Sheet
        const touched = lead.updated_at || 0;
        if (touched > 0 && touched < cutoff) {
          seededOld++;
          continue;
        }
        try {
          const result = await syncDealToSheet(lead.id);
          if (result.sheetWrite.ok || !result.sheetWrite.attempted) {
            memoryState.syncedUpdatedAt[id] = Math.floor(Date.now() / 1000);
            synced.push(id);
          } else {
            errors.push(`${id}: ${result.sheetWrite.error || "sheet fail"}`);
          }
        } catch (err) {
          errors.push(
            `${id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        if (opts?.onlyLatestMissing) break;
        continue;
      }

      // Ya procesamos este cierre
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

      // Cierre nuevo en la ventana → escribir
      try {
        const result = await syncDealToSheet(lead.id);
        if (result.sheetWrite.ok || !result.sheetWrite.attempted) {
          memoryState.syncedUpdatedAt[id] = closedAt;
          synced.push(id);
        } else {
          errors.push(`${id}: ${result.sheetWrite.error || "sheet fail"}`);
        }
      } catch (err) {
        errors.push(
          `${id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (opts?.onlyLatestMissing) break;
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
    } else {
      console.log(
        `[ventas-poll] OK sin nuevos · checked=${closed.length} · skipped=${skippedAlreadySynced} · seededOld=${seededOld} · lookbackH=${Math.round(lookbackMs / 3600000)}`
      );
    }
    return memoryState.lastResult;
  } catch (err) {
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
  } finally {
    polling = false;
    pollingStartedAt = 0;
  }
}

/**
 * Solo el cierre más reciente de las últimas 2h que aún no se subió.
 * No re-sube cerrados anteriores.
 */
export async function syncLatestMissingClosedDeal(
  limit = 40
): Promise<PollState["lastResult"]> {
  return pollClosedDealsOnce(limit, {
    force: true,
    onlyLatestMissing: true,
    lookbackMs: 2 * 60 * 60_000,
  });
}

/** Arranca poll cada `intervalMs` (default 60s) + watchdog si se queda quieto. */
export function startClosedDealsPoller(intervalMs = 60_000): void {
  if (pollTimer) return;
  loadState();
  console.log(
    `[ventas-poll] activo cada ${Math.round(intervalMs / 1000)}s — lookback ${Math.round(WRITE_LOOKBACK_MS / 3600000)}h, solo cierres nuevos`
  );

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
        console.warn(
          "[ventas-poll] watchdog: poll stale → forzando pasada"
        );
        run(false);
      }
    }, 60_000);
  }
}
