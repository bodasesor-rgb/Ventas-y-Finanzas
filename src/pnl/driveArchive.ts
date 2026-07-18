import fs from "fs";
import path from "path";
import { postToAppsScript } from "../appsScriptClient";
import {
  STATEMENTS_ROOT,
  ensureStatementsRoot,
  resolveStatementFile,
} from "./statementFiles";
import { loadRuns, saveRuns, upsertRunByPeriod } from "./store";
import type { StatementRun } from "./types";

export interface ArchiveListItem {
  periodKey: string;
  periodLabel?: string;
  pdfFileId?: string;
  runFileId?: string;
  pdfUrl?: string;
  storedName?: string;
  updatedAt?: string;
  runId?: string;
}

function runForArchive(run: StatementRun): StatementRun {
  // Persist almost everything needed after deploy
  return { ...run };
}

export async function archiveStatementToDrive(
  run: StatementRun,
  pdfAbsolutePath: string
): Promise<{
  pdfFileId?: string;
  runFileId?: string;
  pdfUrl?: string;
  version?: string;
}> {
  if (!run.periodKey) {
    throw new Error("archive: falta periodKey");
  }
  if (!fs.existsSync(pdfAbsolutePath)) {
    throw new Error("archive: PDF local no existe");
  }
  const pdfBase64 = fs.readFileSync(pdfAbsolutePath).toString("base64");
  const result = await postToAppsScript({
    action: "saveStatementArchive",
    periodKey: run.periodKey,
    periodLabel: run.periodLabel || run.periodKey,
    storedName: run.storedName || `${run.periodKey}_estado-cuenta.pdf`,
    runId: run.id,
    pdfBase64,
    runJson: runForArchive(run),
  });
  return {
    pdfFileId: result.pdfFileId,
    runFileId: result.runFileId,
    pdfUrl: result.pdfUrl,
    version: result.version,
  };
}

export async function listDriveArchives(): Promise<ArchiveListItem[]> {
  const result = await postToAppsScript({
    action: "listStatementArchive",
  });
  const items = result.items as ArchiveListItem[] | undefined;
  return Array.isArray(items) ? items : [];
}

export async function fetchDriveArchive(periodKey: string): Promise<{
  periodKey: string;
  periodLabel?: string;
  storedName: string;
  pdfBase64: string;
  pdfFileId?: string;
  runFileId?: string;
  pdfUrl?: string;
  run: StatementRun;
}> {
  const result = await postToAppsScript({
    action: "getStatementArchive",
    periodKey,
  });
  if (!result.pdfBase64 || !result.run) {
    throw new Error(`Archivo incompleto en Drive para ${periodKey}`);
  }
  return {
    periodKey: result.periodKey || periodKey,
    periodLabel: result.periodLabel,
    storedName: result.storedName || `${periodKey}_estado-cuenta.pdf`,
    pdfBase64: result.pdfBase64,
    pdfFileId: result.pdfFileId,
    runFileId: result.runFileId,
    pdfUrl: result.pdfUrl,
    run: result.run as StatementRun,
  };
}

function writeLocalPdf(
  periodKey: string,
  storedName: string,
  pdfBase64: string
): { relativePath: string; absolutePath: string } {
  ensureStatementsRoot();
  const dir = path.join(STATEMENTS_ROOT, periodKey);
  fs.mkdirSync(dir, { recursive: true });
  const absolutePath = path.join(dir, storedName);
  fs.writeFileSync(absolutePath, Buffer.from(pdfBase64, "base64"));
  return {
    relativePath: path.join(periodKey, storedName),
    absolutePath,
  };
}

/** Restaura un mes desde Drive al disco + runs locales. */
export async function restorePeriodFromDrive(
  periodKey: string
): Promise<StatementRun> {
  const fetched = await fetchDriveArchive(periodKey);
  const storedName =
    fetched.storedName || `${periodKey}_estado-cuenta.pdf`;
  const local = writeLocalPdf(periodKey, storedName, fetched.pdfBase64);
  const run: StatementRun = {
    ...fetched.run,
    periodKey: fetched.periodKey || periodKey,
    periodLabel: fetched.periodLabel || fetched.run.periodLabel || periodKey,
    storedName,
    storedRelativePath: local.relativePath,
    drivePdfFileId: fetched.pdfFileId || fetched.run.drivePdfFileId,
    driveRunFileId: fetched.runFileId || fetched.run.driveRunFileId,
    drivePdfUrl: fetched.pdfUrl || fetched.run.drivePdfUrl,
    archivedAt: new Date().toISOString(),
  };
  upsertRunByPeriod(run);
  return run;
}

let autoRestoreDone = false;

/** Una sola auto-restauración por proceso Node (tras deploy). */
export function shouldAutoRestoreOnce(): boolean {
  if (autoRestoreDone) return false;
  autoRestoreDone = true;
  return true;
}

/**
 * Si el disco quedó vacío tras un deploy, restaura todo lo archivado en Drive.
 * Si ya hay runs locales, solo completa PDFs/meses faltantes.
 */
export async function restoreArchivesFromDrive(): Promise<{
  restored: string[];
  skipped: string[];
  errors: string[];
}> {
  const restored: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  let items: ArchiveListItem[] = [];
  try {
    items = await listDriveArchives();
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { restored, skipped, errors };
  }

  const local = loadRuns();
  const byPeriod = new Map(
    local.filter((r) => r.periodKey).map((r) => [r.periodKey!, r])
  );

  for (const item of items) {
    const key = item.periodKey;
    if (!key) continue;
    const existing = byPeriod.get(key);
    const hasPdf =
      existing?.storedRelativePath &&
      Boolean(resolveStatementFile(existing.storedRelativePath));

    if (existing && hasPdf) {
      // Asegura ids de Drive en el run local
      if (!existing.drivePdfFileId && item.pdfFileId) {
        existing.drivePdfFileId = item.pdfFileId;
        existing.driveRunFileId = item.runFileId;
        existing.drivePdfUrl = item.pdfUrl;
        byPeriod.set(key, existing);
      }
      skipped.push(key);
      continue;
    }

    try {
      const run = await restorePeriodFromDrive(key);
      byPeriod.set(key, run);
      restored.push(key);
    } catch (err) {
      errors.push(
        `${key}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Reescribir runs ordenados por periodo desc
  const merged = Array.from(byPeriod.values()).sort((a, b) =>
    String(b.periodKey || "").localeCompare(String(a.periodKey || ""))
  );
  saveRuns(merged.slice(0, 40));
  return { restored, skipped, errors };
}

/** Sirve bytes del PDF: disco local o, si falta, Drive → disco. */
export async function resolvePdfBytes(run: StatementRun): Promise<{
  bytes: Buffer;
  filename: string;
} | null> {
  if (run.storedRelativePath) {
    const full = resolveStatementFile(run.storedRelativePath);
    if (full) {
      return {
        bytes: fs.readFileSync(full),
        filename: run.storedName || path.basename(full),
      };
    }
  }
  if (!run.periodKey) return null;
  try {
    const restored = await restorePeriodFromDrive(run.periodKey);
    const full = restored.storedRelativePath
      ? resolveStatementFile(restored.storedRelativePath)
      : null;
    if (!full) return null;
    return {
      bytes: fs.readFileSync(full),
      filename: restored.storedName || path.basename(full),
    };
  } catch {
    return null;
  }
}
