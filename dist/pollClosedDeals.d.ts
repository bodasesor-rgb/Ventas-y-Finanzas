import type { KommoLead } from "./types";
interface PollState {
    /**
     * dealId → closed_at (unix sec) ya procesado.
     * (Histórico: pudo guardar updated_at; seguimos comparando contra closed_at.)
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
export declare function isClosedWonLead(lead: KommoLead): boolean;
export declare function getPollStatus(): PollState & {
    polling: boolean;
    pollingStartedAt: number | null;
    lockAgeMs: number | null;
};
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
export declare function pollClosedDealsOnce(limit?: number, opts?: {
    force?: boolean;
    onlyLatestMissing?: boolean;
    lookbackMs?: number;
}): Promise<PollState["lastResult"]>;
/**
 * Solo el cierre más reciente de las últimas 2h que aún no se subió.
 * No re-sube cerrados anteriores.
 */
export declare function syncLatestMissingClosedDeal(limit?: number): Promise<PollState["lastResult"]>;
/** Arranca poll cada `intervalMs` (default 60s) + watchdog si se queda quieto. */
export declare function startClosedDealsPoller(intervalMs?: number): void;
export {};
