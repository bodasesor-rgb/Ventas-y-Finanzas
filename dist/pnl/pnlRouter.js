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
/** Lista de PDFs agrupada por mes */
exports.pnlRouter.get("/api/pnl/library", (_req, res) => {
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
        months: months.map((key) => ({
            periodKey: key,
            periodLabel: byMonth[key][0]?.periodLabel || key,
            statements: byMonth[key],
        })),
    });
});
exports.pnlRouter.get("/api/pnl/runs", (_req, res) => {
    res.json({ ok: true, runs: (0, store_1.loadRuns)().map(runPublic) });
});
exports.pnlRouter.get("/api/pnl/runs/:id", (req, res) => {
    const run = (0, store_1.loadRuns)().find((r) => r.id === req.params.id);
    if (!run) {
        res.status(404).json({ ok: false, error: "Run no encontrado" });
        return;
    }
    res.json({ ok: true, run: runPublic(run) });
});
/** Ver / descargar el PDF guardado */
exports.pnlRouter.get("/api/pnl/runs/:id/pdf", (req, res) => {
    const run = (0, store_1.loadRuns)().find((r) => r.id === req.params.id);
    if (!run?.storedRelativePath) {
        res.status(404).json({ ok: false, error: "PDF no encontrado" });
        return;
    }
    const full = (0, statementFiles_1.resolveStatementFile)(run.storedRelativePath);
    if (!full) {
        res.status(404).json({ ok: false, error: "Archivo no está en disco" });
        return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${run.storedName || "estado-cuenta.pdf"}"`);
    fs_1.default.createReadStream(full).pipe(res);
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
        const { lines, rulesCreated } = (0, autoCategories_1.autoCreateCategoriesFromLines)(parsed);
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
    const { lines, rulesCreated } = (0, autoCategories_1.autoCreateCategoriesFromLines)(parsed);
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
/** Envía totales del mes al Sheet (pestaña Banco YYYY + cols en P&L). */
exports.pnlRouter.post("/api/pnl/runs/:id/send-to-sheet", async (req, res) => {
    const runs = (0, store_1.loadRuns)();
    const idx = runs.findIndex((r) => r.id === req.params.id);
    if (idx < 0) {
        res.status(404).json({ ok: false, error: "Run no encontrado" });
        return;
    }
    const run = runs[idx];
    try {
        const result = await (0, sendToSheet_1.sendRunToBancoSheet)(run);
        run.sentToSheetAt = new Date().toISOString();
        run.sentToSheet = {
            ok: true,
            sheetName: result.sheetName,
            row: result.row,
            action: result.action,
            version: result.version,
        };
        runs[idx] = run;
        (0, store_1.saveRuns)(runs);
        res.json({
            ok: true,
            message: `Enviado a ${result.sheetName} (fila ${result.row}, ${result.action}).`,
            run: runPublic(run),
            sheet: result,
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
            hint: "Si dice que falta action upsertBanco, pega Codigo.gs v7 en Apps Script y publica Nueva versión.",
        });
    }
});
exports.pnlRouter.patch("/api/pnl/runs/:runId/lines/:lineId", (req, res) => {
    const runs = (0, store_1.loadRuns)();
    const run = runs.find((r) => r.id === req.params.runId);
    if (!run) {
        res.status(404).json({ ok: false, error: "Run no encontrado" });
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