import type { KommoContactEmbedded, KommoLead, KommoWebhookBody } from "./types";

const KOMMO_BASE = process.env.KOMMO_BASE_URL?.replace(/\/$/, "");
const KOMMO_TOKEN = process.env.KOMMO_ACCESS_TOKEN;

/**
 * Extrae el primer lead ID del payload típico de webhook de Kommo
 * (leads[status], leads[update], leads[add]).
 */
export function extractLeadIdFromWebhook(body: KommoWebhookBody): number | null {
  const buckets = [
    body.leads?.status,
    body.leads?.update,
    body.leads?.add,
  ];
  for (const list of buckets) {
    if (!list?.length) continue;
    const raw = list[0].id;
    const id = typeof raw === "string" ? Number(raw) : raw;
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

/**
 * Obtiene el deal completo + contacto embebido desde la API de Kommo.
 * Requiere KOMMO_BASE_URL y KOMMO_ACCESS_TOKEN en el entorno.
 */
export async function fetchLeadWithContact(
  leadId: number
): Promise<KommoLead> {
  if (!KOMMO_BASE || !KOMMO_TOKEN) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno"
    );
  }

  const url = `${KOMMO_BASE}/api/v4/leads/${leadId}?with=contacts`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${KOMMO_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kommo API ${res.status}: ${text.slice(0, 500)}`);
  }

  const lead = (await res.json()) as KommoLead;

  // Si el lead trae contact IDs sin detalle, pedir el primer contacto
  const embedded = lead._embedded?.contacts?.[0];
  if (embedded?.id && !embedded.custom_fields_values) {
    const contactUrl = `${KOMMO_BASE}/api/v4/contacts/${embedded.id}`;
    const cRes = await fetch(contactUrl, {
      headers: {
        Authorization: `Bearer ${KOMMO_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    if (cRes.ok) {
      const contact = (await cRes.json()) as KommoContactEmbedded;
      lead._embedded = { contacts: [contact] };
    }
  }

  return lead;
}
