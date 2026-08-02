import { googleAdsStatus } from "./googleAdsClient";
export declare function syncMetricasGoogleAds(opts?: {
    force?: boolean;
    lookbackDays?: number;
    /** Fuerza fallback GA4 aunque exista API */
    preferGa4?: boolean;
}): Promise<{
    ok: boolean;
    sheetName: string;
    source?: "google_ads_api" | "ga4";
    updatedCells: number;
    weeks: Array<{
        weekStart: string;
        inversion: number;
        conversion: number;
        cpl: number;
        cpc: number;
        clics: number;
    }>;
    skipped?: boolean;
    warning?: string;
    error?: string;
    hint?: string;
    status?: ReturnType<typeof googleAdsStatus>;
}>;
export declare function googleAdsProbe(): Promise<{
    ok: boolean;
    status: {
        apiConfigured: boolean;
        apiMissing: string[];
        ga4FallbackConfigured: boolean;
        canSync: boolean;
        customerId: string | null;
        hasRefreshToken: boolean;
        useServiceAccount: boolean;
        envKeysPresent: string[];
    };
    api: {
        ok: boolean;
        customerId?: string;
        sample?: unknown;
        error?: string;
    } | null;
}>;
export declare function googleAdsSyncStatus(): {
    sheetId: string;
    sheetName: string;
    apiConfigured: boolean;
    apiMissing: string[];
    ga4FallbackConfigured: boolean;
    canSync: boolean;
    customerId: string | null;
    hasRefreshToken: boolean;
    useServiceAccount: boolean;
    envKeysPresent: string[];
};
