import type { BankLine, RecurringRule } from "./types";
/**
 * Extrae texto del PDF y arma líneas con fecha/monto.
 * Incluye heurísticas para estados Citibanamex / Banamex.
 */
export declare function parsePdfToLines(buffer: Buffer, rules: RecurringRule[]): Promise<{
    text: string;
    lines: BankLine[];
}>;
export declare function extractLinesFromText(text: string, rules: RecurringRule[]): BankLine[];
export declare function summarizeByCategory(lines: BankLine[]): Record<string, number>;
