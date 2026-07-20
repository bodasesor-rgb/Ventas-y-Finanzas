export interface AppsScriptWriteResult {
    ok: boolean;
    version?: string;
    action?: "appended" | "updated" | "moved" | string;
    row?: number;
    dealId?: string;
    sheetName?: string;
    erSheet?: string;
    erMonthCol?: string;
    erExists?: boolean;
    pnlSheet?: string;
    pnlMonthCol?: string;
    spreadsheetId?: string;
    spreadsheetName?: string;
    spreadsheetUrl?: string;
    existingSheets?: string[];
    message?: string;
    error?: string;
    raw?: string;
    /** Archive / Drive */
    pdfFileId?: string;
    runFileId?: string;
    pdfUrl?: string;
    periodKey?: string;
    items?: unknown[];
    count?: number;
    pdfBase64?: string;
    run?: unknown;
    storedName?: string;
    periodLabel?: string;
}
export declare function getAppsScriptUrl(): string;
/**
 * POST genérico al Apps Script /exec (Eventos, Banco, etc.).
 */
export declare function postToAppsScript(payload: Record<string, unknown>, opts?: {
    timeoutMs?: number;
}): Promise<AppsScriptWriteResult>;
/**
 * Envía la fila al webhook de Google Apps Script (Eventos).
 */
export declare function writeFilaToAppsScript(dealId: string, values: string[], sheetName?: string): Promise<AppsScriptWriteResult>;
