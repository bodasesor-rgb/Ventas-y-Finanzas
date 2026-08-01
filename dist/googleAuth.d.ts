import { GoogleAuth, JWT } from "google-auth-library";
export type ServiceAccountJson = {
    type?: string;
    client_email?: string;
    private_key?: string;
    project_id?: string;
    [k: string]: unknown;
};
/** Archivo en disco — Hostinger a menudo trunca env vars largas. */
export declare const SA_FILE_PATH: string;
/** Nombres de env relacionados (sin valores) — para diagnosticar Hostinger. */
export declare function listGaEnvKeysPresent(): string[];
/** Lee JSON de service account: archivo en disco → env → path. */
export declare function loadServiceAccountJson(): ServiceAccountJson | null;
/**
 * Guarda el service account en data/ (evita límite de env en Hostinger).
 */
export declare function saveServiceAccountJson(raw: unknown): {
    ok: true;
    client_email: string;
    path: string;
};
export declare function hasGoogleCredentials(): boolean;
/** Auth para GA4 Data API + Sheets. */
export declare function getGoogleAuthClient(scopes: string[]): Promise<JWT | GoogleAuth>;
export declare function ga4PropertyId(): string;
export declare function metricasSheetId(): string;
export declare function metricasSheetName(): string;
