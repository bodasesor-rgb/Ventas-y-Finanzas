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

function kommoAuth_(): { base: string; token: string } {
  const base = KOMMO_BASE();
  const token = KOMMO_TOKEN();
  if (!base || !token) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno"
    );
  }
  return { base, token };
}

export async function kommoGetJson_(
  pathAndQuery: string,
  label: string
): Promise<unknown> {
  const { base, token } = kommoAuth_();
  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${base}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 204) return null;
  return readJsonOrThrow(res, label);
}

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
export async function fetchKommoPipelines(): Promise<KommoPipeline[]> {
  const data = (await kommoGetJson_(
    "/api/v4/leads/pipelines",
    "Kommo pipelines"
  )) as {
    _embedded?: {
      pipelines?: Array<{
        id: number;
        name: string;
        is_main?: boolean;
        _embedded?: {
          statuses?: Array<{
            id: number;
            name: string;
            sort?: number;
            type?: number;
          }>;
        };
      }>;
    };
  };
  return (data?._embedded?.pipelines || []).map((p) => ({
    id: p.id,
    name: p.name,
    is_main: p.is_main,
    statuses: (p._embedded?.statuses || []).map((s) => ({
      id: s.id,
      name: s.name,
      sort: s.sort,
      type: s.type,
    })),
  }));
}

/**
 * Leads creados en [fromUnix, toUnix] (inclusive), paginado.
 * Opcional: filtrar por pipeline_id.
 */
export async function fetchLeadsCreatedBetween(opts: {
  fromUnix: number;
  toUnix: number;
  pipelineId?: number;
  maxPages?: number;
}): Promise<KommoLead[]> {
  const { base, token } = kommoAuth_();
  const maxPages = Math.min(Math.max(opts.maxPages || 40, 1), 80);
  const out: KommoLead[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let url =
      `${base}/api/v4/leads?limit=250&page=${page}` +
      `&filter[created_at][from]=${opts.fromUnix}` +
      `&filter[created_at][to]=${opts.toUnix}` +
      `&order[created_at]=asc`;
    if (opts.pipelineId) {
      url += `&filter[pipeline_id]=${opts.pipelineId}`;
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (res.status === 204) break;
    const data = (await readJsonOrThrow(
      res,
      `Kommo leads created page ${page}`
    )) as {
      _embedded?: { leads?: KommoLead[] };
      _page_count?: number;
    };
    const batch = data._embedded?.leads || [];
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < 250) break;
  }
  return out;
}

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

