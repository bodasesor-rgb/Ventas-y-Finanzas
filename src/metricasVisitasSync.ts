import { google } from "googleapis";
import {
  fetchGa4VisitasDaily,
  ga4Configured,
  type DailySessions,
} from "./ga4Client";
import {
  getGoogleAuthClient,
  loadServiceAccountJson,
  metricasSheetId,
  metricasSheetName,
} from "./googleAuth";
import { postToAppsScript } from "./appsScriptClient";

export interface WeekVisitas {
  weekStart: string; // DD/MM/YYYY as in sheet header
  weekStartIso: string; // YYYY-MM-DD
  col: number; // 1-based
  site: number;
  organic: number;
  blogs: number;
  colecciones: number;
  /** celdas que ya tenían valor y no se tocan (salvo force) */
  alreadyFilled: boolean;
}

function pad2_(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDmy_(d: Date): string {
  return `${pad2_(d.getUTCDate())}/${pad2_(d.getUTCMonth() + 1)}/${String(
    d.getUTCFullYear()
  ).slice(-2)}`;
}

function formatDmyLong_(d: Date): string {
  return `${pad2_(d.getUTCDate())}/${pad2_(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function parseHeaderDate_(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return new Date(
      Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate())
    );
  }
  if (typeof raw === "number" && raw > 30000 && raw < 60000) {
    // serial Sheets → UTC date
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  let yy = Number(m[3]);
  if (yy < 100) yy += 2000;
  return new Date(Date.UTC(yy, Number(m[2]) - 1, Number(m[1])));
}

function yyyymmddToUtc_(yyyymmdd: string): Date {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d));
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
  const s = String(v).trim();
  if (!s) return true;
  if (s === "0" || s === "0.0") return false;
  return false;
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

interface MetricasLayout {
  sheetName: string;
  headerRow: number;
  labelCol: number;
  visitasSiteRow: number;
  visitasOrganicRow: number;
  visitasBlogsRow: number;
  visitasColeccionesRow: number;
  weekCols: Array<{ col: number; date: Date; headerRaw: string }>;
  values: unknown[][];
}

async function loadMetricasViaSheetsApi_(): Promise<MetricasLayout> {
  const auth = await getGoogleAuthClient([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  const sheets = google.sheets({ version: "v4", auth: auth as never });
  const spreadsheetId = metricasSheetId();
  const sheetName = metricasSheetName();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A1:CC80`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  const values = (res.data.values || []) as unknown[][];
  return detectLayout_(sheetName, values);
}

/** Fallback público CSV (solo lectura de layout; escritura requiere SA). */
async function loadMetricasViaCsv_(): Promise<MetricasLayout> {
  const id = metricasSheetId();
  const sheetName = metricasSheetName();
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`CSV Metricas HTTP ${res.status}`);
  const text = await res.text();
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (q) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
      continue;
    }
    if (ch === '"') {
      q = true;
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
  return detectLayout_(sheetName, rows);
}

function detectLayout_(
  sheetName: string,
  values: unknown[][]
): MetricasLayout {
  const lastRow = Math.min(values.length, 80);
  let labelCol = 0;
  let visitasSiteRow = -1;
  let visitasOrganicRow = -1;
  let visitasBlogsRow = -1;
  let visitasColeccionesRow = -1;
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
  if (ingresosRow < 0) {
    throw new Error("No encontré fila Ingresos en Metricas");
  }

  for (let r = 0; r < lastRow; r++) {
    const lab = normLabel_(values[r]?.[labelCol]);
    if (visitasSiteRow < 0 && lab.includes("visitas al sitio")) {
      visitasSiteRow = r;
    }
    if (
      visitasOrganicRow < 0 &&
      (lab.includes("visitas organicas") || lab.includes("visitas orgánicas"))
    ) {
      visitasOrganicRow = r;
    }
    if (visitasBlogsRow < 0 && lab.includes("visitas blog")) {
      visitasBlogsRow = r;
    }
    if (
      visitasColeccionesRow < 0 &&
      lab.includes("visitas colecciones")
    ) {
      visitasColeccionesRow = r;
    }
  }

  if (visitasSiteRow < 0) {
    throw new Error('No encontré fila "Visitas al sitio" en Metricas');
  }

  // Fila de fechas arriba de Ingresos
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
  if (headerRow < 0 || best < 2) {
    throw new Error("No encontré fila de fechas de semana en Metricas");
  }

  const weekCols: MetricasLayout["weekCols"] = [];
  const headerVals = values[headerRow] || [];
  for (let c = labelCol + 1; c < Math.max(headerVals.length, 60); c++) {
    const hv = headerVals[c];
    if (typeof hv === "number" && hv > 0 && hv < 1000) continue;
    const d = parseHeaderDate_(hv);
    if (!d) continue;
    weekCols.push({
      col: c + 1,
      date: d,
      headerRaw: String(hv ?? ""),
    });
  }

  return {
    sheetName,
    headerRow: headerRow + 1,
    labelCol: labelCol + 1,
    visitasSiteRow: visitasSiteRow + 1,
    visitasOrganicRow: visitasOrganicRow + 1,
    visitasBlogsRow: visitasBlogsRow + 1,
    visitasColeccionesRow: visitasColeccionesRow + 1,
    weekCols,
    values,
  };
}

