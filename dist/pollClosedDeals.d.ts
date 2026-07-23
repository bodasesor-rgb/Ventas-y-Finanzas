import type { KommoLead } from "./types";
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
export declare function isClosedWonLead(lead: KommoLead): boolean;
export declare function getPollStatus(): PollState & {
    polling: boolean;
    pollingStartedAt: number | null;
    lockAgeMs: number | null;
};
/**
 * Marca un deal como ya subido (webhook / sync manual / poll).
 * Evita que el poller lo re-suba o lo ignore por estado inconsistente.
 * No re-lee disco si el estado ya está en memoria (evita pisar un poll en curso).
 */
export declare function markDealSynced(dealId: string | number, closedAtSec?: number | null): void;
/**
 * Busca deals cerrados recientes y escribe al Sheet los que falten
 * dentro de la ventana de lookback. Más viejos: solo marcar estado
 * (no re-subir histórico).
 *
 * `force` solo destraba candado stuck.
 * `onlyLatestMissing`: como máximo 1 fila (el cierre más reciente elegible).
 * `lookbackMs`: override de la ventana de escritura.
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
