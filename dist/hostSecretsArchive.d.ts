/**
 * Backup durable de credenciales Hostinger.
 * Hostinger borra data/ en cada deploy; los PDFs ya se restauran desde Drive.
 * SA / Meta / Brevo deben vivir igual (Apps Script v32+).
 */
export type HostSecretKey = "google-service-account" | "meta-token" | "brevo" | "google-ads" | "kommo-token";
export declare function localSecretPath(key: HostSecretKey): string;
export declare function archiveHostSecret(secretKey: HostSecretKey, json: unknown): Promise<{
    ok: true;
    fileId?: string;
} | {
    ok: false;
    error: string;
}>;
export declare function fetchHostSecret(secretKey: HostSecretKey): Promise<{
    ok: true;
    json: unknown;
} | {
    ok: false;
    error: string;
}>;
/** Escribe en data/ si falta el archivo (tras deploy). */
export declare function restoreHostSecretIfMissing(secretKey: HostSecretKey): Promise<"restored" | "present" | "missing" | "error">;
/** Tras deploy: recupera SA/Meta/Brevo/Ads desde Drive si falta el archivo. */
export declare function restoreHostSecretsOnBoot(): Promise<Record<HostSecretKey, string>>;
/** Guarda local + intenta Drive (no bloquea si Apps Script aún no es v32). */
export declare function persistHostSecret(secretKey: HostSecretKey, json: unknown): Promise<{
    localPath: string;
    driveOk: boolean;
    driveError?: string;
}>;
