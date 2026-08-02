import { type Reconciliation } from "./statementSummary";
import type { AutoReviewReport, BankLine, RecurringRule, StatementRun } from "./types";
export interface AutoReviewResult {
    lines: BankLine[];
    summaryByCategory: Record<string, number>;
    totals: {
        ingresos: number;
        gastos: number;
        neto: number;
    };
    reconciliation: Reconciliation;
    autoReview: AutoReviewReport;
}
/**
 * Lee el texto del estado varias veces y localiza la cuenta distinta.
 */
export declare function runAutoReview(text: string, rules: RecurringRule[]): AutoReviewResult;
/** Aplica el resultado de auto-review sobre un StatementRun (mutación). */
export declare function applyAutoReviewToRun(run: StatementRun, rules: RecurringRule[]): AutoReviewResult;
