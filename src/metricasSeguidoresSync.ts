import { google } from "googleapis";
import {
  getGoogleAuthClient,
  metricasSheetId,
  metricasSheetName,
} from "./googleAuth";
import {
  fetchSocialFollowers,
  metaConfigured,
  metaStatus,
} from "./metaSocialClient";

function pad2_(n: number): string {
  return String(n).padStart(2, "0");
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

interface Layout {
  sheetName: string;
  igRow: number;
  fbRow: number;
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

  let igRow = -1;
  let fbRow = -1;
  for (let r = 0; r < lastRow; r++) {
    const lab = normLabel_(values[r]?.[labelCol]);
    if (
      igRow < 0 &&
      (lab.includes("seguidores ig") ||
        lab.includes("seguidores instagram") ||
        lab === "instagram")
    ) {
      igRow = r;
    }
    if (
      fbRow < 0 &&
      (lab.includes("fb seguidores") ||
        lab.includes("seguidores fb") ||
        lab.includes("seguidores facebook") ||
        lab === "facebook seguidores")
    ) {
      fbRow = r;
    }
  }
  if (igRow < 0 && fbRow < 0) {
    throw new Error(
      'No encontré filas "Seguidores IG" / "Fb Seguidores" en Metricas'
    );
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
    igRow: igRow >= 0 ? igRow + 1 : -1,
    fbRow: fbRow >= 0 ? fbRow + 1 : -1,
    weekCols,
    values,
  };
}

/** Semana que contiene "hoy" (UTC date), o la última semana ya empezada. */
function pickWeekCol_(
  layout: Layout,
  opts?: { force?: boolean }
): { col: number; date: Date; igEmpty: boolean; fbEmpty: boolean } | null {
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  // Prefer current week
  let target =
    layout.weekCols.find((w) => {
      const start = w.date.getTime();
      const end = start + 7 * 86400000;
      return todayUtc >= start && todayUtc < end;
    }) || null;

  // Else last started week
  if (!target) {
    const started = layout.weekCols.filter((w) => w.date.getTime() <= todayUtc);
    target = started.length ? started[started.length - 1] : null;
  }
  if (!target) return null;

  const igVals = layout.values[layout.igRow - 1] || [];
  const fbVals = layout.values[layout.fbRow - 1] || [];
  const igEmpty = layout.igRow > 0 && isEmptyCell_(igVals[target.col - 1]);
  const fbEmpty = layout.fbRow > 0 && isEmptyCell_(fbVals[target.col - 1]);

  if (!opts?.force && !igEmpty && !fbEmpty) {
    return { col: target.col, date: target.date, igEmpty, fbEmpty };
  }
  return { col: target.col, date: target.date, igEmpty, fbEmpty };
}

export async function syncMetricasSeguidores(opts?: {
  force?: boolean;
}): Promise<{
  ok: boolean;
  sheetName: string;
  weekStart?: string;
  col?: number;
  instagramFollowers?: number;
  facebookFollowers?: number;
  updatedCells: number;
  pageName?: string;
  igUsername?: string | null;
  skipped?: boolean;
  error?: string;
  hint?: string;
}> {
  const cfg = metaConfigured();
  if (!cfg.ok) {
    return {
      ok: false,
      sheetName: metricasSheetName(),
      updatedCells: 0,
      error: `Falta Meta: ${cfg.missing.join(", ")}`,
      hint:
        "Crea un Page Access Token en Meta for Developers y POST /api/ventas/meta-setup { access_token, page_id? }",
    };
  }

  const followers = await fetchSocialFollowers();
  const layout = await loadLayout_();
  const week = pickWeekCol_(layout, { force: opts?.force });
  if (!week) {
    return {
      ok: false,
      sheetName: layout.sheetName,
      updatedCells: 0,
      error: "No hay columna de semana actual en Metricas",
    };
  }

  const weekStart = `${pad2_(week.date.getUTCDate())}/${pad2_(
    week.date.getUTCMonth() + 1
  )}/${String(week.date.getUTCFullYear()).slice(-2)}`;

  const force = Boolean(opts?.force);
  const data: Array<{ range: string; values: number[][] }> = [];
  if (layout.igRow > 0 && (force || week.igEmpty)) {
    data.push({
      range: `'${layout.sheetName}'!${colLetter_(week.col)}${layout.igRow}`,
      values: [[followers.instagramFollowers]],
    });
  }
  if (layout.fbRow > 0 && (force || week.fbEmpty)) {
    data.push({
      range: `'${layout.sheetName}'!${colLetter_(week.col)}${layout.fbRow}`,
      values: [[followers.facebookFollowers]],
    });
  }

  if (!data.length) {
    return {
      ok: true,
      sheetName: layout.sheetName,
      weekStart,
      col: week.col,
      instagramFollowers: followers.instagramFollowers,
      facebookFollowers: followers.facebookFollowers,
      updatedCells: 0,
      pageName: followers.pageName,
      igUsername: followers.igUsername,
      skipped: true,
      hint: "La semana actual ya tenía seguidores; usa ?force=1 para sobrescribir",
    };
  }

  const auth = await getGoogleAuthClient([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  const sheets = google.sheets({ version: "v4", auth: auth as never });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: metricasSheetId(),
    requestBody: { valueInputOption: "RAW", data },
  });

  return {
    ok: true,
    sheetName: layout.sheetName,
    weekStart,
    col: week.col,
    instagramFollowers: followers.instagramFollowers,
    facebookFollowers: followers.facebookFollowers,
    updatedCells: data.length,
    pageName: followers.pageName,
    igUsername: followers.igUsername,
  };
}

export function seguidoresStatus() {
  return {
    meta: metaStatus(),
    sheetId: metricasSheetId(),
    sheetName: metricasSheetName(),
  };
}
