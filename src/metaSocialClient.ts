import fs from "fs";
import path from "path";

const META_FILE = path.join(process.cwd(), "data", "meta-token.json");
const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaTokenStore {
  access_token: string;
  page_id?: string;
  ig_user_id?: string;
  page_name?: string;
  ig_username?: string;
}

export interface SocialFollowers {
  facebookFollowers: number;
  instagramFollowers: number;
  pageId: string;
  pageName: string;
  igUserId: string | null;
  igUsername: string | null;
}

function readStore_(): MetaTokenStore | null {
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, "utf8")) as MetaTokenStore;
    }
  } catch (err) {
    console.warn("[meta] no se pudo leer token file", err);
  }
  return null;
}

export function saveMetaTokenStore(
  raw: Partial<MetaTokenStore> & { access_token: string }
): MetaTokenStore {
  const prev = readStore_() || { access_token: "" };
  const next: MetaTokenStore = {
    access_token: String(raw.access_token || prev.access_token).trim(),
    page_id: String(raw.page_id || prev.page_id || "").trim() || undefined,
    ig_user_id: String(raw.ig_user_id || prev.ig_user_id || "").trim() || undefined,
    page_name: raw.page_name || prev.page_name,
    ig_username: raw.ig_username || prev.ig_username,
  };
  if (!next.access_token) {
    throw new Error("Falta access_token de Meta");
  }
  fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return next;
}

export function getMetaAccessToken(): string {
  const fromEnv = (
    process.env.META_PAGE_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN ||
    ""
  ).trim();
  if (fromEnv) return fromEnv;
  const store = readStore_();
  if (store?.access_token) return store.access_token;
  throw new Error(
    "Falta token Meta: POST /api/ventas/meta-setup o META_PAGE_ACCESS_TOKEN"
  );
}

export function metaConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  try {
    getMetaAccessToken();
  } catch {
    missing.push("META_PAGE_ACCESS_TOKEN o data/meta-token.json");
  }
  return { ok: missing.length === 0, missing };
}

