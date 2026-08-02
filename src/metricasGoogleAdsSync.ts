import { google } from "googleapis";
import {
  getGoogleAuthClient,
  metricasSheetId,
  metricasSheetName,
} from "./googleAuth";
import {
  aggregateWeekMetrics_,
  fetchGoogleAdsApiDaily,
  fetchGoogleAdsGa4Daily,
  googleAdsApiConfigured,
  googleAdsGa4Configured,
  googleAdsStatus,
  probeGoogleAdsApi,
  type WeekGoogleAdsMetrics,
} from "./googleAdsClient";

function pad2_(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIso_(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2_(d.getUTCMonth() + 1)}-${pad2_(
    d.getUTCDate()
  )}`;
}

function formatDmy_(d: Date): string {
  return `${pad2_(d.getUTCDate())}/${pad2_(d.getUTCMonth() + 1)}/${String(
    d.getUTCFullYear()
  ).slice(-2)}`;
}

function parseHeaderDate_(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return new Date(
      Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate())
    );
  }
  if (typeof raw === "number" && raw > 30000 && raw < 60000) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    );
  }
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  let yy = Number(m[3]);
  if (yy < 100) yy += 2000;
  return new Date(Date.UTC(yy, Number(m[2]) - 1, Number(m[1])));
}

function normLabel_(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyCell_(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "number") return false;
  return !String(v).trim();
}

function colLetter_(col: number): string {
  let n = col;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function round2_(n: number): number {
  return Math.round(n * 100) / 100;
}

interface GadsRows {
  inversion: number;
  conversion: number;
  cpl: number;
  cpc: number;
  clics: number;
}

interface Layout {
  sheetName: string;
  rows: GadsRows;
  weekCols: Array<{ col: number; date: Date }>;
  values: unknown[][];
}

async function loadLayout_(): Promise<Layout> {
  const auth = await getGoogleAuthClient([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  const sheets = google.sheets({ version: "v4", auth: auth as never });
  const sheetName = metricasSheetName();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: metricasSheetId(),
    range: `'${sheetName}'!A1:CC80`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  const values = (res.data.values || []) as unknown[][];
  const lastRow = Math.min(values.length, 80);

  let labelCol = 0;
  let ingresosRow = -1;
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < lastRow; r++) {
      const lab = normLabel_(values[r]?.[c]);
      if (lab === "ingresos" || lab.startsWith("ingreso")) {
        labelCol = c;
        ingresosRow = r;
      }
    }
  }
  if (ingresosRow < 0) throw new Error("No encontré fila Ingresos");

  let sectionStart = -1;
  for (let r = 0; r < lastRow; r++) {
    const lab = normLabel_(values[r]?.[labelCol]);
    if (lab === "google ads" || lab === "google ad") {
      sectionStart = r;
      break;
    }
  }
  if (sectionStart < 0) {
    throw new Error('No encontré sección "Google Ads" en Metricas');
  }

  const metricNames = new Set([
    "inversion",
    "conversion",
    "cpl",
    "cpc",
    "clics",
    "clicks",
  ]);
  let sectionEnd = lastRow;
  for (let r = sectionStart + 1; r < lastRow; r++) {
    const lab = normLabel_(values[r]?.[labelCol]);
    if (!lab) continue;
    if (metricNames.has(lab)) continue;
    sectionEnd = r;
    break;
  }

  const rows: GadsRows = {
    inversion: -1,
    conversion: -1,
    cpl: -1,
    cpc: -1,
    clics: -1,
  };
  for (let r = sectionStart + 1; r < sectionEnd; r++) {
    const lab = normLabel_(values[r]?.[labelCol]);
    if (lab === "inversion" && rows.inversion < 0) rows.inversion = r;
    else if (lab === "conversion" && rows.conversion < 0) rows.conversion = r;
    else if (lab === "cpl" && rows.cpl < 0) rows.cpl = r;
    else if (lab === "cpc" && rows.cpc < 0) rows.cpc = r;
    else if ((lab === "clics" || lab === "clicks") && rows.clics < 0)
      rows.clics = r;
  }
  if (rows.inversion < 0) {
    throw new Error('No encontré "Inversión" bajo Google Ads');
  }

  let headerRow = -1;
  let best = 0;
  const year = new Date().getUTCFullYear();
  for (let hr = Math.max(0, ingresosRow - 6); hr < ingresosRow; hr++) {
    let count = 0;
    const row = values[hr] || [];
    for (let c = labelCol + 1; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === "number" && cell > 0 && cell < 1000) continue;
      const d = parseHeaderDate_(cell);
      if (!d) continue;
      const y = d.getUTCFullYear();
      if (y === year || y === year - 1 || y === year + 1) count++;
    }
    if (count > best) {
      best = count;
      headerRow = hr;
    }
  }
  if (headerRow < 0) throw new Error("No encontré fila de fechas de semana");

  const weekCols: Layout["weekCols"] = [];
  const headerVals = values[headerRow] || [];
  for (let c = labelCol + 1; c < Math.max(headerVals.length, 60); c++) {
    const hv = headerVals[c];
    if (typeof hv === "number" && hv > 0 && hv < 1000) continue;
    const d = parseHeaderDate_(hv);
    if (!d) continue;
    weekCols.push({ col: c + 1, date: d });
  }

  return {
    sheetName,
    rows: {
      inversion: rows.inversion + 1,
      conversion: rows.conversion >= 0 ? rows.conversion + 1 : -1,
      cpl: rows.cpl >= 0 ? rows.cpl + 1 : -1,
      cpc: rows.cpc >= 0 ? rows.cpc + 1 : -1,
      clics: rows.clics >= 0 ? rows.clics + 1 : -1,
    },
    weekCols,
    values,
  };
}

export async function syncMetricasGoogleAds(opts?: {
  force?: boolean;
  lookbackDays?: number;
  /** Fuerza fallback GA4 aunque exista API */
  preferGa4?: boolean;
}): Promise<{
  ok: boolean;
  sheetName: string;
  source?: "google_ads_api" | "ga4";
  updatedCells: number;
  weeks: Array<{
    weekStart: string;
    inversion: number;
    conversion: number;
    cpl: number;
    cpc: number;
    clics: number;
  }>;
  skipped?: boolean;
  warning?: string;
  error?: string;
  hint?: string;
  status?: ReturnType<typeof googleAdsStatus>;
}> {
  const apiOk = googleAdsApiConfigured().ok;
  const ga4Ok = googleAdsGa4Configured();
  if (!apiOk && !ga4Ok) {
    return {
      ok: false,
      sheetName: metricasSheetName(),
      updatedCells: 0,
      weeks: [],
      error: "Falta Google Ads API o GA4+service account",
      hint:
        "POST /api/ventas/google-ads-setup con developer_token + customer_id + refresh_token, o usa el SA de GA4 (fallback solo Inversión/Clics/CPC)",
      status: googleAdsStatus(),
    };
  }

  const force = Boolean(opts?.force);
  const lookbackDays = Math.max(7, Number(opts?.lookbackDays) || 45);
  const layout = await loadLayout_();

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const lookbackStart = todayUtc - lookbackDays * 86400000;

  const targetWeeks = layout.weekCols.filter((w) => {
    if (w.date.getTime() > todayUtc) return false;
    if (w.date.getTime() + 7 * 86400000 < lookbackStart) return false;
    const invRow = layout.values[layout.rows.inversion - 1] || [];
    const empty = isEmptyCell_(invRow[w.col - 1]);
    return force || empty;
  });

  if (!targetWeeks.length) {
    return {
      ok: true,
      sheetName: layout.sheetName,
      updatedCells: 0,
      weeks: [],
      skipped: true,
      hint: "No hay semanas vacías de Google Ads; usa ?force=1",
      status: googleAdsStatus(),
    };
  }

  const rangeStart = formatIso_(targetWeeks[0].date);
  let rangeEndMs =
    targetWeeks[targetWeeks.length - 1].date.getTime() + 6 * 86400000;
  if (rangeEndMs >= todayUtc) rangeEndMs = todayUtc - 86400000;
  if (rangeEndMs < targetWeeks[0].date.getTime()) {
    rangeEndMs = targetWeeks[0].date.getTime();
  }
  const rangeEnd = formatIso_(new Date(rangeEndMs));

  let source: "google_ads_api" | "ga4" = "ga4";
  let daily: Array<{
    date: string;
    cost: number;
    clicks: number;
    conversions: number;
  }> = [];
  let warning: string | undefined;

  const useApi = apiOk && !opts?.preferGa4;
  if (useApi) {
    try {
      daily = await fetchGoogleAdsApiDaily({ since: rangeStart, until: rangeEnd });
      source = "google_ads_api";
    } catch (e) {
      if (!ga4Ok) throw e;
      warning = `Google Ads API falló (${
        e instanceof Error ? e.message : String(e)
      }); usando GA4 (sin conversiones reales)`;
      daily = await fetchGoogleAdsGa4Daily({
        since: rangeStart,
        until: rangeEnd,
      });
      source = "ga4";
    }
  } else {
    daily = await fetchGoogleAdsGa4Daily({
      since: rangeStart,
      until: rangeEnd,
    });
    source = "ga4";
    warning =
      "Usando GA4 (costo/clics) + Conversión/CPL estimados = 10% de clics.";
  }

  const auth = await getGoogleAuthClient([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  const sheets = google.sheets({ version: "v4", auth: auth as never });
  const data: Array<{ range: string; values: number[][] }> = [];
  const written: Array<{
    weekStart: string;
    inversion: number;
    conversion: number;
    cpl: number;
    cpc: number;
    clics: number;
  }> = [];

  for (const w of targetWeeks) {
    const weekEndExclusive = w.date.getTime() + 7 * 86400000;
    let untilMs = weekEndExclusive - 86400000;
    if (untilMs >= todayUtc) untilMs = todayUtc - 86400000;
    if (untilMs < w.date.getTime()) untilMs = w.date.getTime();
    const since = formatIso_(w.date);
    const until = formatIso_(new Date(untilMs));
    const m: WeekGoogleAdsMetrics = aggregateWeekMetrics_(
      daily,
      since,
      until,
      source
    );
    const letter = colLetter_(w.col);
    const clics = Math.round(m.clics);
    const conversion = Math.round(m.conversion);
    const inversion = round2_(m.inversion);
    const payload = {
      weekStart: formatDmy_(w.date),
      inversion,
      conversion,
      cpl: conversion > 0 ? round2_(inversion / conversion) : 0,
      cpc: clics > 0 ? round2_(inversion / clics) : round2_(m.cpc),
      clics,
    };
    written.push(payload);

    // Conversión/CPL: API real o estimado 10% clics (GA4 fallback)
    const map: Array<[number, number]> = [
      [layout.rows.inversion, payload.inversion],
      [layout.rows.conversion, payload.conversion],
      [layout.rows.cpl, payload.cpl],
      [layout.rows.cpc, payload.cpc],
      [layout.rows.clics, payload.clics],
    ];
    for (const [row, val] of map) {
      if (row > 0) {
        data.push({
          range: `'${layout.sheetName}'!${letter}${row}`,
          values: [[val]],
        });
      }
    }
  }

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: metricasSheetId(),
      requestBody: { valueInputOption: "RAW", data },
    });
  }

  return {
    ok: true,
    sheetName: layout.sheetName,
    source,
    updatedCells: data.length,
    weeks: written,
    warning,
    status: googleAdsStatus(),
  };
}

export async function googleAdsProbe() {
  const status = googleAdsStatus();
  let api: Awaited<ReturnType<typeof probeGoogleAdsApi>> | null = null;
  if (status.apiConfigured) {
    api = await probeGoogleAdsApi();
  }
  return { ok: true, status, api };
}

export function googleAdsSyncStatus() {
  return {
    ...googleAdsStatus(),
    sheetId: metricasSheetId(),
    sheetName: metricasSheetName(),
  };
}
