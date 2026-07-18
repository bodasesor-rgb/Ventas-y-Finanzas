import type { StatementPeriod } from "./period";
export declare const STATEMENTS_ROOT: string;
export declare function ensureStatementsRoot(): void;
/**
 * Guarda el PDF como data/statements/YYYY-MM/YYYY-MM_estado-cuenta.pdf
 * Un solo archivo por mes: sobrescribe y borra variantes _2, _3…
 */
export declare function saveStatementPdf(tempPath: string, period: StatementPeriod): {
    storedPath: string;
    storedName: string;
    relativePath: string;
};
export declare function resolveStatementFile(relativePath: string): string | null;
/** Borra PDF local del mes (archivo y carpeta si queda vacía). */
export declare function deleteStatementPdf(periodKey?: string, relativePath?: string): void;
