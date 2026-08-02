export declare function syncMetricasSeguidores(opts?: {
    force?: boolean;
}): Promise<{
    ok: boolean;
    sheetName: string;
    weekStart?: string;
    col?: number;
    instagramFollowers?: number;
    facebookFollowers?: number;
    updatedCells: number;
    pageName?: string;
    igUsername?: string | null;
    skipped?: boolean;
    error?: string;
    hint?: string;
}>;
export declare function seguidoresStatus(): {
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
    sheetId: string;
    sheetName: string;
};
