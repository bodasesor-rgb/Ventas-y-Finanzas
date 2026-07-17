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
        const rules = (0, store_1.loadRules)();
        const { text, lines } = await (0, parseStatement_1.parsePdfToLines)(buffer, rules);
        const summaryByCategory = (0, parseStatement_1.summarizeByCategory)(lines);
        const period = (0, period_1.detectPeriodFromText)(text);
        const saved = (0, statementFiles_1.saveStatementPdf)(req.file.path, period);
        const mid = Math.max(0, Math.floor(text.length / 2) - 400);
        const run = {
            id: (0, crypto_1.randomUUID)(),
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
        };
        (0, store_1.addRun)(run);
        res.json({
            ok: true,
            run: runPublic(run),
            stats: {
                lines: lines.length,
                needsReview: lines.filter((l) => l.needsReview).length,
                matched: lines.filter((l) => l.matchedRuleId).length,
                period: period.label,
                savedAs: saved.storedName,
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
    const rules = (0, store_1.loadRules)();
    const lines = (0, parseStatement_1.extractLinesFromText)(text, rules);
    const period = (0, period_1.detectPeriodFromText)(text);
    run.lines = lines;
    run.summaryByCategory = (0, parseStatement_1.summarizeByCategory)(lines);
    run.periodKey = period.key;
    run.periodLabel = period.label;
    runs[idx] = run;
    (0, store_1.saveRuns)(runs);
    res.json({
        ok: true,
        run: runPublic(run),
        stats: {
            lines: lines.length,
            needsReview: lines.filter((l) => l.needsReview).length,
            matched: lines.filter((l) => l.matchedRuleId).length,
            textLength: text.length,
            period: period.label,
        },
    });
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
    const { category } = req.body || {};
    if (!category) {
        res.status(400).json({ ok: false, error: "Falta category" });
        return;
    }
    line.category = category;
    line.needsReview =
        category === "revisar" || category === "transferencia_persona";
    line.matchedRuleId = undefined;
    run.summaryByCategory = (0, parseStatement_1.summarizeByCategory)(run.lines);
    (0, store_1.saveRuns)(runs);
    res.json({ ok: true, line, summaryByCategory: run.summaryByCategory });
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