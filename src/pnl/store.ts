import fs from "fs";
import path from "path";
import type { RecurringRule, StatementRun } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RULES_FILE = path.join(DATA_DIR, "recurring-rules.json");
const RUNS_FILE = path.join(DATA_DIR, "statement-runs.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
    id: "r-ads-google",
    match: "google ads",
    category: "ads",
    label: "Google Ads",
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

export function loadRuns(): StatementRun[] {
  ensureDataDir();
  if (!fs.existsSync(RUNS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RUNS_FILE, "utf8")) as StatementRun[];
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
