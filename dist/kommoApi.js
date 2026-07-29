"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLeadIdFromWebhook = extractLeadIdFromWebhook;
exports.extractPartialLeadFromWebhook = extractPartialLeadFromWebhook;
exports.fetchLeadWithContact = fetchLeadWithContact;
exports.fetchRecentLeads = fetchRecentLeads;
exports.listKommoWebhooks = listKommoWebhooks;
exports.ensureKommoStatusWebhook = ensureKommoStatusWebhook;
exports.fetchRecentlyClosedLeads = fetchRecentlyClosedLeads;
const KOMMO_BASE = () => process.env.KOMMO_BASE_URL?.replace(/\/$/, "");
const KOMMO_TOKEN = () => process.env.KOMMO_ACCESS_TOKEN;
/** Normaliza leads[status] tanto si viene como array, objeto suelto o {0:{…}}. */
function asLeadList(value) {
    if (value == null)
        return [];
    if (Array.isArray(value))
        return value;
    if (typeof value === "object") {
        const obj = value;
        if (obj.id != null)
            return [obj];
        const keys = Object.keys(obj)
            .filter((k) => /^\d+$/.test(k))
            .sort((a, b) => Number(a) - Number(b));
        if (keys.length)
            return keys.map((k) => obj[k]);
    }
    return [];
}
function leadIdFrom(item) {
    if (!item || item.id == null)
        return null;
    const id = typeof item.id === "string" ? Number(item.id) : item.id;
    if (!Number.isFinite(id) || id <= 0)
        return null;
    return id;
}
/**
 * Extrae el primer lead ID del payload típico de webhook de Kommo
 * (leads[status], leads[update], leads[add]) — JSON o form-urlencoded.
 */
function extractLeadIdFromWebhook(body) {
    const leads = body?.leads;
    const buckets = [
        asLeadList(leads?.status),
        asLeadList(leads?.update),
        asLeadList(leads?.add),
    ];
    for (const list of buckets) {
        for (const item of list) {
            const id = leadIdFrom(item);
            if (id != null)
                return id;
        }
    }
    return null;
}
function extractPartialLeadFromWebhook(body, leadId) {
    const leads = body?.leads;
    const buckets = [
        asLeadList(leads?.status),
        asLeadList(leads?.update),
        asLeadList(leads?.add),
    ];
    for (const list of buckets) {
        for (const item of list) {
            if (leadIdFrom(item) === leadId) {
                return { id: leadId, ...(item || {}) };
            }
        }
    }
    return { id: leadId };
}
async function readJsonOrThrow(res, label) {
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    if (!text || !text.trim()) {
        throw new Error(`${label}: respuesta vacía (HTTP ${res.status})`);
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`${label}: JSON inválido (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
}
/**
 * Obtiene el deal completo + contacto embebido desde la API de Kommo.
 */
async function fetchLeadWithContact(leadId) {
    const base = KOMMO_BASE();
    const token = KOMMO_TOKEN();
    if (!base || !token) {
        throw new Error("Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno");
    }
    const url = `${base}/api/v4/leads/${leadId}?with=contacts`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
    });
    const lead = (await readJsonOrThrow(res, `Kommo lead ${leadId}`));
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
                const contact = (await readJsonOrThrow(cRes, `Kommo contact ${embedded.id}`));
                lead._embedded = { contacts: [contact] };
            }
            catch {
                // contacto parcial está bien
            }
        }
    }
    return lead;
}
/** Últimos leads tocados en Kommo (para sync manual). */
async function fetchRecentLeads(limit = 10) {
    const base = KOMMO_BASE();
    const token = KOMMO_TOKEN();
    if (!base || !token) {
        throw new Error("Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno");
    }
    const n = Math.min(Math.max(limit, 1), 50);
    const url = `${base}/api/v4/leads?limit=${n}&order[updated_at]=desc&with=contacts`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
    });
    const data = (await readJsonOrThrow(res, "Kommo leads"));
    return data._embedded?.leads || [];
}
/** Lista webhooks del account Kommo. */
async function listKommoWebhooks() {
    const base = KOMMO_BASE();
    const token = KOMMO_TOKEN();
    if (!base || !token) {
        throw new Error("Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno");
    }
    const res = await fetch(`${base}/api/v4/webhooks`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
    });
    if (res.status === 204 || res.status === 404)
        return [];
    const data = (await readJsonOrThrow(res, "Kommo webhooks"));
    return data._embedded?.webhooks || [];
}
/**
 * Asegura webhook status_lead → destination (subida al cerrar, al instante).
 * Si ya existe el mismo destination, no duplica.
 */
async function ensureKommoStatusWebhook(destination) {
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
    let existing = [];
    try {
        existing = await listKommoWebhooks();
    }
    catch (err) {
        return {
            ok: false,
            created: false,
            destination: dest,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    const already = existing.find((w) => (w.destination || "").replace(/\/$/, "") === dest && !w.disabled);
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
    const created = (await readJsonOrThrow(res, "Kommo create webhook"));
    const webhook = created._embedded?.webhooks?.[0] || created;
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
async function fetchRecentlyClosedLeads(limit = 40, lookbackMs = 72 * 60 * 60_000) {
    const base = KOMMO_BASE();
    const token = KOMMO_TOKEN();
    if (!base || !token) {
        throw new Error("Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno");
    }
    const n = Math.min(Math.max(limit, 1), 50);
    const from = Math.floor((Date.now() - lookbackMs) / 1000);
    // 1) Preferir filtro status ganado 142 + closed_at
    const wonUrl = `${base}/api/v4/leads?limit=${n}` +
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
        const data = (await readJsonOrThrow(wonRes, "Kommo closed won"));
        const won = data._embedded?.leads || [];
        if (won.length)
            return won;
    }
    // 2) Fallback: cualquier closed_at (incluye perdidos; el poller filtra 142)
    const anyUrl = `${base}/api/v4/leads?limit=${n}` +
        `&filter[closed_at][from]=${from}` +
        `&order[closed_at]=desc&with=contacts`;
    const anyRes = await fetch(anyUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
    });
    const data2 = (await readJsonOrThrow(anyRes, "Kommo closed leads"));
    return data2._embedded?.leads || [];
}
//# sourceMappingURL=kommoApi.js.map