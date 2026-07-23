import type { KommoContactEmbedded, KommoLead, KommoWebhookBody } from "./types";

const KOMMO_BASE = () => process.env.KOMMO_BASE_URL?.replace(/\/$/, "");
const KOMMO_TOKEN = () => process.env.KOMMO_ACCESS_TOKEN;

type LeadLike = Partial<KommoLead> & { id?: number | string };

/** Normaliza leads[status] tanto si viene como array, objeto suelto o {0:{…}}. */
function asLeadList(value: unknown): LeadLike[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as LeadLike[];
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.id != null) return [obj as LeadLike];
    const keys = Object.keys(obj)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length) return keys.map((k) => obj[k] as LeadLike);
  }
  return [];
}

function leadIdFrom(item: LeadLike | undefined): number | null {
  if (!item || item.id == null) return null;
  const id = typeof item.id === "string" ? Number(item.id) : item.id;
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

/**
 * Extrae el primer lead ID del payload típico de webhook de Kommo
 * (leads[status], leads[update], leads[add]) — JSON o form-urlencoded.
 */
export function extractLeadIdFromWebhook(body: KommoWebhookBody | Record<string, unknown>): number | null {
  const leads = (body as KommoWebhookBody)?.leads;
  const buckets = [
    asLeadList(leads?.status),
    asLeadList(leads?.update),
    asLeadList(leads?.add),
  ];
  for (const list of buckets) {
    for (const item of list) {
      const id = leadIdFrom(item);
      if (id != null) return id;
    }
  }
  return null;
}

export function extractPartialLeadFromWebhook(
  body: KommoWebhookBody | Record<string, unknown>,
  leadId: number
): KommoLead {
  const leads = (body as KommoWebhookBody)?.leads;
  const buckets = [
    asLeadList(leads?.status),
    asLeadList(leads?.update),
    asLeadList(leads?.add),
  ];
  for (const list of buckets) {
    for (const item of list) {
      if (leadIdFrom(item) === leadId) {
        return { id: leadId, ...(item || {}) } as KommoLead;
      }
    }
  }
  return { id: leadId };
}

async function readJsonOrThrow(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!text || !text.trim()) {
    throw new Error(`${label}: respuesta vacía (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label}: JSON inválido (HTTP ${res.status}): ${text.slice(0, 200)}`
    );
  }
}

/**
 * Obtiene el deal completo + contacto embebido desde la API de Kommo.
 */
export async function fetchLeadWithContact(leadId: number): Promise<KommoLead> {
  const base = KOMMO_BASE();
  const token = KOMMO_TOKEN();
  if (!base || !token) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno"
    );
  }

  const url = `${base}/api/v4/leads/${leadId}?with=contacts`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const lead = (await readJsonOrThrow(res, `Kommo lead ${leadId}`)) as KommoLead;

  const embedded = lead._embedded?.contacts?.[0];
  if (embedded?.id && !embedded.custom_fields_values) {
    const contactUrl = `${base}/api/v4/contacts/${embedded.id}`;
    const cRes = await fetch(contactUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (cRes.ok) {
      try {
        const contact = (await readJsonOrThrow(
          cRes,
          `Kommo contact ${embedded.id}`
        )) as KommoContactEmbedded;
        lead._embedded = { contacts: [contact] };
      } catch {
        // contacto parcial está bien
      }
    }
  }

  return lead;
}

/** Últimos leads tocados en Kommo (para sync manual). */
export async function fetchRecentLeads(limit = 10): Promise<KommoLead[]> {
  const base = KOMMO_BASE();
  const token = KOMMO_TOKEN();
  if (!base || !token) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno"
    );
  }
  const n = Math.min(Math.max(limit, 1), 50);
  const url = `${base}/api/v4/leads?limit=${n}&order[updated_at]=desc&with=contacts`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const data = (await readJsonOrThrow(res, "Kommo leads")) as {
    _embedded?: { leads?: KommoLead[] };
  };
  return data._embedded?.leads || [];
}

/**
 * Leads cerrados desde `sinceMs` atrás (por closed_at), no por updated_at.
 * Así un deal ganado no se pierde entre 40 leads abiertos recién tocados.
 */
export async function fetchRecentlyClosedLeads(
  limit = 40,
  lookbackMs = 6 * 60 * 60_000
): Promise<KommoLead[]> {
  const base = KOMMO_BASE();
  const token = KOMMO_TOKEN();
  if (!base || !token) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno"
    );
  }
  const n = Math.min(Math.max(limit, 1), 50);
  const from = Math.floor((Date.now() - lookbackMs) / 1000);
  // status 142 = ganado en Kommo/amoCRM
  const url =
    `${base}/api/v4/leads?limit=${n}` +
    `&filter[closed_at][from]=${from}` +
    `&filter[statuses][0][status_id]=142` +
    `&order[closed_at]=desc&with=contacts`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  // Si el filtro de status no es aceptado, reintentar solo con closed_at
  if (!res.ok) {
    const fallbackUrl =
      `${base}/api/v4/leads?limit=${n}` +
      `&filter[closed_at][from]=${from}` +
      `&order[closed_at]=desc&with=contacts`;
    const res2 = await fetch(fallbackUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data2 = (await readJsonOrThrow(
      res2,
      "Kommo closed leads"
    )) as {
      _embedded?: { leads?: KommoLead[] };
    };
    return data2._embedded?.leads || [];
  }
  const data = (await readJsonOrThrow(res, "Kommo closed leads")) as {
    _embedded?: { leads?: KommoLead[] };
  };
  return data._embedded?.leads || [];
}
