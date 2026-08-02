import fs from "fs";
import path from "path";
import { OAuth2Client, JWT } from "google-auth-library";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import {
  ga4PropertyId,
  loadServiceAccountJson,
} from "./googleAuth";

const ADS_FILE = path.join(process.cwd(), "data", "google-ads.json");
/** REST version — bump when Google deprecates. */
/** Probar v20→v17 si Google depreca una. */
const ADS_API_VERSIONS = ["v21", "v20", "v19", "v18"];

export type GoogleAdsCredentials = {
  developer_token: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  customer_id: string;
  login_customer_id?: string;
  /** Si true, intenta JWT del service account (requiere SA como usuario Ads + Workspace/MCC). */
  use_service_account?: boolean;
};

export type WeekGoogleAdsMetrics = {
  since: string;
  until: string;
  inversion: number;
  conversion: number;
  cpl: number;
  cpc: number;
  clics: number;
  source: "google_ads_api" | "ga4";
};

function readCredFile_(): GoogleAdsCredentials | null {
  try {
    if (!fs.existsSync(ADS_FILE)) return null;
    return JSON.parse(fs.readFileSync(ADS_FILE, "utf8")) as GoogleAdsCredentials;
  } catch {
    return null;
  }
}

function normalizeCustomerId_(raw: string): string {
  return String(raw || "").replace(/-/g, "").trim();
}

/** Carga credenciales: archivo → env GOOGLE_ADS (JSON) → vars sueltas. */
export function loadGoogleAdsCredentials(): GoogleAdsCredentials | null {
  const fromFile = readCredFile_();
  if (fromFile?.developer_token && fromFile?.customer_id) return fromFile;

  const blob = String(process.env.GOOGLE_ADS || "").trim();
  if (blob) {
    try {
      const j = JSON.parse(blob) as GoogleAdsCredentials;
      if (j.developer_token && j.customer_id) return j;
    } catch {
      // ignore
    }
  }

  const developer_token = String(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ""
  ).trim();
  const customer_id = String(
    process.env.GOOGLE_ADS_CUSTOMER_ID || process.env.GOOGLE_ADS_CLIENT_CUSTOMER_ID || ""
  ).trim();
  const client_id = String(process.env.GOOGLE_ADS_CLIENT_ID || "").trim();
  const client_secret = String(process.env.GOOGLE_ADS_CLIENT_SECRET || "").trim();
  const refresh_token = String(process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
  const login_customer_id = String(
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || ""
  ).trim();
  const use_sa =
    String(process.env.GOOGLE_ADS_USE_SERVICE_ACCOUNT || "").trim() === "1";

  if (developer_token && customer_id) {
    return {
      developer_token,
      customer_id,
      client_id: client_id || undefined,
      client_secret: client_secret || undefined,
      refresh_token: refresh_token || undefined,
      login_customer_id: login_customer_id || undefined,
      use_service_account: use_sa || (!refresh_token && !client_id),
    };
  }
  return null;
}

export function saveGoogleAdsCredentials(
  raw: Partial<GoogleAdsCredentials>
): GoogleAdsCredentials {
  const prev = readCredFile_() || ({} as GoogleAdsCredentials);
  const next: GoogleAdsCredentials = {
    developer_token: String(
      raw.developer_token || prev.developer_token || ""
    ).trim(),
    customer_id: normalizeCustomerId_(
      String(raw.customer_id || prev.customer_id || "")
    ),
    client_id: String(raw.client_id || prev.client_id || "").trim() || undefined,
    client_secret:
      String(raw.client_secret || prev.client_secret || "").trim() || undefined,
    refresh_token:
      String(raw.refresh_token || prev.refresh_token || "").trim() || undefined,
    login_customer_id:
      normalizeCustomerId_(
        String(raw.login_customer_id || prev.login_customer_id || "")
      ) || undefined,
    use_service_account:
      raw.use_service_account ?? prev.use_service_account ?? false,
  };
  if (!next.developer_token || !next.customer_id) {
    throw new Error("Faltan developer_token y customer_id");
  }
  fs.mkdirSync(path.dirname(ADS_FILE), { recursive: true });
  fs.writeFileSync(ADS_FILE, JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return next;
}

export function googleAdsApiConfigured(): { ok: boolean; missing: string[] } {
  const c = loadGoogleAdsCredentials();
  const missing: string[] = [];
  if (!c?.developer_token) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!c?.customer_id) missing.push("GOOGLE_ADS_CUSTOMER_ID");
  if (c) {
    const hasOauth = Boolean(
      c.refresh_token && c.client_id && c.client_secret
    );
    const hasSa =
      Boolean(c.use_service_account) || Boolean(loadServiceAccountJson());
    if (!hasOauth && !hasSa) {
      missing.push(
        "GOOGLE_ADS_REFRESH_TOKEN (+ CLIENT_ID/SECRET) o service account"
      );
    }
  }
  return { ok: missing.length === 0 && Boolean(c), missing };
}

/** GA4 con Ads vinculado basta para Inversión/Clics/CPC. */
export function googleAdsGa4Configured(): boolean {
  try {
    return Boolean(loadServiceAccountJson() && ga4PropertyId());
  } catch {
    return false;
  }
}

export function listGoogleAdsEnvKeysPresent(): string[] {
  const keys = [
    "GOOGLE_ADS",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
    "GOOGLE_ADS_CLIENT_CUSTOMER_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_USE_SERVICE_ACCOUNT",
  ];
  const present = keys.filter((k) => Boolean(String(process.env[k] || "").trim()));
  if (fs.existsSync(ADS_FILE)) present.push("FILE:data/google-ads.json");
  return present;
}

export function googleAdsStatus() {
  const api = googleAdsApiConfigured();
  const ga4 = googleAdsGa4Configured();
  const creds = loadGoogleAdsCredentials();
  return {
    apiConfigured: api.ok,
    apiMissing: api.missing,
    ga4FallbackConfigured: ga4,
    canSync: api.ok || ga4,
    customerId: creds?.customer_id
      ? normalizeCustomerId_(creds.customer_id)
      : null,
    hasRefreshToken: Boolean(creds?.refresh_token),
    useServiceAccount: Boolean(creds?.use_service_account),
    envKeysPresent: listGoogleAdsEnvKeysPresent(),
  };
}

async function getAccessToken_(creds: GoogleAdsCredentials): Promise<string> {
  if (creds.refresh_token && creds.client_id && creds.client_secret) {
    const oauth = new OAuth2Client(creds.client_id, creds.client_secret);
    oauth.setCredentials({ refresh_token: creds.refresh_token });
    const t = await oauth.getAccessToken();
    if (!t.token) throw new Error("No se pudo refrescar access token OAuth");
    return t.token;
  }

  // Service account (solo si la añadieron como usuario en Ads)
  const sa = loadServiceAccountJson();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error(
      "Google Ads: falta OAuth (refresh_token) o service account en disco"
    );
  }
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/adwords"],
  });
  await jwt.authorize();
  const t = await jwt.getAccessToken();
  if (!t.token) throw new Error("No se pudo autorizar service account AdWords");
  return t.token;
}

