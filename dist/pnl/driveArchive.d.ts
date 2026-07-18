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
export declare function archiveStatementToDrive(run: StatementRun, pdfAbsolutePath: string): Promise<{
    pdfFileId?: string;
    runFileId?: string;
    pdfUrl?: string;
    version?: string;
}>;
export declare function listDriveArchives(): Promise<ArchiveListItem[]>;
/** Borra entrada del índice Drive + archivos (si Apps Script v12+ lo soporta). */
export declare function deleteDriveArchive(periodKey: string): Promise<void>;
export declare function fetchDriveArchive(periodKey: string): Promise<{
    periodKey: string;
    periodLabel?: string;
    storedName: string;
    pdfBase64: string;
    pdfFileId?: string;
    runFileId?: string;
    pdfUrl?: string;
    run: StatementRun;
}>;
/** Restaura un mes desde Drive al disco + runs locales. */
export declare function restorePeriodFromDrive(periodKey: string): Promise<StatementRun>;
/** Una sola auto-restauración por proceso Node (tras deploy). */
export declare function shouldAutoRestoreOnce(): boolean;
/**
 * Si el disco quedó vacío tras un deploy, restaura todo lo archivado en Drive.
 * Si ya hay runs locales, solo completa PDFs/meses faltantes.
 */
export declare function restoreArchivesFromDrive(): Promise<{
    restored: string[];
    skipped: string[];
    errors: string[];
}>;
/** Sirve bytes del PDF: disco local o, si falta, Drive → disco. */
export declare function resolvePdfBytes(run: StatementRun): Promise<{
    bytes: Buffer;
    filename: string;
} | null>;
