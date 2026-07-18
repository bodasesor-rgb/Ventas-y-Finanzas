import { writeFilaToAppsScript } from "./appsScriptClient";
import {
  extractPartialLeadFromWebhook,
  fetchLeadWithContact,
} from "./kommoApi";
import {
  filaToOrderedValues,
  mapDealToFilaVentas,
  SHEET_HEADERS,
  yearFromFecha,
} from "./mapDealToFila";
import type { FilaVentas, KommoLead, KommoWebhookBody } from "./types";

export interface VentasSyncResult {
  startedAt: string;
  finishedAt: string;
  dealId: string;
  dataSource: "kommo_api" | "webhook_partial";
  kommoApiError: string | null;
  fila: FilaVentas;
  values: string[];
  sheetWrite: {
    attempted: boolean;
    ok: boolean;
    action?: string;
    row?: number;
    version?: string;
    error?: string;
  };
  headers: readonly string[];
}

/** Último resultado en memoria (se pierde al reiniciar Node). */
let lastSync: VentasSyncResult | null = null;
let lastAccepted: { at: string; dealId: string; source: string } | null = null;

export function getLastVentasSync(): VentasSyncResult | null {
  return lastSync;
}

export function getLastWebhookAccepted(): typeof lastAccepted {
  return lastAccepted;
}

export function rememberWebhookAccepted(dealId: string, source: string): void {
  lastAccepted = { at: new Date().toISOString(), dealId, source };
}

function appsScriptUrl(): string {
  return (
    process.env.URL_BODASESOR_DIRECCION_SHEETS ||
    process.env.APPS_SCRIPT_VENTAS_URL ||
    ""
  ).trim();
}

/**
 * Trae el deal de Kommo (o partial del webhook) y escribe Eventos YYYY.
 */
export async function syncDealToSheet(
  leadId: number,
  webhookBody?: KommoWebhookBody | Record<string, unknown>
): Promise<VentasSyncResult> {
  const startedAt = new Date().toISOString();

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
    lead = webhookBody
      ? extractPartialLeadFromWebhook(webhookBody, leadId)
      : { id: leadId };
  }

  const fila = mapDealToFilaVentas(lead);
  const values = filaToOrderedValues(fila);

  const sheetWrite: VentasSyncResult["sheetWrite"] = {
    attempted: false,
    ok: false,
  };

  if (appsScriptUrl()) {
    sheetWrite.attempted = true;
    try {
      const year =
        yearFromFecha(fila.fechaDeCierre) || new Date().getUTCFullYear();
      const sheetName = `Eventos ${year}`;
      const result = await writeFilaToAppsScript(
        fila.kommoDealId,
        values,
        sheetName
      );
      sheetWrite.ok = true;
      sheetWrite.action = result.action;
      sheetWrite.row = result.row;
      sheetWrite.version = result.version;
      console.log("[ventas][fase2] Sheet write OK", {
        dealId: fila.kommoDealId,
        action: result.action,
        row: result.row,
        sheetName,
      });
    } catch (writeErr) {
      sheetWrite.ok = false;
      sheetWrite.error =
        writeErr instanceof Error ? writeErr.message : String(writeErr);
      console.error("[ventas][fase2] Sheet write FAIL", sheetWrite.error);
    }
  } else {
    console.log(
      "[ventas][fase1] FILA QUE SE APPENDARÍA (sin URL Apps Script /exec)"
    );
  }

  const result: VentasSyncResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    dealId: fila.kommoDealId,
    dataSource,
    kommoApiError,
    fila,
    values,
    sheetWrite,
    headers: SHEET_HEADERS,
  };

  lastSync = result;
  console.log(
    JSON.stringify(
      {
        startedAt,
        dealId: result.dealId,
        dataSource,
        kommoApiError,
        sheetWrite: result.sheetWrite,
        cliente: fila.cliente,
        venta: fila.venta,
        fechaDeCierre: fila.fechaDeCierre,
      },
      null,
      2
    )
  );

  return result;
}
