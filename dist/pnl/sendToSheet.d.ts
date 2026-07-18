import type { StatementRun } from "./types";
export declare function sendRunToBancoSheet(run: StatementRun): Promise<{
    sheetName: string;
    row?: number;
    action?: string;
    version?: string;
}>;
