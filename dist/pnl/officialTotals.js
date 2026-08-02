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
    const ingresos = oficial.ingresosOficiales != null
        ? oficial.ingresosOficiales
        : parseado.ingresos;
    const gastos = oficial.gastosOficiales != null
        ? oficial.gastosOficiales
        : parseado.gastos;
    const neto = Math.round((ingresos + gastos) * 100) / 100;
    const summaryByCategory = (0, parseStatement_1.summarizeByCategory)(lines);
    // Diferencia líneas vs resumen → categoría "revisar" para que el Sheet
    // refleje el total oficial sin perder el desglose aproximado.
    if (hasOficial) {
        const gapIng = Math.round((ingresos - parseado.ingresos) * 100) / 100;
        const gapGas = Math.round((gastos - parseado.gastos) * 100) / 100;
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
            source: hasOficial ? "oficial" : "parseado",
            parseado,
        },
    };
}
//# sourceMappingURL=officialTotals.js.map