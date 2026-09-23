import { Router, type Request, type Response } from "express";
import {
  ensureKommoStatusWebhook,
  extractLeadIdFromWebhook,
  fetchLeadWithContact,
  fetchRecentLeads,
  fetchRecentlyClosedLeads,
  listKommoWebhooks,
} from "./kommoApi";
import { mapDealToFilaVentas, yearFromFecha } from "./mapDealToFila";
import type { KommoWebhookBody } from "./types";
import { postToAppsScript } from "./appsScriptClient";
import {
  getPollStatus,
  getWriteLookbackMs,
  isClosedWonLead,
  runPollTick,
  syncLatestMissingClosedDeal,
} from "./pollClosedDeals";
import {
  getLastVentasSync,
  getLastWebhookAccepted,
  rememberWebhookAccepted,
  syncDealToSheet,
} from "./ventasSync";
import {
  backfillEventReminderTasks,
  deleteEventReminderTasks,
  ensureEventReminderTasks,
  type BackfillResult,
} from "./kommoTasks";
import { getFingerprintStoreStatus } from "./fingerprintStore";
import { eventFingerprintFromFila } from "./eventFingerprint";
import {
  findDuplicateInSheet,
  loadEventosSheetIndex,
} from "./sheetEventosReader";
import {
  metricasVisitasStatus,
  syncMetricasVisitas,
} from "./metricasVisitasSync";
import {
  seguidoresStatus,
  syncMetricasSeguidores,
} from "./metricasSeguidoresSync";
import {
  facebookAdsProbe,
  facebookAdsSyncStatus,
  syncMetricasFacebookAds,
} from "./metricasFacebookAdsSync";
import {
  googleAdsProbe,
  googleAdsSyncStatus,
  syncMetricasGoogleAds,
} from "./metricasGoogleAdsSync";
import {
  leadsWaProbe,
  syncMetricasLeadsWa,
} from "./metricasLeadsWaSync";
import {
  brevoProbe,
  brevoSyncStatus,
  syncMetricasBrevo,
} from "./metricasBrevoSync";
import { saveBrevoApiKey } from "./brevoClient";
import { saveGoogleAdsCredentials } from "./googleAdsClient";
import {
  discoverMetaAccounts,
  saveMetaTokenStore,
} from "./metaSocialClient";
import { listMetaAdAccounts } from "./metaAdsClient";
import { saveServiceAccountJsonDurable } from "./googleAuth";
import {
  getKommoAccessToken,
  getKommoBaseUrl,
  kommoCredentialsSource,
  saveKommoTokenStore,
} from "./kommoAuth";
import { restoreHostSecretsOnBoot } from "./hostSecretsArchive";

