"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAutoReview = runAutoReview;
exports.applyAutoReviewToRun = applyAutoReviewToRun;
/**
 * Revisión automática de estados de cuenta:
 * relee el texto varias veces y busca errores típicos de puntos/comas
 * o dígitos de folio pegados al monto (casi siempre la causa del descuadre).
 */
const parseStatement_1 = require("./parseStatement");
const statementSummary_1 = require("./statementSummary");
const autoCategories_1 = require("./autoCategories");
const counterparties_1 = require("./counterparties");
const TOL = 1;
const STRATEGIES = [
    { id: "delta", label: "1ª lectura: Δsaldo + reparación de saldos pegados" },
    { id: "rebased", label: "2ª lectura: rebasar cadena con montos impresos" },
    { id: "printed", label: "3ª lectura: solo montos impresos" },
    { id: "hybrid", label: "4ª lectura: híbrida" },
];
function scoreReconciliation(rec) {
    let s = 0;
    if (rec.matchIngresos)
        s += 100;
    if (rec.matchGastos)
        s += 100;
    if (rec.diffIngresos != null)
        s -= Math.min(80, Math.abs(rec.diffIngresos) / 500);
    if (rec.diffGastos != null)
        s -= Math.min(80, Math.abs(rec.diffGastos) / 500);
    return s;
}
function money(n) {
    return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
    }).format(n);
}
function near(a, b, tol = TOL) {
    return Math.abs(a - b) <= tol;
}
function prepareLines(parsed) {
    const { lines: autoLines } = (0, autoCategories_1.autoCreateCategoriesFromLines)(parsed);
    return (0, counterparties_1.applyCounterpartyCategories)(autoLines);
}
function reconcileLines(text, lines) {
    const totals = (0, parseStatement_1.summarizeTotals)(lines);
    const oficial = (0, statementSummary_1.extractStatementOfficialTotals)(text);
    return { totals, reconciliation: (0, statementSummary_1.reconcileTotals)(oficial, totals, TOL) };
}
function totalsWithAmount(lines, lineId, amount) {
    return (0, parseStatement_1.summarizeTotals)(lines.map((l) => l.id === lineId
        ? {
            ...l,
            amount,
            direction: amount >= 0 ? "abono" : "cargo",
        }
        : l));
}
function applyAmount(lines, lineId, amount, note) {
    return lines.map((l) => l.id === lineId
        ? {
            ...l,
            amount: Math.round(amount * 100) / 100,
            direction: amount >= 0 ? "abono" : "cargo",
            needsReview: true,
            reviewNote: note,
        }
        : l);
}
/** El cambio debe explicar una fracción seria del descuadre (no un cargo de $400 ante $785 mil). */
function explainsDiff(before, after, minShare = 0.5) {
    if (before == null || after == null)
        return false;
    const absBefore = Math.abs(before);
    if (absBefore <= TOL)
        return false;
    const improvement = absBefore - Math.abs(after);
    if (improvement <= TOL)
        return false;
    return improvement >= absBefore * minShare - 0.01;
}
function findSuspects(lines, text, rec) {
    const oficial = (0, statementSummary_1.extractStatementOfficialTotals)(text);
    const found = [];
    const seen = new Set();
    const push = (s) => {
        const key = `${s.lineId}|${s.reason.slice(0, 48)}`;
        if (seen.has(key))
            return;
        seen.add(key);
        found.push(s);
    };
    const diffIng = rec.diffIngresos;
    const diffGas = rec.diffGastos;
    const absDiffIng = diffIng == null ? 0 : Math.abs(diffIng);
    const absDiffGas = diffGas == null ? 0 : Math.abs(diffGas);
    const dominantDiff = Math.max(absDiffIng, absDiffGas);
    // A) Notas del parser: saldo/impreso con dígitos pegados
    for (const line of lines) {
        if (line.reviewNote &&
            /pegad|folio|punto|coma|rebasad|impreso|Δsaldo/i.test(line.reviewNote)) {
            const abs = Math.abs(line.amount);
            // Solo destacar si el movimiento es relevante frente al descuadre
            if (dominantDiff <= TOL || abs >= dominantDiff * 0.2 || abs >= 1000) {
                push({
                    lineId: line.id,
                    date: line.date,
                    description: line.description,
                    amount: line.amount,
                    reason: line.reviewNote,
                });
            }
        }
    }
    // B) Monto ≈ diferencia (misma magnitud)
    for (const line of lines) {
        const abs = Math.abs(line.amount);
        if (diffIng != null && !rec.matchIngresos && near(abs, absDiffIng, 0.05)) {
            push({
                lineId: line.id,
                date: line.date,
                description: line.description,
                amount: line.amount,
                reason: `Monto ${money(line.amount)} ≈ diferencia de depósitos (${money(diffIng)})`,
            });
        }
        if (diffGas != null && !rec.matchGastos && near(abs, absDiffGas, 0.05)) {
            push({
                lineId: line.id,
                date: line.date,
                description: line.description,
                amount: line.amount,
                reason: `Monto ${money(line.amount)} ≈ diferencia de cargos (${money(diffGas)})`,
            });
        }
    }
    const typoHits = [];
    for (const line of lines) {
        const variants = (0, parseStatement_1.moneyTypoVariants)(line.amount);
        // Si amount - diff ≈ alguna variante tipográfica, usar la variante limpia (no 399.96)
        const extra = [];
        if (line.amount > 0 && diffIng != null && Math.abs(diffIng) > TOL) {
            const v = Math.round((line.amount - diffIng) * 100) / 100;
            const snap = variants.find((x) => x.value > 0 && near(x.value, v, 1));
            if (snap) {
                extra.push({
                    value: snap.value,
                    label: `variante que cierra depósitos (${snap.label})`,
                });
            }
        }
        if (line.amount < 0 && diffGas != null && Math.abs(diffGas) > TOL) {
            const v = Math.round((line.amount - diffGas) * 100) / 100;
            const snap = variants.find((x) => x.value < 0 && near(x.value, v, 1));
            if (snap) {
                extra.push({
                    value: snap.value,
                    label: `variante que cierra cargos (${snap.label})`,
                });
            }
        }
        for (const variant of [...variants, ...extra]) {
            // Ignorar cambios minúsculos ante descuadres enormes
            const deltaAmt = Math.abs(variant.value - line.amount);
            if (dominantDiff > 1000 && deltaAmt < dominantDiff * 0.2)
                continue;
            const t = totalsWithAmount(lines, line.id, variant.value);
            const r = (0, statementSummary_1.reconcileTotals)(oficial, t, TOL);
            const betterIng = explainsDiff(diffIng, r.diffIngresos, 0.45);
            const betterGas = explainsDiff(diffGas, r.diffGastos, 0.45);
            if (!betterIng && !betterGas && !r.matchCompleto)
                continue;
            // Preferir montos “redondos” tipográficos frente a amount-diff con basura de $0.01
            const neatBonus = Math.abs(variant.value * 100 - Math.round(variant.value * 100)) < 1e-9 &&
                (Math.abs(variant.value) < 1000 ||
                    Math.abs(variant.value % 1) < 1e-9 ||
                    Math.abs(Math.round(variant.value * 100) % 100) === 0)
                ? 25
                : 0;
            const stripBonus = /folio|dígito/i.test(variant.label) ? 15 : 0;
            const score = (r.matchCompleto ? 1000 : 0) +
                (r.matchIngresos && !rec.matchIngresos ? 200 : 0) +
                (r.matchGastos && !rec.matchGastos ? 200 : 0) +
                neatBonus +
                stripBonus +
                (betterIng
                    ? Math.abs(diffIng) - Math.abs(r.diffIngresos ?? diffIng)
                    : 0) +
                (betterGas
                    ? Math.abs(diffGas) - Math.abs(r.diffGastos ?? diffGas)
                    : 0);
            typoHits.push({
                line,
                variant,
                rec: r,
                closes: r.matchCompleto || (r.matchIngresos && r.matchGastos),
                score,
            });
        }
    }
    typoHits.sort((a, b) => b.score - a.score);
    if (typoHits.length && typoHits[0].closes) {
        const hit = typoHits[0];
        const note = `Corregido automáticamente (${hit.variant.label}): ${money(hit.line.amount)} → ${money(hit.variant.value)}`;
        const fixedLines = applyAmount(lines, hit.line.id, hit.variant.value, note);
        const suspect = {
            lineId: hit.line.id,
            date: hit.line.date,
            description: hit.line.description,
            amount: hit.line.amount,
            reason: note,
            suggestedAmount: hit.variant.value,
        };
        return {
            suspects: [suspect],
            fixedLines,
            fixedRec: hit.rec,
        };
    }
    for (const hit of typoHits.slice(0, 8)) {
        push({
            lineId: hit.line.id,
            date: hit.line.date,
            description: hit.line.description,
            amount: hit.line.amount,
            reason: `Posible error de puntos/comas (${hit.variant.label}): ${money(hit.line.amount)} → ${money(hit.variant.value)}`,
            suggestedAmount: hit.variant.value,
        });
    }
    // D) Excluir una línea SOLO si explica ≥50% del descuadre (o cierra)
    for (const line of lines) {
        const t = (0, parseStatement_1.summarizeTotals)(lines.filter((l) => l.id !== line.id));
        const r = (0, statementSummary_1.reconcileTotals)(oficial, t, TOL);
        if (r.matchCompleto && !rec.matchCompleto) {
            // Ante diffs grandes, excluir un monto chico casi nunca es la causa real
            if (dominantDiff > 1000 && Math.abs(line.amount) < dominantDiff * 0.2) {
                continue;
            }
            push({
                lineId: line.id,
                date: line.date,
                description: line.description,
                amount: line.amount,
                reason: `Si se excluye este movimiento, los totales cuadran con el PDF`,
                suggestedAmount: 0,
            });
        }
        else {
            const betterIng = explainsDiff(diffIng, r.diffIngresos, 0.5);
            const betterGas = explainsDiff(diffGas, r.diffGastos, 0.5);
            if (betterIng || betterGas) {
                push({
                    lineId: line.id,
                    date: line.date,
                    description: line.description,
                    amount: line.amount,
                    reason: `Excluir este movimiento reduce fuerte el descuadre (diff dep ${r.diffIngresos ?? "—"}, cargos ${r.diffGastos ?? "—"})`,
                });
            }
        }
    }
    // E) Signo invertido (rara vez; solo si cierra)
    for (const line of lines) {
        const flipped = -line.amount;
        const t = totalsWithAmount(lines, line.id, flipped);
        const r = (0, statementSummary_1.reconcileTotals)(oficial, t, TOL);
        if (r.matchCompleto && !rec.matchCompleto) {
            push({
                lineId: line.id,
                date: line.date,
                description: line.description,
                amount: line.amount,
                reason: `El signo parece invertido: con ${money(flipped)} el estado cuadra`,
                suggestedAmount: flipped,
            });
        }
    }
    // F) Par de montos cuya suma ≈ diff (misma magnitud)
    const candidates = lines
        .slice()
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 40);
    if (!rec.matchIngresos && absDiffIng > TOL) {
        const incomes = candidates.filter((l) => l.amount > 0);
        outerIng: for (let i = 0; i < incomes.length; i++) {
            for (let j = i + 1; j < incomes.length; j++) {
                const sum = incomes[i].amount + incomes[j].amount;
                if (near(sum, absDiffIng, 0.05)) {
                    for (const line of [incomes[i], incomes[j]]) {
                        push({
                            lineId: line.id,
                            date: line.date,
                            description: line.description,
                            amount: line.amount,
                            reason: `Par de ingresos suma ${money(sum)} ≈ diff depósitos; revisa ambos (puntos/comas)`,
                        });
                    }
                    break outerIng;
                }
            }
        }
    }
    if (!rec.matchGastos && absDiffGas > TOL) {
        const expenses = candidates.filter((l) => l.amount < 0);
        outerGas: for (let i = 0; i < expenses.length; i++) {
            for (let j = i + 1; j < expenses.length; j++) {
                const sum = Math.abs(expenses[i].amount) + Math.abs(expenses[j].amount);
                if (near(sum, absDiffGas, 0.05)) {
                    for (const line of [expenses[i], expenses[j]]) {
                        push({
                            lineId: line.id,
                            date: line.date,
                            description: line.description,
                            amount: line.amount,
                            reason: `Par de cargos suma ${money(-sum)} ≈ diff otros cargos; revisa ambos (puntos/comas)`,
                        });
                    }
                    break outerGas;
                }
            }
        }
    }
    return { suspects: rankAndDedupeSuspects(found, dominantDiff) };
}
function suspectPriority(s) {
    const r = s.reason.toLowerCase();
    if (r.includes("corregido automáticamente"))
        return 120;
    if (r.includes("puntos/comas") || r.includes("dígito"))
        return 110;
    if (r.includes("pegad") || r.includes("rebasad") || r.includes("folio"))
        return 105;
    if (r.includes("si se excluye") || r.includes("cuadran con el pdf"))
        return 90;
    if (r.includes("signo parece invertido"))
        return 85;
    if (r.includes("≈ diferencia") || r.includes("≈ diff"))
        return 80;
    if (r.includes("par de"))
        return 60;
    if (r.includes("reduce fuerte"))
        return 50;
    if (r.includes("impreso") || r.includes("Δsaldo"))
        return 40;
    return 10;
}
function rankAndDedupeSuspects(found, dominantDiff) {
    const sorted = found
        .slice()
        .sort((a, b) => suspectPriority(b) - suspectPriority(a));
    const byLine = new Map();
    for (const s of sorted) {
        // Filtrar culpables ridículos: monto << descuadre y sin sugerencia tipográfica
        if (dominantDiff > 5000 &&
            Math.abs(s.amount) < dominantDiff * 0.05 &&
            s.suggestedAmount == null &&
            !/puntos\/comas|pegad|folio|rebasad|corregido/i.test(s.reason)) {
            continue;
        }
        if (!byLine.has(s.lineId))
            byLine.set(s.lineId, s);
    }
    const unique = [...byLine.values()].sort((a, b) => suspectPriority(b) - suspectPriority(a));
    const auto = unique.find((s) => /corregido automáticamente/i.test(s.reason));
    if (auto)
        return [auto];
    const typo = unique.filter((s) => /puntos\/comas|pegad|folio|rebasad|dígito/i.test(s.reason));
    if (typo.length)
        return typo.slice(0, 5);
    return unique.slice(0, 5);
}
function markSuspectsOnLines(lines, suspects) {
    const byId = new Map(suspects.map((s) => [s.lineId, s]));
    return lines.map((line) => {
        const s = byId.get(line.id);
        if (!s)
            return line;
        // Solo anotar; los montos se corrigen únicamente si una variante cierra el cuadre
        return {
            ...line,
            needsReview: true,
            reviewNote: s.reason,
        };
    });
}
/** Aplica la mejor sugerencia tipográfica (una sola línea) si mejora el score. */
function tryApplyBestTypoSuggestion(lines, suspects, text, current) {
    const best = suspects.find((s) => s.suggestedAmount != null &&
        /puntos\/comas|dígito|folio|corregido/i.test(s.reason));
    if (!best || best.suggestedAmount == null)
        return null;
    const patched = applyAmount(lines, best.lineId, best.suggestedAmount, best.reason);
    const again = reconcileLines(text, patched);
    if (scoreReconciliation(again.reconciliation) >
        scoreReconciliation(current)) {
        return { lines: patched, ...again };
    }
    return null;
}
/**
 * Lee el texto del estado varias veces y localiza errores de monto.
 */
