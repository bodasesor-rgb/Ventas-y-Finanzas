"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLeadIdFromWebhook = extractLeadIdFromWebhook;
exports.extractPartialLeadFromWebhook = extractPartialLeadFromWebhook;
exports.kommoGetJson_ = kommoGetJson_;
exports.fetchKommoPipelines = fetchKommoPipelines;
exports.fetchLeadsCreatedBetween = fetchLeadsCreatedBetween;
exports.fetchLeadStatusChangedEvents = fetchLeadStatusChangedEvents;
exports.probeKommoMailApis = probeKommoMailApis;
exports.fetchOutgoingMailEvents = fetchOutgoingMailEvents;
exports.isOutgoingMailEvent_ = isOutgoingMailEvent_;
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
function kommoAuth_() {
    const base = KOMMO_BASE();
    const token = KOMMO_TOKEN();
    if (!base || !token) {
        throw new Error("Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en variables de entorno");
    }
    return { base, token };
}
async function kommoGetJson_(pathAndQuery, label) {
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
    if (res.status === 204)
        return null;
    return readJsonOrThrow(res, label);
}
/** Pipelines + statuses (nombres de etapas). */
async function fetchKommoPipelines() {
    const data = (await kommoGetJson_("/api/v4/leads/pipelines", "Kommo pipelines"));
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
async function fetchLeadsCreatedBetween(opts) {
    const { base, token } = kommoAuth_();
    const maxPages = Math.min(Math.max(opts.maxPages || 40, 1), 80);
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
        let url = `${base}/api/v4/leads?limit=250&page=${page}` +
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
        if (res.status === 204)
            break;
        const data = (await readJsonOrThrow(res, `Kommo leads created page ${page}`));
        const batch = data._embedded?.leads || [];
        if (!batch.length)
            break;
        out.push(...batch);
        if (batch.length < 250)
            break;
    }
    return out;
}
/**
 * Eventos de cambio de etapa → cuántos pasaron a "Cotización realizada".
 * Mejor proxy de correos de cotización cuando Mail API no trae asuntos.
 */
