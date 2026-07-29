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
    lookbackHours: number;
    pollAgeMs: number | null;
};
/**
 * Marca un deal como ya subido (webhook / sync manual / poll).
 * No re-lee disco si el estado ya está en memoria (evita pisar un poll en curso).
 */
export declare function markDealSynced(dealId: string | number, closedAtSec?: number | null): void;
/**
 * Busca deals ganados recientes y escribe al Sheet los que falten
 * dentro de la ventana de lookback.
 */
export declare function pollClosedDealsOnce(limit?: number, opts?: {
    force?: boolean;
    /** Si true: máx. 1 escritura. Si false: hasta MAX_SYNC_PER_POLL. */
    onlyLatestMissing?: boolean;
    lookbackMs?: number;
    maxSync?: number;
}): Promise<PollState["lastResult"]>;
/**
 * Solo el cierre más reciente de las últimas 48h que aún no se subió.
 */
export declare function syncLatestMissingClosedDeal(limit?: number): Promise<PollState["lastResult"]>;
/**
 * Si el poll está viejo (Hostinger congela timers), dispara uno en background.
 * Llamar desde cada request HTTP.
 */
export declare function kickPollIfStale(staleMs?: number): boolean;
/**
 * Tick síncrono para cron externo: sube TODOS los faltantes de la ventana ya.
 * Pensado para GitHub Actions / Apps Script cada 1–5 min.
 */
export declare function runPollTick(): Promise<PollState["lastResult"]>;
/** Arranca poll cada `intervalMs` + watchdog + listo para kick por request. */
export declare function startClosedDealsPoller(intervalMs?: number): void;
export declare function getWriteLookbackMs(): number;
export {};
