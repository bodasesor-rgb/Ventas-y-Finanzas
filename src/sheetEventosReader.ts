import { eventFingerprintFromValues } from "./eventFingerprint";
import { rememberFingerprint } from "./fingerprintStore";

const DEFAULT_SHEET_ID = "1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8";

function sheetId_(): string {
  return (
    process.env.GOOGLE_SHEET_ID ||
    process.env.VENTAS_SHEET_ID ||
    DEFAULT_SHEET_ID
  ).trim();
}

/** Parse CSV simple con comillas. */
function parseCsv_(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export interface EventosSheetIndex {
  /** fingerprint → dealId (o "" si no hay) */
  byFingerprint: Record<string, string>;
  /** dealId → row number (1-based en Sheet, con header) */
  byDealId: Record<string, number>;
  fetchedAt: number;
  rowCount: number;
}

let cache: EventosSheetIndex | null = null;
const CACHE_TTL_MS = 45_000;

/**
 * Lee Eventos YYYY del Sheet (CSV público) y arma índice anti-duplicados.
 */
export async function loadEventosSheetIndex(
  year = new Date().getUTCFullYear(),
  force = false
): Promise<EventosSheetIndex> {
  if (
    !force &&
    cache &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache;
  }

  const id = sheetId_();
  const sheetName = encodeURIComponent(`Eventos ${year}`);
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Sheet CSV HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.includes("<HTML>") || text.includes("<!DOCTYPE")) {
    throw new Error("Sheet CSV no accesible (HTML en vez de CSV)");
  }

  const rows = parseCsv_(text);
  const byFingerprint: Record<string, string> = {};
  const byDealId: Record<string, number> = {};

  // fila 0 = header
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    while (r.length < 20) r.push("");
    const cliente = (r[0] || "").trim();
    if (!cliente) continue;
    const dealId = String(r[19] || "").trim();
    const values = r.slice(0, 20);
    const fp = eventFingerprintFromValues(values);
    if (fp && fp !== "||||") {
      // conservar el primer dealId visto para esa huella
      if (!byFingerprint[fp]) byFingerprint[fp] = dealId;
    }
    if (dealId) byDealId[dealId] = i + 1; // 1-based con header
    if (fp && dealId) rememberFingerprint(fp, dealId);
  }

  cache = {
    byFingerprint,
    byDealId,
    fetchedAt: Date.now(),
    rowCount: Object.keys(byFingerprint).length,
  };
  return cache;
}

/** Busca en el Sheet real si ya existe la misma huella con otro deal. */
export async function findDuplicateInSheet(
  fingerprint: string,
  dealId: string,
  year?: number
): Promise<{ dealId: string; row?: number } | null> {
  if (!fingerprint || fingerprint === "||||") return null;
  try {
    const idx = await loadEventosSheetIndex(year);
    if (!Object.prototype.hasOwnProperty.call(idx.byFingerprint, fingerprint)) {
      return null;
    }
    const existing = idx.byFingerprint[fingerprint] || "";
    // Mismo deal → permitir update; otro deal o fila sin id → duplicado
    if (existing && existing === dealId) return null;
    if (!existing && !dealId) return null;
    if (existing === dealId) return null;
    return {
      dealId: existing || "(sin deal id)",
      row: existing ? idx.byDealId[existing] : undefined,
    };
  } catch (err) {
    console.warn(
      "[ventas-sheet] no se pudo leer Eventos para dedupe",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
