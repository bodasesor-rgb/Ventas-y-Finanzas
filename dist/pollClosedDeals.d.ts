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
    } | null;
}
export declare function isClosedWonLead(lead: KommoLead): boolean;
export declare function getPollStatus(): PollState;
/**
 * Busca deals cerrados recientes en Kommo y los escribe al Sheet.
 * Compensa webhooks de Kommo que no llegan / están desactivados.
 */
export declare function pollClosedDealsOnce(limit?: number): Promise<PollState["lastResult"]>;
/** Arranca poll cada `intervalMs` (default 60s) + una pasada al inicio. */
export declare function startClosedDealsPoller(intervalMs?: number): void;
export {};
