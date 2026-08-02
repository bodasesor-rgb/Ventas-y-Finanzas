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
        source?: "oficial" | "parseado";
        parseado?: {
            ingresos: number;
            gastos: number;
            neto: number;
        };
    };
    reconciliation: Reconciliation;
    autoReview: AutoReviewReport;
    /** true si la suma de movimientos ya cuadra con el resumen oficial */
    verified: boolean;
}
/** Identidad: Saldo anterior + depósitos + gastos ≈ saldo al corte */
export declare function officialSaldoConsistent(o: StatementOfficialTotals, tol?: number): boolean;
/**
 * Totales oficiales del inicio del estado; si no cuadran con saldos,
 * prueba candidatos solo dentro de la portada (antes del detalle).
 */
export declare function refineOfficialTotals(text: string): StatementOfficialTotals;
/**
 * Motor principal: verificar lectura y corregir antes de aceptar números.
 */
export declare function verifyStatementParse(text: string, rules: RecurringRule[], options?: VerifyOptions): VerifyResult;
