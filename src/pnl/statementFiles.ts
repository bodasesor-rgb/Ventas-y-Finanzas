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
 * Guarda el PDF como data/statements/YYYY-MM/YYYY-MM_estado-cuenta.pdf
 * Un solo archivo por mes: sobrescribe y borra variantes _2, _3…
 */
export function saveStatementPdf(
  tempPath: string,
  period: StatementPeriod
): { storedPath: string; storedName: string; relativePath: string } {
  ensureStatementsRoot();
  const dir = path.join(STATEMENTS_ROOT, period.key);
  fs.mkdirSync(dir, { recursive: true });

  const storedName = period.fileTitle;
  const dest = path.join(dir, storedName);
  fs.copyFileSync(tempPath, dest);

  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === storedName) continue;
      if (
        f.startsWith(`${period.key}_estado-cuenta`) &&
        f.toLowerCase().endsWith(".pdf")
      ) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore cleanup */
  }

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
