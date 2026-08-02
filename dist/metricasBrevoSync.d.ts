import { brevoStatus } from "./brevoClient";
export declare function syncMetricasBrevo(opts?: {
    force?: boolean;
    lookbackDays?: number;
}): Promise<{
    ok: boolean;
    sheetName: string;
    updatedCells: number;
    weeks: Array<{
        weekStart: string;
        contactos: number;
        correosMandados: number;
        aperturas: number;
        clicks: number;
        ctr: number;
        campaigns: number;
    }>;
    skipped?: boolean;
    error?: string;
    hint?: string;
    status?: ReturnType<typeof brevoStatus>;
}>;
export declare function brevoProbe(): Promise<{
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
export declare function brevoSyncStatus(): {
    sheetId: string;
    sheetName: string;
    configured: boolean;
    missing: string[];
    hasFile: boolean;
    envKeysPresent: string[];
};
