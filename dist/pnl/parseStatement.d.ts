import type { BankLine, RecurringRule } from "./types";
export declare function parsePdfToLines(buffer: Buffer, rules: RecurringRule[]): Promise<{
    text: string;
    lines: BankLine[];
}>;
/**
 * Extrae montos; soporta saldo negativo Banamex escrito como "329.95-".
 * Orden: quitar T.C./POS → separar montos pegados → aplicar signo −.
 */
export declare function collectMoney(s: string): number[];
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
export declare function extractLinesFromText(text: string, rules: RecurringRule[]): BankLine[];
export declare function summarizeByCategory(lines: BankLine[]): Record<string, number>;
export declare function summarizeTotals(lines: BankLine[]): {
    ingresos: number;
    gastos: number;
    neto: number;
};
