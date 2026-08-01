import { GoogleAuth, JWT } from "google-auth-library";

export type ServiceAccountJson = {
  type?: string;
  client_email?: string;
  private_key?: string;
  project_id?: string;
  [k: string]: unknown;
};

const SA_ENV_KEYS_ = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GA4_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
] as const;

/** Nombres de env relacionados (sin valores) — para diagnosticar Hostinger. */
export function listGaEnvKeysPresent(): string[] {
  const keys = [
    ...SA_ENV_KEYS_,
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GA4_PROPERTY_ID",
    "GA4_MEASUREMENT_ID",
    "GOOGLE_SHEET_ID",
    "METRICAS_SHEET_NAME",
  ];
  return keys.filter((k) => Boolean(String(process.env[k] || "").trim()));
}

/** Lee JSON de service account desde env (string, base64 o path). */
export function loadServiceAccountJson(): ServiceAccountJson | null {
  for (const key of SA_ENV_KEYS_) {
    const inline = String(process.env[key] || "").trim();
    if (!inline) continue;
    // Path a archivo
    if (
      (inline.startsWith("/") || inline.endsWith(".json")) &&
      !inline.startsWith("{")
    ) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      if (fs.existsSync(inline)) {
        return JSON.parse(fs.readFileSync(inline, "utf8")) as ServiceAccountJson;
      }
    }
    try {
      return JSON.parse(inline) as ServiceAccountJson;
    } catch {
      try {
        return JSON.parse(
          Buffer.from(inline, "base64").toString("utf8")
        ) as ServiceAccountJson;
      } catch {
        throw new Error(
          `${key} no es JSON válido (ni base64 JSON ni ruta a .json)`
        );
      }
    }
  }
  const path = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (path) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    return JSON.parse(fs.readFileSync(path, "utf8")) as ServiceAccountJson;
  }
  return null;
}

export function hasGoogleCredentials(): boolean {
  try {
    return Boolean(loadServiceAccountJson());
  } catch {
    return false;
  }
}

/** Auth para GA4 Data API + Sheets. */
export async function getGoogleAuthClient(
  scopes: string[]
): Promise<JWT | GoogleAuth> {
  const sa = loadServiceAccountJson();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error(
      "Falta service account: define GOOGLE_SERVICE_ACCOUNT_JSON (JSON) o GOOGLE_APPLICATION_CREDENTIALS (ruta)"
    );
  }
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes,
  });
  await jwt.authorize();
  return jwt;
}

export function ga4PropertyId(): string {
  const raw = (process.env.GA4_PROPERTY_ID || "").trim();
  if (!raw) {
    throw new Error("Falta GA4_PROPERTY_ID (número de propiedad GA4)");
  }
  return raw.replace(/^properties\//, "");
}

export function metricasSheetId(): string {
  return (
    process.env.GOOGLE_SHEET_ID ||
    process.env.VENTAS_SHEET_ID ||
    "1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8"
  ).trim();
}

export function metricasSheetName(): string {
  return (
    process.env.METRICAS_SHEET_NAME ||
    `Metricas ${new Date().getUTCFullYear()} Auto`
  ).trim();
}
