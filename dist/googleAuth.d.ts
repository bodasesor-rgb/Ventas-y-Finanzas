import { GoogleAuth, JWT } from "google-auth-library";
export type ServiceAccountJson = {
    type?: string;
    client_email?: string;
    private_key?: string;
    project_id?: string;
    [k: string]: unknown;
};
/** Nombres de env relacionados (sin valores) — para diagnosticar Hostinger. */
export declare function listGaEnvKeysPresent(): string[];
/** Lee JSON de service account desde env (string, base64 o path). */
export declare function loadServiceAccountJson(): ServiceAccountJson | null;
export declare function hasGoogleCredentials(): boolean;
/** Auth para GA4 Data API + Sheets. */
export declare function getGoogleAuthClient(scopes: string[]): Promise<JWT | GoogleAuth>;
export declare function ga4PropertyId(): string;
export declare function metricasSheetId(): string;
export declare function metricasSheetName(): string;
