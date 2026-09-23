export interface KommoTokenStore {
    access_token: string;
    base_url?: string;
    savedAt?: string;
}
export declare function saveKommoTokenStore(raw: Partial<KommoTokenStore> & {
    access_token: string;
}): KommoTokenStore;
/** Archivo primero: Hostinger trunca tokens largos en env. */
export declare function getKommoAccessToken(): string;
export declare function getKommoBaseUrl(): string;
export declare function hasKommoCredentials(): boolean;
export declare function kommoCredentialsSource(): {
    hasToken: boolean;
    hasBase: boolean;
    tokenFrom: "file" | "env" | "none";
};
