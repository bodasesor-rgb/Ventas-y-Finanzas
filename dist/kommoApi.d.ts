import type { KommoLead, KommoWebhookBody } from "./types";
/**
 * Extrae el primer lead ID del payload típico de webhook de Kommo
 * (leads[status], leads[update], leads[add]) — JSON o form-urlencoded.
 */
export declare function extractLeadIdFromWebhook(body: KommoWebhookBody | Record<string, unknown>): number | null;
export declare function extractPartialLeadFromWebhook(body: KommoWebhookBody | Record<string, unknown>, leadId: number): KommoLead;
/**
 * Obtiene el deal completo + contacto embebido desde la API de Kommo.
 */
export declare function fetchLeadWithContact(leadId: number): Promise<KommoLead>;
/** Últimos leads tocados en Kommo (para sync manual). */
export declare function fetchRecentLeads(limit?: number): Promise<KommoLead[]>;
/**
 * Leads cerrados desde `sinceMs` atrás (por closed_at), no por updated_at.
 * Así un deal ganado no se pierde entre 40 leads abiertos recién tocados.
 */
export declare function fetchRecentlyClosedLeads(limit?: number, lookbackMs?: number): Promise<KommoLead[]>;
