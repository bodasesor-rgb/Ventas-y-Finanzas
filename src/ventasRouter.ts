import { Router, type Request, type Response } from "express";
import { extractLeadIdFromWebhook, fetchLeadWithContact } from "./kommoApi";
import {
  filaToOrderedValues,
  mapDealToFilaVentas,
  SHEET_HEADERS,
} from "./mapDealToFila";
import type { KommoLead, KommoWebhookBody } from "./types";

export const ventasRouter = Router();

/**
 * FASE 1 — Recibe webhook de deal ganado, mapea la fila y la LOGUEA.
 * Aún NO escribe al Google Sheet (eso es Fase 2).
 *
 * Kommo: Digital Pipeline / webhook → POST /webhooks/kommo/deal-won
 */
ventasRouter.post(
  "/webhooks/kommo/deal-won",
  async (req: Request, res: Response) => {
    const startedAt = new Date().toISOString();

    try {
      const body = req.body as KommoWebhookBody;
      const leadId = extractLeadIdFromWebhook(body);

      if (!leadId) {
        console.warn("[ventas][fase1] Webhook sin lead id", {
          startedAt,
          keys: Object.keys(body || {}),
        });
        res.status(400).json({
          ok: false,
          phase: 1,
          error: "No se encontró lead id en el webhook",
        });
        return;
      }

      let lead: KommoLead;
      let dataSource: "kommo_api" | "webhook_partial" = "kommo_api";
      let kommoApiError: string | null = null;

      try {
        lead = await fetchLeadWithContact(leadId);
      } catch (apiErr) {
        // Si no hay token aún, intenta mapear con el payload crudo (parcial)
        dataSource = "webhook_partial";
        kommoApiError =
          apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.warn(
          "[ventas][fase1] No se pudo fetch Kommo API; usando payload parcial",
          kommoApiError
        );
        const partial =
          body.leads?.status?.[0] ||
          body.leads?.update?.[0] ||
          body.leads?.add?.[0];
        lead = {
          id: leadId,
          ...(partial || {}),
        } as KommoLead;
      }

      const fila = mapDealToFilaVentas(lead);
      const values = filaToOrderedValues(fila);

      // LOG de la fila que se APPENDARÍA (Fase 1 — sin escribir Sheet)
      console.log("[ventas][fase1] FILA QUE SE APPENDARÍA (sin escribir Sheet)");
      console.log(
        JSON.stringify(
          {
            startedAt,
            action: "WOULD_APPEND",
            dataSource,
            kommoApiError,
            dealId: fila.kommoDealId,
            headers: SHEET_HEADERS,
            values,
            fila,
          },
          null,
          2
        )
      );

      res.status(200).json({
        ok: true,
        phase: 1,
        message:
          "Fila mapeada y logueada. Escritura a Sheet desactivada (Fase 1).",
        dataSource,
        kommoApiError,
        dealId: fila.kommoDealId,
        fila,
        values,
      });
    } catch (err) {
      console.error("[ventas][fase1] Error", err);
      res.status(500).json({
        ok: false,
        phase: 1,
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }
);

/** Healthcheck para Hostinger / monitoreo */
ventasRouter.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "ventas-y-finanzas",
    phase: 1,
    env: {
      hasKommoBaseUrl: Boolean(process.env.KOMMO_BASE_URL),
      hasKommoAccessToken: Boolean(process.env.KOMMO_ACCESS_TOKEN),
    },
  });
});

/**
 * Prueba rápida de credenciales Kommo (no escribe nada).
 * GET /health/kommo
 */
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
      headers: { Authorization: `Bearer ${token}` },
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
