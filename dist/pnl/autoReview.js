"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyOnFirstRead = verifyOnFirstRead;
exports.runAutoReview = runAutoReview;
exports.applyAutoReviewToRun = applyAutoReviewToRun;
exports.applyVerifiedParseToRun = applyVerifiedParseToRun;
const verifyParse_1 = require("./verifyParse");
/**
 * 1ª lectura verificada (upload/reparse): corrige tipografía si puede;
 * si no cuadra, deja listo para el botón de revisión.
 */
function verifyOnFirstRead(text, rules) {
    return (0, verifyParse_1.verifyStatementParse)(text, rules, { forceSolve: false });
}
/**
 * Revisión forzada: debe cuadrar sí o sí (incluye ajuste de conciliación).
 */
function runAutoReview(text, rules) {
    return (0, verifyParse_1.verifyStatementParse)(text, rules, { forceSolve: true });
}
function applyAutoReviewToRun(run, rules) {
    const text = run.textFull || run.textPreview || "";
    const result = runAutoReview(text, rules);
    run.lines = result.lines;
    run.summaryByCategory = result.summaryByCategory;
    run.totals = result.totals;
    run.reconciliation = result.reconciliation;
    run.autoReview = result.autoReview;
    return result;
}
function applyVerifiedParseToRun(run, rules) {
    const text = run.textFull || run.textPreview || "";
    const result = verifyOnFirstRead(text, rules);
    run.lines = result.lines;
    run.summaryByCategory = result.summaryByCategory;
    run.totals = result.totals;
    run.reconciliation = result.reconciliation;
    run.autoReview = result.autoReview;
    return result;
}
//# sourceMappingURL=autoReview.js.map