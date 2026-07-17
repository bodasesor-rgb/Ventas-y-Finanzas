"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CATEGORIES = void 0;
exports.slugCategory = slugCategory;
exports.loadCategories = loadCategories;
exports.saveCategories = saveCategories;
exports.categoryKind = categoryKind;
exports.isIncomeCategory = isIncomeCategory;
exports.loadRules = loadRules;
exports.saveRules = saveRules;
exports.loadRuns = loadRuns;
exports.saveRuns = saveRuns;
exports.addRun = addRun;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const RULES_FILE = path_1.default.join(DATA_DIR, "recurring-rules.json");
const RUNS_FILE = path_1.default.join(DATA_DIR, "statement-runs.json");
const CATEGORIES_FILE = path_1.default.join(DATA_DIR, "categories.json");
function ensureDataDir() {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
}
exports.DEFAULT_CATEGORIES = [
    { id: "ads", label: "Ads / publicidad", kind: "gasto", builtin: true },
    { id: "pass", label: "Pase / peaje", kind: "gasto", builtin: true },
    { id: "nomina", label: "Nómina", kind: "gasto", builtin: true },
    { id: "proveedor", label: "Proveedor", kind: "gasto", builtin: true },
    { id: "renta", label: "Renta", kind: "gasto", builtin: true },
    { id: "servicios", label: "Servicios / software", kind: "gasto", builtin: true },
    { id: "comisiones", label: "Comisiones bancarias", kind: "gasto", builtin: true },
    { id: "impuestos", label: "Impuestos", kind: "gasto", builtin: true },
    { id: "evento", label: "Costo de evento", kind: "gasto", builtin: true },
    { id: "transferencia_persona", label: "Transferencia a persona", kind: "neutro", builtin: true },
    { id: "ingreso", label: "Ingreso", kind: "ingreso", builtin: true },
    { id: "venta", label: "Venta / anticipo cliente", kind: "ingreso", builtin: true },
    { id: "otro", label: "Otro", kind: "neutro", builtin: true },
    { id: "revisar", label: "Revisar", kind: "neutro", builtin: true },
];
function slugCategory(label) {
    return String(label || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || `cat_${Date.now()}`;
}
let categoriesCache = null;
function loadCategories() {
    if (categoriesCache)
        return categoriesCache;
    ensureDataDir();
    if (!fs_1.default.existsSync(CATEGORIES_FILE)) {
        saveCategories(exports.DEFAULT_CATEGORIES);
        return categoriesCache;
    }
    try {
        const raw = JSON.parse(fs_1.default.readFileSync(CATEGORIES_FILE, "utf8"));
        if (!Array.isArray(raw) || raw.length === 0) {
            saveCategories(exports.DEFAULT_CATEGORIES);
            return categoriesCache;
        }
        const byId = new Map(raw.map((c) => [c.id, c]));
        let changed = false;
        for (const d of exports.DEFAULT_CATEGORIES) {
            if (!byId.has(d.id)) {
                raw.push({ ...d });
                changed = true;
            }
        }
        if (changed) {
            saveCategories(raw);
            return categoriesCache;
        }
        categoriesCache = raw;
        return categoriesCache;
    }
    catch {
        saveCategories(exports.DEFAULT_CATEGORIES);
        return categoriesCache;
    }
}
function saveCategories(categories) {
    ensureDataDir();
    categoriesCache = categories.map((c) => ({ ...c }));
    fs_1.default.writeFileSync(CATEGORIES_FILE, JSON.stringify(categoriesCache, null, 2), "utf8");
}
function categoryKind(id) {
    const found = loadCategories().find((c) => c.id === id);
    if (found)
        return found.kind;
    if (id === "ingreso" || id === "venta")
        return "ingreso";
    return "neutro";
}
function isIncomeCategory(id) {
    return categoryKind(id) === "ingreso";
}
const DEFAULT_RULES = [
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
        category: "servicios",
        label: "Replit",
        frecuente: true,
    },
    {
        id: "r-shopify",
        match: "shopify",
        category: "servicios",
        label: "Shopify",
        frecuente: true,
    },
    {
        id: "r-anthropic",
        match: "anthropic",
        category: "servicios",
        label: "Anthropic / Claude",
        frecuente: true,
    },
    {
        id: "r-sendinblue",
        match: "sendinblue",
        category: "servicios",
        label: "Brevo / Sendinblue",
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
function loadRules() {
    ensureDataDir();
    if (!fs_1.default.existsSync(RULES_FILE)) {
        saveRules(DEFAULT_RULES);
        return DEFAULT_RULES;
    }
    try {
        const raw = JSON.parse(fs_1.default.readFileSync(RULES_FILE, "utf8"));
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
        if (changed)
            saveRules(raw);
        return raw;
    }
    catch {
        saveRules(DEFAULT_RULES);
        return DEFAULT_RULES;
    }
}
function saveRules(rules) {
    ensureDataDir();
    fs_1.default.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf8");
}
function loadRuns() {
    ensureDataDir();
    if (!fs_1.default.existsSync(RUNS_FILE))
        return [];
    try {
        return JSON.parse(fs_1.default.readFileSync(RUNS_FILE, "utf8"));
    }
    catch {
        return [];
    }
}
function saveRuns(runs) {
    ensureDataDir();
    fs_1.default.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2), "utf8");
}
function addRun(run) {
    const runs = loadRuns();
    runs.unshift(run);
    // conservar últimos 30
    saveRuns(runs.slice(0, 30));
}
//# sourceMappingURL=store.js.map