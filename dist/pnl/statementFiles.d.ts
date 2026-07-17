import type { StatementPeriod } from "./period";
export declare const STATEMENTS_ROOT: string;
export declare function ensureStatementsRoot(): void;
/**
 * Guarda el PDF en data/statements/YYYY-MM/YYYY-MM_estado-cuenta.pdf
 * Si ya existe, agrega sufijo _2, _3…
 */
export declare function saveStatementPdf(tempPath: string, period: StatementPeriod): {
    storedPath: string;
    storedName: string;
    relativePath: string;
};
export declare function resolveStatementFile(relativePath: string): string | null;
