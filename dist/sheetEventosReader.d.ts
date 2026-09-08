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
export interface EventoSheetRow {
    row: number;
    dealId: string;
    cliente: string;
    fechaDelEvento: string;
    tipoDeEvento: string;
    invitados: string;
    direccionDeEvento: string;
    horario: string;
}
/** Datos del evento tal como están en el Sheet (donde se corrigen a mano). */
export declare function findEventoInSheet(dealId: string, year?: number): Promise<EventoSheetRow | null>;
/**
 * Filas con fecha de evento de hoy en adelante. Es la fuente correcta para
 * los recordatorios: Kommo ordena mal los cierres y muchas fechas solo
 * existen en el Sheet.
 */
export declare function loadEventosProximos(year?: number): Promise<EventoSheetRow[]>;
/** Busca en el Sheet real si ya existe la misma huella con otro deal. */
export declare function findDuplicateInSheet(fingerprint: string, dealId: string, year?: number): Promise<{
    dealId: string;
    row?: number;
} | null>;
/** ¿Este Kommo Deal ID ya tiene fila en Eventos? */
export declare function findDealRowInSheet(dealId: string, year?: number): Promise<number | null>;
