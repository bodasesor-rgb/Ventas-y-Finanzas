import { ga4Configured } from "./ga4Client";
export interface WeekVisitas {
    weekStart: string;
    weekStartIso: string;
    col: number;
    site: number;
    organic: number;
    blogs: number;
    colecciones: number;
    /** celdas que ya tenían valor y no se tocan (salvo force) */
    alreadyFilled: boolean;
}
/**
 * Sincroniza visitas GA4 → Metricas Auto (semanas vacías por defecto).
 */
export declare function syncMetricasVisitas(opts?: {
    force?: boolean;
    /** días atrás para pedir a GA4 (default 120) */
    lookbackDays?: number;
    /** si true, rellena aunque la celda ya tenga número */
    overwrite?: boolean;
}): Promise<{
    ok: boolean;
    propertyId?: string;
    sheetName: string;
    weeksConsidered: number;
    weeksWritten: number;
    updatedCells: number;
    method?: string;
    weeks: WeekVisitas[];
    error?: string;
    hint?: string;
}>;
export declare function metricasVisitasStatus(): {
    ga4: ReturnType<typeof ga4Configured>;
    sheetId: string;
    sheetName: string;
    serviceAccountEmail: string | null;
    envKeysPresent: string[];
    hint?: string;
};
