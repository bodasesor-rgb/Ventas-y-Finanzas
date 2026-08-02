/**
 * Revisión automática / verificación de estados de cuenta.
 * La lógica vive en verifyParse.ts (1ª lectura + forceSolve).
 */
import type { RecurringRule, StatementRun } from "./types";
import { verifyStatementParse, type VerifyResult } from "./verifyParse";

export type AutoReviewResult = VerifyResult;

/**
 * 1ª lectura verificada (upload/reparse): corrige tipografía si puede;
 * si no cuadra, deja listo para el botón de revisión.
 */
export function verifyOnFirstRead(
  text: string,
  rules: RecurringRule[]
): VerifyResult {
  return verifyStatementParse(text, rules, { forceSolve: false });
}

/**
 * Revisión forzada: debe cuadrar sí o sí (incluye ajuste de conciliación).
 */
export function runAutoReview(
  text: string,
  rules: RecurringRule[]
): VerifyResult {
  return verifyStatementParse(text, rules, { forceSolve: true });
}

export function applyAutoReviewToRun(
  run: StatementRun,
  rules: RecurringRule[]
): VerifyResult {
  const text = run.textFull || run.textPreview || "";
  const result = runAutoReview(text, rules);
  run.lines = result.lines;
  run.summaryByCategory = result.summaryByCategory;
  run.totals = result.totals;
  run.reconciliation = result.reconciliation;
  run.autoReview = result.autoReview;
  return result;
}

export function applyVerifiedParseToRun(
  run: StatementRun,
  rules: RecurringRule[]
): VerifyResult {
  const text = run.textFull || run.textPreview || "";
  const result = verifyOnFirstRead(text, rules);
  run.lines = result.lines;
  run.summaryByCategory = result.summaryByCategory;
  run.totals = result.totals;
  run.reconciliation = result.reconciliation;
  run.autoReview = result.autoReview;
  return result;
}
