import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { categorizeLine } from "./categorize";
import { parsePdfToLines, summarizeByCategory } from "./parseStatement";
import { addRun, loadRules, loadRuns, saveRules, saveRuns } from "./store";
import type { RecurringRule, StatementRun } from "./types";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Solo PDF"));
    }
  },
});

export const pnlRouter = Router();

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

pnlRouter.get("/api/pnl/runs", (_req, res) => {
  res.json({ ok: true, runs: loadRuns() });
});

pnlRouter.get("/api/pnl/runs/:id", (req, res) => {
  const run = loadRuns().find((r) => r.id === req.params.id);
  if (!run) {
    res.status(404).json({ ok: false, error: "Run no encontrado" });
    return;
  }
  res.json({ ok: true, run });
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

      const run: StatementRun = {
        id: randomUUID(),
        filename: req.file.originalname,
        uploadedAt: new Date().toISOString(),
        textPreview: text.slice(0, 1500),
        lines,
        summaryByCategory,
      };
      addRun(run);

      // limpiar archivo temporal
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }

      res.json({
        ok: true,
        run,
        stats: {
          lines: lines.length,
          needsReview: lines.filter((l) => l.needsReview).length,
          matched: lines.filter((l) => l.matchedRuleId).length,
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

/** Recategorizar un movimiento a mano */
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
  const { category } = req.body || {};
  if (!category) {
    res.status(400).json({ ok: false, error: "Falta category" });
    return;
  }
  line.category = category;
  line.needsReview =
    category === "revisar" || category === "transferencia_persona";
  line.matchedRuleId = undefined;
  run.summaryByCategory = summarizeByCategory(run.lines);
  saveRuns(runs);
  res.json({ ok: true, line, summaryByCategory: run.summaryByCategory });
});

/** Probar una regla contra texto libre */
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
