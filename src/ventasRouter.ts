import { Router, type Request, type Response } from "express";
import { writeFilaToAppsScript } from "./appsScriptClient";
import { extractLeadIdFromWebhook, fetchLeadWithContact } from "./kommoApi";
import {
  filaToOrderedValues,
  mapDealToFilaVentas,
  SHEET_HEADERS,
} from "./mapDealToFila";
import type { KommoLead, KommoWebhookBody } from "./types";

export const ventasRouter = Router();

function appsScriptUrl(): string {
  return (
    process.env.URL_BODASESOR_DIRECCION_SHEETS ||
    process.env.APPS_SCRIPT_VENTAS_URL ||
    ""
  ).trim();
}

const PHASE = appsScriptUrl() ? 2 : 1;

/**
 * Recibe webhook de deal ganado, mapea la fila y:
 * - Fase 1: solo log
 * - Fase 2: escribe al Sheet vía Apps Script (idempotente por deal ID)
 */
ventasRouter.post(
  "/webhooks/kommo/deal-won",
  async (req: Request, res: Response) => {
    const startedAt = new Date().toISOString();

    try {
      const body = req.body as KommoWebhookBody;
      const leadId = extractLeadIdFromWebhook(body);

      if (!leadId) {
        console.warn("[ventas] Webhook sin lead id", {
          startedAt,
          keys: Object.keys(body || {}),
        });
        res.status(400).json({
          ok: false,
          phase: PHASE,
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
        dataSource = "webhook_partial";
        kommoApiError =
          apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.warn(
          "[ventas] No se pudo fetch Kommo API; usando payload parcial",
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

      let sheetWrite: {
        attempted: boolean;
        ok: boolean;
        action?: string;
        row?: number;
        error?: string;
      } = { attempted: false, ok: false };

      if (appsScriptUrl()) {
        sheetWrite.attempted = true;
        try {
          // Solo escribe Eventos YYYY. Metricas / P&L = fórmulas en Sheet.
          const sheetName = `Eventos ${
            fila.fechaDeCierre
              ? fila.fechaDeCierre.slice(0, 4)
              : String(new Date().getUTCFullYear())
          }`;
          const result = await writeFilaToAppsScript(
            fila.kommoDealId,
            values,
            sheetName
          );
          sheetWrite = {
            attempted: true,
            ok: true,
            action: result.action,
            row: result.row,
          };
          console.log("[ventas][fase2] Sheet write OK", sheetWrite);
        } catch (writeErr) {
          sheetWrite = {
            attempted: true,
            ok: false,
            error:
              writeErr instanceof Error ? writeErr.message : String(writeErr),
          };
          console.error("[ventas][fase2] Sheet write FAIL", sheetWrite.error);
        }
      } else {
        console.log(
          "[ventas][fase1] FILA QUE SE APPENDARÍA (sin URL Apps Script /exec)"
        );
      }

      console.log(
        JSON.stringify(
          {
            startedAt,
            phase: PHASE,
            dataSource,
            kommoApiError,
            dealId: fila.kommoDealId,
            headers: SHEET_HEADERS,
            values,
            fila,
            sheetWrite,
          },
          null,
          2
        )
      );

      res.status(200).json({
        ok: true,
        phase: PHASE,
        message: sheetWrite.attempted
          ? sheetWrite.ok
            ? `Fila ${sheetWrite.action} en Sheet (fila ${sheetWrite.row}).`
            : `Mapeo OK pero falló escritura a Sheet: ${sheetWrite.error}`
          : "Fila mapeada. Falta URL_BODASESOR_DIRECCION_SHEETS (/exec) para escribir al Sheet.",
        dataSource,
        kommoApiError,
        dealId: fila.kommoDealId,
        fila,
        values,
        sheetWrite,
      });
    } catch (err) {
      console.error("[ventas] Error", err);
      res.status(500).json({
        ok: false,
        phase: PHASE,
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }
);

ventasRouter.get("/health", (_req, res) => {
  const scriptUrl = appsScriptUrl();
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
