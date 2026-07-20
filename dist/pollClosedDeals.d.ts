import type { KommoLead } from "./types";
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
export declare function isClosedWonLead(lead: KommoLead): boolean;
export declare function getPollStatus(): PollState & {
    polling: boolean;
    pollingStartedAt: number | null;
    lockAgeMs: number | null;
};
/**
 * Busca deals cerrados recientes en Kommo y escribe al Sheet solo los que
 * aún no están sincronizados (nunca re-sube los ya hechos).
 * `force` solo destraba un candado stuck — no reescribe filas viejas.
 * `onlyLatestMissing`: sube como máximo el cerrado más reciente que falte.
 */
export declare function pollClosedDealsOnce(limit?: number, opts?: {
    force?: boolean;
    onlyLatestMissing?: boolean;
}): Promise<PollState["lastResult"]>;
/**
 * Solo el deal cerrado más reciente que aún no está en el Sheet.
 * Usar cuando el usuario dice "no se subió" — nunca re-sube el resto.
 */
export declare function syncLatestMissingClosedDeal(limit?: number): Promise<PollState["lastResult"]>;
/** Arranca poll cada `intervalMs` (default 60s) + watchdog si se queda quieto. */
export declare function startClosedDealsPoller(intervalMs?: number): void;
export {};
