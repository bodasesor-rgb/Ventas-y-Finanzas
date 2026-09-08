"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weekIsLive_ = weekIsLive_;
exports.shouldWriteWeekCell_ = shouldWriteWeekCell_;
/**
 * Semana en curso, o la que cerró en los últimos 7 días.
 * Esas hay que reescribir: si no, el primer fill parcial se congela.
 */
function weekIsLive_(weekStartMs, todayUtc) {
    const weekEnd = weekStartMs + 7 * 86400000;
    return weekStartMs <= todayUtc && weekEnd > todayUtc - 7 * 86400000;
}
function shouldWriteWeekCell_(opts) {
    if (opts.force || opts.empty)
        return true;
    return weekIsLive_(opts.weekStartMs, opts.todayUtc);
}
//# sourceMappingURL=metricasWeek.js.map
