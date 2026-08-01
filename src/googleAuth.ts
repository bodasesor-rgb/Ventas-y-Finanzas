import fs from "fs";
import path from "path";
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

/** Archivo en disco — Hostinger a menudo trunca env vars largas. */
export const SA_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "google-service-account.json"
);

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
  const present = keys.filter((k) => Boolean(String(process.env[k] || "").trim()));
  if (fs.existsSync(SA_FILE_PATH)) present.push("FILE:data/google-service-account.json");
  return present;
}

function parseSaJson_(raw: string, label: string): ServiceAccountJson {
  const text = raw.trim();
  try {
    return JSON.parse(text) as ServiceAccountJson;
  } catch {
    try {
      return JSON.parse(
        Buffer.from(text, "base64").toString("utf8")
      ) as ServiceAccountJson;
    } catch {
      throw new Error(`${label} no es JSON válido (ni base64 JSON)`);
    }
  }
}

/** Lee JSON de service account: archivo en disco → env → path. */
export function loadServiceAccountJson(): ServiceAccountJson | null {
  // 1) Archivo local (más fiable en Hostinger)
  try {
    if (fs.existsSync(SA_FILE_PATH)) {
      return parseSaJson_(
        fs.readFileSync(SA_FILE_PATH, "utf8"),
        SA_FILE_PATH
      );
    }
  } catch (err) {
    console.warn(
      "[ga4] no se pudo leer",
      SA_FILE_PATH,
      err instanceof Error ? err.message : err
    );
  }

  for (const key of SA_ENV_KEYS_) {
    const inline = String(process.env[key] || "").trim();
    if (!inline) continue;
    if (
      (inline.startsWith("/") || inline.endsWith(".json")) &&
      !inline.startsWith("{")
    ) {
      if (fs.existsSync(inline)) {
        return parseSaJson_(fs.readFileSync(inline, "utf8"), inline);
      }
    }
    return parseSaJson_(inline, key);
  }
  const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credPath && fs.existsSync(credPath)) {
    return parseSaJson_(fs.readFileSync(credPath, "utf8"), credPath);
  }
  return null;
}

/**
 * Guarda el service account en data/ (evita límite de env en Hostinger).
 */
export function saveServiceAccountJson(
  raw: unknown
): { ok: true; client_email: string; path: string } {
  let sa: ServiceAccountJson;
  if (typeof raw === "string") {
    sa = parseSaJson_(raw, "body");
  } else if (raw && typeof raw === "object") {
    sa = raw as ServiceAccountJson;
  } else {
    throw new Error("Body debe ser el JSON del service account");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("JSON incompleto: faltan client_email o private_key");
  }
  // private_key a veces llega con \\n literales
  if (sa.private_key.includes("\\n") && !sa.private_key.includes("\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }
  fs.mkdirSync(path.dirname(SA_FILE_PATH), { recursive: true });
  fs.writeFileSync(SA_FILE_PATH, JSON.stringify(sa, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    ok: true,
    client_email: sa.client_email,
    path: "data/google-service-account.json",
  };
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
      "Falta service account: sube el JSON a POST /api/ventas/ga4-setup-sa o define GOOGLE_SERVICE_ACCOUNT_JSON"
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
