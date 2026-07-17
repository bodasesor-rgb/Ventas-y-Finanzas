import type { RecurringRule, StatementRun } from "./types";
export declare function loadRules(): RecurringRule[];
export declare function saveRules(rules: RecurringRule[]): void;
export declare function loadRuns(): StatementRun[];
export declare function saveRuns(runs: StatementRun[]): void;
export declare function addRun(run: StatementRun): void;
