import type { BankLine, RecurringRule } from "./types";
/**
 * Extrae texto del PDF y arma líneas con fecha/monto heurísticos.
 * Determinista: regex + reglas, sin IA.
 */
export declare function parsePdfToLines(buffer: Buffer, rules: RecurringRule[]): Promise<{
    text: string;
    lines: BankLine[];
}>;
export declare function summarizeByCategory(lines: BankLine[]): Record<string, number>;