function runAutoReview(text, rules) {
    const passes = [];
    let best = null;
    for (const strat of STRATEGIES) {
        const parsed = (0, parseStatement_1.extractLinesFromText)(text, rules, {
            amountStrategy: strat.id,
        });
        const lines = prepareLines(parsed);
        const { totals, reconciliation } = reconcileLines(text, lines);
        const score = scoreReconciliation(reconciliation);
        passes.push({
            strategy: strat.id,
            label: strat.label,
            lineCount: lines.length,
            matchCompleto: reconciliation.matchCompleto,
            matchIngresos: reconciliation.matchIngresos,
            matchGastos: reconciliation.matchGastos,
            diffIngresos: reconciliation.diffIngresos,
            diffGastos: reconciliation.diffGastos,
        });
        if (!best || score > best.score) {
            best = {
                strategy: strat.id,
                lines,
                totals,
                reconciliation,
                score,
            };
        }
        if (reconciliation.matchCompleto)
            break;
    }
    if (!best) {
        const empty = prepareLines([]);
        const { totals, reconciliation } = reconcileLines(text, empty);
        return {
            lines: empty,
            summaryByCategory: {},
            totals,
            reconciliation,
            autoReview: {
                ranAt: new Date().toISOString(),
                matched: false,
                bestStrategy: "none",
                passes,
                suspects: [],
                message: "No se pudieron leer movimientos del PDF.",
            },
        };
    }
    let lines = best.lines;
    let reconciliation = best.reconciliation;
    let totals = best.totals;
    let suspects = [];
    if (!reconciliation.matchCompleto) {
        const found = findSuspects(lines, text, reconciliation);
        suspects = found.suspects;
        if (found.fixedLines && found.fixedRec) {
            lines = found.fixedLines;
            reconciliation = found.fixedRec;
            totals = (0, parseStatement_1.summarizeTotals)(lines);
        }
        else if (suspects.length) {
            const applied = tryApplyBestTypoSuggestion(lines, suspects, text, reconciliation);
            if (applied) {
                lines = applied.lines;
                totals = applied.totals;
                reconciliation = applied.reconciliation;
            }
            else {
                lines = markSuspectsOnLines(lines, suspects);
            }
        }
    }
    const matched = reconciliation.matchCompleto;
    let message;
    if (matched) {
        const top = suspects[0];
        message = top?.suggestedAmount != null
            ? `Cuadra tras corregir puntos/comas en ${top.date || "?"} · ${top.description.slice(0, 50)}: ${money(top.amount)} → ${money(top.suggestedAmount)}.`
            : `Cuadra tras ${passes.length} lectura(s). Mejor estrategia: ${STRATEGIES.find((s) => s.id === best.strategy)?.label || best.strategy}.`;
    }
    else if (suspects.length) {
        const top = suspects[0];
        message = `Tras ${passes.length} lecturas aún no cuadra (diff dep ${reconciliation.diffIngresos ?? "—"}, cargos ${reconciliation.diffGastos ?? "—"}). Sospechoso: ${top.date || "?"} · ${top.description.slice(0, 55)} · ${money(top.amount)}. ${top.reason}`;
    }
    else {
        message = `Tras ${passes.length} lecturas no se halló error claro de puntos/comas. Diff depósitos: ${reconciliation.diffIngresos ?? "—"}; diff cargos: ${reconciliation.diffGastos ?? "—"}. Revisa a mano los montos grandes.`;
    }
    const autoReview = {
        ranAt: new Date().toISOString(),
        matched,
        bestStrategy: best.strategy,
        passes,
        suspects,
        message,
    };
    return {
        lines,
        summaryByCategory: (0, parseStatement_1.summarizeByCategory)(lines),
        totals,
        reconciliation,
        autoReview,
    };
}
/** Aplica el resultado de auto-review sobre un StatementRun (mutación). */
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
//# sourceMappingURL=autoReview.js.map