function buildWeekPayload_(
  layout: MetricasLayout,
  daily: Awaited<ReturnType<typeof fetchGa4VisitasDaily>>,
  opts?: { force?: boolean; onlyEmpty?: boolean }
): WeekVisitas[] {
  const onlyEmpty = opts?.onlyEmpty !== false;
  const force = Boolean(opts?.force);
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  const out: WeekVisitas[] = [];
  for (const w of layout.weekCols) {
    const weekEnd = w.date.getTime() + 7 * 86400000;
    // no llenar semanas futuras
    if (w.date.getTime() > todayUtc) continue;
    // semana en curso: sí llenar parcial hasta ayer

    const siteRow = layout.values[layout.visitasSiteRow - 1] || [];
    const existing = siteRow[w.col - 1];
    const alreadyFilled = !isEmptyCell_(existing);
    if (onlyEmpty && alreadyFilled && !force) continue;

    // Para semana actual, sumar solo hasta ayer
    let endCap = weekEnd;
    if (weekEnd > todayUtc) {
      endCap = todayUtc; // exclusive end = today start → through yesterday
    }

    const filterDaily = (rows: DailySessions[]) =>
      rows.filter((r) => {
        const t = yyyymmddToUtc_(r.date).getTime();
        return t >= w.date.getTime() && t < Math.min(weekEnd, endCap || weekEnd);
      });

    // reuse sumInWeek_ but with cap: temporarily filter
    const site = filterDaily(daily.site).reduce((a, b) => a + b.sessions, 0);
    const organic = filterDaily(daily.organic).reduce(
      (a, b) => a + b.sessions,
      0
    );
    const blogs = filterDaily(daily.blogs).reduce((a, b) => a + b.sessions, 0);
    const colecciones = filterDaily(daily.colecciones).reduce(
      (a, b) => a + b.sessions,
      0
    );

    // skip weeks with zero everywhere before first traffic (optional)
    // still write 0 for past empty weeks inside lookback

    out.push({
      weekStart: formatDmy_(w.date),
      weekStartIso: `${w.date.getUTCFullYear()}-${pad2_(
        w.date.getUTCMonth() + 1
      )}-${pad2_(w.date.getUTCDate())}`,
      col: w.col,
      site,
      organic,
      blogs,
      colecciones,
      alreadyFilled,
    });
  }
  return out;
}

