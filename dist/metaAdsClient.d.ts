export interface MetaAdAccount {
    id: string;
    accountId: string;
    name: string;
    currency?: string;
    accountStatus?: number;
}
export interface WeekAdsMetrics {
    since: string;
    until: string;
    inversion: number;
    conversion: number;
    cpl: number;
    cpc: number;
    clics: number;
    alcance: number;
    cpm: number;
    conversionActionType: string | null;
}
export declare function getConfiguredAdAccountId(): string;
export declare function listMetaAdAccounts(token?: string): Promise<MetaAdAccount[]>;
/** Resuelve cuenta publicitaria (env / archivo / primera de me/adaccounts). */
export declare function resolveAdAccount(token?: string): Promise<MetaAdAccount>;
/** Insights de cuenta para un rango (inclusive until). */
export declare function fetchAdAccountInsightsWeek(actId: string, since: string, until: string, token?: string): Promise<WeekAdsMetrics>;
export declare function fetchAdsMetricsForWeeks(weeks: Array<{
    since: string;
    until: string;
}>, opts?: {
    adAccountId?: string;
}): Promise<{
    account: MetaAdAccount;
    weeks: WeekAdsMetrics[];
}>;
export declare function metaAdsStatus(): {
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
