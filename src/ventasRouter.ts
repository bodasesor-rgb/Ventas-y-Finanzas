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

      try {
        lead = await fetchLeadWithContact(leadId);
      } catch (apiErr) {
        // Si no hay token aún, intenta mapear con el payload crudo (parcial)
        console.warn(
          "[ventas][fase1] No se pudo fetch Kommo API; usando payload parcial",
          apiErr instanceof Error ? apiErr.message : apiErr
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
  });
});