async function writeViaSheetsApi_(
  layout: MetricasLayout,
  weeks: WeekVisitas[]
): Promise<{ updatedCells: number; method: string }> {
  const auth = await getGoogleAuthClient([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  const sheets = google.sheets({ version: "v4", auth: auth as never });
  const spreadsheetId = metricasSheetId();
  const data: Array<{ range: string; values: number[][] }> = [];

  for (const w of weeks) {
    const letter = colLetter_(w.col);
    if (layout.visitasSiteRow > 0) {
      data.push({
        range: `'${layout.sheetName}'!${letter}${layout.visitasSiteRow}`,
        values: [[w.site]],
      });
    }
    if (layout.visitasOrganicRow > 0) {
      data.push({
        range: `'${layout.sheetName}'!${letter}${layout.visitasOrganicRow}`,
        values: [[w.organic]],
      });
    }
    if (layout.visitasBlogsRow > 0) {
      data.push({
        range: `'${layout.sheetName}'!${letter}${layout.visitasBlogsRow}`,
        values: [[w.blogs]],
      });
    }
    if (layout.visitasColeccionesRow > 0) {
      data.push({
        range: `'${layout.sheetName}'!${letter}${layout.visitasColeccionesRow}`,
        values: [[w.colecciones]],
      });
    }
  }

  if (!data.length) {
    return { updatedCells: 0, method: "sheets_api" };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });
  return { updatedCells: data.length, method: "sheets_api" };
}

async function writeViaAppsScript_(
  weeks: WeekVisitas[]
): Promise<{ updatedCells: number; method: string; version?: string }> {
  const result = await postToAppsScript(
    {
      action: "upsertMetricasVisitas",
      sheetName: metricasSheetName(),
      weeks: weeks.map((w) => ({
        weekStart: w.weekStart,
        weekStartLong: formatDmyLong_(new Date(w.weekStartIso + "T00:00:00Z")),
        site: w.site,
        organic: w.organic,
        blogs: w.blogs,
        colecciones: w.colecciones,
      })),
    },
    { timeoutMs: 90_000 }
  );
  return {
    updatedCells: Number(
      (result as { updatedCells?: number }).updatedCells || weeks.length
    ),
    method: "apps_script",
    version: result.version,
  };
}

/**
 * Sincroniza visitas GA4 → Metricas Auto (semanas vacías por defecto).
 */
export async function syncMetricasVisitas(opts?: {
  force?: boolean;
  /** días atrás para pedir a GA4 (default 120) */
  lookbackDays?: number;
  /** si true, rellena aunque la celda ya tenga número */
  overwrite?: boolean;
}): Promise<{
  ok: boolean;
  propertyId?: string;
  sheetName: string;
  weeksConsidered: number;
  weeksWritten: number;
  updatedCells: number;
  method?: string;
  weeks: WeekVisitas[];
  error?: string;
  hint?: string;
}> {
  const cfg = ga4Configured();
  if (!cfg.ok) {
    return {
      ok: false,
      sheetName: metricasSheetName(),
      weeksConsidered: 0,
      weeksWritten: 0,
      updatedCells: 0,
      weeks: [],
      error: `Faltan credenciales GA4: ${cfg.missing.join(", ")}`,
      hint:
        "En Hostinger agrega GA4_PROPERTY_ID y GOOGLE_SERVICE_ACCOUNT_JSON. Comparte el Sheet con el email del service account (Editor) y dale Viewer en la propiedad GA4.",
    };
  }

  const lookbackDays = opts?.lookbackDays ?? 120;
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);
  const startDate = `${start.getUTCFullYear()}-${pad2_(
    start.getUTCMonth() + 1
  )}-${pad2_(start.getUTCDate())}`;
  const endDate = `${end.getUTCFullYear()}-${pad2_(
    end.getUTCMonth() + 1
  )}-${pad2_(end.getUTCDate())}`;

  let layout: MetricasLayout;
  try {
    layout = await loadMetricasViaSheetsApi_();
  } catch (err) {
    console.warn(
      "[metricas-visitas] Sheets API falló, intento CSV",
      err instanceof Error ? err.message : err
    );
    layout = await loadMetricasViaCsv_();
  }

  const daily = await fetchGa4VisitasDaily({ startDate, endDate });
  const weeks = buildWeekPayload_(layout, daily, {
    force: opts?.overwrite || opts?.force,
    onlyEmpty: !(opts?.overwrite || opts?.force),
  });

  // Limitar escritura a semanas que intersectan el lookback GA4
  const startMs = start.getTime();
  const writable = weeks.filter((w) => {
    const t = new Date(w.weekStartIso + "T00:00:00Z").getTime();
    return t + 6 * 86400000 >= startMs; // week overlaps lookback
  });

  if (!writable.length) {
    return {
      ok: true,
      propertyId: daily.propertyId,
      sheetName: layout.sheetName,
      weeksConsidered: weeks.length,
      weeksWritten: 0,
      updatedCells: 0,
      weeks: [],
      hint: "No hay semanas vacías que llenar en el lookback",
    };
  }

  let writeResult: { updatedCells: number; method: string; version?: string };
  try {
    writeResult = await writeViaSheetsApi_(layout, writable);
  } catch (err) {
    console.warn(
      "[metricas-visitas] write Sheets API falló, intento Apps Script",
      err instanceof Error ? err.message : err
    );
    try {
      writeResult = await writeViaAppsScript_(writable);
    } catch (err2) {
      const sa = loadServiceAccountJson();
      return {
        ok: false,
        propertyId: daily.propertyId,
        sheetName: layout.sheetName,
        weeksConsidered: weeks.length,
        weeksWritten: 0,
        updatedCells: 0,
        weeks: writable,
        error: err2 instanceof Error ? err2.message : String(err2),
        hint: sa?.client_email
          ? `Comparte el Sheet con ${sa.client_email} como Editor, o publica Apps Script v31 (upsertMetricasVisitas).`
          : "Configura service account con acceso al Sheet o Apps Script v31.",
      };
    }
  }

  return {
    ok: true,
    propertyId: daily.propertyId,
    sheetName: layout.sheetName,
    weeksConsidered: weeks.length,
    weeksWritten: writable.length,
    updatedCells: writeResult.updatedCells,
    method: writeResult.method,
    weeks: writable,
  };
}

export function metricasVisitasStatus(): {
  ga4: ReturnType<typeof ga4Configured>;
  sheetId: string;
  sheetName: string;
  serviceAccountEmail: string | null;
} {
  const sa = (() => {
    try {
      return loadServiceAccountJson();
    } catch {
      return null;
    }
  })();
  return {
    ga4: ga4Configured(),
    sheetId: metricasSheetId(),
    sheetName: metricasSheetName(),
    serviceAccountEmail: sa?.client_email || null,
  };
}
