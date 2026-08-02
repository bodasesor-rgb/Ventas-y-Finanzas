/**
 * Revisión automática / verificación de estados de cuenta.
 * La lógica vive en verifyParse.ts (1ª lectura + forceSolve).
 */
import type { RecurringRule, StatementRun } from "./types";
import { type VerifyResult } from "./verifyParse";
export type AutoReviewResult = VerifyResult;
/**
 * 1ª lectura verificada (upload/reparse): corrige tipografía si puede;
 * si no cuadra, deja listo para el botón de revisión.
 */
export declare function verifyOnFirstRead(text: string, rules: RecurringRule[]): VerifyResult;
/**
 * Revisión forzada: debe cuadrar sí o sí (incluye ajuste de conciliación).
 */
export declare function runAutoReview(text: string, rules: RecurringRule[]): VerifyResult;
export declare function applyAutoReviewToRun(run: StatementRun, rules: RecurringRule[]): VerifyResult;
export declare function applyVerifiedParseToRun(run: StatementRun, rules: RecurringRule[]): VerifyResult;
