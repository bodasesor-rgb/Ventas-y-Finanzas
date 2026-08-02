"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ventasRouter = void 0;
const express_1 = require("express");
const kommoApi_1 = require("./kommoApi");
const mapDealToFila_1 = require("./mapDealToFila");
const appsScriptClient_1 = require("./appsScriptClient");
const pollClosedDeals_1 = require("./pollClosedDeals");
const ventasSync_1 = require("./ventasSync");
const fingerprintStore_1 = require("./fingerprintStore");
const eventFingerprint_1 = require("./eventFingerprint");
const sheetEventosReader_1 = require("./sheetEventosReader");
const metricasVisitasSync_1 = require("./metricasVisitasSync");
const metricasSeguidoresSync_1 = require("./metricasSeguidoresSync");
const metricasFacebookAdsSync_1 = require("./metricasFacebookAdsSync");
const metaSocialClient_1 = require("./metaSocialClient");
const metaAdsClient_1 = require("./metaAdsClient");
const googleAuth_1 = require("./googleAuth");
function publicBaseUrl_(req) {
    const env = (process.env.PUBLIC_BASE_URL ||
        process.env.HOSTINGER_URL ||
        "").trim();
    if (env)
        return env.replace(/\/$/, "");
    if (req?.get) {
        const host = req.get("x-forwarded-host") || req.get("host");
        if (host) {
            const proto = req.get("x-forwarded-proto") || req.protocol || "https";
            return `${proto}://${host}`.replace(/\/$/, "");
        }
    }
    return "https://lightcyan-reindeer-284498.hostingersite.com";
}
exports.ventasRouter = (0, express_1.Router)();
function appsScriptUrl() {
    return (process.env.URL_BODASESOR_DIRECCION_SHEETS ||
        process.env.APPS_SCRIPT_VENTAS_URL ||
        "").trim();
}
const PHASE = () => (appsScriptUrl() ? 2 : 1);
/**
 * Webhook Kommo deal ganado / status change.
 *
 * IMPORTANTE: Kommo exige respuesta HTTP exitosa en ≤ 2 segundos.
 * Antes escribiamos al Sheet antes de responder (~3s) y Kommo marcaba
 * el webhook como fallido / lo desactivaba. Ahora ACK inmediato y
 * el Sheet se escribe en segundo plano.
 */
