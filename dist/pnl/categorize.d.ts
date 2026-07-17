import type { BankLine, RecurringRule } from "./types";
export declare function categorizeLine(description: string, amount: number, direction: BankLine["direction"], rules: RecurringRule[]): Pick<BankLine, "category" | "matchedRuleId" | "needsReview">;
