import fs from "fs";
import path from "path";
import { fetchRecentLeads } from "./kommoApi";
import type { KommoLead } from "./types";
import { syncDealToSheet } from "./ventasSync";

/** Status ganado por defecto en Kommo/amoCRM */
const DEFAULT_WON_STATUS_ID = 142;

const STATE_PATH = path.join(process.cwd(), "data", "ventas-poll.json");
/** Si un poll queda colgado más de esto, se destraba. */
const POLL_LOCK_MAX_MS = 90_000;
/** Si no hubo poll reciente, el watchdog fuerza uno. */
const POLL_STALE_MS = 3 * 60_000;

interface PollState {
  /** dealId → updated_at ya sincronizado */
  syncedUpdatedAt: Record<string, number>;
  lastPollAt: string | null;
  lastResult: {
    at: string;
    checked: number;
    synced: string[];
    errors: string[];
    skippedAlreadySynced?: number;
  } | null;
}

let memoryState: PollState = {
  syncedUpdatedAt: {},
  lastPollAt: null,
  lastResult: null,
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let pollingStartedAt = 0;

function loadState(): PollState {
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
  return memoryState;
}

function saveState(): void {
  try {
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

function leadRecency_(lead: KommoLead): number {
  return lead.closed_at || lead.updated_at || 0;
}

function isAlreadySynced_(lead: KommoLead): boolean {
  const id = String(lead.id);
  const updated = lead.updated_at || lead.closed_at || 0;
  const prev = memoryState.syncedUpdatedAt[id] || 0;
  return Boolean(prev && updated && prev >= updated);
}

/**
 * Busca deals cerrados recientes en Kommo y escribe al Sheet solo los que
 * aún no están sincronizados (nunca re-sube los ya hechos).
 * `force` solo destraba un candado stuck — no reescribe filas viejas.
 * `onlyLatestMissing`: sube como máximo el cerrado más reciente que falte.
 */
export async function pollClosedDealsOnce(
  limit = 40,
  opts?: { force?: boolean; onlyLatestMissing?: boolean }
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
    };
  }

  polling = true;
  pollingStartedAt = Date.now();
  const synced: string[] = [];
  const errors: string[] = [];
  let skippedAlreadySynced = 0;

  try {
    loadState();
    const leads = await fetchRecentLeads(limit);
    const closed = leads
      .filter(isClosedWonLead)
      .sort((a, b) => leadRecency_(b) - leadRecency_(a)); // más reciente primero

    for (const lead of closed) {
      const id = String(lead.id);
      const updated = lead.updated_at || lead.closed_at || 0;
      if (isAlreadySynced_(lead)) {
        skippedAlreadySynced++;
        continue;
      }
      try {
        const result = await syncDealToSheet(lead.id);
        if (result.sheetWrite.ok || !result.sheetWrite.attempted) {
          memoryState.syncedUpdatedAt[id] = updated || Date.now() / 1000;
          synced.push(id);
        } else {
          errors.push(`${id}: ${result.sheetWrite.error || "sheet fail"}`);
        }
      } catch (err) {
        errors.push(
          `${id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // Recuperación: solo el último faltante, no todos los pendientes
      if (opts?.onlyLatestMissing && synced.length > 0) break;
    }

    memoryState.lastPollAt = new Date().toISOString();
    memoryState.lastResult = {
      at: memoryState.lastPollAt,
      checked: closed.length,
      synced,
      errors,
      skippedAlreadySynced,
    };
    saveState();
    if (synced.length) {
      console.log("[ventas-poll] sincronizados", synced);
    } else {
      console.log(
        `[ventas-poll] OK sin nuevos · checked=${closed.length} · skipped=${skippedAlreadySynced}`
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
 * Solo el deal cerrado más reciente que aún no está en el Sheet.
 * Usar cuando el usuario dice "no se subió" — nunca re-sube el resto.
 */
export async function syncLatestMissingClosedDeal(
  limit = 40
): Promise<PollState["lastResult"]> {
  return pollClosedDealsOnce(limit, { force: true, onlyLatestMissing: true });
}

/** Arranca poll cada `intervalMs` (default 60s) + watchdog si se queda quieto. */
export function startClosedDealsPoller(intervalMs = 60_000): void {
  if (pollTimer) return;
  loadState();
  console.log(
    `[ventas-poll] activo cada ${Math.round(intervalMs / 1000)}s (backup si falla webhook Kommo)`
  );

  const run = (force = false) => {
    void pollClosedDealsOnce(40, { force }).catch((err) => {
      console.error("[ventas-poll] error", err);
      // Asegura liberar candado ante rechazo inesperado
      polling = false;
      pollingStartedAt = 0;
    });
  };

  // Primera pasada a los 8s (deja subir el server)
  setTimeout(() => run(false), 8_000);
  pollTimer = setInterval(() => run(false), intervalMs);

  // Watchdog: si lastPollAt es viejo o el candado está stuck, fuerza
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
