import { BetaAnalyticsDataClient } from "@google-analytics/data";
import {
  ga4PropertyId,
  loadServiceAccountJson,
} from "./googleAuth";

export interface DailySessions {
  /** YYYYMMDD */
  date: string;
  sessions: number;
}

function client_(): BetaAnalyticsDataClient {
  const sa = loadServiceAccountJson();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error(
      "Falta GOOGLE_SERVICE_ACCOUNT_JSON para leer Google Analytics"
    );
  }
  return new BetaAnalyticsDataClient({
    credentials: {
      client_email: sa.client_email,
      private_key: sa.private_key,
    },
  });
}

function parseRows_(
  rows: Array<{
    dimensionValues?: Array<{ value?: string | null } | null> | null;
    metricValues?: Array<{ value?: string | null } | null> | null;
  }> | null | undefined
): DailySessions[] {
  const out: DailySessions[] = [];
  for (const row of rows || []) {
    const date = String(row.dimensionValues?.[0]?.value || "");
    const sessions = Number(row.metricValues?.[0]?.value || 0);
    if (/^\d{8}$/.test(date)) {
      out.push({ date, sessions: Number.isFinite(sessions) ? sessions : 0 });
    }
  }
  return out;
}

async function runSessionsReport_(opts: {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  dimensionFilter?: Record<string, unknown>;
}): Promise<DailySessions[]> {
  const propertyId = ga4PropertyId();
  const analytics = client_();
  const [response] = await analytics.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: opts.dimensionFilter as never,
    limit: 100000,
  });
  return parseRows_(response.rows);
}

function pathContainsFilter_(
  paths: string[]
): Record<string, unknown> | undefined {
  const cleaned = paths.map((p) => p.trim()).filter(Boolean);
  if (!cleaned.length) return undefined;
  if (cleaned.length === 1) {
    return {
      filter: {
        fieldName: "pagePath",
        stringFilter: {
          matchType: "CONTAINS",
          value: cleaned[0],
          caseSensitive: false,
        },
      },
    };
  }
  return {
    orGroup: {
      expressions: cleaned.map((value) => ({
        filter: {
          fieldName: "pagePath",
          stringFilter: {
            matchType: "CONTAINS",
            value,
            caseSensitive: false,
          },
        },
      })),
    },
  };
}

function andFilters_(
  ...parts: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const exprs = parts.filter(Boolean) as Record<string, unknown>[];
  if (!exprs.length) return undefined;
  if (exprs.length === 1) return exprs[0];
  return { andGroup: { expressions: exprs } };
}

const ORGANIC_FILTER: Record<string, unknown> = {
  filter: {
    fieldName: "sessionDefaultChannelGroup",
    stringFilter: {
      matchType: "EXACT",
      value: "Organic Search",
      caseSensitive: false,
    },
  },
};

export function blogPathContains(): string[] {
  const raw = process.env.GA4_BLOG_PATH_CONTAINS || "/blog";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function coleccionesPathContains(): string[] {
  const raw =
    process.env.GA4_COLECCIONES_PATH_CONTAINS ||
    "/coleccion,/collections,/catalogo,/tienda";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Trae sesiones diarias para llenar Metricas:
 * - site: todas
 * - organic: Organic Search
 * - blogs: organic + path blog
 * - colecciones: organic + path colecciones
 */
export async function fetchGa4VisitasDaily(opts: {
  startDate: string;
  endDate: string;
}): Promise<{
  site: DailySessions[];
  organic: DailySessions[];
  blogs: DailySessions[];
  colecciones: DailySessions[];
  propertyId: string;
}> {
  const propertyId = ga4PropertyId();
  const blogFilter = andFilters_(
    ORGANIC_FILTER,
    pathContainsFilter_(blogPathContains())
  );
  const colFilter = andFilters_(
    ORGANIC_FILTER,
    pathContainsFilter_(coleccionesPathContains())
  );

  const [site, organic, blogs, colecciones] = await Promise.all([
    runSessionsReport_({
      startDate: opts.startDate,
      endDate: opts.endDate,
    }),
    runSessionsReport_({
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensionFilter: ORGANIC_FILTER,
    }),
    runSessionsReport_({
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensionFilter: blogFilter,
    }),
    runSessionsReport_({
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensionFilter: colFilter,
    }),
  ]);

  return { site, organic, blogs, colecciones, propertyId };
}

export function ga4Configured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.GA4_PROPERTY_ID?.trim()) missing.push("GA4_PROPERTY_ID");
  try {
    if (!loadServiceAccountJson()) {
      missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");
    }
  } catch {
    missing.push("GOOGLE_SERVICE_ACCOUNT_JSON (inválido)");
  }
  return { ok: missing.length === 0, missing };
}
