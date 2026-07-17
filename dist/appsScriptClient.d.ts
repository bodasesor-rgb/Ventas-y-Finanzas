export interface AppsScriptWriteResult {
    ok: boolean;
    version?: string;
    action?: "appended" | "updated";
    row?: number;
    dealId?: string;
    error?: string;
    raw?: string;
}
/**
 * Envía la fila al webhook de Google Apps Script.
 * El script en Sheets hace append o update por kommoDealId.
 */
export declare function writeFilaToAppsScript(dealId: string, values: string[], sheetName?: string): Promise<AppsScriptWriteResult>;
