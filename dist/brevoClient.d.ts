export type BrevoStore = {
    api_key: string;
    updated_at?: string;
};
export type BrevoWeekStats = {
    since: string;
    until: string;
    contactos: number;
    correosMandados: number;
    aperturas: number;
    clicks: number;
    ctr: number;
    campaigns: number;
};
export declare function getBrevoApiKey(): string;
export declare function saveBrevoApiKey(apiKey: string): BrevoStore;
export declare function brevoConfigured(): {
    ok: boolean;
    missing: string[];
};
export declare function brevoStatus(): {
    configured: boolean;
    missing: string[];
    hasFile: boolean;
    envKeysPresent: string[];
};
export declare function fetchBrevoAccount(): Promise<{
    email?: string;
    companyName?: string;
    plan?: unknown;
}>;
export declare function fetchBrevoContactsCount(): Promise<number>;
type CampaignStats = {
    sent?: number;
    delivered?: number;
    uniqueViews?: number;
    viewed?: number;
    uniqueClicks?: number;
    clickers?: number;
    trackableViews?: number;
};
type Campaign = {
    id?: number;
    name?: string;
    status?: string;
    sentDate?: string;
    statistics?: {
        globalStats?: CampaignStats;
    };
};
/** Campañas enviadas en rango (por sentDate). */
export declare function fetchBrevoSentCampaigns(opts: {
    startDate: string;
    endDate: string;
}): Promise<Campaign[]>;
/**
 * SMTP / transactional aggregated (opcional, suma a correos si hay volumen).
 * GET /smtp/statistics/aggregatedReport
 */
export declare function fetchBrevoSmtpAggregated(opts: {
    startDate: string;
    endDate: string;
}): Promise<{
    requests?: number;
    delivered?: number;
    opens?: number;
    clicks?: number;
    uniqueOpens?: number;
    uniqueClicks?: number;
}>;
/** Agrega stats de campañas (+ SMTP) por semana. */
export declare function fetchBrevoWeekStats(weeks: Array<{
    since: string;
    until: string;
}>, opts?: {
    includeSmtp?: boolean;
}): Promise<BrevoWeekStats[]>;
export declare function probeBrevo(): Promise<{
    ok: boolean;
    status: {
        configured: boolean;
        missing: string[];
        hasFile: boolean;
        envKeysPresent: string[];
    };
    error: string;
    account?: undefined;
    contactos?: undefined;
} | {
    ok: boolean;
    status: {
        configured: boolean;
        missing: string[];
        hasFile: boolean;
        envKeysPresent: string[];
    };
    account: {
        email: string | undefined;
        companyName: string | undefined;
    };
    contactos: number;
    error?: undefined;
}>;
export {};
