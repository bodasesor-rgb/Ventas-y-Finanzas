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
  const totals = run.totals || { ingresos: 0, gastos: 0, neto: 0 };
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

  const oficial = run.reconciliation?.oficial;
  const result = await postToAppsScript({
    action: "upsertBanco",
    year,
    month,
    periodKey,
    periodLabel: run.periodLabel || periodKey,
    ingresos: totals.ingresos,
    // Sheet: gastos como positivo (monto salido)
    gastos: Math.abs(totals.gastos),
    neto: totals.neto,
    byCategory,
    otros: Math.round(otros * 100) / 100,
    depositosOficiales: oficial?.ingresosOficiales ?? oficial?.depositos ?? null,
    retirosOficiales:
      oficial?.gastosOficiales == null
        ? null
        : Math.abs(oficial.gastosOficiales),
    cuadra: Boolean(run.reconciliation?.matchCompleto),
    runId: run.id,
    filename: run.storedName || run.filename || "",
  });

  const erSheet =
    result.erSheet || `Estado de Resultados ${year}`;
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

  return {
    sheetName: result.sheetName || `Banco ${year}`,
    erSheet,
    erMonthCol: erCol,
    row: result.row,
    action: result.action,
    version: result.version,
    message: `OK → ${erSheet} (columna ${monthLabel}${
      erCol ? ` / ${erCol}` : ""
    }) · Banco fila ${result.row || "?"} · v${result.version || "?"}`,
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
