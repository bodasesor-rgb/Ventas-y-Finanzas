import fs from "fs";
import path from "path";
import { postToAppsScript } from "./appsScriptClient";

/**
 * Backup durable de credenciales Hostinger.
 * Hostinger borra data/ en cada deploy; los PDFs ya se restauran desde Drive.
 * SA / Meta / Brevo deben vivir igual (Apps Script v32+).
 */

export type HostSecretKey =
  | "google-service-account"
  | "meta-token"
  | "brevo"
  | "google-ads";

const DATA_DIR = path.join(process.cwd(), "data");

const LOCAL_PATH: Record<HostSecretKey, string> = {
  "google-service-account": path.join(DATA_DIR, "google-service-account.json"),
  "meta-token": path.join(DATA_DIR, "meta-token.json"),
  brevo: path.join(DATA_DIR, "brevo.json"),
  "google-ads": path.join(DATA_DIR, "google-ads.json"),
};

export function localSecretPath(key: HostSecretKey): string {
  return LOCAL_PATH[key];
}

export async function archiveHostSecret(
  secretKey: HostSecretKey,
  json: unknown
): Promise<{ ok: true; fileId?: string } | { ok: false; error: string }> {
  try {
    const payload =
      typeof json === "string" ? json : JSON.stringify(json, null, 2);
    const result = await postToAppsScript({
      action: "saveHostSecret",
      secretKey,
      jsonBase64: Buffer.from(payload, "utf8").toString("base64"),
    });
    if (!result.ok) {
      return { ok: false, error: result.error || "saveHostSecret falló" };
    }
    return { ok: true, fileId: (result as { fileId?: string }).fileId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchHostSecret(
  secretKey: HostSecretKey
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const result = await postToAppsScript({
      action: "getHostSecret",
      secretKey,
    });
    if (!result.ok || !result.jsonBase64) {
      return {
        ok: false,
        error: result.error || `Sin backup Drive de ${secretKey}`,
      };
    }
    const text = Buffer.from(String(result.jsonBase64), "base64").toString(
      "utf8"
    );
    return { ok: true, json: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Escribe en data/ si falta el archivo (tras deploy). */
export async function restoreHostSecretIfMissing(
  secretKey: HostSecretKey
): Promise<"restored" | "present" | "missing" | "error"> {
  const dest = LOCAL_PATH[secretKey];
  if (fs.existsSync(dest)) return "present";
  const fetched = await fetchHostSecret(secretKey);
  if (!fetched.ok) {
    if (/no hay backup|Sin backup/i.test(fetched.error)) return "missing";
    console.warn(`[secrets] restore ${secretKey}:`, fetched.error);
    return "error";
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(fetched.json, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(`[secrets] restaurado ${secretKey} desde Drive → ${dest}`);
  return "restored";
}

let restoreOnce: Promise<Record<HostSecretKey, string>> | null = null;

/** Una vez por proceso Node: intenta recuperar SA/Meta/Brevo tras deploy. */
export function restoreHostSecretsOnBoot(): Promise<
  Record<HostSecretKey, string>
> {
  if (!restoreOnce) {
    restoreOnce = (async () => {
      const keys: HostSecretKey[] = [
        "google-service-account",
        "meta-token",
        "brevo",
        "google-ads",
      ];
      const out = {} as Record<HostSecretKey, string>;
      for (const key of keys) {
        out[key] = await restoreHostSecretIfMissing(key);
      }
      return out;
    })().catch((err) => {
      console.warn(
        "[secrets] restore on boot falló",
        err instanceof Error ? err.message : err
      );
      restoreOnce = null;
      return {
        "google-service-account": "error",
        "meta-token": "error",
        brevo: "error",
        "google-ads": "error",
      } as Record<HostSecretKey, string>;
    });
  }
  return restoreOnce;
}

/** Guarda local + intenta Drive (no bloquea si Apps Script aún no es v32). */
export async function persistHostSecret(
  secretKey: HostSecretKey,
  json: unknown
): Promise<{ localPath: string; driveOk: boolean; driveError?: string }> {
  const dest = LOCAL_PATH[secretKey];
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const text =
    typeof json === "string" ? json : JSON.stringify(json, null, 2);
  fs.writeFileSync(dest, text, { encoding: "utf8", mode: 0o600 });
  const archived = await archiveHostSecret(secretKey, JSON.parse(text));
  if (!archived.ok) {
    console.warn(
      `[secrets] Drive backup ${secretKey} falló (¿Apps Script v32?):`,
      archived.error
    );
    return { localPath: dest, driveOk: false, driveError: archived.error };
  }
  return { localPath: dest, driveOk: true };
}
