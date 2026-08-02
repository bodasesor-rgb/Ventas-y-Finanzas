export interface MetaTokenStore {
    access_token: string;
    page_id?: string;
    ig_user_id?: string;
    page_name?: string;
    ig_username?: string;
}
export interface SocialFollowers {
    facebookFollowers: number;
    instagramFollowers: number;
    pageId: string;
    pageName: string;
    igUserId: string | null;
    igUsername: string | null;
}
export declare function saveMetaTokenStore(raw: Partial<MetaTokenStore> & {
    access_token: string;
}): MetaTokenStore;
export declare function getMetaAccessToken(): string;
export declare function metaConfigured(): {
    ok: boolean;
    missing: string[];
};
export declare function metaStatus(): {
    configured: boolean;
    missing: string[];
    hasFile: boolean;
    pageId: string | null;
    igUserId: string | null;
    pageName: string | null;
    igUsername: string | null;
    envKeysPresent: string[];
};
/**
 * Descubre Page + IG Business desde el token (me/accounts).
 */
export declare function discoverMetaAccounts(token?: string): Promise<{
    pages: Array<{
        id: string;
        name: string;
        access_token?: string;
        followers_count?: number;
        ig?: {
            id: string;
            username?: string;
            followers_count?: number;
        };
    }>;
}>;
/** Lee seguidores actuales de FB Page + Instagram Business. */
export declare function fetchSocialFollowers(): Promise<SocialFollowers>;
