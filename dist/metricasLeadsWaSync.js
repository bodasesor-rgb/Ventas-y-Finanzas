"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyStatusName_ = classifyStatusName_;
exports.isCotizacionMail_ = isCotizacionMail_;
exports.syncMetricasLeadsWa = syncMetricasLeadsWa;
exports.leadsWaProbe = leadsWaProbe;
const googleapis_1 = require("googleapis");
const googleAuth_1 = require("./googleAuth");
const kommoApi_1 = require("./kommoApi");
function pad2_(n) {
    return String(n).padStart(2, "0");
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
function roundPct_(n) {
    return Math.round(n * 10000) / 10000;
}
/** Clasificación de etapa según nombre (reglas Bodasesor). */
function classifyStatusName_(name) {
    const n = normLabel_(name);
    if (n.includes("datos de cliente") ||
        n.includes("dato de cliente") ||
        n === "datos clientes" ||
        n.includes("datos clientes")) {
        return "no_contestaron";
    }
    if (n.includes("humano trabaja") ||
        n.includes("seguimiento") ||
        n.includes("intencion de pag") ||
        n.includes("intencion paga")) {
        return "llenado";
    }
    return "other";
}
/** Correo cuenta solo si el asunto habla de cotización (no publicidad). */
function isCotizacionMail_(subject) {
    const n = normLabel_(subject);
    if (!n)
        return false;
    if (n.includes("publicidad") ||
        n.includes("promo") ||
        n.includes("newsletter") ||
        n.includes("marketing") ||
        n.includes("descuento")) {
        // si igual dice cotización, sí cuenta
        if (!n.includes("cotizacion"))
            return false;
    }
    return n.includes("cotizacion");
}
function pickWaPipeline_(pipelines) {
    if (!pipelines.length)
        return null;
    const scored = pipelines.map((p) => {
        const n = normLabel_(p.name);
        let score = 0;
        if (n.includes("whatsapp") || n.includes("wa ") || n.endsWith(" wa") || n === "wa")
            score += 10;
        if (n.includes("lead"))
            score += 3;
        if (n.includes("bodasesor"))
            score += 2;
        if (p.is_main)
            score += 1;
        return { p, score };
    });
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > 0)
        return scored[0].p;
    // Si no hay WA explícito, usar el pipeline con más statuses “datos/humano”
    let best = null;
    let bestHits = -1;
    for (const p of pipelines) {
        let hits = 0;
        for (const s of p.statuses) {
            const c = classifyStatusName_(s.name);
            if (c !== "other")
                hits++;
        }
        if (hits > bestHits) {
            bestHits = hits;
            best = p;
        }
    }
    return best || pipelines[0];
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
        if (lab.includes("leads wa") ||
            lab === "leads kommo" ||
            lab.includes("leads wa kommo")) {
            sectionStart = r;
            break;
        }
    }
    if (sectionStart < 0) {
        throw new Error('No encontré sección "Leads WA Kommo" en Metricas');
    }
    const metricNames = new Set([
        "leads",
        "correo",
        "no contestaron",
        "llenado",
        "porcentaje de llenado",
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
        leads: -1,
        correo: -1,
        noContestaron: -1,
        llenado: -1,
        porcentaje: -1,
    };
    for (let r = sectionStart + 1; r < sectionEnd; r++) {
        const lab = normLabel_(values[r]?.[labelCol]);
        if (lab === "leads" && rows.leads < 0)
            rows.leads = r;
        else if (lab === "correo" && rows.correo < 0)
            rows.correo = r;
        else if (lab.includes("no contestaron") && rows.noContestaron < 0)
            rows.noContestaron = r;
        else if (lab === "llenado" && rows.llenado < 0)
            rows.llenado = r;
        else if (lab.includes("porcentaje de llenado") && rows.porcentaje < 0)
            rows.porcentaje = r;
    }
    if (rows.leads < 0) {
        throw new Error('No encontré fila "Leads" bajo Leads WA Kommo');
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
            leads: rows.leads + 1,
            correo: rows.correo >= 0 ? rows.correo + 1 : -1,
            noContestaron: rows.noContestaron >= 0 ? rows.noContestaron + 1 : -1,
            llenado: rows.llenado >= 0 ? rows.llenado + 1 : -1,
            porcentaje: rows.porcentaje >= 0 ? rows.porcentaje + 1 : -1,
        },
        weekCols,
        values,
    };
}
function buildStatusMaps_(pipeline) {
    const byId = new Map();
    const noContestaronIds = new Set();
    const llenadoIds = new Set();
    for (const s of pipeline.statuses) {
        byId.set(s.id, s.name);
        const c = classifyStatusName_(s.name);
        if (c === "no_contestaron")
            noContestaronIds.add(s.id);
        if (c === "llenado")
            llenadoIds.add(s.id);
    }
    return { byId, noContestaronIds, llenadoIds };
}
async function syncMetricasLeadsWa(opts) {
    const force = Boolean(opts?.force);
    const lookbackDays = Math.max(7, Number(opts?.lookbackDays) || 45);
    const layout = await loadLayout_();
    const pipelines = await (0, kommoApi_1.fetchKommoPipelines)();
    const pipeline = (opts?.pipelineId
        ? pipelines.find((p) => p.id === opts.pipelineId)
        : null) || pickWaPipeline_(pipelines);
    if (!pipeline) {
        return {
            ok: false,
            sheetName: layout.sheetName,
            updatedCells: 0,
            weeks: [],
            error: "No hay pipelines en Kommo",
        };
    }
    const maps = buildStatusMaps_(pipeline);
    if (!maps.noContestaronIds.size && !maps.llenadoIds.size) {
        return {
            ok: false,
            sheetName: layout.sheetName,
            pipeline: { id: pipeline.id, name: pipeline.name },
            statusMap: pipeline.statuses.map((s) => ({
                id: s.id,
                name: s.name,
                class: classifyStatusName_(s.name),
            })),
            updatedCells: 0,
            weeks: [],
            error: 'No encontré etapas "Datos de clientes" / "Humano trabaja" / "Seguimientos" / "Intención de paga" en el pipeline',
            hint: "Revisa statusMap y ajusta nombres en Kommo o avísame los nombres exactos",
        };
    }
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const lookbackStart = todayUtc - lookbackDays * 86400000;
    const targetWeeks = layout.weekCols.filter((w) => {
        if (w.date.getTime() > todayUtc)
            return false;
        if (w.date.getTime() + 7 * 86400000 < lookbackStart)
            return false;
        const leadsRow = layout.values[layout.rows.leads - 1] || [];
        const empty = isEmptyCell_(leadsRow[w.col - 1]);
        return force || empty;
    });
    if (!targetWeeks.length) {
        return {
            ok: true,
            sheetName: layout.sheetName,
            pipeline: { id: pipeline.id, name: pipeline.name },
            updatedCells: 0,
            weeks: [],
            skipped: true,
            hint: "No hay semanas vacías de Leads WA; usa ?force=1",
        };
    }
    const rangeFrom = Math.floor(targetWeeks[0].date.getTime() / 1000);
    let rangeToMs = targetWeeks[targetWeeks.length - 1].date.getTime() + 7 * 86400000 - 1000;
    if (rangeToMs > Date.now())
        rangeToMs = Date.now();
    const rangeTo = Math.floor(rangeToMs / 1000);
    const [allLeads, allMails] = await Promise.all([
        (0, kommoApi_1.fetchLeadsCreatedBetween)({
            fromUnix: rangeFrom,
            toUnix: rangeTo,
            pipelineId: pipeline.id,
        }),
        (0, kommoApi_1.fetchOutgoingMailEvents)({
            fromUnix: rangeFrom,
            toUnix: rangeTo,
        }),
    ]);
    const cotizacionMails = allMails.filter((m) => isCotizacionMail_(m.subject || ""));
    const mailSample = [
        ...new Set(allMails
            .map((m) => (m.subject || "").trim())
            .filter(Boolean)
            .slice(0, 15)),
    ];
    const weeks = [];
    for (const w of targetWeeks) {
        const weekStartMs = w.date.getTime();
        let weekEndMs = weekStartMs + 7 * 86400000;
        if (weekEndMs > Date.now() + 1000)
            weekEndMs = Date.now() + 1000;
        const fromU = Math.floor(weekStartMs / 1000);
        const toU = Math.floor((weekEndMs - 1) / 1000);
        const weekLeads = allLeads.filter((l) => {
            const c = Number(l.created_at || 0);
            return c >= fromU && c <= toU;
        });
        let noContestaron = 0;
        let llenado = 0;
        for (const l of weekLeads) {
            const sid = Number(l.status_id);
            if (maps.noContestaronIds.has(sid))
                noContestaron++;
            else if (maps.llenadoIds.has(sid))
                llenado++;
        }
        const leads = weekLeads.length;
        const correo = cotizacionMails.filter((m) => {
            const c = Number(m.created_at || 0);
            return c >= fromU && c <= toU;
        }).length;
        const porcentaje = leads > 0 ? llenado / leads : 0;
        weeks.push({
            weekStart: formatDmy_(w.date),
            leads,
            correo,
            noContestaron,
            llenado,
            porcentaje: roundPct_(porcentaje),
        });
    }
    const auth = await (0, googleAuth_1.getGoogleAuthClient)([
        "https://www.googleapis.com/auth/spreadsheets",
    ]);
    const sheets = googleapis_1.google.sheets({ version: "v4", auth: auth });
    const data = [];
    for (let i = 0; i < targetWeeks.length; i++) {
        const w = targetWeeks[i];
        const m = weeks[i];
        const letter = colLetter_(w.col);
        const map = [
            [layout.rows.leads, m.leads],
            [layout.rows.correo, m.correo],
            [layout.rows.noContestaron, m.noContestaron],
            [layout.rows.llenado, m.llenado],
            [layout.rows.porcentaje, m.porcentaje],
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
        pipeline: { id: pipeline.id, name: pipeline.name },
        statusMap: pipeline.statuses.map((s) => ({
            id: s.id,
            name: s.name,
            class: classifyStatusName_(s.name),
        })),
        updatedCells: data.length,
        weeks,
        mailSample,
        hint: cotizacionMails.length === 0 && allMails.length === 0
            ? "No se leyeron correos desde Kommo (events/notes). Revisa permisos de Mail o avísame."
            : cotizacionMails.length === 0 && allMails.length > 0
                ? "Hay correos pero ninguno con 'cotización' en el asunto. Revisa mailSample."
                : undefined,
    };
}
async function leadsWaProbe() {
    const pipelines = await (0, kommoApi_1.fetchKommoPipelines)();
    const pipeline = pickWaPipeline_(pipelines);
    return {
        ok: true,
        pipelines: pipelines.map((p) => ({
            id: p.id,
            name: p.name,
            is_main: p.is_main,
            statuses: p.statuses.map((s) => ({
                id: s.id,
                name: s.name,
                class: classifyStatusName_(s.name),
            })),
        })),
        selected: pipeline
            ? { id: pipeline.id, name: pipeline.name }
            : null,
    };
}
//# sourceMappingURL=metricasLeadsWaSync.js.map