/** Debug: prueba varias rutas de Mail/Events/Notes en Kommo. */
export async function probeKommoMailApis(opts?: {
  fromUnix?: number;
  toUnix?: number;
}): Promise<Record<string, unknown>> {
  const { base, token } = kommoAuth_();
  const to = opts?.toUnix || Math.floor(Date.now() / 1000);
  const from = opts?.fromUnix || to - 14 * 86400;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const tryGet = async (path: string) => {
    try {
      const res = await fetch(`${base}${path}`, { headers });
      const text = await res.text();
      let body: unknown = text.slice(0, 500);
      try {
        body = JSON.parse(text);
      } catch {
        // keep text
      }
      return { status: res.status, body };
    } catch (e) {
      return { status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    events_outgoing_mail: await tryGet(
      `/api/v4/events?limit=5&filter[type]=outgoing_mail&filter[created_at][from]=${from}&filter[created_at][to]=${to}`
    ),
    events_mail_message: await tryGet(
      `/api/v4/events?limit=5&filter[type]=mail_message&filter[created_at][from]=${from}&filter[created_at][to]=${to}`
    ),
    events_any: await tryGet(
      `/api/v4/events?limit=5&filter[created_at][from]=${from}&filter[created_at][to]=${to}`
    ),
    notes_mail: await tryGet(
      `/api/v4/leads/notes?limit=5&filter[note_type]=mail_message&filter[updated_at][from]=${from}&filter[updated_at][to]=${to}`
    ),
    notes_common: await tryGet(
      `/api/v4/leads/notes?limit=5&filter[updated_at][from]=${from}&filter[updated_at][to]=${to}`
    ),
    mail_messages: await tryGet(`/api/v4/mail/messages?limit=5`),
    mail_threads: await tryGet(`/api/v4/mail/threads?limit=5`),
    account_mail: await tryGet(`/api/v4/account?with=mail`),
  };
}

/**
 * Eventos de correo saliente en rango (para contar cotizaciones).
 * Prueba types típicos de Kommo/amoCRM.
 */
export async function fetchOutgoingMailEvents(opts: {
  fromUnix: number;
  toUnix: number;
  maxPages?: number;
}): Promise<KommoMailEvent[]> {
  const { base, token } = kommoAuth_();
  const maxPages = Math.min(Math.max(opts.maxPages || 30, 1), 60);
  const types = ["outgoing_mail", "mail_message", "outgoing_email"];
  const out: KommoMailEvent[] = [];
  const seen = new Set<string>();

  for (const type of types) {
    for (let page = 1; page <= maxPages; page++) {
      const url =
        `${base}/api/v4/events?limit=100&page=${page}` +
        `&filter[type]=${encodeURIComponent(type)}` +
        `&filter[created_at][from]=${opts.fromUnix}` +
        `&filter[created_at][to]=${opts.toUnix}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (res.status === 204 || res.status === 400 || res.status === 404) break;
      if (!res.ok) {
        // type no soportado → siguiente
        break;
      }
      const data = (await readJsonOrThrow(
        res,
        `Kommo events ${type} p${page}`
      )) as {
        _embedded?: { events?: Array<Record<string, unknown>> };
      };
      const batch = data._embedded?.events || [];
      if (!batch.length) break;
      for (const ev of batch) {
        const id = String(ev.id ?? `${type}-${ev.created_at}-${ev.entity_id}`);
        if (seen.has(id)) continue;
        seen.add(id);
        const subject = extractMailSubject_(ev);
        out.push({
          id: Number(ev.id) || undefined,
          type: String(ev.type || type),
          entity_id: Number(ev.entity_id) || undefined,
          entity_type: ev.entity_type ? String(ev.entity_type) : undefined,
          created_at: Number(ev.created_at) || undefined,
          value_after: ev.value_after,
          subject,
          raw: ev,
        });
      }
      if (batch.length < 100) break;
    }
  }

  // Fallback: notes tipo mail en leads
  if (!out.length) {
    for (let page = 1; page <= maxPages; page++) {
      const url =
        `${base}/api/v4/leads/notes?limit=250&page=${page}` +
        `&filter[note_type]=mail_message` +
        `&filter[updated_at][from]=${opts.fromUnix}` +
        `&filter[updated_at][to]=${opts.toUnix}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (res.status === 204 || res.status === 400 || res.status === 404) break;
      if (!res.ok) break;
      const data = (await readJsonOrThrow(
        res,
        `Kommo mail notes p${page}`
      )) as {
        _embedded?: { notes?: Array<Record<string, unknown>> };
      };
      const batch = data._embedded?.notes || [];
      if (!batch.length) break;
      for (const note of batch) {
        const id = String(note.id ?? `note-${note.created_at}`);
        if (seen.has(id)) continue;
        seen.add(id);
        const params = (note.params || {}) as Record<string, unknown>;
        const subject = String(
          params.subject || params.topic || params.title || ""
        );
        const created = Number(note.created_at || note.updated_at || 0);
        if (created && (created < opts.fromUnix || created > opts.toUnix)) {
          continue;
        }
        out.push({
          id: Number(note.id) || undefined,
          type: "mail_message_note",
          entity_id: Number(note.entity_id) || undefined,
          created_at: created || undefined,
          subject,
          raw: note,
        });
      }
      if (batch.length < 250) break;
    }
  }

  return out;
}

function extractMailSubject_(ev: Record<string, unknown>): string {
  const tryObj = (v: unknown): string => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      for (const item of v) {
        const s = tryObj(item);
        if (s) return s;
      }
      return "";
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["subject", "topic", "title", "mail_subject", "name"]) {
        if (o[k] != null && String(o[k]).trim()) return String(o[k]);
      }
      if (o.params) return tryObj(o.params);
      if (o.value) return tryObj(o.value);
    }
    return "";
  };
  return (
    tryObj(ev.value_after) ||
    tryObj(ev.value_before) ||
    tryObj(ev) ||
    ""
  );
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

