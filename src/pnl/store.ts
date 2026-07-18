import fs from "fs";
import path from "path";
import { colorForCategoryId } from "./categoryColors";
import type { CategoryDef, RecurringRule, StatementRun } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RULES_FILE = path.join(DATA_DIR, "recurring-rules.json");
const RUNS_FILE = path.join(DATA_DIR, "statement-runs.json");
const CATEGORIES_FILE = path.join(DATA_DIR, "categories.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: "ads", label: "Ads / publicidad", kind: "gasto", builtin: true, color: colorForCategoryId("ads") },
  { id: "pass", label: "Pase / peaje", kind: "gasto", builtin: true, color: colorForCategoryId("pass") },
  { id: "nomina", label: "Nómina", kind: "gasto", builtin: true, color: colorForCategoryId("nomina") },
  { id: "proveedor", label: "Proveedor", kind: "gasto", builtin: true, color: colorForCategoryId("proveedor") },
  { id: "renta", label: "Renta", kind: "gasto", builtin: true, color: colorForCategoryId("renta") },
  { id: "servicios", label: "Servicios", kind: "gasto", builtin: true, color: colorForCategoryId("servicios") },
  { id: "apps", label: "Apps / software", kind: "gasto", builtin: true, color: colorForCategoryId("apps") },
  { id: "comisiones", label: "Comisiones bancarias", kind: "gasto", builtin: true, color: colorForCategoryId("comisiones") },
  { id: "impuestos", label: "Impuestos", kind: "gasto", builtin: true, color: colorForCategoryId("impuestos") },
  { id: "evento", label: "Costo de evento", kind: "gasto", builtin: true, color: colorForCategoryId("evento") },
  { id: "pago", label: "Pago", kind: "gasto", builtin: true, color: colorForCategoryId("pago") },
  { id: "transferencia_persona", label: "Transferencia a persona", kind: "neutro", builtin: true, color: colorForCategoryId("transferencia_persona") },
  { id: "ingreso", label: "Ingreso", kind: "ingreso", builtin: true, color: colorForCategoryId("ingreso") },
  { id: "venta", label: "Venta / anticipo cliente", kind: "ingreso", builtin: true, color: colorForCategoryId("venta") },
  { id: "otro", label: "Otro", kind: "neutro", builtin: true, color: colorForCategoryId("otro") },
  { id: "revisar", label: "Revisar", kind: "neutro", builtin: true, color: colorForCategoryId("revisar") },
];

