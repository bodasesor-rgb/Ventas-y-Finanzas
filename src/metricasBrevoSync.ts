import { google } from "googleapis";
import {
  getGoogleAuthClient,
  metricasSheetId,
  metricasSheetName,
} from "./googleAuth";
import {
  brevoConfigured,
  brevoStatus,
  fetchBrevoWeekStats,
  probeBrevo,
  type BrevoWeekStats,
} from "./brevoClient";

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

function roundPct_(n: number): number {
  return Math.round(n * 10000) / 10000;
}

interface BrevoRows {
  contactos: number;
  correos: number;
  aperturas: number;
  clicks: number;
  ctr: number;
}

interface Layout {
  sheetName: string;
  rows: BrevoRows;
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
    if (lab.includes("brevo")) {
      sectionStart = r;
      break;
    }
  }
  if (sectionStart < 0) {
    throw new Error('No encontré sección "Brevo Bodasesor" en Metricas');
  }

  const metricNames = new Set([
    "contactos",
    "correos mandados",
    "aperturas",
    "clicks",
    "clics",
    "ctr",
  ]);
  let sectionEnd = lastRow;
  for (let r = sectionStart + 1; r < lastRow; r++) {
    const lab = normLabel_(values[r]?.[labelCol]);
    if (!lab) continue;
    if (metricNames.has(lab)) continue;
    sectionEnd = r;
    break;
  }

  const rows: BrevoRows = {
    contactos: -1,
    correos: -1,
    aperturas: -1,
    clicks: -1,
    ctr: -1,
  };
  for (let r = sectionStart + 1; r < sectionEnd; r++) {
    const lab = normLabel_(values[r]?.[labelCol]);
    if (lab === "contactos" && rows.contactos < 0) rows.contactos = r;
    else if (lab.includes("correos mandados") && rows.correos < 0)
      rows.correos = r;
    else if (lab === "aperturas" && rows.aperturas < 0) rows.aperturas = r;
    else if ((lab === "clicks" || lab === "clics") && rows.clicks < 0)
      rows.clicks = r;
    else if (lab === "ctr" && rows.ctr < 0) rows.ctr = r;
  }
  if (rows.correos < 0 && rows.contactos < 0) {
    throw new Error("No encontré filas Brevo (Contactos / Correos mandados)");
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
      contactos: rows.contactos >= 0 ? rows.contactos + 1 : -1,
      correos: rows.correos >= 0 ? rows.correos + 1 : -1,
      aperturas: rows.aperturas >= 0 ? rows.aperturas + 1 : -1,
      clicks: rows.clicks >= 0 ? rows.clicks + 1 : -1,
      ctr: rows.ctr >= 0 ? rows.ctr + 1 : -1,
    },
    weekCols,
    values,
  };
}

export async function syncMetricasBrevo(opts?: {
  force?: boolean;
  lookbackDays?: number;
}): Promise<{
  ok: boolean;
  sheetName: string;
  updatedCells: number;
  weeks: Array<{
    weekStart: string;
    contactos: number;
    correosMandados: number;
    aperturas: number;
    clicks: number;
    ctr: number;
    campaigns: number;
  }>;
  skipped?: boolean;
  error?: string;
  hint?: string;
  status?: ReturnType<typeof brevoStatus>;
}> {
  const cfg = brevoConfigured();
  if (!cfg.ok) {
    return {
      ok: false,
      sheetName: metricasSheetName(),
      updatedCells: 0,
      weeks: [],
      error: `Falta Brevo: ${cfg.missing.join(", ")}`,
      hint: "POST /api/ventas/brevo-setup { \"api_key\": \"xkeysib-...\" } o env BREVO_API_KEY",
      status: brevoStatus(),
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
    const row =
      layout.values[
        (layout.rows.correos > 0 ? layout.rows.correos : layout.rows.contactos) -
          1
      ] || [];
    const empty = isEmptyCell_(row[w.col - 1]);
    return force || empty;
  });

  if (!targetWeeks.length) {
    return {
      ok: true,
      sheetName: layout.sheetName,
      updatedCells: 0,
      weeks: [],
      skipped: true,
      hint: "No hay semanas vacías de Brevo; usa ?force=1",
      status: brevoStatus(),
    };
  }

  const ranges = targetWeeks.map((w) => {
    const weekEndExclusive = w.date.getTime() + 7 * 86400000;
    let untilMs = weekEndExclusive - 86400000;
    if (untilMs >= todayUtc) untilMs = todayUtc - 86400000;
    if (untilMs < w.date.getTime()) untilMs = w.date.getTime();
    return {
      since: formatIso_(w.date),
      until: formatIso_(new Date(untilMs)),
      col: w.col,
      weekStart: formatDmy_(w.date),
    };
  });

  const stats: BrevoWeekStats[] = await fetchBrevoWeekStats(
    ranges.map((r) => ({ since: r.since, until: r.until }))
  );

  const auth = await getGoogleAuthClient([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  const sheets = google.sheets({ version: "v4", auth: auth as never });
  const data: Array<{ range: string; values: number[][] }> = [];
  const written: Array<{
    weekStart: string;
    contactos: number;
    correosMandados: number;
    aperturas: number;
    clicks: number;
    ctr: number;
    campaigns: number;
  }> = [];

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const m = stats[i];
    const letter = colLetter_(r.col);
    const payload = {
      weekStart: r.weekStart,
      contactos: Math.round(m.contactos),
      correosMandados: Math.round(m.correosMandados),
      aperturas: Math.round(m.aperturas),
      clicks: Math.round(m.clicks),
      ctr: roundPct_(m.ctr),
      campaigns: m.campaigns,
    };
    written.push(payload);
    const map: Array<[number, number]> = [
      [layout.rows.contactos, payload.contactos],
      [layout.rows.correos, payload.correosMandados],
      [layout.rows.aperturas, payload.aperturas],
      [layout.rows.clicks, payload.clicks],
      [layout.rows.ctr, payload.ctr],
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
    updatedCells: data.length,
    weeks: written,
    status: brevoStatus(),
  };
}

export async function brevoProbe() {
  return probeBrevo();
}

export function brevoSyncStatus() {
  return {
    ...brevoStatus(),
    sheetId: metricasSheetId(),
    sheetName: metricasSheetName(),
  };
}
