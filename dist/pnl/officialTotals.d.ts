import { type Reconciliation, type StatementOfficialTotals } from "./statementSummary";
import type { BankLine } from "./types";
export type TotalsSource = "oficial" | "parseado";
export interface RunTotals {
    ingresos: number;
    gastos: number;
    neto: number;
    /** De dónde salieron ingresos/gastos principales */
    source: TotalsSource;
    /** Suma cruda de movimientos (para ver daños) */
    parseado: {
        ingresos: number;
        gastos: number;
        neto: number;
    };
}
/**
 * Lee el resumen SOLO de la portada / inicio del PDF
 * (antes de "Detalle de Operaciones"), que es donde Banamex
 * imprime Depósitos y Retiros/compras/comis./otros cargos.
 */
export declare function extractOfficialFromPreamble(text: string): StatementOfficialTotals;
/**
 * Totales a mostrar / enviar = montos generales del estado.
 * La suma de líneas queda en totals.parseado para localizar daños.
 */
export declare function buildOfficialAwareTotals(lines: BankLine[], textOrOficial: string | StatementOfficialTotals): {
    totals: RunTotals;
    summaryByCategory: Record<string, number>;
    reconciliation: Reconciliation;
    oficial: StatementOfficialTotals;
};