export function slugCategory(label: string): string {
  return String(label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `cat_${Date.now()}`;
}

let categoriesCache: CategoryDef[] | null = null;

export function loadCategories(): CategoryDef[] {
  if (categoriesCache) return categoriesCache;
  ensureDataDir();
  if (!fs.existsSync(CATEGORIES_FILE)) {
    saveCategories(DEFAULT_CATEGORIES);
    return categoriesCache!;
  }
  try {
    const raw = JSON.parse(
      fs.readFileSync(CATEGORIES_FILE, "utf8")
    ) as CategoryDef[];
    if (!Array.isArray(raw) || raw.length === 0) {
      saveCategories(DEFAULT_CATEGORIES);
      return categoriesCache!;
    }
    const byId = new Map(raw.map((c) => [c.id, c]));
    let changed = false;
    for (const d of DEFAULT_CATEGORIES) {
      if (!byId.has(d.id)) {
        raw.push({ ...d });
        changed = true;
      }
    }
    raw.forEach((c, i) => {
      if (!c.color) {
        c.color = colorForCategoryId(c.id, i);
        changed = true;
      }
    });
    if (changed) {
      saveCategories(raw);
      return categoriesCache!;
    }
    categoriesCache = raw;
    return categoriesCache;
  } catch {
    saveCategories(DEFAULT_CATEGORIES);
    return categoriesCache!;
  }
}

export function saveCategories(categories: CategoryDef[]): void {
  ensureDataDir();
  categoriesCache = categories.map((c) => ({ ...c }));
  fs.writeFileSync(
    CATEGORIES_FILE,
    JSON.stringify(categoriesCache, null, 2),
    "utf8"
  );
}

export function categoryKind(id: string): CategoryDef["kind"] {
  const found = loadCategories().find((c) => c.id === id);
  if (found) return found.kind;
  if (id === "ingreso" || id === "venta") return "ingreso";
  return "neutro";
}

export function isIncomeCategory(id: string): boolean {
  return categoryKind(id) === "ingreso";
}

const DEFAULT_RULES: RecurringRule[] = [
  {
    id: "r-ads-meta",
    match: "meta",
    category: "ads",
    label: "Meta Ads",
    frecuente: true,
  },
  {
    id: "r-ads-facebook",
    match: "facebook",
    category: "ads",
    label: "Facebook Ads",
    frecuente: true,
  },
  {
    id: "r-ads-facebk",
    match: "facebk",
    category: "ads",
    label: "Facebook Ads",
    frecuente: true,
  },
  {
    id: "r-ads-google",
    match: "google",
    category: "ads",
    label: "Google / Ads",
    frecuente: true,
  },
  {
    id: "r-pass",
    match: "pass",
    category: "pass",
    label: "Pase / peaje",
    frecuente: true,
  },
  {
    id: "r-pase",
    match: "pase",
    category: "pass",
    label: "Pase",
    frecuente: true,
  },
  {
    id: "r-replit",
    match: "replit",
    category: "apps",
    label: "Replit",
    frecuente: true,
  },
  {
    id: "r-shopify",
    match: "shopify",
    category: "apps",
    label: "Shopify",
    frecuente: true,
  },
  {
    id: "r-anthropic",
    match: "anthropic",
    category: "apps",
    label: "Anthropic / Claude",
    frecuente: true,
  },
  {
    id: "r-sendinblue",
    match: "sendinblue",
    category: "apps",
    label: "Brevo / Sendinblue",
    frecuente: true,
  },
  {
    id: "r-netlify",
    match: "netlify",
    category: "apps",
    label: "Netlify",
    frecuente: true,
  },
  {
    id: "r-openai",
    match: "openai",
    category: "apps",
    label: "OpenAI",
    frecuente: true,
  },
  {
    id: "r-ebanx",
    match: "ebanx",
    category: "apps",
    label: "Ebanx",
    frecuente: true,
  },
  {
    id: "r-cursor",
    match: "cursor",
    category: "apps",
    label: "Cursor",
    frecuente: true,
  },
  {
    id: "r-gamma",
    match: "gamma",
    category: "apps",
    label: "Gamma",
    frecuente: true,
  },
  {
    id: "r-telcel",
    match: "telcel",
    category: "servicios",
    label: "Telcel",
    frecuente: true,
  },
  {
    id: "r-cfe",
    match: "cfe",
    category: "servicios",
    label: "CFE",
    frecuente: true,
  },
];

export function loadRules(): RecurringRule[] {
  ensureDataDir();
  if (!fs.existsSync(RULES_FILE)) {
    saveRules(DEFAULT_RULES);
    return DEFAULT_RULES;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(RULES_FILE, "utf8")) as RecurringRule[];
    if (!Array.isArray(raw) || raw.length === 0) {
      saveRules(DEFAULT_RULES);
      return DEFAULT_RULES;
    }
    // Fusiona defaults nuevos (facebk, replit…) sin borrar reglas del usuario
    const byId = new Map(raw.map((r) => [r.id, r]));
    let changed = false;
    for (const d of DEFAULT_RULES) {
      if (!byId.has(d.id)) {
        raw.push(d);
        changed = true;
      }
    }
    if (changed) saveRules(raw);
    return raw;
  } catch {
    saveRules(DEFAULT_RULES);
    return DEFAULT_RULES;
  }
}

export function saveRules(rules: RecurringRule[]): void {
  ensureDataDir();
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf8");
}

/** Deja un solo run por periodKey (el más reciente). */
function dedupeRunsByPeriod(runs: StatementRun[]): StatementRun[] {
  const seen = new Set<string>();
  const out: StatementRun[] = [];
  for (const run of runs) {
    const key = run.periodKey || `id:${run.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(run);
  }
  return out;
}

export function loadRuns(): StatementRun[] {
  ensureDataDir();
  if (!fs.existsSync(RUNS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(RUNS_FILE, "utf8")) as StatementRun[];
    if (!Array.isArray(raw)) return [];
    const deduped = dedupeRunsByPeriod(raw);
    if (deduped.length !== raw.length) {
      saveRuns(deduped);
    }
    return deduped;
  } catch {
    return [];
  }
}

export function saveRuns(runs: StatementRun[]): void {
  ensureDataDir();
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2), "utf8");
}

export function addRun(run: StatementRun): void {
  const runs = loadRuns();
  runs.unshift(run);
  // conservar últimos 30
  saveRuns(runs.slice(0, 30));
}

/** Un run por mes: reemplaza el anterior del mismo periodKey. */
export function upsertRunByPeriod(run: StatementRun): void {
  const runs = loadRuns();
  const key = run.periodKey;
  const next = key
    ? [run, ...runs.filter((r) => r.periodKey !== key)]
    : [run, ...runs];
  saveRuns(next.slice(0, 30));
}
