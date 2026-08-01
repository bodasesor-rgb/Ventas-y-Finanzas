export interface DailySessions {
    /** YYYYMMDD */
    date: string;
    sessions: number;
}
export declare function blogPathContains(): string[];
export declare function coleccionesPathContains(): string[];
/**
 * Trae sesiones diarias para llenar Metricas:
 * - site: todas
 * - organic: Organic Search
 * - blogs: organic + path blog
 * - colecciones: organic + path colecciones
 */
export declare function fetchGa4VisitasDaily(opts: {
    startDate: string;
    endDate: string;
}): Promise<{
    site: DailySessions[];
    organic: DailySessions[];
    blogs: DailySessions[];
    colecciones: DailySessions[];
    propertyId: string;
}>;
export declare function ga4Configured(): {
    ok: boolean;
    missing: string[];
};
