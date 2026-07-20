"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pnlRouter = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = require("crypto");
const categorize_1 = require("./categorize");
const parseStatement_1 = require("./parseStatement");
const period_1 = require("./period");
const statementFiles_1 = require("./statementFiles");
const autoCategories_1 = require("./autoCategories");
const categoryColors_1 = require("./categoryColors");
const statementSummary_1 = require("./statementSummary");
const driveArchive_1 = require("./driveArchive");
const counterparties_1 = require("./counterparties");
const providerAnalysis_1 = require("./providerAnalysis");
const appsScriptClient_1 = require("../appsScriptClient");
const appsScriptClient_2 = require("../appsScriptClient");
const estadoResultados_1 = require("./estadoResultados");
const sendToSheet_1 = require("./sendToSheet");
const store_1 = require("./store");
const uploadDir = path_1.default.join(process.cwd(), "uploads");
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
const upload = (0, multer_1.default)({
    dest: uploadDir,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === "application/pdf" ||
            file.originalname.toLowerCase().endsWith(".pdf")) {
            cb(null, true);
        }
        else {
            cb(new Error("Solo PDF"));
        }
    },
});
exports.pnlRouter = (0, express_1.Router)();
function runPublic(run) {
    const { textFull: _t, ...rest } = run;
    return rest;
}
exports.pnlRouter.get("/api/pnl/categories", (_req, res) => {
    res.json({ ok: true, categories: (0, store_1.loadCategories)() });
});
exports.pnlRouter.put("/api/pnl/categories", (req, res) => {
    const categories = req.body?.categories;
    if (!Array.isArray(categories)) {
        res.status(400).json({ ok: false, error: "categories debe ser array" });
        return;
    }
    const cleaned = [];
    const seen = new Set();
    for (const c of categories) {
        if (!c || !c.id || !c.label)
            continue;
        const id = (0, store_1.slugCategory)(String(c.id));
        if (seen.has(id))
            continue;
        seen.add(id);
        const kind = c.kind === "ingreso" || c.kind === "gasto" || c.kind === "neutro"
            ? c.kind
            : "gasto";
        cleaned.push({
            id,
            label: String(c.label).trim().slice(0, 80),
            kind,
            color: c.color || (0, categoryColors_1.colorForCategoryId)(id, cleaned.length),
            builtin: Boolean(c.builtin),
            autoCreated: Boolean(c.autoCreated),
        });
    }
    if (!cleaned.some((c) => c.id === "revisar")) {
        cleaned.push({
            id: "revisar",
            label: "Revisar",
            kind: "neutro",
            builtin: true,
        });
    }
    if (!cleaned.some((c) => c.id === "ingreso")) {
        cleaned.push({
            id: "ingreso",
            label: "Ingreso",
            kind: "ingreso",
            builtin: true,
        });
    }
    (0, store_1.saveCategories)(cleaned);
    res.json({ ok: true, categories: cleaned });
});
exports.pnlRouter.post("/api/pnl/categories", (req, res) => {
    const label = String(req.body?.label || "").trim();
    const kindRaw = String(req.body?.kind || "gasto");
    const kind = kindRaw === "ingreso" || kindRaw === "neutro" ? kindRaw : "gasto";
    if (!label) {
        res.status(400).json({ ok: false, error: "Falta label" });
        return;
    }
    const categories = (0, store_1.loadCategories)();
    let id = (0, store_1.slugCategory)(label);
    let n = 2;
    while (categories.some((c) => c.id === id)) {
        id = `${(0, store_1.slugCategory)(label)}_${n}`;
        n += 1;
    }
    const created = {
        id,
        label,
        kind,
        color: (0, categoryColors_1.colorForCategoryId)(id, categories.length),
        builtin: false,
    };
    categories.push(created);
    (0, store_1.saveCategories)(categories);
    res.json({ ok: true, category: created, categories });
});
exports.pnlRouter.delete("/api/pnl/categories/:id", (req, res) => {
    const id = String(req.params.id || "");
    const categories = (0, store_1.loadCategories)();
    const found = categories.find((c) => c.id === id);
    if (!found) {
        res.status(404).json({ ok: false, error: "Categoría no encontrada" });
        return;
    }
    if (found.builtin || id === "revisar" || id === "ingreso") {
        res.status(400).json({
            ok: false,
            error: "No se puede borrar una categoría base",
        });
        return;
    }
    const next = categories.filter((c) => c.id !== id);
    (0, store_1.saveCategories)(next);
    res.json({ ok: true, categories: next });
});
exports.pnlRouter.get("/api/pnl/rules", (_req, res) => {
    res.json({ ok: true, rules: (0, store_1.loadRules)() });
});
exports.pnlRouter.put("/api/pnl/rules", (req, res) => {
    const rules = req.body?.rules;
    if (!Array.isArray(rules)) {
        res.status(400).json({ ok: false, error: "rules debe ser array" });
        return;
    }
    const cleaned = rules
        .filter((r) => r && r.match && r.category)
        .map((r) => ({
        id: r.id || (0, crypto_1.randomUUID)(),
        match: String(r.match).trim().toLowerCase(),
        category: r.category,
        label: String(r.label || r.match).trim(),
        frecuente: Boolean(r.frecuente),
        notes: r.notes ? String(r.notes) : undefined,
    }));
    (0, store_1.saveRules)(cleaned);
    res.json({ ok: true, rules: cleaned });
});
/** Lista de PDFs agrupada por mes (restaura desde Drive si el deploy borró data/) */
exports.pnlRouter.get("/api/pnl/library", async (_req, res) => {
    let restore;
    try {
        if ((0, driveArchive_1.shouldAutoRestoreOnce)()) {
            restore = await (0, driveArchive_1.restoreArchivesFromDrive)();
            if (restore.restored.length) {
                console.log("[pnl] restaurados desde Drive", restore.restored);
            }
        }
    }
    catch (err) {
        console.warn("[pnl] restore Drive", err);
    }
    const runs = (0, store_1.loadRuns)().map(runPublic);
    const byMonth = {};
    for (const run of runs) {
        const key = run.periodKey || "sin-mes";
        if (!byMonth[key])
            byMonth[key] = [];
        byMonth[key].push(run);
    }
    const months = Object.keys(byMonth).sort().reverse();
    res.json({
        ok: true,
        restore,
        months: months.map((key) => ({
            periodKey: key,
            periodLabel: byMonth[key][0]?.periodLabel || key,
            statements: byMonth[key],
        })),
    });
});
/** Fuerza restauración desde Google Drive */
exports.pnlRouter.post("/api/pnl/restore-from-drive", async (_req, res) => {
    try {
        const result = await (0, driveArchive_1.restoreArchivesFromDrive)();
        res.json({
            ok: true,
            ...result,
            runs: (0, store_1.loadRuns)().map(runPublic),
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            hint: "Apps Script: ejecuta authorizeDrive_ (acepta Drive) y publica Nueva versión v11.",
        });
    }
});
exports.pnlRouter.get("/api/pnl/runs", (_req, res) => {
    res.json({ ok: true, runs: (0, store_1.loadRuns)().map(runPublic) });
});
exports.pnlRouter.get("/api/pnl/runs/:id", (req, res) => {
    const run = (0, store_1.loadRuns)().find((r) => r.id === req.params.id);
    if (!run) {
        res.status(404).json({
            ok: false,
            error: "Run no encontrado",
            hint: "El deploy borró data/ local. Vuelve a subir el PDF (y autoriza Drive para que no se pierda).",
        });
        return;
    }
    res.json({ ok: true, run: runPublic(run) });
});
/** Elimina run + PDF local (+ Drive si está autorizado) */
exports.pnlRouter.delete("/api/pnl/runs/:id", async (req, res) => {
    const removed = (0, store_1.deleteRunById)(req.params.id);
    if (!removed) {
        res.status(404).json({
            ok: false,
            error: "Run no encontrado",
            hint: "Ya no está en el servidor.",
        });
        return;
    }
    (0, statementFiles_1.deleteStatementPdf)(removed.periodKey, removed.storedRelativePath);
    if (removed.periodKey) {
        await (0, driveArchive_1.deleteDriveArchive)(removed.periodKey);
    }
    res.json({
        ok: true,
        deleted: {
            id: removed.id,
            periodKey: removed.periodKey,
            periodLabel: removed.periodLabel,
        },
        runs: (0, store_1.loadRuns)().map(runPublic),
    });
});
/** Ver / descargar el PDF (disco o Drive si se borró en el deploy) */
exports.pnlRouter.get("/api/pnl/runs/:id/pdf", async (req, res) => {
    const run = (0, store_1.loadRuns)().find((r) => r.id === req.params.id);
    if (!run) {
        res.status(404).json({ ok: false, error: "Run no encontrado" });
        return;
    }
    try {
        const pdf = await (0, driveArchive_1.resolvePdfBytes)(run);
        if (!pdf) {
            res.status(404).json({
                ok: false,
                error: "PDF no está en disco ni en Drive",
                hint: "Vuelve a subir el estado o publica Apps Script v8.",
            });
            return;
        }
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
        res.send(pdf.bytes);
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
exports.pnlRouter.post("/api/pnl/upload", upload.single("statement"), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ ok: false, error: "Falta archivo PDF (statement)" });
            return;
        }
        const buffer = fs_1.default.readFileSync(req.file.path);
        (0, autoCategories_1.pruneMerchantCategories)();
        const rules = (0, store_1.loadRules)();
        const { text, lines: parsed } = await (0, parseStatement_1.parsePdfToLines)(buffer, rules);
        const { lines: autoLines, rulesCreated } = (0, autoCategories_1.autoCreateCategoriesFromLines)(parsed);
        const lines = (0, counterparties_1.applyCounterpartyCategories)(autoLines);
        const summaryByCategory = (0, parseStatement_1.summarizeByCategory)(lines);
        const totals = (0, parseStatement_1.summarizeTotals)(lines);
        const oficial = (0, statementSummary_1.extractStatementOfficialTotals)(text);
        const reconciliation = (0, statementSummary_1.reconcileTotals)(oficial, totals);
        const period = (0, period_1.detectPeriodFromText)(text);
        const saved = (0, statementFiles_1.saveStatementPdf)(req.file.path, period);
        const mid = Math.max(0, Math.floor(text.length / 2) - 400);
        // Un solo estado por mes: reutilizar id si ya existía
        const prev = (0, store_1.loadRuns)().find((r) => r.periodKey === period.key);
        const run = {
            id: prev?.id || (0, crypto_1.randomUUID)(),
            filename: req.file.originalname,
            uploadedAt: new Date().toISOString(),
            periodKey: period.key,
            periodLabel: period.label,
            storedName: saved.storedName,
            storedRelativePath: saved.relativePath,
            textPreview: text.slice(0, 2000),
            textFull: text.slice(0, 300000),
            parseDebug: {
                textLength: text.length,
                pagesHint: (text.match(/P[aá]gina\s+\d+\s+de\s+\d+/i) || [])[0],
                sampleMid: text.slice(mid, mid + 800),
            },
            lines,
            summaryByCategory,
            totals,
            reconciliation,
            sentToSheetAt: prev?.sentToSheetAt,
            sentToSheet: prev?.sentToSheet,
        };
        // Memoria durable: copia a Google Drive (no bloquea si falla)
        let archive = {
            ok: false,
            error: "no intentado",
        };
        try {
            const archived = await (0, driveArchive_1.archiveStatementToDrive)(run, saved.storedPath);
            run.drivePdfFileId = archived.pdfFileId;
            run.driveRunFileId = archived.runFileId;
            run.drivePdfUrl = archived.pdfUrl;
            run.archivedAt = new Date().toISOString();
            archive = {
                ok: true,
                pdfUrl: archived.pdfUrl,
                version: archived.version,
            };
        }
        catch (archErr) {
            archive = {
                ok: false,
                error: archErr instanceof Error ? archErr.message : String(archErr),
            };
            console.warn("[pnl] archive Drive FAIL", archive.error);
        }
        (0, store_1.upsertRunByPeriod)(run);
        res.json({
            ok: true,
            run: runPublic(run),
            categories: (0, store_1.loadCategories)(),
            rules: (0, store_1.loadRules)(),
            stats: {
                lines: lines.length,
                needsReview: lines.filter((l) => l.needsReview).length,
                matched: lines.filter((l) => l.matchedRuleId).length,
                period: period.label,
                savedAs: saved.storedName,
                rulesCreated,
                totals,
                reconciliation,
                archive,
            },
        });
    }
    catch (err) {
        console.error("[pnl] upload error", err);
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
exports.pnlRouter.post("/api/pnl/runs/:id/reparse", (req, res) => {
    const runs = (0, store_1.loadRuns)();
    const idx = runs.findIndex((r) => r.id === req.params.id);
    if (idx < 0) {
        res.status(404).json({ ok: false, error: "Run no encontrado" });
        return;
    }
    const run = runs[idx];
    const text = run.textFull || run.textPreview || "";
    if (!text || text.length < 50) {
        res.status(400).json({
            ok: false,
            error: "Texto incompleto. Vuelve a soltar el PDF.",
        });
        return;
    }
    (0, autoCategories_1.pruneMerchantCategories)();
    const rules = (0, store_1.loadRules)();
    const parsed = (0, parseStatement_1.extractLinesFromText)(text, rules);
    const { lines: autoLines, rulesCreated } = (0, autoCategories_1.autoCreateCategoriesFromLines)(parsed);
    const lines = (0, counterparties_1.applyCounterpartyCategories)(autoLines);
    const period = (0, period_1.detectPeriodFromText)(text);
    run.lines = lines;
    run.summaryByCategory = (0, parseStatement_1.summarizeByCategory)(lines);
    run.totals = (0, parseStatement_1.summarizeTotals)(lines);
    const oficial = (0, statementSummary_1.extractStatementOfficialTotals)(text);
    run.reconciliation = (0, statementSummary_1.reconcileTotals)(oficial, run.totals);
    run.periodKey = period.key;
    run.periodLabel = period.label;
    runs[idx] = run;
    (0, store_1.saveRuns)(runs);
    res.json({
        ok: true,
        run: runPublic(run),
        categories: (0, store_1.loadCategories)(),
        rules: (0, store_1.loadRules)(),
        stats: {
            lines: lines.length,
            needsReview: lines.filter((l) => l.needsReview).length,
            matched: lines.filter((l) => l.matchedRuleId).length,
            textLength: text.length,
            period: period.label,
            rulesCreated,
            totals: run.totals,
            reconciliation: run.reconciliation,
        },
    });
});
/** Estado de Resultados en página (matriz mes × concepto) desde PDFs cargados. */
exports.pnlRouter.get("/api/pnl/estado-resultados", (req, res) => {
    const runs = (0, store_1.loadRuns)();
    const years = yearsFromRuns();
    const requested = Number(req.query.year);
    const year = Number.isFinite(requested)
        ? requested
        : years[years.length - 1] || new Date().getFullYear();
    const er = (0, estadoResultados_1.buildEstadoResultados)(runs, year);
    res.json({
        ok: true,
        years,
        year,
        estadoResultados: er,
        emptyYear: er.monthsPresent.length === 0,
    });
});
/** Ping Apps Script: versión publicada + si ya conoce Estado de Resultados. */
exports.pnlRouter.get("/api/pnl/apps-script-status", async (_req, res) => {
    const url = (0, appsScriptClient_2.getAppsScriptUrl)();
    if (!url) {
        res.status(503).json({
            ok: false,
            error: "Falta URL Apps Script en el servidor",
        });
        return;
    }
    try {
        const r = await fetch(url, { redirect: "follow" });
        const text = await r.text();
        let data = {};
        try {
            data = JSON.parse(text);
        }
        catch {
            res.status(502).json({
                ok: false,
                error: "Apps Script no devolvió JSON",
                rawPreview: text.slice(0, 200),
            });
            return;
        }
        const version = String(data.version || "");
        const sheets = Array.isArray(data.sheets) ? data.sheets : [];
        const hasErFlag = Boolean(data.hasEstadoResultados);
        const hasErSheet = sheets.some((s) => String(s).startsWith("Estado de Resultados"));
        const needsPublish = !hasErFlag && !/v1[89]|v2\d/.test(version) && !hasErSheet;
        res.json({
            ok: true,
            version,
            erSheet: data.erSheet || "Estado de Resultados 2026",
            hasEstadoResultados: hasErFlag || hasErSheet,
            needsPublish,
            sheets,
            message: needsPublish
                ? `Apps Script sigue en ${version || "?"}. Hay que pegar Codigo.gs v18 y publicar Nueva versión para que exista la pestaña Estado de Resultados.`
                : `Apps Script ${version}: listo para Estado de Resultados.`,
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
/** Crea/regenera la pestaña Estado de Resultados en el Sheet (vía Apps Script). */
exports.pnlRouter.post("/api/pnl/setup-estado-resultados", async (_req, res) => {
    try {
        const result = await (0, appsScriptClient_1.postToAppsScript)({
            action: "setupEstadoResultados",
        });
        if (!result.ok) {
            res.status(502).json({
                ok: false,
                error: result.error || "Apps Script rechazó setupEstadoResultados",
                version: result.version,
                hint: "Pega Codigo.gs v18 en Apps Script → Guardar → Implementar → Nueva versión. Luego reintenta.",
            });
            return;
        }
        res.json({
            ok: true,
            version: result.version,
            erSheet: result.erSheet || "Estado de Resultados 2026",
            message: result.message ||
                `Pestaña lista: ${result.erSheet || "Estado de Resultados 2026"}`,
        });
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const looksOld = /values no es array|v16|action/i.test(error) ||
            /setupEstadoResultados/i.test(error);
        res.status(502).json({
            ok: false,
            error: looksOld
                ? "Apps Script aún no es v18 (sigue sin conocer setupEstadoResultados)."
                : error,
            hint: "Pega Codigo.gs v18 → Guardar → Implementar → Nueva versión (misma URL /exec). Luego vuelve a pulsar Crear pestaña.",
        });
    }
});
/** Envía totales del mes al Sheet (Banco + Estado de Resultados por columna). */
exports.pnlRouter.post("/api/pnl/runs/:id/send-to-sheet", async (req, res) => {
    const runs = (0, store_1.loadRuns)();
    const idx = runs.findIndex((r) => r.id === req.params.id);
    if (idx < 0) {
        res.status(404).json({
            ok: false,
            error: "Run no encontrado",
            hint: "Sube de nuevo el PDF y luego pulsa Enviar a Estado de Resultados.",
        });
        return;
    }
    const run = runs[idx];
    try {
        const result = await (0, sendToSheet_1.sendRunToBancoSheet)(run);
        run.sentToSheetAt = new Date().toISOString();
        run.sentToSheet = {
            ok: true,
            sheetName: result.erSheet || result.sheetName,
            row: result.row,
            action: result.action,
            version: result.version,
        };
        runs[idx] = run;
        (0, store_1.saveRuns)(runs);
        let analysisSheet;
        try {
            const year = Number(String(run.periodKey || "").slice(0, 4)) || 2026;
            const a = await (0, sendToSheet_1.sendYearAnalysisToSheet)(year);
            analysisSheet = { sheetName: a.sheetName, version: a.version };
        }
        catch (aErr) {
            console.warn("[pnl] analisis Sheet", aErr instanceof Error ? aErr.message : aErr);
        }
        res.json({
            ok: true,
            message: result.message ||
                `Enviado a ${result.erSheet || result.sheetName} (fila Banco ${result.row})${analysisSheet ? ` · ${analysisSheet.sheetName}` : ""}.`,
            run: runPublic(run),
            sheet: result,
            analysisSheet,
        });
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        run.sentToSheet = { ok: false, error };
        runs[idx] = run;
        (0, store_1.saveRuns)(runs);
        res.status(502).json({
            ok: false,
            error,
            hint: "Si falta el Estado de Resultados, pega Codigo.gs v18 en Apps Script, ejecuta restoreEstadoResultados_ y publica Nueva versión.",
        });
    }
});
function yearsFromRuns() {
    const ys = new Set();
    for (const r of (0, store_1.loadRuns)()) {
        const y = Number(String(r.periodKey || "").slice(0, 4));
        if (y >= 2000 && y <= 2100)
            ys.add(y);
    }
    return Array.from(ys).sort((a, b) => a - b);
}
/** Análisis anual: top proveedores, socios, mensual (un solo año) */
exports.pnlRouter.get("/api/pnl/analysis", (req, res) => {
    const runs = (0, store_1.loadRuns)();
    const years = yearsFromRuns();
    const requested = Number(req.query.year);
    const year = Number.isFinite(requested)
        ? requested
        : years[years.length - 1] || new Date().getFullYear();
    const analysis = (0, providerAnalysis_1.buildYearAnalysis)(runs, year);
    res.json({
        ok: true,
        years,
        year,
        analysis,
        emptyYear: analysis.monthsPresent.length === 0,
        runs: runs
            .filter((r) => String(r.periodKey || "").startsWith(`${year}-`))
            .map((r) => ({
            id: r.id,
            periodKey: r.periodKey,
            periodLabel: r.periodLabel,
            lines: r.lines?.length || 0,
            sentToSheetAt: r.sentToSheetAt,
            archivedAt: r.archivedAt,
        })),
    });
});
exports.pnlRouter.post("/api/pnl/analysis/send-to-sheet", async (req, res) => {
    try {
        const yearsAvail = yearsFromRuns();
        const year = Number(req.body?.year);
        if (!Number.isFinite(year) || year < 2000) {
            res.status(400).json({
                ok: false,
                error: "Indica el año del análisis (ej. 2025 o 2026)",
                years: yearsAvail,
            });
            return;
        }
        if (yearsAvail.length && !yearsAvail.includes(year)) {
            res.status(400).json({
                ok: false,
                error: `No hay estados de cuenta del año ${year}. Años disponibles: ${yearsAvail.join(", ") || "ninguno"}`,
                years: yearsAvail,
            });
            return;
        }
        const result = await (0, sendToSheet_1.sendYearAnalysisToSheet)(year);
        if (!result.analysis.monthsPresent.length) {
            res.status(400).json({
                ok: false,
                error: `No hay meses cargados para ${year}. Sube PDFs de ese año.`,
                years: yearsAvail,
                analysis: result.analysis,
            });
            return;
        }
        res.json({
            ok: true,
            message: `Análisis ${year} enviado a ${result.sheetName}`,
            year,
            sheetName: result.sheetName,
            version: result.version,
            analysis: result.analysis,
            sheets: [result.sheetName],
        });
    }
    catch (err) {
        res.status(502).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            hint: "Pega Codigo.gs v13 (upsertAnalisis) y publica Nueva versión.",
        });
    }
});
exports.pnlRouter.patch("/api/pnl/runs/:runId/lines/:lineId", (req, res) => {
    const runs = (0, store_1.loadRuns)();
    const run = runs.find((r) => r.id === req.params.runId);
    if (!run) {
        res.status(404).json({
            ok: false,
            error: "Run no encontrado",
            hint: "Sube de nuevo el PDF; el estado en pantalla ya no está en el servidor.",
        });
        return;
    }
    const line = run.lines.find((l) => l.id === req.params.lineId);
    if (!line) {
        res.status(404).json({ ok: false, error: "Línea no encontrada" });
        return;
    }
    const { category, amount, description, needsReview } = req.body || {};
    if (category === undefined &&
        amount === undefined &&
        description === undefined &&
        needsReview === undefined) {
        res.status(400).json({
            ok: false,
            error: "Envía category, amount, description y/ o needsReview",
        });
        return;
    }
    if (category !== undefined) {
        line.category = String(category);
        line.matchedRuleId = undefined;
    }
    if (description !== undefined) {
        line.description = String(description).trim().slice(0, 300);
    }
    if (amount !== undefined) {
        const n = Number(amount);
        if (!Number.isFinite(n)) {
            res.status(400).json({ ok: false, error: "amount inválido" });
            return;
        }
        line.amount = Math.round(n * 100) / 100;
        line.direction = line.amount >= 0 ? "abono" : "cargo";
        if (line.amount > 0 && (line.category === "revisar" || !line.category)) {
            line.category = "ingreso";
        }
    }
    if (needsReview !== undefined) {
        line.needsReview = Boolean(needsReview);
    }
    else if (category !== undefined) {
        line.needsReview =
            line.category === "revisar" ||
                line.category === "transferencia_persona";
        if ((0, store_1.isIncomeCategory)(line.category))
            line.needsReview = false;
    }
    run.summaryByCategory = (0, parseStatement_1.summarizeByCategory)(run.lines);
    run.totals = (0, parseStatement_1.summarizeTotals)(run.lines);
    (0, store_1.saveRuns)(runs);
    res.json({
        ok: true,
        line,
        summaryByCategory: run.summaryByCategory,
        totals: run.totals,
    });
});
exports.pnlRouter.post("/api/pnl/test-rule", (req, res) => {
    const { description, amount = -100, match, category } = req.body || {};
    const rules = (0, store_1.loadRules)();
    if (match && category) {
        rules.unshift({
            id: "tmp",
            match: String(match),
            category,
            label: "tmp",
            frecuente: true,
        });
    }
    const result = (0, categorize_1.categorizeLine)(String(description || ""), Number(amount), Number(amount) < 0 ? "cargo" : "abono", rules);
    res.json({ ok: true, result });
});
//# sourceMappingURL=pnlRouter.js.map