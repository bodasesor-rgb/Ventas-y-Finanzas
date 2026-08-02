import type { KommoLead, KommoWebhookBody } from "./types";
/**
 * Extrae el primer lead ID del payload típico de webhook de Kommo
 * (leads[status], leads[update], leads[add]) — JSON o form-urlencoded.
 */
export declare function extractLeadIdFromWebhook(body: KommoWebhookBody | Record<string, unknown>): number | null;
export declare function extractPartialLeadFromWebhook(body: KommoWebhookBody | Record<string, unknown>, leadId: number): KommoLead;
export declare function kommoGetJson_(pathAndQuery: string, label: string): Promise<unknown>;
export type KommoPipelineStatus = {
    id: number;
    name: string;
    sort?: number;
    type?: number;
};
export type KommoPipeline = {
    id: number;
    name: string;
    is_main?: boolean;
    statuses: KommoPipelineStatus[];
};
/** Pipelines + statuses (nombres de etapas). */
export declare function fetchKommoPipelines(): Promise<KommoPipeline[]>;
/**
 * Leads creados en [fromUnix, toUnix] (inclusive), paginado.
 * Opcional: filtrar por pipeline_id.
 */
export declare function fetchLeadsCreatedBetween(opts: {
    fromUnix: number;
    toUnix: number;
    pipelineId?: number;
    maxPages?: number;
}): Promise<KommoLead[]>;
export type KommoMailEvent = {
    id?: number;
    type?: string;
    entity_id?: number;
    entity_type?: string;
    created_at?: number;
    value_after?: unknown;
    value_before?: unknown;
    subject?: string;
    raw?: unknown;
};
/**
 * Eventos de correo saliente en rango (para contar cotizaciones).
 * Prueba types típicos de Kommo/amoCRM.
 */
export declare function fetchOutgoingMailEvents(opts: {
    fromUnix: number;
    toUnix: number;
    maxPages?: number;
}): Promise<KommoMailEvent[]>;
/**
 * Obtiene el deal completo + contacto embebido desde la API de Kommo.
 */
export declare function fetchLeadWithContact(leadId: number): Promise<KommoLead>;
/** Últimos leads tocados en Kommo (para sync manual). */
export declare function fetchRecentLeads(limit?: number): Promise<KommoLead[]>;
export interface KommoWebhookInfo {
    id?: number;
    destination?: string;
    disabled?: boolean;
    settings?: string[];
}
/** Lista webhooks del account Kommo. */
export declare function listKommoWebhooks(): Promise<KommoWebhookInfo[]>;
/**
 * Asegura webhook status_lead → destination (subida al cerrar, al instante).
 * Si ya existe el mismo destination, no duplica.
 */
export declare function ensureKommoStatusWebhook(destination: string): Promise<{
    ok: boolean;
    created: boolean;
    destination: string;
    webhook?: KommoWebhookInfo;
    existing?: KommoWebhookInfo[];
    error?: string;
}>;
/**
 * Leads con closed_at reciente. El caller filtra ganado (142) vs perdido (143).
 * No depende solo de updated_at (un ganado se pierde entre leads abiertos).
 */
export declare function fetchRecentlyClosedLeads(limit?: number, lookbackMs?: number): Promise<KommoLead[]>;
