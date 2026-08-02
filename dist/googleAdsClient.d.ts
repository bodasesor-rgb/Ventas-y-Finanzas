export type GoogleAdsCredentials = {
    developer_token: string;
    client_id?: string;
    client_secret?: string;
    refresh_token?: string;
    customer_id: string;
    login_customer_id?: string;
    /** Si true, intenta JWT del service account (requiere SA como usuario Ads + Workspace/MCC). */
    use_service_account?: boolean;
};
export type WeekGoogleAdsMetrics = {
    since: string;
    until: string;
    inversion: number;
    conversion: number;
    cpl: number;
    cpc: number;
    clics: number;
    source: "google_ads_api" | "ga4";
};
/** Carga credenciales: archivo → env GOOGLE_ADS (JSON) → vars sueltas. */
export declare function loadGoogleAdsCredentials(): GoogleAdsCredentials | null;
export declare function saveGoogleAdsCredentials(raw: Partial<GoogleAdsCredentials>): GoogleAdsCredentials;
export declare function googleAdsApiConfigured(): {
    ok: boolean;
    missing: string[];
};
/** GA4 con Ads vinculado basta para Inversión/Clics/CPC. */
export declare function googleAdsGa4Configured(): boolean;
export declare function listGoogleAdsEnvKeysPresent(): string[];
export declare function googleAdsStatus(): {
    apiConfigured: boolean;
    apiMissing: string[];
    ga4FallbackConfigured: boolean;
    canSync: boolean;
    customerId: string | null;
    hasRefreshToken: boolean;
    useServiceAccount: boolean;
    envKeysPresent: string[];
};
/** Insights diarios vía Google Ads API, agregados por semana. */
export declare function fetchGoogleAdsApiDaily(opts: {
    since: string;
    until: string;
}): Promise<Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
}>>;
export declare function probeGoogleAdsApi(): Promise<{
    ok: boolean;
    customerId?: string;
    sample?: unknown;
    error?: string;
}>;
/**
 * Fallback: costo/clics desde GA4 (Google Ads vinculado).
 * Conversiones: regla de negocio Bodasesor = 10% de los clics
 * (no hay Google Ads API; el histórico del Sheet coincide ~10%).
 */
export declare function fetchGoogleAdsGa4Daily(opts: {
    since: string;
    until: string;
}): Promise<Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
}>>;
export declare function aggregateWeekMetrics_(daily: Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
}>, since: string, until: string, source: "google_ads_api" | "ga4"): WeekGoogleAdsMetrics;
