import { buildYearAnalysis } from "./providerAnalysis";
import type { StatementRun } from "./types";
export declare function sendRunToBancoSheet(run: StatementRun): Promise<{
    sheetName: string;
    erSheet?: string;
    erMonthCol?: string;
    erExists?: boolean;
    spreadsheetId?: string;
    spreadsheetName?: string;
    spreadsheetUrl?: string;
    existingSheets?: string[];
    row?: number;
    action?: string;
    version?: string;
    message?: string;
}>;
/** Escribe pestaña Análisis YYYY con ranking proveedores + mensual/anual. */
export declare function sendYearAnalysisToSheet(year?: number): Promise<{
    sheetName: string;
    version?: string;
    analysis: ReturnType<typeof buildYearAnalysis>;
}>;
