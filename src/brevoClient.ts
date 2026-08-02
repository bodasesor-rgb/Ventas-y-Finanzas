import fs from "fs";
import path from "path";

const BREVO_FILE = path.join(process.cwd(), "data", "brevo.json");
const BREVO_API = "https://api.brevo.com/v3";

export type BrevoStore = {
  api_key: string;
  updated_at?: string;
};

export type BrevoWeekStats = {
  since: string; // YYYY-MM-DD
  until: string;
  contactos: number;
  correosMandados: number;
  aperturas: number;
  clicks: number;
  ctr: number; // 0–1
  campaigns: number;
};

function readStore_(): BrevoStore | null {
  try {
    if (fs.existsSync(BREVO_FILE)) {
      return JSON.parse(fs.readFileSync(BREVO_FILE, "utf8")) as BrevoStore;
    }
  } catch {
    // ignore
  }
  return null;
}

export function getBrevoApiKey(): string {
  const fromEnv = (
    process.env.BREVO_AUTH ||
    process.env.BREVO_API_KEY ||
    process.env.BREVO ||
    process.env.SENDINBLUE_API_KEY ||
    ""
  ).trim();
  if (fromEnv) return fromEnv;
  return String(readStore_()?.api_key || "").trim();
}

export function saveBrevoApiKey(apiKey: string): BrevoStore {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Falta api_key de Brevo");
  fs.mkdirSync(path.dirname(BREVO_FILE), { recursive: true });
  const next: BrevoStore = {
    api_key: key,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(BREVO_FILE, JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return next;
}

export function brevoConfigured(): { ok: boolean; missing: string[] } {
  if (getBrevoApiKey()) return { ok: true, missing: [] };
  return {
    ok: false,
    missing: ["BREVO_AUTH / BREVO_API_KEY o data/brevo.json"],
  };
}

export function brevoStatus() {
  const cfg = brevoConfigured();
  const keys = [
    "BREVO_AUTH",
    "BREVO_API_KEY",
    "BREVO",
    "SENDINBLUE_API_KEY",
  ].filter((k) => Boolean(String(process.env[k] || "").trim()));
  if (fs.existsSync(BREVO_FILE)) keys.push("FILE:data/brevo.json");
  return {
    configured: cfg.ok,
    missing: cfg.missing,
    hasFile: fs.existsSync(BREVO_FILE),
    envKeysPresent: keys,
  };
}

async function brevoGet_<T>(pathAndQuery: string): Promise<T> {
  const key = getBrevoApiKey();
  if (!key) throw new Error("Falta BREVO_API_KEY");
  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${BREVO_API}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      "api-key": key,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Brevo HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg =
      (data as { message?: string })?.message ||
      `Brevo HTTP ${res.status}: ${text.slice(0, 300)}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchBrevoAccount(): Promise<{
  email?: string;
  companyName?: string;
  plan?: unknown;
}> {
  return brevoGet_("/account");
}

export async function fetchBrevoContactsCount(): Promise<number> {
  const data = await brevoGet_<{ count?: number }>(
    "/contacts?limit=1&offset=0"
  );
  return Number(data.count || 0);
}

type CampaignStats = {
  sent?: number;
  delivered?: number;
  uniqueViews?: number;
  viewed?: number;
  uniqueClicks?: number;
  clickers?: number;
  trackableViews?: number;
};

type Campaign = {
  id?: number;
  name?: string;
  status?: string;
  sentDate?: string;
  statistics?: {
    globalStats?: CampaignStats;
  };
};

/** Campañas enviadas en rango (por sentDate). */
export async function fetchBrevoSentCampaigns(opts: {
  startDate: string; // YYYY-MM-DD
  endDate: string;
}): Promise<Campaign[]> {
  const start = encodeURIComponent(`${opts.startDate}T00:00:00.000Z`);
  const end = encodeURIComponent(`${opts.endDate}T23:59:59.999Z`);
  const out: Campaign[] = [];
  let offset = 0;
  const limit = 50;
  for (let page = 0; page < 40; page++) {
    const data = await brevoGet_<{
      campaigns?: Campaign[];
      count?: number;
    }>(
      `/emailCampaigns?type=classic&status=sent&statistics=globalStats` +
        `&startDate=${start}&endDate=${end}&limit=${limit}&offset=${offset}`
    );
    const batch = data.campaigns || [];
    if (!batch.length) break;
    out.push(...batch);
    offset += batch.length;
    if (batch.length < limit) break;
  }
  return out;
}

/**
 * SMTP / transactional aggregated (opcional, suma a correos si hay volumen).
 * GET /smtp/statistics/aggregatedReport
 */
export async function fetchBrevoSmtpAggregated(opts: {
  startDate: string;
  endDate: string;
}): Promise<{
  requests?: number;
  delivered?: number;
  opens?: number;
  clicks?: number;
  uniqueOpens?: number;
  uniqueClicks?: number;
}> {
  try {
    return await brevoGet_(
      `/smtp/statistics/aggregatedReport?startDate=${opts.startDate}&endDate=${opts.endDate}&days=90`
    );
  } catch {
    return {};
  }
}

function num_(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function campaignInWeek_(
  sentDate: string | undefined,
  since: string,
  until: string
): boolean {
  if (!sentDate) return false;
  const day = sentDate.slice(0, 10);
  return day >= since && day <= until;
}

/** Agrega stats de campañas (+ SMTP) por semana. */
export async function fetchBrevoWeekStats(
  weeks: Array<{ since: string; until: string }>,
  opts?: { includeSmtp?: boolean }
): Promise<BrevoWeekStats[]> {
  if (!weeks.length) return [];
  const rangeStart = weeks[0].since;
  const rangeEnd = weeks[weeks.length - 1].until;
  const [contactos, campaigns] = await Promise.all([
    fetchBrevoContactsCount(),
    fetchBrevoSentCampaigns({ startDate: rangeStart, endDate: rangeEnd }),
  ]);

  let smtpByWeek: Array<{
    since: string;
    until: string;
    sent: number;
    opens: number;
    clicks: number;
  }> | null = null;
  if (opts?.includeSmtp !== false) {
    smtpByWeek = [];
    for (const w of weeks) {
      const smtp = await fetchBrevoSmtpAggregated({
        startDate: w.since,
        endDate: w.until,
      });
      smtpByWeek.push({
        since: w.since,
        until: w.until,
        sent: num_(smtp.requests || smtp.delivered),
        opens: num_(smtp.uniqueOpens || smtp.opens),
        clicks: num_(smtp.uniqueClicks || smtp.clicks),
      });
    }
  }

  return weeks.map((w) => {
    let sent = 0;
    let opens = 0;
    let clicks = 0;
    let nCamp = 0;
    for (const c of campaigns) {
      if (!campaignInWeek_(c.sentDate, w.since, w.until)) continue;
      const g = c.statistics?.globalStats || {};
      sent += num_(g.sent || g.delivered);
      opens += num_(g.uniqueViews || g.viewed || g.trackableViews);
      clicks += num_(g.uniqueClicks || g.clickers);
      nCamp++;
    }
    const smtp = smtpByWeek?.find(
      (s) => s.since === w.since && s.until === w.until
    );
    // Si SMTP aporta mucho más que campañas (transaccional), sumar
    if (smtp && smtp.sent > sent) {
      // Preferir el mayor bloque (normalmente campañas semanales ~6k)
      // Si SMTP es el canal principal, úsalo; si no, campañas.
      if (sent === 0) {
        sent = smtp.sent;
        opens = smtp.opens;
        clicks = smtp.clicks;
      }
    }
    const ctr = sent > 0 ? clicks / sent : 0;
    return {
      since: w.since,
      until: w.until,
      contactos,
      correosMandados: sent,
      aperturas: opens,
      clicks,
      ctr,
      campaigns: nCamp,
    };
  });
}

export async function probeBrevo() {
  const status = brevoStatus();
  if (!status.configured) {
    return { ok: false, status, error: "Falta API key Brevo" };
  }
  try {
    const account = await fetchBrevoAccount();
    const contactos = await fetchBrevoContactsCount();
    return {
      ok: true,
      status,
      account: {
        email: account.email,
        companyName: account.companyName,
      },
      contactos,
    };
  } catch (e) {
    return {
      ok: false,
      status,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
