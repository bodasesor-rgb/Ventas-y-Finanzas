import type { KommoLead, KommoWebhookBody } from "./types";
/**
 * Extrae el primer lead ID del payload típico de webhook de Kommo
 * (leads[status], leads[update], leads[add]).
 */
export declare function extractLeadIdFromWebhook(body: KommoWebhookBody): number | null;
/**
 * Obtiene el deal completo + contacto embebido desde la API de Kommo.
 * Requiere KOMMO_BASE_URL y KOMMO_ACCESS_TOKEN en el entorno.
 */
export declare function fetchLeadWithContact(leadId: number): Promise<KommoLead>;
