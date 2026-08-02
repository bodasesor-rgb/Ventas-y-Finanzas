import type { BankLine, RecurringRule } from "./types";
export declare function parsePdfToLines(buffer: Buffer, rules: RecurringRule[]): Promise<{
    text: string;
    lines: BankLine[];
}>;
/**
 * Quita del CONCEPTO todo lo que no es texto: folios, CLABE, refs, fechas, etc.
 * Por política: NUNCA un número del concepto puede entrar al monto.
 */
export declare function stripConceptNumbers(concept: string): string;
/**
 * Prepara la línea para leer SOLO columnas Retiros/Depósitos/Saldo.
 * - Saca POS/T.C.
 * - Separa letras↔dígitos del concepto
 * - Borra enteros del concepto (folios/CLABE/refs) — nunca tienen .centavos
 * - Despega montos de columna pegados (.xx pegado a otro monto)
 * No parte montos válidos con coma (100,500.00).
 */
export declare function unglueMoneyText(s: string): string;
export interface AmountColumns {
    /** Texto del concepto sin ningún dígito */
    concept: string;
    /** Retiro o Depósito impreso (una sola columna; la otra viene vacía) */
    printedMove: number | null;
    /** Saldo (última columna) */
    saldo: number | null;
}
/**
 * Banamex: FECHA | CONCEPTO | RETIROS | DEPÓSITOS | SALDO
 * En texto plano solo existen 1–2 montos al FINAL (retiro XOR depósito + saldo).
 * Cualquier número anterior es del concepto y se IGNORA por completo.
 */
export declare function extractAmountColumns(body: string): AmountColumns;
/**
 * Solo montos de columnas (trailing). No devuelve números del concepto.
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
