"use strict";
/**
 * Lee el resumen Banamex del PDF:
 *   Depósitos / Retiros en efectivo / Otros cargos / Saldo…
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractStatementOfficialTotals = extractStatementOfficialTotals;
exports.reconcileTotals = reconcileTotals;
function parseMoney(raw) {
    const n = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n))
        return null;
    return Math.round(n * 100) / 100;
}
function extractStatementOfficialTotals(text) {
    const t = text.replace(/\s+/g, " ");
    const pick = (label) => {
        const m = t.match(label);
        return m ? parseMoney(m[1]) : null;
    };
    const saldoAnterior = pick(/Saldo\s+anterior\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
    // Preferir el resumen compacto: "(-)46Retiros/compras/comis./otros cargos185,037.87"
    const depositosResumen = pick(/(?:\(\+\)\s*\d*)?Dep[oó]sitos\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
    const cargosResumen = pick(/Retiros\/compras\/comis\.\/otros cargos\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
    const depositos = depositosResumen ??
        pick(/Dep[oó]sitos\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
    const retirosEfectivo = pick(/Retiros\s+en\s+efectivo\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
    const otrosCargos = pick(/Otros\s+cargos\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
    const saldoCorte = pick(/Saldo\s+al\s+corte\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
    const ingresosOficiales = depositos;
    // Total de salidas del estado (incluye comisión). Preferir línea del resumen (+/-).
    let gastosOficiales = null;
    if (cargosResumen != null) {
        gastosOficiales = -Math.abs(cargosResumen);
    }
    else if (otrosCargos != null || retirosEfectivo != null) {
        gastosOficiales = -Math.abs((otrosCargos || 0) + (retirosEfectivo || 0));
    }
    return {
        saldoAnterior,
        depositos,
        retirosEfectivo,
        otrosCargos,
        saldoCorte,
        ingresosOficiales,
        gastosOficiales,
    };
}
function reconcileTotals(oficial, parseado, tolerancia = 1) {
    const diffIngresos = oficial.ingresosOficiales == null
        ? null
        : Math.round((parseado.ingresos - oficial.ingresosOficiales) * 100) /
            100;
    const diffGastos = oficial.gastosOficiales == null
        ? null
        : Math.round((parseado.gastos - oficial.gastosOficiales) * 100) / 100;
    const matchIngresos = diffIngresos != null && Math.abs(diffIngresos) <= tolerancia;
    const matchGastos = diffGastos != null && Math.abs(diffGastos) <= tolerancia;
    return {
        oficial,
        parseado,
        diffIngresos,
        diffGastos,
        matchIngresos,
        matchGastos,
        matchCompleto: matchIngresos && matchGastos,
        tolerancia,
    };
}
//# sourceMappingURL=statementSummary.js.map