function publicBaseUrl_(req?: { protocol?: string; get?: (h: string) => string | undefined }): string {
  const env = (
    process.env.PUBLIC_BASE_URL ||
    process.env.HOSTINGER_URL ||
    ""
  ).trim();
  if (env) return env.replace(/\/$/, "");
  if (req?.get) {
    const host = req.get("x-forwarded-host") || req.get("host");
    if (host) {
      const proto = req.get("x-forwarded-proto") || req.protocol || "https";
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }
  return "https://lightcyan-reindeer-284498.hostingersite.com";
}

export const ventasRouter = Router();

function appsScriptUrl(): string {
  return (
    process.env.URL_BODASESOR_DIRECCION_SHEETS ||
    process.env.APPS_SCRIPT_VENTAS_URL ||
    ""
  ).trim();
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
ventasRouter.post(
  "/webhooks/kommo/deal-won",
  (req: Request, res: Response) => {
    const body = (req.body || {}) as KommoWebhookBody;
    console.log("[ventas] webhook hit", {
      contentType: req.headers["content-type"],
      keys: Object.keys(body || {}),
      leadKeys: body?.leads ? Object.keys(body.leads) : [],
    });
    const leadId = extractLeadIdFromWebhook(body);

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

    rememberWebhookAccepted(String(leadId), "webhook");

    // ACK inmediato (<2s) — Kommo no espera la escritura al Sheet
    res.status(200).json({
      ok: true,
      accepted: true,
      phase: PHASE(),
      dealId: String(leadId),
      message:
        "Webhook aceptado. Si está ganado, escribe al Sheet ya. Revisa GET /api/ventas/last",
    });

    // Solo ganado → Sheet; si no, igual corre un tick por si hubo otro cierre
    void (async () => {
      try {
        const lead = await fetchLeadWithContact(leadId);
        if (isClosedWonLead(lead)) {
          await syncDealToSheet(leadId, body);
        } else {
          console.log(
            "[ventas] webhook status no-ganado, skip write",
            leadId,
            lead.status_id
          );
        }
      } catch (err) {
        // NUNCA escribir a ciegas: con token caído esto metía filas fantasma
        // de leads abiertos (nombres raros / vacíos). Mejor reintentar en el poll.
        console.error(
          "[ventas] Error al verificar ganado; NO se escribe al Sheet",
          leadId,
          err instanceof Error ? err.message : err
        );
      }
      try {
        await runPollTick();
      } catch (err) {
        console.error("[ventas] tick tras webhook fail", err);
      }
    })();
  }
);

async function handleManualSync(req: Request, res: Response): Promise<void> {
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId) || dealId <= 0) {
    res.status(400).json({ ok: false, error: "dealId inválido" });
    return;
  }
  try {
    rememberWebhookAccepted(String(dealId), "manual_sync");
    const result = await syncDealToSheet(dealId);
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
  } catch (err) {
    console.error("[ventas] sync manual error", err);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Re-sincroniza un deal por ID (POST o GET para abrir en navegador). */
ventasRouter.post("/api/ventas/sync/:dealId", handleManualSync);
ventasRouter.get("/api/ventas/sync/:dealId", handleManualSync);

/** Último webhook aceptado + último sync completado. */
ventasRouter.get("/api/ventas/last", (_req, res) => {
  res.status(200).json({
    ok: true,
    accepted: getLastWebhookAccepted(),
    lastSync: getLastVentasSync(),
  });
});

/** Debug: deal Kommo crudo + fila mapeada (para ver campos). */
ventasRouter.get("/api/ventas/lead/:dealId", async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId) || dealId <= 0) {
    res.status(400).json({ ok: false, error: "dealId inválido" });
    return;
  }
  try {
    const lead = await fetchLeadWithContact(dealId);
    const fila = mapDealToFilaVentas(lead);
    const fields = (lead.custom_fields_values || []).map((f) => ({
      field_id: f.field_id,
      field_name: f.field_name,
      field_type: f.field_type,
      value: f.values?.[0]?.value ?? null,
    }));
    res.status(200).json({ ok: true, dealId: String(dealId), fila, fields, lead });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Estado del poller automático (backup del webhook). */
ventasRouter.get("/api/ventas/poll", (_req, res) => {
  const poll = getPollStatus();
  res.status(200).json({
    ok: true,
    poll,
    diagnosis: {
      webhookLastSource: getLastWebhookAccepted()?.source ?? null,
      lookbackHours: poll.lookbackHours,
      pollAgeMs: poll.pollAgeMs,
      note:
        "Si lastAccepted.source nunca es 'webhook', Kommo no está pegando al endpoint. El poller sube cierres ganados (72h) en cada request + timer.",
    },
  });
});

/**
 * Pasada del poller: destraba candado; sube faltantes de la ventana ya.
 */
ventasRouter.post("/api/ventas/poll", async (_req, res) => {
  try {
    const result = await runPollTick();
    res.status(200).json({ ok: true, result, poll: getPollStatus() });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

ventasRouter.get("/api/ventas/poll-now", async (_req, res) => {
  try {
    const result = await runPollTick();
    res.status(200).json({ ok: true, result, poll: getPollStatus() });
  } catch (err) {
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
let lastGoogleAdsTickAt = 0;
let lastLeadsWaTickAt = 0;
let lastBrevoTickAt = 0;
const VISITAS_TICK_EVERY_MS = 6 * 60 * 60_000;
const SEGUIDORES_TICK_EVERY_MS = 12 * 60 * 60_000;
const FACEBOOK_ADS_TICK_EVERY_MS = 6 * 60 * 60_000;
const GOOGLE_ADS_TICK_EVERY_MS = 6 * 60 * 60_000;
const LEADS_WA_TICK_EVERY_MS = 6 * 60 * 60_000;
const BREVO_TICK_EVERY_MS = 6 * 60 * 60_000;
let lastKommoTasksTickAt = 0;
const KOMMO_TASKS_TICK_EVERY_MS = 6 * 60 * 60_000;

async function handleTick(_req: Request, res: Response): Promise<void> {
  try {
    const result = await runPollTick();
    let visitas: Awaited<ReturnType<typeof syncMetricasVisitas>> | null = null;
    let seguidores: Awaited<
      ReturnType<typeof syncMetricasSeguidores>
    > | null = null;
    let facebookAds: Awaited<
      ReturnType<typeof syncMetricasFacebookAds>
    > | null = null;
    let googleAds: Awaited<
      ReturnType<typeof syncMetricasGoogleAds>
    > | null = null;
    let leadsWa: Awaited<ReturnType<typeof syncMetricasLeadsWa>> | null =
      null;
    let brevo: Awaited<ReturnType<typeof syncMetricasBrevo>> | null = null;
    const ga4 = metricasVisitasStatus().ga4;
    if (ga4.ok && Date.now() - lastVisitasTickAt > VISITAS_TICK_EVERY_MS) {
      lastVisitasTickAt = Date.now();
      try {
        visitas = await syncMetricasVisitas({ lookbackDays: 45 });
      } catch (err) {
        console.warn(
          "[tick] sync visitas",
          err instanceof Error ? err.message : err
        );
      }
    }
    const metaOk = seguidoresStatus().meta.configured;
    if (
      metaOk &&
      Date.now() - lastSeguidoresTickAt > SEGUIDORES_TICK_EVERY_MS
    ) {
      lastSeguidoresTickAt = Date.now();
      try {
        seguidores = await syncMetricasSeguidores();
      } catch (err) {
        console.warn(
          "[tick] sync seguidores",
          err instanceof Error ? err.message : err
        );
      }
    }
    if (
      metaOk &&
      Date.now() - lastFacebookAdsTickAt > FACEBOOK_ADS_TICK_EVERY_MS
    ) {
      lastFacebookAdsTickAt = Date.now();
      try {
        facebookAds = await syncMetricasFacebookAds({ lookbackDays: 45 });
      } catch (err) {
        console.warn(
          "[tick] sync facebook ads",
          err instanceof Error ? err.message : err
        );
      }
    }
    if (
      googleAdsSyncStatus().canSync &&
      Date.now() - lastGoogleAdsTickAt > GOOGLE_ADS_TICK_EVERY_MS
    ) {
      lastGoogleAdsTickAt = Date.now();
      try {
        googleAds = await syncMetricasGoogleAds({ lookbackDays: 45 });
      } catch (err) {
        console.warn(
          "[tick] sync google ads",
          err instanceof Error ? err.message : err
        );
      }
    }
    if (Date.now() - lastLeadsWaTickAt > LEADS_WA_TICK_EVERY_MS) {
      lastLeadsWaTickAt = Date.now();
      try {
        leadsWa = await syncMetricasLeadsWa({ lookbackDays: 45 });
      } catch (err) {
        console.warn(
          "[tick] sync leads wa",
          err instanceof Error ? err.message : err
        );
      }
    }
    if (
      brevoSyncStatus().configured &&
      Date.now() - lastBrevoTickAt > BREVO_TICK_EVERY_MS
    ) {
      lastBrevoTickAt = Date.now();
      try {
        brevo = await syncMetricasBrevo({ lookbackDays: 45 });
      } catch (err) {
        console.warn(
          "[tick] sync brevo",
          err instanceof Error ? err.message : err
        );
      }
    }
    // Reintento de recordatorios: si Kommo falló justo en el cierre, aquí se
    // recupera sin que nadie tenga que darse cuenta.
    let kommoTasks: BackfillResult | null = null;
    if (Date.now() - lastKommoTasksTickAt > KOMMO_TASKS_TICK_EVERY_MS) {
      lastKommoTasksTickAt = Date.now();
      try {
        kommoTasks = await backfillEventReminderTasks();
      } catch (err) {
        console.warn(
          "[tick] backfill tareas Kommo",
          err instanceof Error ? err.message : err
        );
      }
    }
    res.status(200).json({
      ok: true,
      at: new Date().toISOString(),
      result,
      poll: getPollStatus(),
      visitas,
      seguidores,
      facebookAds,
      googleAds,
      leadsWa,
      brevo,
      kommoTasks: kommoTasks
        ? {
            eventosFuturos: kommoTasks.eventosFuturos,
            creadas: kommoTasks.creadas,
          }
        : null,
      message: "Tick OK — cierres faltantes de la ventana sincronizados",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
ventasRouter.get("/api/ventas/tick", handleTick);
ventasRouter.post("/api/ventas/tick", handleTick);

/** Registra en Kommo el webhook status_lead → este servidor (subida al instante). */
ventasRouter.post("/api/ventas/ensure-webhook", async (req, res) => {
  const dest = `${publicBaseUrl_(req)}/webhooks/kommo/deal-won`;
  try {
    const result = await ensureKommoStatusWebhook(dest);
    res.status(result.ok ? 200 : 502).json({
      ...result,
      webhookUrl: dest,
      hint: result.ok
        ? "Kommo avisará al cerrar/cambiar status → Sheet en segundos"
        : "Si falla por permisos, en Kommo: Ajustes → Integraciones → Webhooks → URL de arriba + evento status_lead",
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      webhookUrl: dest,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

ventasRouter.get("/api/ventas/ensure-webhook", async (req, res) => {
  const dest = `${publicBaseUrl_(req)}/webhooks/kommo/deal-won`;
  try {
    const existing = await listKommoWebhooks();
    const result = await ensureKommoStatusWebhook(dest);
    res.status(result.ok ? 200 : 502).json({
      ...result,
      webhookUrl: dest,
      allWebhooks: existing,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      webhookUrl: dest,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Estado de integración Google Analytics → Metricas (visitas). */
ventasRouter.get("/api/ventas/ga4-status", (_req, res) => {
  res.status(200).json({ ok: true, ...metricasVisitasStatus() });
});

/**
 * Guarda el service account en data/ + backup Drive (sobrevive deploy Hostinger).
 * Body: el JSON completo del .json de Google Cloud.
 */
ventasRouter.post("/api/ventas/ga4-setup-sa", async (req, res) => {
  try {
    const body = req.body;
    const raw =
      typeof body === "string"
        ? body
        : body?.serviceAccount || body?.json || body;
    const saved = await saveServiceAccountJsonDurable(raw);
    res.status(200).json({
      ...saved,
      message: saved.driveOk
        ? "Service account en disco + Drive. POST /api/ventas/sync-visitas"
        : "Service account en disco. Drive backup falló (pega Apps Script v32). POST /api/ventas/sync-visitas",
      status: metricasVisitasStatus(),
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint:
        "Envía el JSON del service account como body (Content-Type: application/json)",
    });
  }
});

/** Diagnóstico: archivos locales vs restore Drive tras deploy. */
ventasRouter.get("/api/ventas/secrets-status", async (_req, res) => {
  try {
    const restore = await restoreHostSecretsOnBoot();
    res.status(200).json({
      ok: true,
      restore,
      ga4: metricasVisitasStatus(),
      meta: seguidoresStatus(),
      hint: "Tras un deploy Hostinger, data/ se borra. Con Apps Script v32 las credenciales se restauran solas desde Drive.",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * Llena Visitas al sitio / orgánicas / blogs / colecciones desde GA4
 * en Metricas Auto (solo celdas vacías de semanas ya empezadas).
 * Query: ?force=1 para sobrescribir, ?days=90 lookback.
 */
async function handleSyncVisitas(req: Request, res: Response): Promise<void> {
  try {
    await restoreHostSecretsOnBoot();
    const body = (req.body || {}) as { force?: unknown; days?: unknown };
    const force =
      String(req.query.force || body.force || "") === "1" ||
      body.force === true;
    const days = Number(req.query.days || body.days || 120);
    const result = await syncMetricasVisitas({
      overwrite: force,
      force,
      lookbackDays: Number.isFinite(days) ? days : 120,
    });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint: metricasVisitasStatus(),
    });
  }
}
ventasRouter.post("/api/ventas/sync-visitas", handleSyncVisitas);
ventasRouter.get("/api/ventas/sync-visitas", handleSyncVisitas);

/** Estado Instagram / Facebook → Metricas (seguidores). */
ventasRouter.get("/api/ventas/meta-status", (_req, res) => {
  res.status(200).json({ ok: true, ...seguidoresStatus() });
});

/**
 * Guarda Page Access Token de Meta (y opcional page_id / ig_user_id / ad_account_id).
 * Body: { access_token, page_id?, ig_user_id?, ad_account_id? }
 */
ventasRouter.post("/api/ventas/meta-setup", async (req, res) => {
  try {
    const body = (req.body || {}) as {
      access_token?: string;
      token?: string;
      page_id?: string;
      ig_user_id?: string;
      ad_account_id?: string;
    };
    const access_token = String(body.access_token || body.token || "").trim();
    if (!access_token) {
      res.status(400).json({
        ok: false,
        error: "Falta access_token",
        hint: "Body JSON: { \"access_token\": \"EAAB...\" }",
      });
      return;
    }
    const saved = saveMetaTokenStore({
      access_token,
      page_id: body.page_id,
      ig_user_id: body.ig_user_id,
      ad_account_id: body.ad_account_id,
    });
    let discovery: unknown = null;
    let adAccounts: unknown = null;
    try {
      discovery = await discoverMetaAccounts(access_token);
    } catch (err) {
      discovery = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      adAccounts = await listMetaAdAccounts(access_token);
    } catch (err) {
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
      status: seguidoresStatus(),
      message:
        "Token guardado. Ahora POST /api/ventas/sync-seguidores o /api/ventas/sync-facebook-ads",
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * Guarda el access token de Kommo en data/ + Drive (Hostinger trunca env largos).
 * Body: { access_token, base_url? }
 */
ventasRouter.post("/api/ventas/kommo-setup", async (req, res) => {
  try {
    const body = (req.body || {}) as {
      access_token?: string;
      token?: string;
      base_url?: string;
      baseUrl?: string;
    };
    const access_token = String(body.access_token || body.token || "").trim();
    if (!access_token) {
      res.status(400).json({
        ok: false,
        error: "Falta access_token",
        hint: 'Body JSON: { "access_token": "...", "base_url": "https://xxx.kommo.com" }',
      });
      return;
    }
    const base_url = String(
      body.base_url || body.baseUrl || process.env.KOMMO_BASE_URL || ""
    )
      .trim()
      .replace(/\/$/, "");
    const saved = saveKommoTokenStore({
      access_token,
      base_url: base_url || undefined,
    });

    let probe: {
      ok: boolean;
      status?: number;
      bodyPreview?: string;
      error?: string;
    } = { ok: false };
    const base = saved.base_url || getKommoBaseUrl();
    if (!base) {
      probe = {
        ok: false,
        error: "Falta base_url (pásala o define KOMMO_BASE_URL)",
      };
    } else {
      try {
        const r = await fetch(`${base}/api/v4/account`, {
          headers: {
            Authorization: `Bearer ${saved.access_token}`,
            Accept: "application/json",
          },
        });
        const text = await r.text();
        probe = {
          ok: r.ok,
          status: r.status,
          bodyPreview: text.slice(0, 200),
        };
      } catch (err) {
        probe = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    res.status(probe.ok ? 200 : 502).json({
      ok: probe.ok,
      saved: {
        tokenLen: saved.access_token.length,
        base_url: saved.base_url || null,
        tokenFrom: "file",
      },
      probe,
      message: probe.ok
        ? "Token Kommo OK. Los cierres deberían volver a escribirse al Sheet."
        : "Token guardado pero Kommo rechazó la prueba. Revisa el token / base_url.",
      hint: "Tras guardar, GET /api/ventas/sync-latest o espera el próximo webhook/tick.",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

ventasRouter.get("/api/ventas/kommo-status", async (_req, res) => {
  const src = kommoCredentialsSource();
  const base = getKommoBaseUrl();
  const token = getKommoAccessToken();
  if (!base || !token) {
    res.status(200).json({
      ok: false,
      ...src,
      error: "Faltan credenciales Kommo",
      hint: 'POST /api/ventas/kommo-setup { "access_token", "base_url" }',
    });
    return;
  }
  try {
    const r = await fetch(`${base}/api/v4/account`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const text = await r.text();
    res.status(r.ok ? 200 : 502).json({
      ok: r.ok,
      ...src,
      status: r.status,
      bodyPreview: text.slice(0, 200),
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      ...src,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

async function handleSyncSeguidores(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await restoreHostSecretsOnBoot();
    const body = (req.body || {}) as { force?: unknown };
    const force =
      String(req.query.force || body.force || "") === "1" ||
      body.force === true;
    const result = await syncMetricasSeguidores({ force });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint: seguidoresStatus(),
    });
  }
}
ventasRouter.post("/api/ventas/sync-seguidores", handleSyncSeguidores);
ventasRouter.get("/api/ventas/sync-seguidores", handleSyncSeguidores);

/** Estado Meta Ads → sección Facebook Ads en Metricas. */
ventasRouter.get("/api/ventas/meta-ads-status", async (_req, res) => {
  try {
    const probe = await facebookAdsProbe();
    res.status(200).json(probe);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: facebookAdsSyncStatus(),
    });
  }
});

async function handleSyncFacebookAds(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await restoreHostSecretsOnBoot();
    const body = (req.body || {}) as {
      force?: unknown;
      lookbackDays?: unknown;
    };
    const force =
      String(req.query.force || body.force || "") === "1" ||
      body.force === true;
    const lookbackDays = Number(
      req.query.lookbackDays || body.lookbackDays || 45
    );
    const result = await syncMetricasFacebookAds({ force, lookbackDays });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: facebookAdsSyncStatus(),
    });
  }
}
ventasRouter.post("/api/ventas/sync-facebook-ads", handleSyncFacebookAds);
ventasRouter.get("/api/ventas/sync-facebook-ads", handleSyncFacebookAds);

/** Estado Google Ads → sección Google Ads en Metricas. */
ventasRouter.get("/api/ventas/google-ads-status", async (_req, res) => {
  try {
    const probe = await googleAdsProbe();
    res.status(200).json(probe);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: googleAdsSyncStatus(),
    });
  }
});

/**
 * Guarda credenciales Google Ads API.
 * Body: { developer_token, customer_id, client_id?, client_secret?, refresh_token?, login_customer_id?, use_service_account? }
 * También acepta env GOOGLE_ADS (JSON) en Hostinger.
 */
ventasRouter.post("/api/ventas/google-ads-setup", (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const saved = saveGoogleAdsCredentials({
      developer_token: String(body.developer_token || body.developerToken || ""),
      customer_id: String(body.customer_id || body.customerId || ""),
      client_id: body.client_id
        ? String(body.client_id)
        : body.clientId
          ? String(body.clientId)
          : undefined,
      client_secret: body.client_secret
        ? String(body.client_secret)
        : body.clientSecret
          ? String(body.clientSecret)
          : undefined,
      refresh_token: body.refresh_token
        ? String(body.refresh_token)
        : body.refreshToken
          ? String(body.refreshToken)
          : undefined,
      login_customer_id: body.login_customer_id
        ? String(body.login_customer_id)
        : body.loginCustomerId
          ? String(body.loginCustomerId)
          : undefined,
      use_service_account:
        body.use_service_account === true ||
        body.use_service_account === 1 ||
        body.use_service_account === "1",
    });
    res.status(200).json({
      ok: true,
      saved: {
        customer_id: saved.customer_id,
        hasDeveloperToken: Boolean(saved.developer_token),
        hasRefreshToken: Boolean(saved.refresh_token),
        use_service_account: Boolean(saved.use_service_account),
      },
      status: googleAdsSyncStatus(),
      message: "Credenciales guardadas. Ahora POST /api/ventas/sync-google-ads",
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

async function handleSyncGoogleAds(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await restoreHostSecretsOnBoot();
    const body = (req.body || {}) as {
      force?: unknown;
      lookbackDays?: unknown;
      preferGa4?: unknown;
    };
    const force =
      String(req.query.force || body.force || "") === "1" ||
      body.force === true;
    const preferGa4 =
      String(req.query.preferGa4 || body.preferGa4 || "") === "1" ||
      body.preferGa4 === true;
    const lookbackDays = Number(
      req.query.lookbackDays || body.lookbackDays || 45
    );
    const result = await syncMetricasGoogleAds({
      force,
      lookbackDays,
      preferGa4,
    });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: googleAdsSyncStatus(),
    });
  }
}
ventasRouter.post("/api/ventas/sync-google-ads", handleSyncGoogleAds);
ventasRouter.get("/api/ventas/sync-google-ads", handleSyncGoogleAds);

/** Probe pipelines/etapas Kommo para Leads WA. */
ventasRouter.get("/api/ventas/leads-wa-status", async (_req, res) => {
  try {
    const probe = await leadsWaProbe();
    res.status(200).json(probe);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

async function handleSyncLeadsWa(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await restoreHostSecretsOnBoot();
    const body = (req.body || {}) as {
      force?: unknown;
      lookbackDays?: unknown;
      pipelineId?: unknown;
    };
    const force =
      String(req.query.force || body.force || "") === "1" ||
      body.force === true;
    const lookbackDays = Number(
      req.query.lookbackDays || body.lookbackDays || 45
    );
    const pipelineId = Number(
      req.query.pipelineId || body.pipelineId || 0
    );
    const result = await syncMetricasLeadsWa({
      force,
      lookbackDays,
      pipelineId: pipelineId > 0 ? pipelineId : undefined,
    });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
ventasRouter.post("/api/ventas/sync-leads-wa", handleSyncLeadsWa);
ventasRouter.get("/api/ventas/sync-leads-wa", handleSyncLeadsWa);

/** Estado Brevo → sección Brevo Bodasesor en Metricas. */
ventasRouter.get("/api/ventas/brevo-status", async (_req, res) => {
  try {
    const probe = await brevoProbe();
    res.status(probe.ok ? 200 : 502).json(probe);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: brevoSyncStatus(),
    });
  }
});

/**
 * Guarda API key de Brevo.
 * Body: { api_key: "xkeysib-..." }
 */
ventasRouter.post("/api/ventas/brevo-setup", (req, res) => {
  try {
    const body = (req.body || {}) as {
      api_key?: string;
      apiKey?: string;
      key?: string;
    };
    const api_key = String(
      body.api_key || body.apiKey || body.key || ""
    ).trim();
    if (!api_key) {
      res.status(400).json({
        ok: false,
        error: "Falta api_key",
        hint: 'Body: { "api_key": "xkeysib-..." }',
      });
      return;
    }
    saveBrevoApiKey(api_key);
    res.status(200).json({
      ok: true,
      saved: true,
      path: "data/brevo.json",
      status: brevoSyncStatus(),
      message: "API key guardada. Ahora POST /api/ventas/sync-brevo",
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

async function handleSyncBrevo(req: Request, res: Response): Promise<void> {
  try {
    await restoreHostSecretsOnBoot();
    const body = (req.body || {}) as {
      force?: unknown;
      lookbackDays?: unknown;
    };
    const force =
      String(req.query.force || body.force || "") === "1" ||
      body.force === true;
    const lookbackDays = Number(
      req.query.lookbackDays || body.lookbackDays || 45
    );
    const result = await syncMetricasBrevo({ force, lookbackDays });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: brevoSyncStatus(),
    });
  }
}
ventasRouter.post("/api/ventas/sync-brevo", handleSyncBrevo);
ventasRouter.get("/api/ventas/sync-brevo", handleSyncBrevo);

/** Estado anti-duplicados: cuántas huellas hay en Sheet + cache. */
ventasRouter.get("/api/ventas/dedupe-status", async (_req, res) => {
  try {
    const idx = await loadEventosSheetIndex(2026, true);
    const local = getFingerprintStoreStatus();
    res.status(200).json({
      ok: true,
      sheetFingerprints: idx.rowCount,
      sheetDealIds: Object.keys(idx.byDealId).length,
      localCache: local,
      rule: "cliente + fecha evento + fecha cierre + horario + tipo",
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** ¿Este deal sería duplicado si se subiera hoy? */
ventasRouter.get("/api/ventas/dedupe-check/:dealId", async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId) || dealId <= 0) {
    res.status(400).json({ ok: false, error: "dealId inválido" });
    return;
  }
  try {
    const lead = await fetchLeadWithContact(dealId);
    const fila = mapDealToFilaVentas(lead);
    const fp = eventFingerprintFromFila(fila);
    const year = yearFromFecha(fila.fechaDeCierre) || 2026;
    const dup = await findDuplicateInSheet(fp, String(dealId), year);
    // Simular otro dealId para ver si la huella ya está
    const wouldDupIfOtherId = await findDuplicateInSheet(
      fp,
      "00000000",
      year
    );
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
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Lista cierres ganados recientes en Kommo (diagnóstico). */
ventasRouter.get("/api/ventas/closed", async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 72, 1), 168);
  try {
    const leads = await fetchRecentlyClosedLeads(
      50,
      hours * 60 * 60_000
    );
    const won = leads.filter(isClosedWonLead);
    const poll = getPollStatus();
    const items = won.map((l) => {
      const id = String(l.id);
      const closedAt = l.closed_at && l.closed_at > 0 ? l.closed_at : 0;
      const prev = poll.syncedUpdatedAt[id] || 0;
      const fila = mapDealToFilaVentas(l);
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
      lookbackHoursDefault: Math.round(getWriteLookbackMs() / 3600000),
      count: items.length,
      items,
    });
  } catch (err) {
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
ventasRouter.post("/api/ventas/sync-latest", async (_req, res) => {
  try {
    const result = await syncLatestMissingClosedDeal(40);
    res.status(200).json({ ok: true, result, poll: getPollStatus() });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

ventasRouter.get("/api/ventas/sync-latest", async (_req, res) => {
  try {
    const result = await syncLatestMissingClosedDeal(40);
    res.status(200).json({ ok: true, result, poll: getPollStatus() });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/* ---------- Calendario de eventos ---------- */

/**
 * Reagenda en Google Calendar todos los eventos futuros del Sheet.
 * Úsalo tras el primer deploy de v38 o si corregiste fechas a mano.
 */
const handleCalendarSync = async (_req: Request, res: Response) => {
  try {
    const result = await postToAppsScript(
      { action: "syncEventosCalendar" },
      { timeoutMs: 300_000 }
    );
    res.status(200).json({ ok: true, result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
ventasRouter.post("/api/ventas/calendar-sync", handleCalendarSync);
ventasRouter.get("/api/ventas/calendar-sync", handleCalendarSync);

/**
 * Resumen "esta semana". Sin force el Apps Script solo lo manda una vez al
 * día, así que este endpoint sirve de respaldo del trigger del lunes sin
 * duplicar el correo. force=1 para probar a mano.
 */
const handleCalendarDigest = async (req: Request, res: Response) => {
  const force = req.query.force === "1" || req.query.force === "true";
  try {
    const result = await postToAppsScript(
      { action: "weeklyEventosDigest", force },
      { timeoutMs: 180_000 }
    );
    res.status(200).json({ ok: true, force, result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
ventasRouter.post("/api/ventas/calendar-digest", handleCalendarDigest);
ventasRouter.get("/api/ventas/calendar-digest", handleCalendarDigest);

/**
 * ¿Hostinger sigue hablando con la implementación actual del Apps Script?
 * Devuelve 503 si no, para que un monitor externo lo note.
 */
const handleConexionCheck = async (_req: Request, res: Response) => {
  try {
    const result = await postToAppsScript({ action: "verificarConexion" });
    const ok = result.ok !== false && !(result as { problemas?: string[] }).problemas?.length;
    res.status(ok ? 200 : 503).json({ ok, result });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
ventasRouter.post("/api/ventas/conexion-check", handleConexionCheck);
ventasRouter.get("/api/ventas/conexion-check", handleConexionCheck);

/** Instala los triggers de Apps Script (lunes 7am + reagenda diaria 5am). */
const handleCalendarInstall = async (_req: Request, res: Response) => {
  try {
    const result = await postToAppsScript({
      action: "installEventosCalendarTriggers",
    });
    res.status(200).json({ ok: true, result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
ventasRouter.post("/api/ventas/calendar-install", handleCalendarInstall);
ventasRouter.get("/api/ventas/calendar-install", handleCalendarInstall);

/** Recordatorios en el calendario de Kommo para un deal concreto. */
const handleKommoTasks = async (req: Request, res: Response) => {
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId) || dealId <= 0) {
    res.status(400).json({ ok: false, error: "dealId inválido" });
    return;
  }
  try {
    const lead = await fetchLeadWithContact(dealId);
    const fila = mapDealToFilaVentas(lead);
    const result = await ensureEventReminderTasks(lead, fila);
    res.status(200).json({ ok: true, fechaDelEvento: fila.fechaDelEvento, result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
ventasRouter.post("/api/ventas/kommo-tasks/:dealId", handleKommoTasks);
ventasRouter.get("/api/ventas/kommo-tasks/:dealId", handleKommoTasks);

/**
 * Borra recordatorios Bodasesor ([evt:...]) de un lead.
 * Sirve para limpiar tareas creadas por error en chats abiertos.
 */
const handleKommoTasksDelete = async (req: Request, res: Response) => {
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId) || dealId <= 0) {
    res.status(400).json({ ok: false, error: "dealId inválido" });
    return;
  }
  try {
    const result = await deleteEventReminderTasks(dealId);
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
ventasRouter.delete("/api/ventas/kommo-tasks/:dealId", handleKommoTasksDelete);
ventasRouter.post("/api/ventas/kommo-tasks/:dealId/delete", handleKommoTasksDelete);

/**
 * Limpia recordatorios erróneos en leads NO ganados (p.ej. tras un sync a ciegas).
 * Body/query opcional: ?ids=1,2,3 — si no, usa la lista de basura conocida del 22/09.
 */
ventasRouter.post("/api/ventas/kommo-tasks-cleanup-open", async (req, res) => {
  try {
    const body = (req.body || {}) as { ids?: unknown };
    const raw =
      String(req.query.ids || "") ||
      (Array.isArray(body.ids) ? body.ids.join(",") : String(body.ids || ""));
    const defaultJunk = [
      27397610, 27397416, 27397830, 27197320, 27397926, 27398166, 27398108,
      27398434,
    ];
    const ids = (raw
      ? raw.split(/[,\s]+/).map((s) => Number(s.trim()))
      : defaultJunk
    ).filter((n) => Number.isFinite(n) && n > 0);

    const items: Array<Record<string, unknown>> = [];
    let deleted = 0;
    for (const id of ids) {
      const lead = await fetchLeadWithContact(id);
      if (isClosedWonLead(lead)) {
        items.push({
          dealId: String(id),
          skipped: "es_ganado_se_conserva",
          cliente: lead.name || null,
        });
        continue;
      }
      const result = await deleteEventReminderTasks(id);
      deleted += result.deleted;
      items.push({ ...result, status_id: lead.status_id, cliente: lead.name || null });
    }
    res.status(200).json({ ok: true, deleted, items });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Fuerza el repaso de recordatorios sin esperar al tick de cada 6h. */
const handleKommoTasksBackfill = async (_req: Request, res: Response) => {
  try {
    const result = await backfillEventReminderTasks();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
ventasRouter.post("/api/ventas/kommo-tasks-backfill", handleKommoTasksBackfill);
ventasRouter.get("/api/ventas/kommo-tasks-backfill", handleKommoTasksBackfill);

/** Últimos deals tocados en Kommo (para elegir cuál sincronizar). */
ventasRouter.get("/api/ventas/recent", async (req, res) => {
  const limit = Number(req.query.limit) || 15;
  try {
    const leads = await fetchRecentLeads(limit);
    const items = leads.map((l) => {
      const fila = mapDealToFilaVentas(l);
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
  } catch (err) {
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
ventasRouter.post("/api/ventas/setup-metricas-auto", async (_req, res) => {
  try {
    const result = await postToAppsScript(
      { action: "setupMetricasAuto" },
      { timeoutMs: 90_000 }
    );
    if (!result.ok) {
      res.status(502).json({
        ok: false,
        error: result.error || "Apps Script rechazó setupMetricasAuto",
        version: result.version,
        hint:
          "Pega Codigo.gs v33 → Guardar → Implementar → Nueva versión. O en Apps Script ejecuta restoreMetricasSemanal_.",
      });
      return;
    }
    res.status(200).json({
      ok: true,
      version: result.version,
      metricasAutoSheet:
        (result as { metricasAutoSheet?: string }).metricasAutoSheet ||
        "Metricas 2026 Auto",
      spreadsheetName: result.spreadsheetName,
      spreadsheetUrl: result.spreadsheetUrl,
      existingSheets: result.existingSheets,
      message:
        result.message ||
        "Pestaña Metricas Auto lista. Refresca el Sheet.",
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      ok: false,
      error,
      hint:
        "Pega Codigo.gs v33 → Guardar → Implementar → Nueva versión. O ejecuta restoreMetricasSemanal_.",
    });
  }
});

ventasRouter.get("/api/ventas/setup-metricas-auto", async (_req, res) => {
  try {
    const result = await postToAppsScript(
      { action: "setupMetricasAuto" },
      { timeoutMs: 90_000 }
    );
    res.status(result.ok ? 200 : 502).json({
      ok: Boolean(result.ok),
      version: result.version,
      metricasAutoSheet:
        (result as { metricasAutoSheet?: string }).metricasAutoSheet ||
        "Metricas 2026 Auto",
      spreadsheetUrl: result.spreadsheetUrl,
      existingSheets: result.existingSheets,
      message: result.message,
      error: result.error,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint: "En Apps Script ejecuta restoreMetricasSemanal_ → ▶ Ejecutar",
    });
  }
});

ventasRouter.get("/health", (_req, res) => {
  const scriptUrl = appsScriptUrl();
  let appsScriptUrlTail = "";
  try {
    const u = new URL(scriptUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    appsScriptUrlTail = parts.slice(-2).join("/");
  } catch {
    appsScriptUrlTail = "";
  }
  res.status(200).json({
    ok: true,
    service: "ventas-y-finanzas",
    phase: scriptUrl ? 2 : 1,
    env: {
      hasKommoBaseUrl: Boolean(getKommoBaseUrl()),
      hasKommoAccessToken: Boolean(getKommoAccessToken()),
      kommoTokenFrom: kommoCredentialsSource().tokenFrom,
      hasAppsScriptUrl: Boolean(scriptUrl),
      appsScriptUrlLooksValid:
        scriptUrl.includes("script.google.com") && scriptUrl.includes("/exec"),
      appsScriptUrlTail,
    },
    lastAccepted: getLastWebhookAccepted(),
    lastSyncDealId: getLastVentasSync()?.dealId ?? null,
    poll: {
      lastPollAt: getPollStatus().lastPollAt,
      lastSynced: getPollStatus().lastResult?.synced || [],
    },
    ga4: metricasVisitasStatus().ga4,
  });
});

ventasRouter.get("/health/kommo", async (_req, res) => {
  const base = getKommoBaseUrl();
  const token = getKommoAccessToken();
  const src = kommoCredentialsSource();

  if (!base || !token) {
    res.status(500).json({
      ok: false,
      error:
        "Faltan KOMMO_BASE_URL o KOMMO_ACCESS_TOKEN (env o data/kommo-token.json)",
      hasKommoBaseUrl: Boolean(base),
      hasKommoAccessToken: Boolean(token),
      ...src,
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
      ...src,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...src,
    });
  }
});
