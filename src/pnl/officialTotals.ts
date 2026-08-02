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

  // Neto del resumen PDF (corte − anterior, o depósitos + cargos oficiales)
  let netoOficial: number | null = null;
  if (oficial.saldoCorte != null && oficial.saldoAnterior != null) {
    netoOficial =
      Math.round((oficial.saldoCorte - oficial.saldoAnterior) * 100) / 100;
  } else if (
    oficial.ingresosOficiales != null &&
    oficial.gastosOficiales != null
  ) {
    netoOficial =
      Math.round(
        (oficial.ingresosOficiales + oficial.gastosOficiales) * 100
      ) / 100;
  }

  let ingresos: number;
  let gastos: number;
  let neto: number;
  let source: TotalsSource;

  if (reconciliation.matchCompleto && hasOficial) {
    // Cuadra: usar resumen oficial tal cual
    ingresos =
      oficial.ingresosOficiales != null
        ? oficial.ingresosOficiales
        : parseado.ingresos;
    gastos =
      oficial.gastosOficiales != null
        ? oficial.gastosOficiales
        : parseado.gastos;
    neto =
      netoOficial != null
        ? netoOficial
        : Math.round((ingresos + gastos) * 100) / 100;
    source = "oficial";
  } else if (hasOficial && netoOficial != null) {
    // NO cuadra: no inflar ingreso — solo ajustar gasto para cerrar el neto
    ingresos = parseado.ingresos;
    neto = netoOficial;
    gastos = Math.round((neto - ingresos) * 100) / 100;
    source = "oficial";
  } else {
    ingresos = parseado.ingresos;
    gastos = parseado.gastos;
    neto = parseado.neto;
    source = "parseado";
  }

  const summaryByCategory = summarizeByCategory(lines);

  // Solo meter en "revisar" el hueco de GASTOS (nunca inflar ingreso vía categorías)
  if (hasOficial && !reconciliation.matchCompleto) {
    const gapGas = Math.round((gastos - parseado.gastos) * 100) / 100;
    if (Math.abs(gapGas) > 0.009) {
      summaryByCategory.revisar =
        Math.round(((summaryByCategory.revisar || 0) + gapGas) * 100) / 100;
    }
  } else if (hasOficial && reconciliation.matchCompleto) {
    const gapGas = Math.round((gastos - parseado.gastos) * 100) / 100;
    const gapIng = Math.round((ingresos - parseado.ingresos) * 100) / 100;
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
      source,
      parseado,
    },
  };
}
