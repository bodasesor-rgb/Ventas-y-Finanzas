import { type Reconciliation, type StatementOfficialTotals } from "./statementSummary";
import type { AutoReviewReport, BankLine, RecurringRule } from "./types";
export interface VerifyOptions {
    /** Si true, al final añade ajustes para cuadrar sí o sí */
    forceSolve?: boolean;
}
export interface VerifyResult {
    lines: BankLine[];
    summaryByCategory: Record<string, number>;
    totals: {
        ingresos: number;
        gastos: number;
        neto: number;
    };
    reconciliation: Reconciliation;
    autoReview: AutoReviewReport;
    /** true si ya cuadró en la verificación (sin botón) */
    verified: boolean;
}
/** Identidad: Saldo anterior + depósitos + gastos ≈ saldo al corte */
export declare function officialSaldoConsistent(o: StatementOfficialTotals, tol?: number): boolean;
/**
 * Si el resumen no cuadra con saldos, prueba totales alternos del texto
 * (a veces "Otros cargos" del detalle pisa el del resumen).
 */
export declare function refineOfficialTotals(text: string): StatementOfficialTotals;
/**
 * Motor principal: verificar lectura y corregir antes de aceptar números.
 */
export declare function verifyStatementParse(text: string, rules: RecurringRule[], options?: VerifyOptions): VerifyResult;
