import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { categorizeLine } from "./categorize";
import {
  extractLinesFromText,
  parsePdfToLines,
  summarizeByCategory,
} from "./parseStatement";
import { detectPeriodFromText } from "./period";
import {
  resolveStatementFile,
  saveStatementPdf,
} from "./statementFiles";
import {
  addRun,
  isIncomeCategory,
  loadCategories,
  loadRules,
  loadRuns,
  saveCategories,
  saveRules,
  saveRuns,
  slugCategory,
} from "./store";
import type { CategoryDef, RecurringRule, StatementRun } from "./types";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Solo PDF"));
    }
  },
});

export const pnlRouter = Router();

function runPublic(run: StatementRun) {
  const { textFull: _t, ...rest } = run;
  return rest;
}

pnlRouter.get("/api/pnl/categories", (_req, res) => {
  res.json({ ok: true, categories: loadCategories() });
});

pnlRouter.put("/api/pnl/categories", (req, res) => {
  const categories = req.body?.categories as CategoryDef[];
  if (!Array.isArray(categories)) {
    res.status(400).json({ ok: false, error: "categories debe ser array" });
    return;
  }
  const cleaned: CategoryDef[] = [];
  const seen = new Set<string>();
  for (const c of categories) {
    if (!c || !c.id || !c.label) continue;
    const id = slugCategory(String(c.id));
    if (seen.has(id)) continue;
    seen.add(id);
    const kind =
      c.kind === "ingreso" || c.kind === "gasto" || c.kind === "neutro"
        ? c.kind
        : "gasto";
    cleaned.push({
      id,
      label: String(c.label).trim().slice(0, 80),
      kind,
      builtin: Boolean(c.builtin),
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
  saveCategories(cleaned);
  res.json({ ok: true, categories: cleaned });
});

pnlRouter.post("/api/pnl/categories", (req, res) => {
  const label = String(req.body?.label || "").trim();
  const kindRaw = String(req.body?.kind || "gasto");
  const kind =
    kindRaw === "ingreso" || kindRaw === "neutro" ? kindRaw : "gasto";
  if (!label) {
    res.status(400).json({ ok: false, error: "Falta label" });
    return;
  }
  const categories = loadCategories();
  let id = slugCategory(label);
  let n = 2;
  while (categories.some((c) => c.id === id)) {
    id = `${slugCategory(label)}_${n}`;
    n += 1;
  }
  const created: CategoryDef = { id, label, kind, builtin: false };
  categories.push(created);
  saveCategories(categories);
  res.json({ ok: true, category: created, categories });
});

pnlRouter.delete("/api/pnl/categories/:id", (req, res) => {
  const id = String(req.params.id || "");
  const categories = loadCategories();
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
  saveCategories(next);
  res.json({ ok: true, categories: next });
});

pnlRouter.get("/api/pnl/rules", (_req, res) => {
  res.json({ ok: true, rules: loadRules() });
});

pnlRouter.put("/api/pnl/rules", (req, res) => {
  const rules = req.body?.rules as RecurringRule[];
  if (!Array.isArray(rules)) {
    res.status(400).json({ ok: false, error: "rules debe ser array" });
    return;
  }
  const cleaned = rules
    .filter((r) => r && r.match && r.category)
    .map((r) => ({
      id: r.id || randomUUID(),
      match: String(r.match).trim().toLowerCase(),
      category: r.category,
      label: String(r.label || r.match).trim(),
      frecuente: Boolean(r.frecuente),
      notes: r.notes ? String(r.notes) : undefined,
    }));
  saveRules(cleaned);
  res.json({ ok: true, rules: cleaned });
});

/** Lista de PDFs agrupada por mes */
pnlRouter.get("/api/pnl/library", (_req, res) => {
  const runs = loadRuns().map(runPublic);
  const byMonth: Record<string, typeof runs> = {};
  for (const run of runs) {
    const key = run.periodKey || "sin-mes";
    if (!byMonth[key]) byMonth[key] = [];
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

pnlRouter.get("/api/pnl/runs", (_req, res) => {
  res.json({ ok: true, runs: loadRuns().map(runPublic) });
});

pnlRouter.get("/api/pnl/runs/:id", (req, res) => {
  const run = loadRuns().find((r) => r.id === req.params.id);
  if (!run) {
    res.status(404).json({ ok: false, error: "Run no encontrado" });
    return;
  }
  res.json({ ok: true, run: runPublic(run) });
});

/** Ver / descargar el PDF guardado */
pnlRouter.get("/api/pnl/runs/:id/pdf", (req, res) => {
  const run = loadRuns().find((r) => r.id === req.params.id);
  if (!run?.storedRelativePath) {
    res.status(404).json({ ok: false, error: "PDF no encontrado" });
    return;
  }
  const full = resolveStatementFile(run.storedRelativePath);
  if (!full) {
    res.status(404).json({ ok: false, error: "Archivo no está en disco" });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${run.storedName || "estado-cuenta.pdf"}"`
  );
  fs.createReadStream(full).pipe(res);
});

pnlRouter.post(
  "/api/pnl/upload",
  upload.single("statement"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ ok: false, error: "Falta archivo PDF (statement)" });
        return;
      }

      const buffer = fs.readFileSync(req.file.path);
      const rules = loadRules();
      const { text, lines } = await parsePdfToLines(buffer, rules);
      const summaryByCategory = summarizeByCategory(lines);
      const period = detectPeriodFromText(text);
      const saved = saveStatementPdf(req.file.path, period);
      const mid = Math.max(0, Math.floor(text.length / 2) - 400);

      const run: StatementRun = {
        id: randomUUID(),
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
      addRun(run);

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
    } catch (err) {
      console.error("[pnl] upload error", err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

pnlRouter.post("/api/pnl/runs/:id/reparse", (req, res) => {
  const runs = loadRuns();
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
  const rules = loadRules();
  const lines = extractLinesFromText(text, rules);
  const period = detectPeriodFromText(text);
  run.lines = lines;
  run.summaryByCategory = summarizeByCategory(lines);
  run.periodKey = period.key;
  run.periodLabel = period.label;
  runs[idx] = run;
  saveRuns(runs);
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

pnlRouter.patch("/api/pnl/runs/:runId/lines/:lineId", (req, res) => {
  const runs = loadRuns();
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
  if (
    category === undefined &&
    amount === undefined &&
    description === undefined &&
    needsReview === undefined
  ) {
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
  } else if (category !== undefined) {
    line.needsReview =
      line.category === "revisar" ||
      line.category === "transferencia_persona";
    if (isIncomeCategory(line.category)) line.needsReview = false;
  }

  run.summaryByCategory = summarizeByCategory(run.lines);
  saveRuns(runs);
  res.json({ ok: true, line, summaryByCategory: run.summaryByCategory });
});

pnlRouter.post("/api/pnl/test-rule", (req, res) => {
  const { description, amount = -100, match, category } = req.body || {};
  const rules = loadRules();
  if (match && category) {
    rules.unshift({
      id: "tmp",
      match: String(match),
      category,
      label: "tmp",
      frecuente: true,
    });
  }
  const result = categorizeLine(
    String(description || ""),
    Number(amount),
    Number(amount) < 0 ? "cargo" : "abono",
    rules
  );
  res.json({ ok: true, result });
});