exports.ventasRouter.post("/webhooks/kommo/deal-won", (req, res) => {
    const body = (req.body || {});
    console.log("[ventas] webhook hit", {
        contentType: req.headers["content-type"],
        keys: Object.keys(body || {}),
        leadKeys: body?.leads ? Object.keys(body.leads) : [],
    });
    const leadId = (0, kommoApi_1.extractLeadIdFromWebhook)(body);
    if (!leadId) {
        console.warn("[ventas] Webhook sin lead id", {
            keys: Object.keys(body || {}),
            contentType: req.headers["content-type"],
            bodyPreview: JSON.stringify(body).slice(0, 500),
        });
        // 200 para que Kommo no desactive el webhook por 4xx repetidos
        res.status(200).json({
            ok: false,
            accepted: false,
            phase: PHASE(),
            error: "No se encontró lead id en el webhook",
        });
        return;
    }
    (0, ventasSync_1.rememberWebhookAccepted)(String(leadId), "webhook");
    // ACK inmediato (<2s) — Kommo no espera la escritura al Sheet
    res.status(200).json({
        ok: true,
        accepted: true,
        phase: PHASE(),
        dealId: String(leadId),
        message: "Webhook aceptado. Si está ganado, escribe al Sheet ya. Revisa GET /api/ventas/last",
    });
    // Solo ganado → Sheet; si no, igual corre un tick por si hubo otro cierre
    void (async () => {
        try {
            const lead = await (0, kommoApi_1.fetchLeadWithContact)(leadId);
            if ((0, pollClosedDeals_1.isClosedWonLead)(lead)) {
                await (0, ventasSync_1.syncDealToSheet)(leadId, body);
            }
            else {
                console.log("[ventas] webhook status no-ganado, skip write", leadId, lead.status_id);
            }
        }
        catch (err) {
            console.error("[ventas] Error en sync background", err);
            try {
                await (0, ventasSync_1.syncDealToSheet)(leadId, body);
            }
            catch (err2) {
                console.error("[ventas] sync fallback fail", err2);
            }
        }
        try {
            await (0, pollClosedDeals_1.runPollTick)();
        }
        catch (err) {
            console.error("[ventas] tick tras webhook fail", err);
        }
    })();
});
async function handleManualSync(req, res) {
    const dealId = Number(req.params.dealId);
    if (!Number.isFinite(dealId) || dealId <= 0) {
        res.status(400).json({ ok: false, error: "dealId inválido" });
        return;
    }
    try {
        (0, ventasSync_1.rememberWebhookAccepted)(String(dealId), "manual_sync");
        const result = await (0, ventasSync_1.syncDealToSheet)(dealId);
        res.status(200).json({
            ok: true,
            phase: PHASE(),
            message: result.sheetWrite.attempted
                ? result.sheetWrite.ok
                    ? `Fila ${result.sheetWrite.action} en Sheet (fila ${result.sheetWrite.row}).`
                    : `Falló escritura a Sheet: ${result.sheetWrite.error}`
                : "Mapeado sin URL Apps Script",
            ...result,
        });
    }
    catch (err) {
        console.error("[ventas] sync manual error", err);
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
/** Re-sincroniza un deal por ID (POST o GET para abrir en navegador). */
exports.ventasRouter.post("/api/ventas/sync/:dealId", handleManualSync);
exports.ventasRouter.get("/api/ventas/sync/:dealId", handleManualSync);
/** Último webhook aceptado + último sync completado. */
exports.ventasRouter.get("/api/ventas/last", (_req, res) => {
    res.status(200).json({
        ok: true,
        accepted: (0, ventasSync_1.getLastWebhookAccepted)(),
        lastSync: (0, ventasSync_1.getLastVentasSync)(),
    });
});
/** Debug: deal Kommo crudo + fila mapeada (para ver campos). */
exports.ventasRouter.get("/api/ventas/lead/:dealId", async (req, res) => {
    const dealId = Number(req.params.dealId);
    if (!Number.isFinite(dealId) || dealId <= 0) {
        res.status(400).json({ ok: false, error: "dealId inválido" });
        return;
    }
    try {
        const lead = await (0, kommoApi_1.fetchLeadWithContact)(dealId);
        const fila = (0, mapDealToFila_1.mapDealToFilaVentas)(lead);
        const fields = (lead.custom_fields_values || []).map((f) => ({
            field_id: f.field_id,
            field_name: f.field_name,
            field_type: f.field_type,
            value: f.values?.[0]?.value ?? null,
        }));
        res.status(200).json({ ok: true, dealId: String(dealId), fila, fields, lead });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/** Estado del poller automático (backup del webhook). */
exports.ventasRouter.get("/api/ventas/poll", (_req, res) => {
    const poll = (0, pollClosedDeals_1.getPollStatus)();
    res.status(200).json({
        ok: true,
        poll,
        diagnosis: {
            webhookLastSource: (0, ventasSync_1.getLastWebhookAccepted)()?.source ?? null,
            lookbackHours: poll.lookbackHours,
            pollAgeMs: poll.pollAgeMs,
            note: "Si lastAccepted.source nunca es 'webhook', Kommo no está pegando al endpoint. El poller sube cierres ganados (72h) en cada request + timer.",
        },
    });
});
/**
 * Pasada del poller: destraba candado; sube faltantes de la ventana ya.
 */
exports.ventasRouter.post("/api/ventas/poll", async (_req, res) => {
    try {
        const result = await (0, pollClosedDeals_1.runPollTick)();
        res.status(200).json({ ok: true, result, poll: (0, pollClosedDeals_1.getPollStatus)() });
    }
    catch (err) {
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
exports.ventasRouter.get("/api/ventas/poll-now", async (_req, res) => {
    try {
        const result = await (0, pollClosedDeals_1.runPollTick)();
        res.status(200).json({ ok: true, result, poll: (0, pollClosedDeals_1.getPollStatus)() });
    }
    catch (err) {
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/**
 * Cron externo (GitHub Actions / Apps Script): despierta Hostinger y sube
 * cierres faltantes al momento. GET o POST.
 */
let lastVisitasTickAt = 0;
let lastSeguidoresTickAt = 0;
let lastFacebookAdsTickAt = 0;
const VISITAS_TICK_EVERY_MS = 6 * 60 * 60_000;
const SEGUIDORES_TICK_EVERY_MS = 12 * 60 * 60_000;
const FACEBOOK_ADS_TICK_EVERY_MS = 6 * 60 * 60_000;
async function handleTick(_req, res) {
    try {
        const result = await (0, pollClosedDeals_1.runPollTick)();
        let visitas = null;
        let seguidores = null;
        let facebookAds = null;
        const ga4 = (0, metricasVisitasSync_1.metricasVisitasStatus)().ga4;
        if (ga4.ok && Date.now() - lastVisitasTickAt > VISITAS_TICK_EVERY_MS) {
            lastVisitasTickAt = Date.now();
            try {
                visitas = await (0, metricasVisitasSync_1.syncMetricasVisitas)({ lookbackDays: 45 });
            }
            catch (err) {
                console.warn("[tick] sync visitas", err instanceof Error ? err.message : err);
            }
        }
        const metaOk = (0, metricasSeguidoresSync_1.seguidoresStatus)().meta.configured;
        if (metaOk &&
            Date.now() - lastSeguidoresTickAt > SEGUIDORES_TICK_EVERY_MS) {
            lastSeguidoresTickAt = Date.now();
            try {
                seguidores = await (0, metricasSeguidoresSync_1.syncMetricasSeguidores)();
            }
            catch (err) {
                console.warn("[tick] sync seguidores", err instanceof Error ? err.message : err);
            }
        }
        if (metaOk &&
            Date.now() - lastFacebookAdsTickAt > FACEBOOK_ADS_TICK_EVERY_MS) {
            lastFacebookAdsTickAt = Date.now();
            try {
                facebookAds = await (0, metricasFacebookAdsSync_1.syncMetricasFacebookAds)({ lookbackDays: 45 });
            }
            catch (err) {
                console.warn("[tick] sync facebook ads", err instanceof Error ? err.message : err);
            }
        }
        res.status(200).json({
            ok: true,
            at: new Date().toISOString(),
            result,
            poll: (0, pollClosedDeals_1.getPollStatus)(),
            visitas,
            seguidores,
            facebookAds,
            message: "Tick OK — cierres faltantes de la ventana sincronizados",
        });
    }
    catch (err) {
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
exports.ventasRouter.get("/api/ventas/tick", handleTick);
exports.ventasRouter.post("/api/ventas/tick", handleTick);
/** Registra en Kommo el webhook status_lead → este servidor (subida al instante). */
exports.ventasRouter.post("/api/ventas/ensure-webhook", async (req, res) => {
    const dest = `${publicBaseUrl_(req)}/webhooks/kommo/deal-won`;
    try {
        const result = await (0, kommoApi_1.ensureKommoStatusWebhook)(dest);
        res.status(result.ok ? 200 : 502).json({
            ...result,
            webhookUrl: dest,
            hint: result.ok
                ? "Kommo avisará al cerrar/cambiar status → Sheet en segundos"
                : "Si falla por permisos, en Kommo: Ajustes → Integraciones → Webhooks → URL de arriba + evento status_lead",
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            webhookUrl: dest,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
exports.ventasRouter.get("/api/ventas/ensure-webhook", async (req, res) => {
    const dest = `${publicBaseUrl_(req)}/webhooks/kommo/deal-won`;
    try {
        const existing = await (0, kommoApi_1.listKommoWebhooks)();
        const result = await (0, kommoApi_1.ensureKommoStatusWebhook)(dest);
        res.status(result.ok ? 200 : 502).json({
            ...result,
            webhookUrl: dest,
            allWebhooks: existing,
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            webhookUrl: dest,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/** Estado de integración Google Analytics → Metricas (visitas). */
exports.ventasRouter.get("/api/ventas/ga4-status", (_req, res) => {
    res.status(200).json({ ok: true, ...(0, metricasVisitasSync_1.metricasVisitasStatus)() });
});
/**
 * Guarda el service account como archivo en data/
 * (Hostinger suele truncar variables de entorno muy largas).
 * Body: el JSON completo del .json de Google Cloud.
 */
exports.ventasRouter.post("/api/ventas/ga4-setup-sa", (req, res) => {
    try {
        const body = req.body;
        const raw = typeof body === "string"
            ? body
            : body?.serviceAccount || body?.json || body;
        const saved = (0, googleAuth_1.saveServiceAccountJson)(raw);
        res.status(200).json({
            ...saved,
            message: "Service account guardado en disco. Ahora POST /api/ventas/sync-visitas",
            status: (0, metricasVisitasSync_1.metricasVisitasStatus)(),
        });
    }
    catch (err) {
        res.status(400).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            hint: "Envía el JSON del service account como body (Content-Type: application/json)",
        });
    }
});
/**
 * Llena Visitas al sitio / orgánicas / blogs / colecciones desde GA4
 * en Metricas Auto (solo celdas vacías de semanas ya empezadas).
 * Query: ?force=1 para sobrescribir, ?days=90 lookback.
 */
async function handleSyncVisitas(req, res) {
    try {
        const body = (req.body || {});
        const force = String(req.query.force || body.force || "") === "1" ||
            body.force === true;
        const days = Number(req.query.days || body.days || 120);
        const result = await (0, metricasVisitasSync_1.syncMetricasVisitas)({
            overwrite: force,
            force,
            lookbackDays: Number.isFinite(days) ? days : 120,
        });
        res.status(result.ok ? 200 : 502).json(result);
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            hint: (0, metricasVisitasSync_1.metricasVisitasStatus)(),
        });
    }
}
exports.ventasRouter.post("/api/ventas/sync-visitas", handleSyncVisitas);
exports.ventasRouter.get("/api/ventas/sync-visitas", handleSyncVisitas);
/** Estado Instagram / Facebook → Metricas (seguidores). */
exports.ventasRouter.get("/api/ventas/meta-status", (_req, res) => {
    res.status(200).json({ ok: true, ...(0, metricasSeguidoresSync_1.seguidoresStatus)() });
});
/**
 * Guarda Page Access Token de Meta (y opcional page_id / ig_user_id / ad_account_id).
 * Body: { access_token, page_id?, ig_user_id?, ad_account_id? }
 */
exports.ventasRouter.post("/api/ventas/meta-setup", async (req, res) => {
    try {
        const body = (req.body || {});
        const access_token = String(body.access_token || body.token || "").trim();
        if (!access_token) {
            res.status(400).json({
                ok: false,
                error: "Falta access_token",
                hint: "Body JSON: { \"access_token\": \"EAAB...\" }",
            });
            return;
        }
        const saved = (0, metaSocialClient_1.saveMetaTokenStore)({
            access_token,
            page_id: body.page_id,
            ig_user_id: body.ig_user_id,
            ad_account_id: body.ad_account_id,
        });
        let discovery = null;
        let adAccounts = null;
        try {
            discovery = await (0, metaSocialClient_1.discoverMetaAccounts)(access_token);
        }
        catch (err) {
            discovery = {
                error: err instanceof Error ? err.message : String(err),
            };
        }
        try {
            adAccounts = await (0, metaAdsClient_1.listMetaAdAccounts)(access_token);
        }
        catch (err) {
            adAccounts = {
                error: err instanceof Error ? err.message : String(err),
            };
        }
        res.status(200).json({
            ok: true,
            saved: {
                page_id: saved.page_id || null,
                ig_user_id: saved.ig_user_id || null,
                ad_account_id: saved.ad_account_id || null,
                hasToken: true,
            },
            discovery,
            adAccounts,
            status: (0, metricasSeguidoresSync_1.seguidoresStatus)(),
            message: "Token guardado. Ahora POST /api/ventas/sync-seguidores o /api/ventas/sync-facebook-ads",
        });
    }
    catch (err) {
        res.status(400).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
async function handleSyncSeguidores(req, res) {
    try {
        const body = (req.body || {});
        const force = String(req.query.force || body.force || "") === "1" ||
            body.force === true;
        const result = await (0, metricasSeguidoresSync_1.syncMetricasSeguidores)({ force });
        res.status(result.ok ? 200 : 502).json(result);
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            hint: (0, metricasSeguidoresSync_1.seguidoresStatus)(),
        });
    }
}
exports.ventasRouter.post("/api/ventas/sync-seguidores", handleSyncSeguidores);
exports.ventasRouter.get("/api/ventas/sync-seguidores", handleSyncSeguidores);
/** Estado Meta Ads → sección Facebook Ads en Metricas. */
exports.ventasRouter.get("/api/ventas/meta-ads-status", async (_req, res) => {
    try {
        const probe = await (0, metricasFacebookAdsSync_1.facebookAdsProbe)();
        res.status(200).json(probe);
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            status: (0, metricasFacebookAdsSync_1.facebookAdsSyncStatus)(),
        });
    }
});
async function handleSyncFacebookAds(req, res) {
    try {
        const body = (req.body || {});
        const force = String(req.query.force || body.force || "") === "1" ||
            body.force === true;
        const lookbackDays = Number(req.query.lookbackDays || body.lookbackDays || 45);
        const result = await (0, metricasFacebookAdsSync_1.syncMetricasFacebookAds)({ force, lookbackDays });
        res.status(result.ok ? 200 : 502).json(result);
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            status: (0, metricasFacebookAdsSync_1.facebookAdsSyncStatus)(),
        });
    }
}
exports.ventasRouter.post("/api/ventas/sync-facebook-ads", handleSyncFacebookAds);
exports.ventasRouter.get("/api/ventas/sync-facebook-ads", handleSyncFacebookAds);
/** Estado anti-duplicados: cuántas huellas hay en Sheet + cache. */
exports.ventasRouter.get("/api/ventas/dedupe-status", async (_req, res) => {
    try {
        const idx = await (0, sheetEventosReader_1.loadEventosSheetIndex)(2026, true);
        const local = (0, fingerprintStore_1.getFingerprintStoreStatus)();
        res.status(200).json({
            ok: true,
            sheetFingerprints: idx.rowCount,
            sheetDealIds: Object.keys(idx.byDealId).length,
            localCache: local,
            rule: "cliente + fecha evento + fecha cierre + horario + tipo",
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/** ¿Este deal sería duplicado si se subiera hoy? */
exports.ventasRouter.get("/api/ventas/dedupe-check/:dealId", async (req, res) => {
    const dealId = Number(req.params.dealId);
    if (!Number.isFinite(dealId) || dealId <= 0) {
        res.status(400).json({ ok: false, error: "dealId inválido" });
        return;
    }
    try {
        const lead = await (0, kommoApi_1.fetchLeadWithContact)(dealId);
        const fila = (0, mapDealToFila_1.mapDealToFilaVentas)(lead);
        const fp = (0, eventFingerprint_1.eventFingerprintFromFila)(fila);
        const year = (0, mapDealToFila_1.yearFromFecha)(fila.fechaDeCierre) || 2026;
        const dup = await (0, sheetEventosReader_1.findDuplicateInSheet)(fp, String(dealId), year);
        // Simular otro dealId para ver si la huella ya está
        const wouldDupIfOtherId = await (0, sheetEventosReader_1.findDuplicateInSheet)(fp, "00000000", year);
        res.status(200).json({
            ok: true,
            dealId: String(dealId),
            cliente: fila.cliente,
            fingerprint: fp,
            wouldUpdateOwnRow: !dup,
            wouldSkipIfDifferentDealId: Boolean(wouldDupIfOtherId),
            duplicateOf: wouldDupIfOtherId,
            fields: {
                fechaDelEvento: fila.fechaDelEvento,
                fechaDeCierre: fila.fechaDeCierre,
                horario: fila.horario,
                tipoDeEvento: fila.tipoDeEvento,
            },
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/** Lista cierres ganados recientes en Kommo (diagnóstico). */
exports.ventasRouter.get("/api/ventas/closed", async (req, res) => {
    const hours = Math.min(Math.max(Number(req.query.hours) || 72, 1), 168);
    try {
        const leads = await (0, kommoApi_1.fetchRecentlyClosedLeads)(50, hours * 60 * 60_000);
        const won = leads.filter(pollClosedDeals_1.isClosedWonLead);
        const poll = (0, pollClosedDeals_1.getPollStatus)();
        const items = won.map((l) => {
            const id = String(l.id);
            const closedAt = l.closed_at && l.closed_at > 0 ? l.closed_at : 0;
            const prev = poll.syncedUpdatedAt[id] || 0;
            const fila = (0, mapDealToFila_1.mapDealToFilaVentas)(l);
            return {
                dealId: id,
                cliente: fila.cliente,
                venta: fila.venta,
                fechaDeCierre: fila.fechaDeCierre,
                closed_at: closedAt,
                status_id: l.status_id ?? null,
                inPollState: prev > 0 && (!closedAt || prev >= closedAt),
            };
        });
        res.status(200).json({
            ok: true,
            hours,
            lookbackHoursDefault: Math.round((0, pollClosedDeals_1.getWriteLookbackMs)() / 3600000),
            count: items.length,
            items,
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/**
 * Solo el último cerrado que falte en el Sheet (no re-sube el resto).
 * Usar cuando un cierre no llegó solo.
 */
exports.ventasRouter.post("/api/ventas/sync-latest", async (_req, res) => {
    try {
        const result = await (0, pollClosedDeals_1.syncLatestMissingClosedDeal)(40);
        res.status(200).json({ ok: true, result, poll: (0, pollClosedDeals_1.getPollStatus)() });
    }
    catch (err) {
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
exports.ventasRouter.get("/api/ventas/sync-latest", async (_req, res) => {
    try {
        const result = await (0, pollClosedDeals_1.syncLatestMissingClosedDeal)(40);
        res.status(200).json({ ok: true, result, poll: (0, pollClosedDeals_1.getPollStatus)() });
    }
    catch (err) {
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/** Últimos deals tocados en Kommo (para elegir cuál sincronizar). */
exports.ventasRouter.get("/api/ventas/recent", async (req, res) => {
    const limit = Number(req.query.limit) || 15;
    try {
        const leads = await (0, kommoApi_1.fetchRecentLeads)(limit);
        const items = leads.map((l) => {
            const fila = (0, mapDealToFila_1.mapDealToFilaVentas)(l);
            return {
                dealId: String(l.id),
                name: l.name || "",
                cliente: fila.cliente,
                status_id: l.status_id ?? null,
                closed_at: l.closed_at ?? null,
                updated_at: l.updated_at ?? null,
                venta: fila.venta,
                fechaDeCierre: fila.fechaDeCierre,
            };
        });
        res.status(200).json({ ok: true, count: items.length, items });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/**
 * Duplica Metricas → Metricas Auto + resumen semanal (vía Apps Script).
 * La pestaña original no se toca.
 */
exports.ventasRouter.post("/api/ventas/setup-metricas-auto", async (_req, res) => {
    try {
        const result = await (0, appsScriptClient_1.postToAppsScript)({ action: "setupMetricasAuto" }, { timeoutMs: 90_000 });
        if (!result.ok) {
            res.status(502).json({
                ok: false,
                error: result.error || "Apps Script rechazó setupMetricasAuto",
                version: result.version,
                hint: "Pega Codigo.gs v23 → Guardar → Implementar → Nueva versión. O en Apps Script ejecuta restoreMetricasSemanal_.",
            });
            return;
        }
        res.status(200).json({
            ok: true,
            version: result.version,
            metricasAutoSheet: result.metricasAutoSheet ||
                "Metricas 2026 Auto",
            spreadsheetName: result.spreadsheetName,
            spreadsheetUrl: result.spreadsheetUrl,
            existingSheets: result.existingSheets,
            message: result.message ||
                "Pestaña Metricas Auto lista. Refresca el Sheet.",
        });
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        res.status(502).json({
            ok: false,
            error,
            hint: "Si el script aún es v22: en Apps Script elige restoreMetricasSemanal_ → ▶ Ejecutar. O pega v23 e Implementa.",
        });
    }
});
exports.ventasRouter.get("/api/ventas/setup-metricas-auto", async (_req, res) => {
    try {
        const result = await (0, appsScriptClient_1.postToAppsScript)({ action: "setupMetricasAuto" }, { timeoutMs: 90_000 });
        res.status(result.ok ? 200 : 502).json({
            ok: Boolean(result.ok),
            version: result.version,
            metricasAutoSheet: result.metricasAutoSheet ||
                "Metricas 2026 Auto",
            spreadsheetUrl: result.spreadsheetUrl,
            existingSheets: result.existingSheets,
            message: result.message,
            error: result.error,
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            hint: "En Apps Script ejecuta restoreMetricasSemanal_ → ▶ Ejecutar",
        });
    }
});
exports.ventasRouter.get("/health", (_req, res) => {
    const scriptUrl = appsScriptUrl();
    let appsScriptUrlTail = "";
    try {
        const u = new URL(scriptUrl);
        const parts = u.pathname.split("/").filter(Boolean);
        appsScriptUrlTail = parts.slice(-2).join("/");
    }
    catch {
        appsScriptUrlTail = "";
    }
    res.status(200).json({
        ok: true,
        service: "ventas-y-finanzas",
        phase: scriptUrl ? 2 : 1,
        env: {
            hasKommoBaseUrl: Boolean(process.env.KOMMO_BASE_URL),
            hasKommoAccessToken: Boolean(process.env.KOMMO_ACCESS_TOKEN),
            hasAppsScriptUrl: Boolean(scriptUrl),
            appsScriptUrlLooksValid: scriptUrl.includes("script.google.com") && scriptUrl.includes("/exec"),
            appsScriptUrlTail,
        },
        lastAccepted: (0, ventasSync_1.getLastWebhookAccepted)(),
        lastSyncDealId: (0, ventasSync_1.getLastVentasSync)()?.dealId ?? null,
        poll: {
            lastPollAt: (0, pollClosedDeals_1.getPollStatus)().lastPollAt,
            lastSynced: (0, pollClosedDeals_1.getPollStatus)().lastResult?.synced || [],
        },
        ga4: (0, metricasVisitasSync_1.metricasVisitasStatus)().ga4,
    });
});
exports.ventasRouter.get("/health/kommo", async (_req, res) => {
    const base = process.env.KOMMO_BASE_URL?.replace(/\/$/, "");
    const token = process.env.KOMMO_ACCESS_TOKEN;
    if (!base || !token) {
        res.status(500).json({
            ok: false,
            error: "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN en el entorno",
            hasKommoBaseUrl: Boolean(base),
            hasKommoAccessToken: Boolean(token),
        });
        return;
    }
    try {
        const r = await fetch(`${base}/api/v4/account`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        const text = await r.text();
        res.status(r.ok ? 200 : 502).json({
            ok: r.ok,
            status: r.status,
            bodyPreview: text.slice(0, 300),
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
//# sourceMappingURL=ventasRouter.js.map