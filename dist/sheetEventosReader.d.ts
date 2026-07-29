export interface EventosSheetIndex {
    /** fingerprint → dealId (o "" si no hay) */
    byFingerprint: Record<string, string>;
    /** dealId → row number (1-based en Sheet, con header) */
    byDealId: Record<string, number>;
    fetchedAt: number;
    rowCount: number;
}
/**
 * Lee Eventos YYYY del Sheet (CSV público) y arma índice anti-duplicados.
 */
export declare function loadEventosSheetIndex(year?: number, force?: boolean): Promise<EventosSheetIndex>;
/** Busca en el Sheet real si ya existe la misma huella con otro deal. */
export declare function findDuplicateInSheet(fingerprint: string, dealId: string, year?: number): Promise<{
    dealId: string;
    row?: number;
} | null>;
