import fs from "fs";
import path from "path";
import { persistHostSecret } from "./hostSecretsArchive";

const KOMMO_FILE = path.join(process.cwd(), "data", "kommo-token.json");

export interface KommoTokenStore {
  access_token: string;
  base_url?: string;
  savedAt?: string;
}

function readStore_(): KommoTokenStore | null {
  try {
    if (fs.existsSync(KOMMO_FILE)) {
      return JSON.parse(fs.readFileSync(KOMMO_FILE, "utf8")) as KommoTokenStore;
    }
  } catch (err) {
    console.warn("[kommo] no se pudo leer token file", err);
  }
  return null;
}

export function saveKommoTokenStore(
  raw: Partial<KommoTokenStore> & { access_token: string }
): KommoTokenStore {
  const prev = readStore_() || { access_token: "" };
  const next: KommoTokenStore = {
    access_token: String(raw.access_token || prev.access_token).trim(),
    base_url:
      String(raw.base_url || prev.base_url || "").trim().replace(/\/$/, "") ||
      undefined,
    savedAt: new Date().toISOString(),
  };
  if (!next.access_token) {
    throw new Error("Falta access_token de Kommo");
  }
  fs.mkdirSync(path.dirname(KOMMO_FILE), { recursive: true });
  fs.writeFileSync(KOMMO_FILE, JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  void persistHostSecret("kommo-token", next).catch((err) => {
    console.warn(
      "[kommo] backup Drive token:",
      err instanceof Error ? err.message : err
    );
  });
  return next;
}

/** Archivo primero: Hostinger trunca tokens largos en env. */
export function getKommoAccessToken(): string {
  const store = readStore_();
  if (store?.access_token) return store.access_token;
  return String(process.env.KOMMO_ACCESS_TOKEN || "").trim();
}

export function getKommoBaseUrl(): string {
  const store = readStore_();
  if (store?.base_url) return store.base_url.replace(/\/$/, "");
  return String(process.env.KOMMO_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
}

export function hasKommoCredentials(): boolean {
  return Boolean(getKommoBaseUrl() && getKommoAccessToken());
}

export function kommoCredentialsSource(): {
  hasToken: boolean;
  hasBase: boolean;
  tokenFrom: "file" | "env" | "none";
} {
  const store = readStore_();
  if (store?.access_token) {
    return {
      hasToken: true,
      hasBase: Boolean(getKommoBaseUrl()),
      tokenFrom: "file",
    };
  }
  if (process.env.KOMMO_ACCESS_TOKEN) {
    return {
      hasToken: true,
      hasBase: Boolean(getKommoBaseUrl()),
      tokenFrom: "env",
    };
  }
  return { hasToken: false, hasBase: Boolean(getKommoBaseUrl()), tokenFrom: "none" };
}
