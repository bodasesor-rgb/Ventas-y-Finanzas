"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncMetricasFacebookAds = syncMetricasFacebookAds;
exports.facebookAdsProbe = facebookAdsProbe;
exports.facebookAdsSyncStatus = facebookAdsSyncStatus;
const googleapis_1 = require("googleapis");
const googleAuth_1 = require("./googleAuth");
const metaAdsClient_1 = require("./metaAdsClient");
const metaSocialClient_1 = require("./metaSocialClient");
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
    // Sección "Facebook Ads" (no Google Ads)
    let sectionStart = -1;
    for (let r = 0; r < lastRow; r++) {
        const lab = normLabel_(values[r]?.[labelCol]);
        if (lab === "facebook ads" ||
            lab === "fb ads" ||
            lab === "meta ads") {
            sectionStart = r;
            break;
        }
    }
    if (sectionStart < 0) {
        throw new Error('No encontré sección "Facebook Ads" en Metricas');
    }
    // Fin de sección: siguiente encabezado no-métrica
    const metricNames = new Set([
        "inversion",
        "conversion",
        "cpl",
        "cpc",
        "clics",
        "alcance",
        "cpm",
    ]);
    let sectionEnd = lastRow;
    for (let r = sectionStart + 1; r < lastRow; r++) {
        const lab = normLabel_(values[r]?.[labelCol]);
        if (!lab)
            continue;
        if (metricNames.has(lab))
            continue;
        // otro bloque
        sectionEnd = r;
        break;
    }
    const rows = {
        inversion: -1,
        conversion: -1,
        cpl: -1,
        cpc: -1,
        clics: -1,
        alcance: -1,
        cpm: -1,
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
        else if (lab === "alcance" && rows.alcance < 0)
            rows.alcance = r;
        else if (lab === "cpm" && rows.cpm < 0)
            rows.cpm = r;
    }
    if (rows.inversion < 0) {
        throw new Error('No encontré fila "Inversión" bajo Facebook Ads en Metricas');
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
        labelCol,
        rows: {
            inversion: rows.inversion + 1,
            conversion: rows.conversion >= 0 ? rows.conversion + 1 : -1,
            cpl: rows.cpl >= 0 ? rows.cpl + 1 : -1,
            cpc: rows.cpc >= 0 ? rows.cpc + 1 : -1,
            clics: rows.clics >= 0 ? rows.clics + 1 : -1,
            alcance: rows.alcance >= 0 ? rows.alcance + 1 : -1,
            cpm: rows.cpm >= 0 ? rows.cpm + 1 : -1,
        },
        weekCols,
        values,
    };
}
function round2_(n) {
    return Math.round(n * 100) / 100;
}
async function syncMetricasFacebookAds(opts) {
    const cfg = (0, metaSocialClient_1.metaConfigured)();
    if (!cfg.ok) {
        return {
            ok: false,
            sheetName: (0, googleAuth_1.metricasSheetName)(),
            updatedCells: 0,
            weeks: [],
            error: `Falta Meta: ${cfg.missing.join(", ")}`,
            hint: "Define FB_META en Hostinger o POST /api/ventas/meta-setup",
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
            hint: "No hay semanas vacías de Facebook Ads en el lookback; usa ?force=1",
        };
    }
    const ranges = targetWeeks.map((w) => {
        const weekEndExclusive = w.date.getTime() + 7 * 86400000;
        // semana en curso: hasta ayer (o hoy si ya cerró día en UTC)
        let untilMs = weekEndExclusive - 86400000;
        if (untilMs >= todayUtc)
            untilMs = todayUtc - 86400000;
        if (untilMs < w.date.getTime())
            untilMs = w.date.getTime();
        return {
            since: formatIso_(w.date),
            until: formatIso_(new Date(untilMs)),
            col: w.col,
            weekStart: formatDmy_(w.date),
        };
    });
    const { account, weeks: metrics } = await (0, metaAdsClient_1.fetchAdsMetricsForWeeks)(ranges.map((r) => ({ since: r.since, until: r.until })));
    const auth = await (0, googleAuth_1.getGoogleAuthClient)([
        "https://www.googleapis.com/auth/spreadsheets",
    ]);
    const sheets = googleapis_1.google.sheets({ version: "v4", auth: auth });
    const data = [];
    const written = [];
    let conversionActionType = null;
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const m = metrics[i];
        if (m.conversionActionType)
            conversionActionType = m.conversionActionType;
        const letter = colLetter_(r.col);
        const payload = {
            weekStart: r.weekStart,
            inversion: round2_(m.inversion),
            conversion: m.conversion,
            cpl: round2_(m.cpl),
            cpc: round2_(m.cpc),
            clics: m.clics,
            alcance: m.alcance,
            cpm: round2_(m.cpm),
        };
        written.push(payload);
        const map = [
            [layout.rows.inversion, payload.inversion],
            [layout.rows.conversion, payload.conversion],
            [layout.rows.cpl, payload.cpl],
            [layout.rows.cpc, payload.cpc],
            [layout.rows.clics, payload.clics],
            [layout.rows.alcance, payload.alcance],
            [layout.rows.cpm, payload.cpm],
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
            spreadsheetId: (0, googleAuth_1.metricasSheetId)(),
            requestBody: { valueInputOption: "RAW", data },
        });
    }
    return {
        ok: true,
        sheetName: layout.sheetName,
        adAccountId: account.id,
        adAccountName: account.name,
        updatedCells: data.length,
        weeks: written,
        conversionActionType,
    };
}
async function facebookAdsProbe() {
    const account = await (0, metaAdsClient_1.resolveAdAccount)();
    return {
        ok: true,
        account,
        status: (0, metaAdsClient_1.metaAdsStatus)(),
    };
}
function facebookAdsSyncStatus() {
    return {
        ...(0, metaAdsClient_1.metaAdsStatus)(),
        sheetId: (0, googleAuth_1.metricasSheetId)(),
        sheetName: (0, googleAuth_1.metricasSheetName)(),
    };
}
//# sourceMappingURL=metricasFacebookAdsSync.js.map