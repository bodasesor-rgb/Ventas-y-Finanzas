export interface StatementPeriod {
    /** YYYY-MM */
    key: string;
    year: number;
    month: number;
    /** ej. junio 2026 */
    label: string;
    /** ej. 2026-06_estado-cuenta.pdf */
    fileTitle: string;
}
/**
 * Detecta mes/año del estado Banamex u otros.
 * Ej: "PeríodoDel 1 al 30 de junio del 2026"
 *     "Fecha de corte … 30 de junio de 2026"
 */
export declare function detectPeriodFromText(text: string): StatementPeriod;
