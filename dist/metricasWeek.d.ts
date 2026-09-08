/**
 * Semana en curso, o la que cerró en los últimos 7 días.
 * Esas hay que reescribir: si no, el primer fill parcial se congela.
 */
export declare function weekIsLive_(weekStartMs: number, todayUtc: number): boolean;
export declare function shouldWriteWeekCell_(opts: {
    weekStartMs: number;
    todayUtc: number;
    empty: boolean;
    force?: boolean;
}): boolean;
