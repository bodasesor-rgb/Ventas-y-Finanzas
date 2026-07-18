import type { CategoryDef, RecurringRule, StatementRun } from "./types";
export declare const DEFAULT_CATEGORIES: CategoryDef[];
export declare function slugCategory(label: string): string;
export declare function loadCategories(): CategoryDef[];
export declare function saveCategories(categories: CategoryDef[]): void;
export declare function categoryKind(id: string): CategoryDef["kind"];
export declare function isIncomeCategory(id: string): boolean;
export declare function loadRules(): RecurringRule[];
export declare function saveRules(rules: RecurringRule[]): void;
export declare function loadRuns(): StatementRun[];
export declare function saveRuns(runs: StatementRun[]): void;
export declare function addRun(run: StatementRun): void;
/** Un run por mes: reemplaza el anterior del mismo periodKey. */
export declare function upsertRunByPeriod(run: StatementRun): void;
