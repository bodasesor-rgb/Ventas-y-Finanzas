"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLeadIdFromWebhook = extractLeadIdFromWebhook;
exports.extractPartialLeadFromWebhook = extractPartialLeadFromWebhook;
exports.fetchLeadWithContact = fetchLeadWithContact;
exports.fetchRecentLeads = fetchRecentLeads;
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
//# sourceMappingURL=kommoApi.js.map