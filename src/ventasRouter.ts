import { Router, type Request, type Response } from "express";
import {
  extractLeadIdFromWebhook,
  fetchLeadWithContact,
  fetchRecentLeads,
} from "./kommoApi";
import { mapDealToFilaVentas } from "./mapDealToFila";
import type { KommoWebhookBody } from "./types";
import { postToAppsScript } from "./appsScriptClient";
import {
  getPollStatus,
  pollClosedDealsOnce,
  syncLatestMissingClosedDeal,
} from "./pollClosedDeals";
import {
  getLastVentasSync,
  getLastWebhookAccepted,
  rememberWebhookAccepted,
  syncDealToSheet,
} from "./ventasSync";

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
        "Webhook aceptado. Escribiendo al Sheet en segundo plano. Revisa GET /api/ventas/last",
    });

    void syncDealToSheet(leadId, body).catch((err) => {
      console.error("[ventas] Error en sync background", err);
    });
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
  res.status(200).json({ ok: true, poll: getPollStatus() });
});

/**
 * Pasada del poller: destraba candado si hace falta.
 * Solo el cierre más reciente en la ventana; no re-sube históricos.
 */
ventasRouter.post("/api/ventas/poll", async (_req, res) => {
  try {
    const result = await pollClosedDealsOnce(40, {
      force: true,
      onlyLatestMissing: true,
    });
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
    const result = await pollClosedDealsOnce(40, {
      force: true,
      onlyLatestMissing: true,
    });
    res.status(200).json({ ok: true, result, poll: getPollStatus() });
  } catch (err) {
    res.status(500).json({
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
          "Pega Codigo.gs v23 → Guardar → Implementar → Nueva versión. O en Apps Script ejecuta restoreMetricasSemanal_.",
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
        "Si el script aún es v22: en Apps Script elige restoreMetricasSemanal_ → ▶ Ejecutar. O pega v23 e Implementa.",
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
      hasKommoBaseUrl: Boolean(process.env.KOMMO_BASE_URL),
      hasKommoAccessToken: Boolean(process.env.KOMMO_ACCESS_TOKEN),
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
  });
});

ventasRouter.get("/health/kommo", async (_req, res) => {
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
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
