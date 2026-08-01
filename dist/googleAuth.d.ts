import { GoogleAuth, JWT } from "google-auth-library";
export type ServiceAccountJson = {
    type?: string;
    client_email?: string;
    private_key?: string;
    project_id?: string;
    [k: string]: unknown;
};
/** Lee JSON de service account desde env (string o path). */
export declare function loadServiceAccountJson(): ServiceAccountJson | null;
export declare function hasGoogleCredentials(): boolean;
/** Auth para GA4 Data API + Sheets. */
export declare function getGoogleAuthClient(scopes: string[]): Promise<JWT | GoogleAuth>;
export declare function ga4PropertyId(): string;
export declare function metricasSheetId(): string;
export declare function metricasSheetName(): string;