export interface KommoWebhookInfo {
  id?: number;
  destination?: string;
  disabled?: boolean;
  settings?: string[];
}

/** Lista webhooks del account Kommo. */
export async function listKommoWebhooks(): Promise<KommoWebhookInfo[]> {
  const base = KOMMO_BASE();
  const token = KOMMO_TOKEN();
  if (!base || !token) {
    throw new Error(
      "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno"
    );
  }
  const res = await fetch(`${base}/api/v4/webhooks`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 204 || res.status === 404) return [];
  const data = (await readJsonOrThrow(res, "Kommo webhooks")) as {
    _embedded?: { webhooks?: KommoWebhookInfo[] };
  };
  return data._embedded?.webhooks || [];
}

/**
 * Asegura webhook status_lead → destination (subida al cerrar, al instante).
 * Si ya existe el mismo destination, no duplica.
 */
export async function ensureKommoStatusWebhook(
  destination: string
): Promise<{
  ok: boolean;
  created: boolean;
  destination: string;
  webhook?: KommoWebhookInfo;
  existing?: KommoWebhookInfo[];
  error?: string;
}> {
  const base = KOMMO_BASE();
  const token = KOMMO_TOKEN();
  if (!base || !token) {
    return {
      ok: false,
      created: false,
      destination,
      error: "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN",
    };
  }
  const dest = destination.replace(/\/$/, "");
  let existing: KommoWebhookInfo[] = [];
  try {
    existing = await listKommoWebhooks();
  } catch (err) {
    return {
      ok: false,
      created: false,
      destination: dest,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const already = existing.find(
    (w) =>
      (w.destination || "").replace(/\/$/, "") === dest && !w.disabled
  );
  if (already) {
    return {
      ok: true,
      created: false,
      destination: dest,
      webhook: already,
      existing,
    };
  }

  const res = await fetch(`${base}/api/v4/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      destination: dest,
      settings: ["status_lead"],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      created: false,
      destination: dest,
      existing,
      error: `Kommo webhook HTTP ${res.status}: ${text.slice(0, 300)}`,
    };
  }
  const created = (await readJsonOrThrow(res, "Kommo create webhook")) as {
    _embedded?: { webhooks?: KommoWebhookInfo[] };
  } & KommoWebhookInfo;
  const webhook =
    created._embedded?.webhooks?.[0] || (created as KommoWebhookInfo);
  return {
    ok: true,
    created: true,
    destination: dest,
    webhook,
    existing,
  };
}

/**
 * Leads con closed_at reciente. El caller filtra ganado (142) vs perdido (143).
 * No depende solo de updated_at (un ganado se pierde entre leads abiertos).
 */
export async function fetchRecentlyClosedLeads(
  limit = 40,
  lookbackMs = 72 * 60 * 60_000
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

  // 1) Preferir filtro status ganado 142 + closed_at
  const wonUrl =
    `${base}/api/v4/leads?limit=${n}` +
    `&filter[closed_at][from]=${from}` +
    `&filter[statuses][0][status_id]=142` +
    `&order[closed_at]=desc&with=contacts`;
  const wonRes = await fetch(wonUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (wonRes.ok) {
    const data = (await readJsonOrThrow(wonRes, "Kommo closed won")) as {
      _embedded?: { leads?: KommoLead[] };
    };
    const won = data._embedded?.leads || [];
    if (won.length) return won;
  }

  // 2) Fallback: cualquier closed_at (incluye perdidos; el poller filtra 142)
  const anyUrl =
    `${base}/api/v4/leads?limit=${n}` +
    `&filter[closed_at][from]=${from}` +
    `&order[closed_at]=desc&with=contacts`;
  const anyRes = await fetch(anyUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const data2 = (await readJsonOrThrow(anyRes, "Kommo closed leads")) as {
    _embedded?: { leads?: KommoLead[] };
  };
  return data2._embedded?.leads || [];
}
