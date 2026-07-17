"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
function ensureDataDir() {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
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