import fs from "fs";
import path from "path";
import { fetchRecentLeads } from "./kommoApi";
import type { KommoLead } from "./types";
import { syncDealToSheet } from "./ventasSync";

/** Status ganado por defecto en Kommo/amoCRM */
const DEFAULT_WON_STATUS_ID = 142;

const STATE_PATH = path.join(process.cwd(), "data", "ventas-poll.json");

interface PollState {
  /** dealId → updated_at ya sincronizado */
  syncedUpdatedAt: Record<string, number>;
  lastPollAt: string | null;
  lastResult: {
    at: string;
    checked: number;
    synced: string[];
    errors: string[];
  } | null;
}

let memoryState: PollState = {
  syncedUpdatedAt: {},
  lastPollAt: null,
  lastResult: null,
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

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

export function getPollStatus(): PollState {
  return memoryState;
}

/**
 * Busca deals cerrados recientes en Kommo y los escribe al Sheet.
 * Compensa webhooks de Kommo que no llegan / están desactivados.
 */
export async function pollClosedDealsOnce(limit = 30): Promise<PollState["lastResult"]> {
  if (polling) {
    return (
      memoryState.lastResult || {
        at: new Date().toISOString(),
        checked: 0,
        synced: [],
        errors: ["poll ya en curso"],
      }
    );
  }
  polling = true;
  const synced: string[] = [];
  const errors: string[] = [];

  try {
    loadState();
    const leads = await fetchRecentLeads(limit);
    const closed = leads.filter(isClosedWonLead);

    for (const lead of closed) {
      const id = String(lead.id);
      const updated = lead.updated_at || lead.closed_at || 0;
      const prev = memoryState.syncedUpdatedAt[id] || 0;
      if (prev && updated && prev >= updated) {
        continue; // sin cambios desde el último sync
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
  } finally {
    polling = false;
  }
}

/** Arranca poll cada `intervalMs` (default 60s) + una pasada al inicio. */
export function startClosedDealsPoller(intervalMs = 60_000): void {
  if (pollTimer) return;
  loadState();
  console.log(
    `[ventas-poll] activo cada ${Math.round(intervalMs / 1000)}s (backup si falla webhook Kommo)`
  );

  const run = () => {
    void pollClosedDealsOnce().catch((err) => {
      console.error("[ventas-poll] error", err);
    });
  };

  // Primera pasada a los 8s (deja subir el server)
  setTimeout(run, 8_000);
  pollTimer = setInterval(run, intervalMs);
}
