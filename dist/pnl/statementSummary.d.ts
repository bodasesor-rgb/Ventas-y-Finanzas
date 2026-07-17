/**
 * Lee el resumen Banamex del PDF:
 *   Depósitos / Retiros en efectivo / Otros cargos / Saldo…
 */
export interface StatementOfficialTotals {
    saldoAnterior: number | null;
    depositos: number | null;
    retirosEfectivo: number | null;
    otrosCargos: number | null;
    saldoCorte: number | null;
    /** Depósitos del estado */
    ingresosOficiales: number | null;
    /** Retiros + otros cargos del estado */
    gastosOficiales: number | null;
}
export interface Reconciliation {
    oficial: StatementOfficialTotals;
    parseado: {
        ingresos: number;
        gastos: number;
        neto: number;
    };
    diffIngresos: number | null;
    diffGastos: number | null;
    /** true si ambos lados cuadran (tolerancia $1) */
    matchIngresos: boolean;
    matchGastos: boolean;
    matchCompleto: boolean;
    tolerancia: number;
}
export declare function extractStatementOfficialTotals(text: string): StatementOfficialTotals;
export declare function reconcileTotals(oficial: StatementOfficialTotals, parseado: {
    ingresos: number;
    gastos: number;
    neto: number;
}, tolerancia?: number): Reconciliation;
