import {
  getMetaAccessToken,
  metaConfigured,
  metaStatus,
  saveMetaTokenStore,
  type MetaTokenStore,
} from "./metaSocialClient";
import fs from "fs";
import path from "path";

const GRAPH = "https://graph.facebook.com/v21.0";
const META_FILE = path.join(process.cwd(), "data", "meta-token.json");

export interface MetaAdAccount {
  id: string; // act_XXXX
  accountId: string; // digits
  name: string;
  currency?: string;
  accountStatus?: number;
}

export interface WeekAdsMetrics {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD inclusive
  inversion: number; // spend
  conversion: number; // leads / primary results
  cpl: number;
  cpc: number;
  clics: number;
  alcance: number; // reach
  cpm: number;
  conversionActionType: string | null;
}

const LEAD_ACTION_TYPES = [
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "omni_complete_registration",
  "complete_registration",
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "leadgen_grouped",
];

async function graphGet_<T>(pathAndQuery: string, token: string): Promise<T> {
  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${GRAPH}/${pathAndQuery.replace(/^\//, "")}`;
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(
    `${url}${sep}access_token=${encodeURIComponent(token)}`
  );
  const data = (await res.json()) as T & {
    error?: { message?: string; code?: number; type?: string };
  };
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Meta Graph HTTP ${res.status}`);
  }
  return data;
}

function readStore_(): MetaTokenStore | null {
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, "utf8")) as MetaTokenStore;
    }
  } catch {
    // ignore
  }
  return null;
}

function normalizeActId_(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("act_")) return s;
  if (/^\d+$/.test(s)) return `act_${s}`;
  return s;
}

export function getConfiguredAdAccountId(): string {
  const fromEnv = (
    process.env.META_AD_ACCOUNT_ID ||
    process.env.FB_AD_ACCOUNT_ID ||
    process.env.FACEBOOK_AD_ACCOUNT_ID ||
    ""
  ).trim();
  if (fromEnv) return normalizeActId_(fromEnv);
  const store = readStore_();
  return normalizeActId_(store?.ad_account_id || "");
}

export async function listMetaAdAccounts(
  token?: string
): Promise<MetaAdAccount[]> {
  const t = token || getMetaAccessToken();
  const data = await graphGet_<{
    data?: Array<{
      id: string;
      account_id?: string;
      name?: string;
      currency?: string;
      account_status?: number;
    }>;
  }>("me/adaccounts?fields=id,account_id,name,currency,account_status&limit=50", t);

  return (data.data || []).map((a) => ({
    id: normalizeActId_(a.id || a.account_id || ""),
    accountId: String(a.account_id || a.id?.replace(/^act_/, "") || ""),
    name: String(a.name || ""),
    currency: a.currency,
    accountStatus: a.account_status,
  }));
}

/** Resuelve cuenta publicitaria (env / archivo / primera de me/adaccounts). */
export async function resolveAdAccount(
  token?: string
): Promise<MetaAdAccount> {
  const t = token || getMetaAccessToken();
  const configured = getConfiguredAdAccountId();
  const accounts = await listMetaAdAccounts(t);
  if (!accounts.length) {
    throw new Error(
      "El token no ve ninguna cuenta publicitaria (me/adaccounts). Necesita permiso ads_read y acceso a la ad account."
    );
  }
  let chosen =
    (configured
      ? accounts.find(
          (a) =>
            a.id === configured ||
            a.accountId === configured.replace(/^act_/, "")
        )
      : null) || null;
  if (!chosen && configured) {
    // Token puede acceder al act_ aunque no aparezca en me/adaccounts
    chosen = {
      id: configured,
      accountId: configured.replace(/^act_/, ""),
      name: "",
    };
  }
  if (!chosen) {
    chosen =
      accounts.find((a) => /bodasesor/i.test(a.name)) || accounts[0];
  }

  // Persist for next runs
  try {
    saveMetaTokenStore({
      access_token: t,
      ad_account_id: chosen.id,
    });
  } catch {
    // ignore if only env token
  }
  return chosen;
}

function num_(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickConversions_(
  actions?: Array<{ action_type?: string; value?: string | number }>
): { count: number; actionType: string | null } {
  if (!actions?.length) return { count: 0, actionType: null };
  for (const pref of LEAD_ACTION_TYPES) {
    const hit = actions.find((a) => a.action_type === pref);
    if (hit) return { count: num_(hit.value), actionType: pref };
  }
  // fallback: cualquier action con "lead" en el nombre
  const leadish = actions.find((a) =>
    String(a.action_type || "")
      .toLowerCase()
      .includes("lead")
  );
  if (leadish) {
    return {
      count: num_(leadish.value),
      actionType: String(leadish.action_type),
    };
  }
  return { count: 0, actionType: null };
}

function pickCpl_(
  costPerAction: Array<{ action_type?: string; value?: string | number }> | undefined,
  actionType: string | null,
  spend: number,
  conversions: number
): number {
  if (actionType && costPerAction?.length) {
    const hit = costPerAction.find((a) => a.action_type === actionType);
    if (hit) return num_(hit.value);
  }
  if (conversions > 0) return spend / conversions;
  return 0;
}

/** Insights de cuenta para un rango (inclusive until). */
export async function fetchAdAccountInsightsWeek(
  actId: string,
  since: string,
  until: string,
  token?: string
): Promise<WeekAdsMetrics> {
  const t = token || getMetaAccessToken();
  const id = normalizeActId_(actId);
  const fields = [
    "spend",
    "clicks",
    "cpc",
    "cpm",
    "reach",
    "impressions",
    "actions",
    "cost_per_action_type",
  ].join(",");
  const timeRange = encodeURIComponent(
    JSON.stringify({ since, until })
  );
  const data = await graphGet_<{
    data?: Array<{
      spend?: string;
      clicks?: string;
      cpc?: string;
      cpm?: string;
      reach?: string;
      impressions?: string;
      actions?: Array<{ action_type?: string; value?: string }>;
      cost_per_action_type?: Array<{
        action_type?: string;
        value?: string;
      }>;
      date_start?: string;
      date_stop?: string;
    }>;
  }>(
    `${id}/insights?fields=${fields}&level=account&time_range=${timeRange}&limit=5`,
    t
  );

  const row = data.data?.[0];
  if (!row) {
    return {
      since,
      until,
      inversion: 0,
      conversion: 0,
      cpl: 0,
      cpc: 0,
      clics: 0,
      alcance: 0,
      cpm: 0,
      conversionActionType: null,
    };
  }

  const inversion = num_(row.spend);
  const clics = num_(row.clicks);
  const cpc = num_(row.cpc) || (clics > 0 ? inversion / clics : 0);
  const alcance = num_(row.reach);
  const cpm =
    num_(row.cpm) ||
    (alcance > 0 ? (inversion / alcance) * 1000 : 0);
  const { count: conversion, actionType } = pickConversions_(row.actions);
  const cpl = pickCpl_(
    row.cost_per_action_type,
    actionType,
    inversion,
    conversion
  );

  return {
    since,
    until,
    inversion,
    conversion,
    cpl,
    cpc,
    clics,
    alcance,
    cpm,
    conversionActionType: actionType,
  };
}

export async function fetchAdsMetricsForWeeks(
  weeks: Array<{ since: string; until: string }>,
  opts?: { adAccountId?: string }
): Promise<{
  account: MetaAdAccount;
  weeks: WeekAdsMetrics[];
}> {
  const token = getMetaAccessToken();
  const account = opts?.adAccountId
    ? {
        id: normalizeActId_(opts.adAccountId),
        accountId: normalizeActId_(opts.adAccountId).replace(/^act_/, ""),
        name: "",
      }
    : await resolveAdAccount(token);

  const out: WeekAdsMetrics[] = [];
  for (const w of weeks) {
    out.push(
      await fetchAdAccountInsightsWeek(account.id, w.since, w.until, token)
    );
  }
  return { account, weeks: out };
}

export function metaAdsStatus() {
  const base = metaStatus();
  const adAccountId = getConfiguredAdAccountId() || null;
  const envKeys = [
    ...base.envKeysPresent,
    ...[
      "META_AD_ACCOUNT_ID",
      "FB_AD_ACCOUNT_ID",
      "FACEBOOK_AD_ACCOUNT_ID",
    ].filter((k) => Boolean(String(process.env[k] || "").trim())),
  ];
  return {
    meta: base,
    configured: metaConfigured().ok,
    adAccountId,
    envKeysPresent: Array.from(new Set(envKeys)),
  };
}
