"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncMetricasGoogleAds = syncMetricasGoogleAds;
exports.googleAdsProbe = googleAdsProbe;
exports.googleAdsSyncStatus = googleAdsSyncStatus;
const googleapis_1 = require("googleapis");
const googleAuth_1 = require("./googleAuth");
const googleAdsClient_1 = require("./googleAdsClient");
function pad2_(n) {
    return String(n).padStart(2, "0");
}
function formatIso_(d) {
    return `${d.getUTCFullYear()}-${pad2_(d.getUTCMonth() + 1)}-${pad2_(d.getUTCDate())}`;
}
function formatDmy_(d) {
    return `${pad2_(d.getUTCDate())}/${pad2_(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(-2)}`;
}
function parseHeaderDate_(raw) {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
    }
    if (typeof raw === "number" && raw > 30000 && raw < 60000) {
        const ms = Math.round((raw - 25569) * 86400 * 1000);
        const d = new Date(ms);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    const s = String(raw ?? "").trim();
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!m)
        return null;
    let yy = Number(m[3]);
    if (yy < 100)
        yy += 2000;
    return new Date(Date.UTC(yy, Number(m[2]) - 1, Number(m[1])));
}
function normLabel_(v) {
    return String(v ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}
function isEmptyCell_(v) {
    if (v == null)
        return true;
    if (typeof v === "number")
        return false;
    return !String(v).trim();
}
function colLetter_(col) {
    let n = col;
    let s = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}
function round2_(n) {
    return Math.round(n * 100) / 100;
}
async function loadLayout_() {
    const auth = await (0, googleAuth_1.getGoogleAuthClient)([
        "https://www.googleapis.com/auth/spreadsheets",
    ]);
    const sheets = googleapis_1.google.sheets({ version: "v4", auth: auth });
    const sheetName = (0, googleAuth_1.metricasSheetName)();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: (0, googleAuth_1.metricasSheetId)(),
        range: `'${sheetName}'!A1:CC80`,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
    });
    const values = (res.data.values || []);
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
    if (ingresosRow < 0)
        throw new Error("No encontré fila Ingresos");
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
        if (!lab)
            continue;
        if (metricNames.has(lab))
            continue;
        sectionEnd = r;
        break;
    }
    const rows = {
        inversion: -1,
        conversion: -1,
        cpl: -1,
        cpc: -1,
        clics: -1,
    };
    for (let r = sectionStart + 1; r < sectionEnd; r++) {
        const lab = normLabel_(values[r]?.[labelCol]);
        if (lab === "inversion" && rows.inversion < 0)
            rows.inversion = r;
        else if (lab === "conversion" && rows.conversion < 0)
            rows.conversion = r;
        else if (lab === "cpl" && rows.cpl < 0)
            rows.cpl = r;
        else if (lab === "cpc" && rows.cpc < 0)
            rows.cpc = r;
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
            if (typeof cell === "number" && cell > 0 && cell < 1000)
                continue;
            const d = parseHeaderDate_(cell);
            if (!d)
                continue;
            const y = d.getUTCFullYear();
            if (y === year || y === year - 1 || y === year + 1)
                count++;
        }
        if (count > best) {
            best = count;
            headerRow = hr;
        }
    }
    if (headerRow < 0)
        throw new Error("No encontré fila de fechas de semana");
    const weekCols = [];
    const headerVals = values[headerRow] || [];
    for (let c = labelCol + 1; c < Math.max(headerVals.length, 60); c++) {
        const hv = headerVals[c];
        if (typeof hv === "number" && hv > 0 && hv < 1000)
            continue;
        const d = parseHeaderDate_(hv);
        if (!d)
            continue;
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
async function syncMetricasGoogleAds(opts) {
    const apiOk = (0, googleAdsClient_1.googleAdsApiConfigured)().ok;
    const ga4Ok = (0, googleAdsClient_1.googleAdsGa4Configured)();
    if (!apiOk && !ga4Ok) {
        return {
            ok: false,
            sheetName: (0, googleAuth_1.metricasSheetName)(),
            updatedCells: 0,
            weeks: [],
            error: "Falta Google Ads API o GA4+service account",
            hint: "POST /api/ventas/google-ads-setup con developer_token + customer_id + refresh_token, o usa el SA de GA4 (fallback solo Inversión/Clics/CPC)",
            status: (0, googleAdsClient_1.googleAdsStatus)(),
        };
    }
    const force = Boolean(opts?.force);
    const lookbackDays = Math.max(7, Number(opts?.lookbackDays) || 45);
    const layout = await loadLayout_();
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const lookbackStart = todayUtc - lookbackDays * 86400000;
    const targetWeeks = layout.weekCols.filter((w) => {
        if (w.date.getTime() > todayUtc)
            return false;
        if (w.date.getTime() + 7 * 86400000 < lookbackStart)
            return false;
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
            status: (0, googleAdsClient_1.googleAdsStatus)(),
        };
    }
    const rangeStart = formatIso_(targetWeeks[0].date);
    let rangeEndMs = targetWeeks[targetWeeks.length - 1].date.getTime() + 6 * 86400000;
    if (rangeEndMs >= todayUtc)
        rangeEndMs = todayUtc - 86400000;
    if (rangeEndMs < targetWeeks[0].date.getTime()) {
        rangeEndMs = targetWeeks[0].date.getTime();
    }
    const rangeEnd = formatIso_(new Date(rangeEndMs));
    let source = "ga4";
    let daily = [];
    let warning;
    const useApi = apiOk && !opts?.preferGa4;
    if (useApi) {
        try {
            daily = await (0, googleAdsClient_1.fetchGoogleAdsApiDaily)({ since: rangeStart, until: rangeEnd });
            source = "google_ads_api";
        }
        catch (e) {
            if (!ga4Ok)
                throw e;
            warning = `Google Ads API falló (${e instanceof Error ? e.message : String(e)}); usando GA4 (sin conversiones reales)`;
            daily = await (0, googleAdsClient_1.fetchGoogleAdsGa4Daily)({
                since: rangeStart,
                until: rangeEnd,
            });
            source = "ga4";
        }
    }
    else {
        daily = await (0, googleAdsClient_1.fetchGoogleAdsGa4Daily)({
            since: rangeStart,
            until: rangeEnd,
        });
        source = "ga4";
        warning =
            "Usando GA4 (costo/clics). Para Conversión/CPL reales configura Google Ads API.";
    }
    const auth = await (0, googleAuth_1.getGoogleAuthClient)([
        "https://www.googleapis.com/auth/spreadsheets",
    ]);
    const sheets = googleapis_1.google.sheets({ version: "v4", auth: auth });
    const data = [];
    const written = [];
    for (const w of targetWeeks) {
        const weekEndExclusive = w.date.getTime() + 7 * 86400000;
        let untilMs = weekEndExclusive - 86400000;
        if (untilMs >= todayUtc)
            untilMs = todayUtc - 86400000;
        if (untilMs < w.date.getTime())
            untilMs = w.date.getTime();
        const since = formatIso_(w.date);
        const until = formatIso_(new Date(untilMs));
        const m = (0, googleAdsClient_1.aggregateWeekMetrics_)(daily, since, until, source);
        const letter = colLetter_(w.col);
        const payload = {
            weekStart: formatDmy_(w.date),
            inversion: round2_(m.inversion),
            conversion: round2_(m.conversion),
            cpl: round2_(m.cpl),
            cpc: round2_(m.cpc),
            clics: Math.round(m.clics),
        };
        written.push(payload);
        const writeConv = source === "google_ads_api";
        const map = [
            [layout.rows.inversion, payload.inversion, true],
            [layout.rows.conversion, payload.conversion, writeConv],
            [layout.rows.cpl, payload.cpl, writeConv],
            [layout.rows.cpc, payload.cpc, true],
            [layout.rows.clics, payload.clics, true],
        ];
        for (const [row, val, doWrite] of map) {
            if (row > 0 && doWrite) {
                data.push({
                    range: `'${layout.sheetName}'!${letter}${row}`,
                    values: [[val]],
                });
            }
        }
    }
    if (data.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: (0, googleAuth_1.metricasSheetId)(),
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
        status: (0, googleAdsClient_1.googleAdsStatus)(),
    };
}
async function googleAdsProbe() {
    const status = (0, googleAdsClient_1.googleAdsStatus)();
    let api = null;
    if (status.apiConfigured) {
        api = await (0, googleAdsClient_1.probeGoogleAdsApi)();
    }
    return { ok: true, status, api };
}
function googleAdsSyncStatus() {
    return {
        ...(0, googleAdsClient_1.googleAdsStatus)(),
        sheetId: (0, googleAuth_1.metricasSheetId)(),
        sheetName: (0, googleAuth_1.metricasSheetName)(),
    };
}
//# sourceMappingURL=metricasGoogleAdsSync.js.map