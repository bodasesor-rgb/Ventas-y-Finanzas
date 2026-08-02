"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractOfficialFromPreamble = extractOfficialFromPreamble;
exports.buildOfficialAwareTotals = buildOfficialAwareTotals;
/**
 * Totales del resumen al inicio del estado (Depósitos / Otros cargos).
 * Esos montos son la verdad del banco; la suma de movimientos solo sirve
 * para encontrar líneas dañadas (puntos/comas/folios).
 */
const parseStatement_1 = require("./parseStatement");
const statementSummary_1 = require("./statementSummary");
/**
 * Lee el resumen SOLO de la portada / inicio del PDF
 * (antes de "Detalle de Operaciones"), que es donde Banamex
 * imprime Depósitos y Retiros/compras/comis./otros cargos.
 */
function extractOfficialFromPreamble(text) {
    const cut = text.search(/Detalle de Operaciones/i);
    const preamble = cut > 80 ? text.slice(0, cut) : text.slice(0, 4500);
    const fromPre = (0, statementSummary_1.extractStatementOfficialTotals)(preamble);
    // Si la portada no trajo Depósitos, caer al documento completo
    if (fromPre.ingresosOficiales != null ||
        fromPre.gastosOficiales != null) {
        return fromPre;
    }
    return (0, statementSummary_1.extractStatementOfficialTotals)(text);
}
/**
 * Totales a mostrar / enviar = montos generales del estado.
 * La suma de líneas queda en totals.parseado para localizar daños.
 */
function buildOfficialAwareTotals(lines, textOrOficial) {
    const oficial = typeof textOrOficial === "string"
        ? extractOfficialFromPreamble(textOrOficial)
        : textOrOficial;
    const parseado = (0, parseStatement_1.summarizeTotals)(lines);
    const reconciliation = (0, statementSummary_1.reconcileTotals)(oficial, parseado, 1);
    const hasOficial = oficial.ingresosOficiales != null || oficial.gastosOficiales != null;
    // Neto del resumen PDF (corte − anterior, o depósitos + cargos oficiales)
    let netoOficial = null;
    if (oficial.saldoCorte != null && oficial.saldoAnterior != null) {
        netoOficial =
            Math.round((oficial.saldoCorte - oficial.saldoAnterior) * 100) / 100;
    }
    else if (oficial.ingresosOficiales != null &&
        oficial.gastosOficiales != null) {
        netoOficial =
            Math.round((oficial.ingresosOficiales + oficial.gastosOficiales) * 100) / 100;
    }
    let ingresos;
    let gastos;
    let neto;
    let source;
    if (reconciliation.matchCompleto && hasOficial) {
        // Cuadra: usar resumen oficial tal cual
        ingresos =
            oficial.ingresosOficiales != null
                ? oficial.ingresosOficiales
                : parseado.ingresos;
        gastos =
            oficial.gastosOficiales != null
                ? oficial.gastosOficiales
                : parseado.gastos;
        neto =
            netoOficial != null
                ? netoOficial
                : Math.round((ingresos + gastos) * 100) / 100;
        source = "oficial";
    }
    else if (hasOficial && netoOficial != null) {
        // NO cuadra: no inflar ingreso — solo ajustar gasto para cerrar el neto
        ingresos = parseado.ingresos;
        neto = netoOficial;
        gastos = Math.round((neto - ingresos) * 100) / 100;
        source = "oficial";
    }
    else {
        ingresos = parseado.ingresos;
        gastos = parseado.gastos;
        neto = parseado.neto;
        source = "parseado";
    }
    const summaryByCategory = (0, parseStatement_1.summarizeByCategory)(lines);
    // Solo meter en "revisar" el hueco de GASTOS (nunca inflar ingreso vía categorías)
    if (hasOficial && !reconciliation.matchCompleto) {
        const gapGas = Math.round((gastos - parseado.gastos) * 100) / 100;
        if (Math.abs(gapGas) > 0.009) {
            summaryByCategory.revisar =
                Math.round(((summaryByCategory.revisar || 0) + gapGas) * 100) / 100;
        }
    }
    else if (hasOficial && reconciliation.matchCompleto) {
        const gapGas = Math.round((gastos - parseado.gastos) * 100) / 100;
        const gapIng = Math.round((ingresos - parseado.ingresos) * 100) / 100;
        const gap = Math.round((gapIng + gapGas) * 100) / 100;
        if (Math.abs(gap) > 0.009) {
            summaryByCategory.revisar =
                Math.round(((summaryByCategory.revisar || 0) + gap) * 100) / 100;
        }
    }
    return {
        oficial,
        reconciliation,
        summaryByCategory,
        totals: {
            ingresos,
            gastos,
            neto,
            source,
            parseado,
        },
    };
}
//# sourceMappingURL=officialTotals.js.map