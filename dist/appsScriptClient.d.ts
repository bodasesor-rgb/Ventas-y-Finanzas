export interface AppsScriptWriteResult {
    ok: boolean;
    version?: string;
    action?: "appended" | "updated" | "moved" | string;
    row?: number;
    dealId?: string;
    sheetName?: string;
    error?: string;
    raw?: string;
}
export declare function getAppsScriptUrl(): string;
/**
 * POST genérico al Apps Script /exec (Eventos, Banco, etc.).
 */
export declare function postToAppsScript(payload: Record<string, unknown>): Promise<AppsScriptWriteResult>;
/**
 * Envía la fila al webhook de Google Apps Script (Eventos).
 */
export declare function writeFilaToAppsScript(dealId: string, values: string[], sheetName?: string): Promise<AppsScriptWriteResult>;
