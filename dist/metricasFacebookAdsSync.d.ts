export declare function syncMetricasFacebookAds(opts?: {
    force?: boolean;
    lookbackDays?: number;
}): Promise<{
    ok: boolean;
    sheetName: string;
    adAccountId?: string;
    adAccountName?: string;
    updatedCells: number;
    weeks: Array<{
        weekStart: string;
        inversion: number;
        conversion: number;
        cpl: number;
        cpc: number;
        clics: number;
        alcance: number;
        cpm: number;
    }>;
    conversionActionType?: string | null;
    skipped?: boolean;
    error?: string;
    hint?: string;
}>;
export declare function facebookAdsProbe(): Promise<{
    ok: boolean;
    account: import("./metaAdsClient").MetaAdAccount;
    status: {
        meta: {
            configured: boolean;
            missing: string[];
            hasFile: boolean;
            pageId: string | null;
            igUserId: string | null;
            pageName: string | null;
            igUsername: string | null;
            envKeysPresent: string[];
        };
        configured: boolean;
        adAccountId: string | null;
        envKeysPresent: string[];
    };
}>;
export declare function facebookAdsSyncStatus(): {
    sheetId: string;
    sheetName: string;
    meta: {
        configured: boolean;
        missing: string[];
        hasFile: boolean;
        pageId: string | null;
        igUserId: string | null;
        pageName: string | null;
        igUsername: string | null;
        envKeysPresent: string[];
    };
    configured: boolean;
    adAccountId: string | null;
    envKeysPresent: string[];
};