export function metaStatus(): {
  configured: boolean;
  missing: string[];
  hasFile: boolean;
  pageId: string | null;
  igUserId: string | null;
  pageName: string | null;
  igUsername: string | null;
  envKeysPresent: string[];
} {
  const store = readStore_();
  const cfg = metaConfigured();
  const envKeys = [
    "META_PAGE_ACCESS_TOKEN",
    "META_ACCESS_TOKEN",
    "FACEBOOK_PAGE_ACCESS_TOKEN",
    "META_PAGE_ID",
    "FACEBOOK_PAGE_ID",
    "META_IG_USER_ID",
    "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  ].filter((k) => Boolean(String(process.env[k] || "").trim()));
  if (fs.existsSync(META_FILE)) envKeys.push("FILE:data/meta-token.json");
  return {
    configured: cfg.ok,
    missing: cfg.missing,
    hasFile: fs.existsSync(META_FILE),
    pageId:
      store?.page_id ||
      process.env.META_PAGE_ID ||
      process.env.FACEBOOK_PAGE_ID ||
      null,
    igUserId:
      store?.ig_user_id ||
      process.env.META_IG_USER_ID ||
      process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
      null,
    pageName: store?.page_name || null,
    igUsername: store?.ig_username || null,
    envKeysPresent: envKeys,
  };
}

async function graphGet_<T>(
  pathAndQuery: string,
  token: string
): Promise<T> {
  const url = pathAndQuery.startsWith("http")
    ? pathAndQuery
    : `${GRAPH}/${pathAndQuery.replace(/^\//, "")}`;
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`);
  const data = (await res.json()) as T & {
    error?: { message?: string; code?: number; type?: string };
  };
  if (!res.ok || data.error) {
    throw new Error(
      data.error?.message || `Meta Graph HTTP ${res.status}`
    );
  }
  return data;
}

/**
 * Descubre Page + IG Business desde el token (me/accounts).
 */
export async function discoverMetaAccounts(token?: string): Promise<{
  pages: Array<{
    id: string;
    name: string;
    access_token?: string;
    followers_count?: number;
    ig?: { id: string; username?: string; followers_count?: number };
  }>;
}> {
  const t = token || getMetaAccessToken();
  const data = await graphGet_<{
    data?: Array<{
      id: string;
      name: string;
      access_token?: string;
      followers_count?: number;
      instagram_business_account?: { id: string };
    }>;
  }>(
    "me/accounts?fields=id,name,access_token,followers_count,instagram_business_account",
    t
  );
  const pages = [];
  for (const p of data.data || []) {
    let ig:
      | { id: string; username?: string; followers_count?: number }
      | undefined;
    if (p.instagram_business_account?.id) {
      try {
        const igData = await graphGet_<{
          id: string;
          username?: string;
          followers_count?: number;
        }>(
          `${p.instagram_business_account.id}?fields=id,username,followers_count`,
          p.access_token || t
        );
        ig = {
          id: igData.id,
          username: igData.username,
          followers_count: igData.followers_count,
        };
      } catch (err) {
        console.warn(
          "[meta] IG lookup",
          p.name,
          err instanceof Error ? err.message : err
        );
        ig = { id: p.instagram_business_account.id };
      }
    }
    pages.push({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      followers_count: p.followers_count,
      ig,
    });
  }
  return { pages };
}

/** Lee seguidores actuales de FB Page + Instagram Business. */
export async function fetchSocialFollowers(): Promise<SocialFollowers> {
  const store = readStore_();
  let token = getMetaAccessToken();
  let pageId = (
    store?.page_id ||
    process.env.META_PAGE_ID ||
    process.env.FACEBOOK_PAGE_ID ||
    ""
  ).trim();
  let igUserId = (
    store?.ig_user_id ||
    process.env.META_IG_USER_ID ||
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
    ""
  ).trim();

  // Si no hay page_id, descubrir
  if (!pageId) {
    const { pages } = await discoverMetaAccounts(token);
    if (!pages.length) {
      throw new Error(
        "El token no tiene Pages. Usa un Page Access Token o User token con pages_show_list"
      );
    }
    // Preferir página con IG, o la primera
    const preferred =
      pages.find((p) => p.ig?.id) ||
      pages.find((p) => /bodasesor/i.test(p.name)) ||
      pages[0];
    pageId = preferred.id;
    if (preferred.access_token) token = preferred.access_token;
    if (preferred.ig?.id) igUserId = preferred.ig.id;
    saveMetaTokenStore({
      access_token: token,
      page_id: pageId,
      ig_user_id: igUserId || undefined,
      page_name: preferred.name,
      ig_username: preferred.ig?.username,
    });
  }

  const page = await graphGet_<{
    id: string;
    name?: string;
    followers_count?: number;
    fan_count?: number;
    instagram_business_account?: { id: string };
  }>(
    `${pageId}?fields=id,name,followers_count,fan_count,instagram_business_account`,
    token
  );

  const facebookFollowers = Number(
    page.followers_count ?? page.fan_count ?? 0
  );

  if (!igUserId && page.instagram_business_account?.id) {
    igUserId = page.instagram_business_account.id;
  }

  let instagramFollowers = 0;
  let igUsername: string | null = store?.ig_username || null;
  if (igUserId) {
    const ig = await graphGet_<{
      id: string;
      username?: string;
      followers_count?: number;
    }>(`${igUserId}?fields=id,username,followers_count`, token);
    instagramFollowers = Number(ig.followers_count || 0);
    igUsername = ig.username || igUsername;
  }

  // Persistir ids descubiertos
  saveMetaTokenStore({
    access_token: token,
    page_id: pageId,
    ig_user_id: igUserId || undefined,
    page_name: page.name,
    ig_username: igUsername || undefined,
  });

  return {
    facebookFollowers,
    instagramFollowers,
    pageId,
    pageName: page.name || "",
    igUserId: igUserId || null,
    igUsername,
  };
}
