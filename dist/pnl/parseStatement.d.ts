import type { BankLine, RecurringRule } from "./types";
export declare function parsePdfToLines(buffer: Buffer, rules: RecurringRule[]): Promise<{
    text: string;
    lines: BankLine[];
}>;
/**
 * Extrae movimiento + saldo.
 * Prioridad: cola USD/T.C. → par final de montos MXN.
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
