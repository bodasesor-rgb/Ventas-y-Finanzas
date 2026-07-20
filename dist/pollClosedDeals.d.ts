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
 * Busca deals cerrados recientes en Kommo y los escribe al Sheet.
 * Compensa webhooks de Kommo que no llegan / quedan desactivados.
 */
export declare function pollClosedDealsOnce(limit?: number, opts?: {
    force?: boolean;
}): Promise<PollState["lastResult"]>;
/** Arranca poll cada `intervalMs` (default 60s) + watchdog si se queda quieto. */
export declare function startClosedDealsPoller(intervalMs?: number): void;
export {};
