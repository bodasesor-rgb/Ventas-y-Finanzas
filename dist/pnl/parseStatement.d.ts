import type { BankLine, RecurringRule } from "./types";
export declare function parsePdfToLines(buffer: Buffer, rules: RecurringRule[]): Promise<{
    text: string;
    lines: BankLine[];
}>;
/**
 * Separa montos Banamex pegados y quita basura de folios/POS/T.C.
 * Casos típicos:
 *   500.003,169.72      → 500.00 + 3,169.72
 *   400.00785,432.10    → 400.00 + 785,432.10
 *   9000/00126,000.00   → 6,000.00
 */
export declare function unglueMoneyText(s: string): string;
/**
 * Extrae montos; soporta saldo negativo Banamex escrito como "329.95-".
 * Orden: quitar T.C./POS → separar montos pegados → aplicar signo −.
 */
export declare function collectMoney(s: string): number[];
/**
 * Variantes típicas por puntos/comas o dígitos de folio pegados.
 * Sirve para revisión automática de descuadres grandes.
 */
export declare function moneyTypoVariants(amount: number): {
    value: number;
    label: string;
}[];
/**
 * Extrae movimiento + saldo (legado / debug).
 * El parser principal usa cadena de saldos.
 */
export declare function extractMoveAndSaldo(body: string): {
    move: number;
    saldo: number | null;
    suspicious: boolean;
} | null;
export declare function detectDirection(desc: string): BankLine["direction"];
/** Cómo calcular el monto de cada movimiento Banamex. */
export type AmountStrategy = "delta" | "printed" | "hybrid" | "rebased";
export interface ParseOptions {
    amountStrategy?: AmountStrategy;
}
export declare function extractLinesFromText(text: string, rules: RecurringRule[], options?: ParseOptions): BankLine[];
export declare function summarizeByCategory(lines: BankLine[]): Record<string, number>;
export declare function summarizeTotals(lines: BankLine[]): {
    ingresos: number;
    gastos: number;
    neto: number;
};
