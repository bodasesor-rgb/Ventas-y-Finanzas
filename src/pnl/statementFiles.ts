import fs from "fs";
import path from "path";
import type { StatementPeriod } from "./period";

export const STATEMENTS_ROOT = path.join(process.cwd(), "data", "statements");

export function ensureStatementsRoot(): void {
  if (!fs.existsSync(STATEMENTS_ROOT)) {
    fs.mkdirSync(STATEMENTS_ROOT, { recursive: true });
  }
}

/**
 * Guarda el PDF en data/statements/YYYY-MM/YYYY-MM_estado-cuenta.pdf
 * Si ya existe, agrega sufijo _2, _3…
 */
export function saveStatementPdf(
  tempPath: string,
  period: StatementPeriod
): { storedPath: string; storedName: string; relativePath: string } {
  ensureStatementsRoot();
  const dir = path.join(STATEMENTS_ROOT, period.key);
  fs.mkdirSync(dir, { recursive: true });

  let storedName = period.fileTitle;
  let dest = path.join(dir, storedName);
  let n = 2;
  while (fs.existsSync(dest)) {
    storedName = `${period.key}_estado-cuenta_${n}.pdf`;
    dest = path.join(dir, storedName);
    n += 1;
  }

  fs.copyFileSync(tempPath, dest);
  try {
    fs.unlinkSync(tempPath);
  } catch {
    /* ignore */
  }

  const relativePath = path.join(period.key, storedName);
  return { storedPath: dest, storedName, relativePath };
}

export function resolveStatementFile(relativePath: string): string | null {
  if (!relativePath || relativePath.includes("..")) return null;
  const full = path.join(STATEMENTS_ROOT, relativePath);
  if (!full.startsWith(STATEMENTS_ROOT)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}
