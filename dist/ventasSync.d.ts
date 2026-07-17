import type { FilaVentas, KommoWebhookBody } from "./types";
export interface VentasSyncResult {
    startedAt: string;
    finishedAt: string;
    dealId: string;
    dataSource: "kommo_api" | "webhook_partial";
    kommoApiError: string | null;
    fila: FilaVentas;
    values: string[];
    sheetWrite: {
        attempted: boolean;
        ok: boolean;
        action?: string;
        row?: number;
        version?: string;
        error?: string;
    };
    headers: readonly string[];
}
declare let lastAccepted: {
    at: string;
    dealId: string;
    source: string;
} | null;
export declare function getLastVentasSync(): VentasSyncResult | null;
export declare function getLastWebhookAccepted(): typeof lastAccepted;
export declare function rememberWebhookAccepted(dealId: string, source: string): void;
/**
 * Trae el deal de Kommo (o partial del webhook) y escribe Eventos YYYY.
 */
export declare function syncDealToSheet(leadId: number, webhookBody?: KommoWebhookBody | Record<string, unknown>): Promise<VentasSyncResult>;
export {};
