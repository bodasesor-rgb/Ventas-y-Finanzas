"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.archiveStatementToDrive = archiveStatementToDrive;
exports.listDriveArchives = listDriveArchives;
exports.deleteDriveArchive = deleteDriveArchive;
exports.fetchDriveArchive = fetchDriveArchive;
exports.restorePeriodFromDrive = restorePeriodFromDrive;
exports.shouldAutoRestoreOnce = shouldAutoRestoreOnce;
exports.restoreArchivesFromDrive = restoreArchivesFromDrive;
exports.resolvePdfBytes = resolvePdfBytes;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const appsScriptClient_1 = require("../appsScriptClient");
const statementFiles_1 = require("./statementFiles");
const store_1 = require("./store");
function runForArchive(run) {
    // Persist almost everything needed after deploy
    return { ...run };
}
async function archiveStatementToDrive(run, pdfAbsolutePath) {
    if (!run.periodKey) {
        throw new Error("archive: falta periodKey");
    }
    if (!fs_1.default.existsSync(pdfAbsolutePath)) {
        throw new Error("archive: PDF local no existe");
    }
    const pdfBase64 = fs_1.default.readFileSync(pdfAbsolutePath).toString("base64");
    const result = await (0, appsScriptClient_1.postToAppsScript)({
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
async function listDriveArchives() {
    const result = await (0, appsScriptClient_1.postToAppsScript)({
        action: "listStatementArchive",
    });
    const items = result.items;
    return Array.isArray(items) ? items : [];
}
/** Borra entrada del índice Drive + archivos (si Apps Script v12+ lo soporta). */
async function deleteDriveArchive(periodKey) {
    if (!/^\d{4}-\d{2}$/.test(periodKey))
        return;
    try {
        await (0, appsScriptClient_1.postToAppsScript)({
            action: "deleteStatementArchive",
            periodKey,
        });
    }
    catch (err) {
        console.warn("[pnl] delete Drive archive", err instanceof Error ? err.message : err);
    }
}
async function fetchDriveArchive(periodKey) {
    const result = await (0, appsScriptClient_1.postToAppsScript)({
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
        run: result.run,
    };
}
function writeLocalPdf(periodKey, storedName, pdfBase64) {
    (0, statementFiles_1.ensureStatementsRoot)();
    const dir = path_1.default.join(statementFiles_1.STATEMENTS_ROOT, periodKey);
    fs_1.default.mkdirSync(dir, { recursive: true });
    const absolutePath = path_1.default.join(dir, storedName);
    fs_1.default.writeFileSync(absolutePath, Buffer.from(pdfBase64, "base64"));
    return {
        relativePath: path_1.default.join(periodKey, storedName),
        absolutePath,
    };
}
/** Restaura un mes desde Drive al disco + runs locales. */
async function restorePeriodFromDrive(periodKey) {
    const fetched = await fetchDriveArchive(periodKey);
    const storedName = fetched.storedName || `${periodKey}_estado-cuenta.pdf`;
    const local = writeLocalPdf(periodKey, storedName, fetched.pdfBase64);
    const run = {
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
    (0, store_1.upsertRunByPeriod)(run);
    return run;
}
let autoRestoreDone = false;
/** Una sola auto-restauración por proceso Node (tras deploy). */
function shouldAutoRestoreOnce() {
    if (autoRestoreDone)
        return false;
    autoRestoreDone = true;
    return true;
}
/**
 * Si el disco quedó vacío tras un deploy, restaura todo lo archivado en Drive.
 * Si ya hay runs locales, solo completa PDFs/meses faltantes.
 */
async function restoreArchivesFromDrive() {
    const restored = [];
    const skipped = [];
    const errors = [];
    let items = [];
    try {
        items = await listDriveArchives();
    }
    catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        return { restored, skipped, errors };
    }
    const local = (0, store_1.loadRuns)();
    const byPeriod = new Map(local.filter((r) => r.periodKey).map((r) => [r.periodKey, r]));
    for (const item of items) {
        const key = item.periodKey;
        if (!key)
            continue;
        const existing = byPeriod.get(key);
        const hasPdf = existing?.storedRelativePath &&
            Boolean((0, statementFiles_1.resolveStatementFile)(existing.storedRelativePath));
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
        }
        catch (err) {
            errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // Reescribir runs ordenados por periodo desc
    const merged = Array.from(byPeriod.values()).sort((a, b) => String(b.periodKey || "").localeCompare(String(a.periodKey || "")));
    (0, store_1.saveRuns)(merged.slice(0, 40));
    return { restored, skipped, errors };
}
/** Sirve bytes del PDF: disco local o, si falta, Drive → disco. */
async function resolvePdfBytes(run) {
    if (run.storedRelativePath) {
        const full = (0, statementFiles_1.resolveStatementFile)(run.storedRelativePath);
        if (full) {
            return {
                bytes: fs_1.default.readFileSync(full),
                filename: run.storedName || path_1.default.basename(full),
            };
        }
    }
    if (!run.periodKey)
        return null;
    try {
        const restored = await restorePeriodFromDrive(run.periodKey);
        const full = restored.storedRelativePath
            ? (0, statementFiles_1.resolveStatementFile)(restored.storedRelativePath)
            : null;
        if (!full)
            return null;
        return {
            bytes: fs_1.default.readFileSync(full),
            filename: restored.storedName || path_1.default.basename(full),
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=driveArchive.js.map