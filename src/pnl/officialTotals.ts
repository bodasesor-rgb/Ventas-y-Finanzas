/**
 * Totales del resumen al inicio del estado (Depósitos / Otros cargos).
 * Esos montos son la verdad del banco; la suma de movimientos solo sirve
 * para encontrar líneas dañadas (puntos/comas/folios).
 */
import { summarizeByCategory, summarizeTotals } from "./parseStatement";
import {
  extractStatementOfficialTotals,
  reconcileTotals,
  type Reconciliation,
  type StatementOfficialTotals,
} from "./statementSummary";
import type { BankLine } from "./types";

export type TotalsSource = "oficial" | "parseado";

export interface RunTotals {
  ingresos: number;
  gastos: number;
  neto: number;
  /** De dónde salieron ingresos/gastos principales */
  source: TotalsSource;
  /** Suma cruda de movimientos (para ver daños) */
  parseado: { ingresos: number; gastos: number; neto: number };
}

/**
 * Lee el resumen SOLO de la portada / inicio del PDF
 * (antes de "Detalle de Operaciones"), que es donde Banamex
 * imprime Depósitos y Retiros/compras/comis./otros cargos.
 */
export function extractOfficialFromPreamble(
  text: string
): StatementOfficialTotals {
  const cut = text.search(/Detalle de Operaciones/i);
  const preamble = cut > 80 ? text.slice(0, cut) : text.slice(0, 4500);
  const fromPre = extractStatementOfficialTotals(preamble);
  // Si la portada no trajo Depósitos, caer al documento completo
  if (
    fromPre.ingresosOficiales != null ||
    fromPre.gastosOficiales != null
  ) {
    return fromPre;
  }
  return extractStatementOfficialTotals(text);
}

/**
 * Totales a mostrar / enviar = montos generales del estado.
 * La suma de líneas queda en totals.parseado para localizar daños.
 */
export function buildOfficialAwareTotals(
  lines: BankLine[],
  textOrOficial: string | StatementOfficialTotals
): {
  totals: RunTotals;
  summaryByCategory: Record<string, number>;
  reconciliation: Reconciliation;
  oficial: StatementOfficialTotals;
} {
  const oficial =
    typeof textOrOficial === "string"
      ? extractOfficialFromPreamble(textOrOficial)
      : textOrOficial;

  const parseado = summarizeTotals(lines);
  const reconciliation = reconcileTotals(oficial, parseado, 1);

  const hasOficial =
    oficial.ingresosOficiales != null || oficial.gastosOficiales != null;

  const ingresos =
    oficial.ingresosOficiales != null
      ? oficial.ingresosOficiales
      : parseado.ingresos;
  const gastos =
    oficial.gastosOficiales != null
      ? oficial.gastosOficiales
      : parseado.gastos;
  const neto = Math.round((ingresos + gastos) * 100) / 100;

  const summaryByCategory = summarizeByCategory(lines);

  // Diferencia líneas vs resumen → categoría "revisar" para que el Sheet
  // refleje el total oficial sin perder el desglose aproximado.
  if (hasOficial) {
    const gapIng = Math.round((ingresos - parseado.ingresos) * 100) / 100;
    const gapGas = Math.round((gastos - parseado.gastos) * 100) / 100;
    const gap = Math.round((gapIng + gapGas) * 100) / 100;
    if (Math.abs(gap) > 0.009) {
      summaryByCategory.revisar =
        Math.round(((summaryByCategory.revisar || 0) + gap) * 100) / 100;
    }
  }

  return {
    oficial,
    reconciliation,
    summaryByCategory,
    totals: {
      ingresos,
      gastos,
      neto,
      source: hasOficial ? "oficial" : "parseado",
      parseado,
    },
  };
}