async function fetchLeadStatusChangedEvents(opts) {
    const { base, token } = kommoAuth_();
    const maxPages = Math.min(Math.max(opts.maxPages || 40, 1), 80);
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
        const url = `${base}/api/v4/events?limit=100&page=${page}` +
            `&filter[type]=lead_status_changed` +
            `&filter[created_at][from]=${opts.fromUnix}` +
            `&filter[created_at][to]=${opts.toUnix}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
        });
        if (res.status === 204)
            break;
        if (!res.ok)
            break;
        const data = (await readJsonOrThrow(res, `Kommo status events p${page}`));
        const batch = data._embedded?.events || [];
        if (!batch.length)
            break;
        for (const ev of batch) {
            const after = extractStatusIdFromEventValue_(ev.value_after);
            const before = extractStatusIdFromEventValue_(ev.value_before);
            out.push({
                created_at: Number(ev.created_at || 0),
                leadId: Number(ev.entity_id || 0),
                statusAfterId: after,
                statusBeforeId: before,
            });
        }
        if (batch.length < 100)
            break;
    }
    return out;
}
function extractStatusIdFromEventValue_(v) {
    if (!v)
        return null;
    if (Array.isArray(v)) {
        for (const item of v) {
            const id = extractStatusIdFromEventValue_(item);
            if (id != null)
                return id;
        }
        return null;
    }
    if (typeof v === "object") {
        const o = v;
        if (o.status_id != null && Number(o.status_id) > 0)
            return Number(o.status_id);
        if (o.id != null && o.name != null && Number(o.id) > 0)
            return Number(o.id);
        if (o.status)
            return extractStatusIdFromEventValue_(o.status);
        if (o.lead_status)
            return extractStatusIdFromEventValue_(o.lead_status);
    }
    return null;
}
/** Debug: prueba varias rutas de Mail/Events/Notes en Kommo. */
async function probeKommoMailApis(opts) {
    const { base, token } = kommoAuth_();
    const to = opts?.toUnix || Math.floor(Date.now() / 1000);
    const from = opts?.fromUnix || to - 14 * 86400;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
    };
    const tryGet = async (path) => {
        try {
            const res = await fetch(`${base}${path}`, { headers });
            const text = await res.text();
            let body = text.slice(0, 500);
            try {
                body = JSON.parse(text);
            }
            catch {
                // keep text
            }
            return { status: res.status, body };
        }
        catch (e) {
            return { status: 0, error: e instanceof Error ? e.message : String(e) };
        }
    };
    return {
        events_outgoing_mail: await tryGet(`/api/v4/events?limit=5&filter[type]=outgoing_mail&filter[created_at][from]=${from}&filter[created_at][to]=${to}`),
        events_mail_message: await tryGet(`/api/v4/events?limit=5&filter[type]=mail_message&filter[created_at][from]=${from}&filter[created_at][to]=${to}`),
        events_any: await tryGet(`/api/v4/events?limit=5&filter[created_at][from]=${from}&filter[created_at][to]=${to}`),
        notes_mail: await tryGet(`/api/v4/leads/notes?limit=5&filter[note_type]=mail_message&filter[updated_at][from]=${from}&filter[updated_at][to]=${to}`),
        notes_common: await tryGet(`/api/v4/leads/notes?limit=5&filter[updated_at][from]=${from}&filter[updated_at][to]=${to}`),
        mail_messages: await tryGet(`/api/v4/mail/messages?limit=5`),
        mail_threads: await tryGet(`/api/v4/mail/threads?limit=5`),
        account_mail: await tryGet(`/api/v4/account?with=mail`),
    };
}
/**
 * Eventos de correo saliente en rango (para contar cotizaciones).
 * Prueba types típicos de Kommo/amoCRM.
 */
async function fetchOutgoingMailEvents(opts) {
    const { base, token } = kommoAuth_();
    const maxPages = Math.min(Math.max(opts.maxPages || 30, 1), 60);
    const types = ["outgoing_mail", "mail_message", "outgoing_email"];
    const out = [];
    const seen = new Set();
    for (const type of types) {
        for (let page = 1; page <= maxPages; page++) {
            const url = `${base}/api/v4/events?limit=100&page=${page}` +
                `&filter[type]=${encodeURIComponent(type)}` +
                `&filter[created_at][from]=${opts.fromUnix}` +
                `&filter[created_at][to]=${opts.toUnix}`;
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                },
            });
            if (res.status === 204 || res.status === 400 || res.status === 404)
                break;
            if (!res.ok) {
                // type no soportado → siguiente
                break;
            }
            const data = (await readJsonOrThrow(res, `Kommo events ${type} p${page}`));
            const batch = data._embedded?.events || [];
            if (!batch.length)
                break;
            for (const ev of batch) {
                const id = String(ev.id ?? `${type}-${ev.created_at}-${ev.entity_id}`);
                if (seen.has(id))
                    continue;
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
            if (batch.length < 100)
                break;
        }
    }
    // Notes mail_message
    for (let page = 1; page <= maxPages; page++) {
        const url = `${base}/api/v4/leads/notes?limit=250&page=${page}` +
            `&filter[note_type]=mail_message` +
            `&filter[updated_at][from]=${opts.fromUnix}` +
            `&filter[updated_at][to]=${opts.toUnix}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
        });
        if (res.status === 204 || res.status === 400 || res.status === 404)
            break;
        if (!res.ok)
            break;
        const data = (await readJsonOrThrow(res, `Kommo mail notes p${page}`));
        const batch = data._embedded?.notes || [];
        if (!batch.length)
            break;
        for (const note of batch) {
            const id = String(note.id ?? `note-${note.created_at}`);
            if (seen.has(id))
                continue;
            seen.add(id);
            const params = (note.params || {});
            const subject = String(params.subject ||
                params.topic ||
                params.title ||
                params.text ||
                "");
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
        if (batch.length < 250)
            break;
    }
    // Notes comunes cuyo texto menciona cotización (a veces el mail queda como nota)
    if (out.length < 10) {
        for (let page = 1; page <= Math.min(maxPages, 20); page++) {
            const url = `${base}/api/v4/leads/notes?limit=250&page=${page}` +
                `&filter[updated_at][from]=${opts.fromUnix}` +
                `&filter[updated_at][to]=${opts.toUnix}`;
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                },
            });
            if (res.status === 204)
                break;
            if (!res.ok)
                break;
            const data = (await readJsonOrThrow(res, `Kommo notes scan p${page}`));
            const batch = data._embedded?.notes || [];
            if (!batch.length)
                break;
            for (const note of batch) {
                const params = (note.params || {});
                const text = String(params.subject || params.text || params.message || "");
                const norm = text
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/\p{M}/gu, "");
                if (!norm.includes("cotizacion"))
                    continue;
                if (norm.includes("publicidad") ||
                    norm.includes("newsletter") ||
                    norm.includes("marketing")) {
                    continue;
                }
                const id = `cotiz-note-${note.id}`;
                if (seen.has(id))
                    continue;
                seen.add(id);
                const created = Number(note.created_at || note.updated_at || 0);
                out.push({
                    id: Number(note.id) || undefined,
                    type: "cotizacion_note",
                    entity_id: Number(note.entity_id) || undefined,
                    created_at: created || undefined,
                    subject: text.slice(0, 200),
                    raw: note,
                });
            }
            if (batch.length < 250)
                break;
        }
    }
    return out;
}
function extractMailSubject_(ev) {
    const tryObj = (v) => {
        if (!v)
            return "";
        if (typeof v === "string")
            return v;
        if (Array.isArray(v)) {
            for (const item of v) {
                const s = tryObj(item);
                if (s)
                    return s;
            }
            return "";
        }
        if (typeof v === "object") {
            const o = v;
            for (const k of [
                "subject",
                "topic",
                "title",
                "mail_subject",
                "name",
                "text",
            ]) {
                if (o[k] != null && String(o[k]).trim())
                    return String(o[k]);
            }
            if (o.params)
                return tryObj(o.params);
            if (o.value)
                return tryObj(o.value);
            if (o.note)
                return tryObj(o.note);
            if (o.message)
                return tryObj(o.message);
        }
        return "";
    };
    return (tryObj(ev.value_after) ||
        tryObj(ev.value_before) ||
        tryObj(ev) ||
        "");
}
/** ¿Es un evento/nota de correo saliente? */
function isOutgoingMailEvent_(m) {
    const t = String(m.type || "").toLowerCase();
    return (t.includes("outgoing_mail") ||
        t.includes("outgoing_email") ||
        t === "mail_message" ||
        t === "mail_message_note");
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