async function adsSearch_(
  creds: GoogleAdsCredentials,
  query: string
): Promise<unknown[]> {
  const token = await getAccessToken_(creds);
  const customerId = normalizeCustomerId_(creds.customer_id);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": creds.developer_token,
    "Content-Type": "application/json",
  };
  if (creds.login_customer_id) {
    headers["login-customer-id"] = normalizeCustomerId_(creds.login_customer_id);
  }

  let lastErr = "Google Ads: sin respuesta";
  for (const ver of ADS_API_VERSIONS) {
    const res = await fetch(
      `https://googleads.googleapis.com/${ver}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ query }),
      }
    );
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      lastErr = `Google Ads ${ver} HTTP ${res.status}: ${text.slice(0, 200)}`;
      if (res.status === 404) continue;
      throw new Error(lastErr);
    }
    if (!res.ok) {
      const err = data as {
        error?: { message?: string; status?: string };
      };
      lastErr =
        err.error?.message ||
        `Google Ads ${ver} HTTP ${res.status}: ${text.slice(0, 300)}`;
      // versión inexistente → probar siguiente
      if (res.status === 404) continue;
      throw new Error(lastErr);
    }
    const batches = Array.isArray(data) ? data : [data];
    const rows: unknown[] = [];
    for (const b of batches) {
      const results = (b as { results?: unknown[] }).results;
      if (Array.isArray(results)) rows.push(...results);
    }
    return rows;
  }
  throw new Error(lastErr);
}

function micros_(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n / 1_000_000;
}

function num_(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Insights diarios vía Google Ads API, agregados por semana. */
export async function fetchGoogleAdsApiDaily(opts: {
  since: string;
  until: string;
}): Promise<
  Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
  }>
> {
  const creds = loadGoogleAdsCredentials();
  if (!creds) throw new Error("Faltan credenciales Google Ads API");

  const query = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.conversions,
      metrics.all_conversions
    FROM customer
    WHERE segments.date BETWEEN '${opts.since}' AND '${opts.until}'
  `;
  const rows = await adsSearch_(creds, query);
  const out: Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
  }> = [];
  for (const row of rows) {
    const r = row as {
      segments?: { date?: string };
      metrics?: {
        costMicros?: string | number;
        clicks?: string | number;
        conversions?: string | number;
        allConversions?: string | number;
      };
    };
    const date = String(r.segments?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const conversions =
      num_(r.metrics?.conversions) || num_(r.metrics?.allConversions);
    out.push({
      date,
      cost: micros_(r.metrics?.costMicros),
      clicks: num_(r.metrics?.clicks),
      conversions,
    });
  }
  return out;
}

export async function probeGoogleAdsApi(): Promise<{
  ok: boolean;
  customerId?: string;
  sample?: unknown;
  error?: string;
}> {
  const creds = loadGoogleAdsCredentials();
  if (!creds) {
    return { ok: false, error: "Sin credenciales Google Ads API" };
  }
  try {
    const rows = await adsSearch_(
      creds,
      `SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1`
    );
    return {
      ok: true,
      customerId: normalizeCustomerId_(creds.customer_id),
      sample: rows[0] || null,
    };
  } catch (e) {
    return {
      ok: false,
      customerId: normalizeCustomerId_(creds.customer_id),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Fallback: costo/clics desde GA4 (Google Ads vinculado).
 * Conversiones: regla de negocio Bodasesor = 10% de los clics
 * (no hay Google Ads API; el histórico del Sheet coincide ~10%).
 */
export async function fetchGoogleAdsGa4Daily(opts: {
  since: string;
  until: string;
}): Promise<
  Array<{
    date: string; // YYYY-MM-DD
    cost: number;
    clicks: number;
    conversions: number;
  }>
> {
  const sa = loadServiceAccountJson();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error("Falta service account para GA4 Google Ads fallback");
  }
  const propertyId = ga4PropertyId();
  const analytics = new BetaAnalyticsDataClient({
    credentials: {
      client_email: sa.client_email,
      private_key: sa.private_key,
    },
  });
  const [response] = await analytics.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: opts.since, endDate: opts.until }],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "advertiserAdCost" },
      { name: "advertiserAdClicks" },
    ],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "sessionSource",
              stringFilter: {
                matchType: "EXACT",
                value: "google",
                caseSensitive: false,
              },
            },
          },
          {
            filter: {
              fieldName: "sessionMedium",
              stringFilter: {
                matchType: "EXACT",
                value: "cpc",
                caseSensitive: false,
              },
            },
          },
        ],
      },
    },
    limit: 100000,
  });

  const out: Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
  }> = [];
  for (const row of response.rows || []) {
    const yyyymmdd = String(row.dimensionValues?.[0]?.value || "");
    if (!/^\d{8}$/.test(yyyymmdd)) continue;
    const date = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
    const clicks = num_(row.metricValues?.[1]?.value);
    out.push({
      date,
      cost: num_(row.metricValues?.[0]?.value),
      clicks,
      // Estimado: 10% de clics (acordado; sin Ads API)
      conversions: clicks * 0.1,
    });
  }
  return out;
}

export function aggregateWeekMetrics_(
  daily: Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
  }>,
  since: string,
  until: string,
  source: "google_ads_api" | "ga4"
): WeekGoogleAdsMetrics {
  let cost = 0;
  let clicks = 0;
  let conversions = 0;
  for (const d of daily) {
    if (d.date < since || d.date > until) continue;
    cost += d.cost;
    clicks += d.clicks;
    conversions += d.conversions;
  }
  const cpc = clicks > 0 ? cost / clicks : 0;
  const cpl = conversions > 0 ? cost / conversions : 0;
  return {
    since,
    until,
    inversion: cost,
    conversion: conversions,
    cpl,
    cpc,
    clics: clicks,
    source,
  };
}
