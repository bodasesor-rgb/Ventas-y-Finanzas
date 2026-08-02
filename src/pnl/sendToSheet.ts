import { postToAppsScript } from "../appsScriptClient";
import { buildYearAnalysis } from "./providerAnalysis";
import { loadCategories, loadRuns } from "./store";
import type { StatementRun } from "./types";

const CATEGORY_COLS = [
  "ads",
  "apps",
  "pass",
  "comisiones",
  "servicios",
  "pago",
  "transferencia_persona",
  "socio",
  "proveedor",
  "evento",
  "revisar",
  "otro",
  "ingreso",
  "venta",
] as const;

export async function sendRunToBancoSheet(run: StatementRun): Promise<{
  sheetName: string;
  erSheet?: string;
  erMonthCol?: string;
  erExists?: boolean;
  spreadsheetId?: string;
  spreadsheetName?: string;
  spreadsheetUrl?: string;
  existingSheets?: string[];
  row?: number;
  action?: string;
  version?: string;
  message?: string;
}> {
  const periodKey = run.periodKey || "";
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    throw new Error("El estado no tiene mes válido (periodKey YYYY-MM)");
  }
  const year = Number(periodKey.slice(0, 4));
  const month = Number(periodKey.slice(5, 7));
  // Totales ya resueltos en buildOfficialAwareTotals:
  // si no cuadra → ingreso = líneas (no inflar); gasto absorbe el neto del PDF
  const oficial = run.reconciliation?.oficial;
  const totals = run.totals || { ingresos: 0, gastos: 0, neto: 0 };
  const match = Boolean(run.reconciliation?.matchCompleto);
  let ingresos = totals.ingresos;
  let gastosSigned = totals.gastos;
  let neto = totals.neto;
  if (match && oficial?.ingresosOficiales != null) {
    ingresos = oficial.ingresosOficiales;
  }
  if (match && oficial?.gastosOficiales != null) {
    gastosSigned = oficial.gastosOficiales;
  }
  if (oficial?.saldoCorte != null && oficial?.saldoAnterior != null) {
    neto =
      Math.round((oficial.saldoCorte - oficial.saldoAnterior) * 100) / 100;
    if (!match) {
      // Sin cuadre: no inflar ingreso; el gasto cierra el neto del estado
      ingresos = totals.parseado?.ingresos ?? totals.ingresos;
      gastosSigned = Math.round((neto - ingresos) * 100) / 100;
    }
  } else if (!match) {
    ingresos = totals.parseado?.ingresos ?? totals.ingresos;
    gastosSigned = Math.round((neto - ingresos) * 100) / 100;
  }

  const summary = run.summaryByCategory || {};
  const cats = loadCategories();
  const labelOf = (id: string) =>
    cats.find((c) => c.id === id)?.label || id;

  const byCategory = CATEGORY_COLS.map((id) => ({
    id,
    label: labelOf(id),
    amount: Math.round((summary[id] || 0) * 100) / 100,
  }));

  // Resto de categorías no listadas
  const known = new Set<string>(CATEGORY_COLS as unknown as string[]);
  let otros = 0;
  for (const [id, amt] of Object.entries(summary)) {
    if (!known.has(id)) otros += amt;
  }

  const payload = {
    action: "upsertEstadoResultados",
    year,
    month,
    periodKey,
    periodLabel: run.periodLabel || periodKey,
    ingresos,
    // Sheet: gastos como positivo (monto salido)
    gastos: Math.abs(gastosSigned),
    neto,
    byCategory,
    otros: Math.round(otros * 100) / 100,
    depositosOficiales: oficial?.ingresosOficiales ?? oficial?.depositos ?? null,
    retirosOficiales:
      oficial?.gastosOficiales == null
        ? null
        : Math.abs(oficial.gastosOficiales),
    // Cuadra a nivel totales oficiales del resumen (siempre, si existen)
    cuadra: Boolean(
      oficial?.ingresosOficiales != null && oficial?.gastosOficiales != null
    ),
    movimientosCuadran: Boolean(run.reconciliation?.matchCompleto),
    totalsSource: totals.source || "oficial",
    runId: run.id,
    filename: run.storedName || run.filename || "",
  };

  let result;
  try {
    result = await postToAppsScript(payload);
  } catch (err) {
    // Compat: Scripts viejos solo conocen upsertBanco
    result = await postToAppsScript({ ...payload, action: "upsertBanco" });
  }

  const erSheet =
    result.erSheet || result.sheetName || `Estado de Resultados ${year}`;
  const erCol = result.erMonthCol || "";
  const monthNames = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const monthLabel = monthNames[month - 1] || String(month);

  const sheetTitle =
    result.spreadsheetName || "Google Sheet vinculado al Apps Script";
  const msg =
    result.message ||
    `Enviado a Sheet «${sheetTitle}» → ${erSheet} · ${monthLabel}${
      erCol ? ` (${erCol})` : ""
    } · v${result.version || "?"}`;

  return {
    sheetName: erSheet,
    erSheet,
    erMonthCol: erCol,
    erExists: result.erExists,
    spreadsheetId: result.spreadsheetId,
    spreadsheetName: result.spreadsheetName,
    spreadsheetUrl: result.spreadsheetUrl,
    existingSheets: result.existingSheets,
    row: result.row,
    action: result.action,
    version: result.version,
    message: msg,
  };
}

/** Escribe pestaña Análisis YYYY con ranking proveedores + mensual/anual. */
export async function sendYearAnalysisToSheet(year = 2026): Promise<{
  sheetName: string;
  version?: string;
  analysis: ReturnType<typeof buildYearAnalysis>;
}> {
  const analysis = buildYearAnalysis(loadRuns(), year);
  const result = await postToAppsScript({
    action: "upsertAnalisis",
    year,
    analysis,
  });
  return {
    sheetName: result.sheetName || `Analisis ${year}`,
    version: result.version,
    analysis,
  };
}
