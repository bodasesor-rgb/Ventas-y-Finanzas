/**
 * Revisión automática de estados de cuenta:
 * relee el texto varias veces con estrategias distintas y,
 * si aún no cuadra, busca la(s) cuenta(s) que provocan la diferencia.
 */
import {
  extractLinesFromText,
  summarizeByCategory,
  summarizeTotals,
  type AmountStrategy,
} from "./parseStatement";
import {
  extractStatementOfficialTotals,
  reconcileTotals,
  type Reconciliation,
} from "./statementSummary";
import { autoCreateCategoriesFromLines } from "./autoCategories";
import { applyCounterpartyCategories } from "./counterparties";
import type {
  AutoReviewPass,
  AutoReviewReport,
  AutoReviewSuspect,
  BankLine,
  RecurringRule,
  StatementRun,
} from "./types";

const TOL = 1;

interface StrategyDef {
  id: AmountStrategy;
  label: string;
}

const STRATEGIES: StrategyDef[] = [
  { id: "delta", label: "1ª lectura: Δsaldo (cadena de saldos)" },
  { id: "printed", label: "2ª lectura: montos impresos del PDF" },
  { id: "hybrid", label: "3ª lectura: híbrida (impreso si discrepa)" },
];

function scoreReconciliation(rec: Reconciliation): number {
  let s = 0;
  if (rec.matchIngresos) s += 100;
  if (rec.matchGastos) s += 100;
  if (rec.diffIngresos != null) s -= Math.min(50, Math.abs(rec.diffIngresos) / 1000);
  if (rec.diffGastos != null) s -= Math.min(50, Math.abs(rec.diffGastos) / 1000);
  return s;
}

function money(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

function near(a: number, b: number, tol = TOL): boolean {
  return Math.abs(a - b) <= tol;
}

function prepareLines(parsed: BankLine[]): BankLine[] {
  const { lines: autoLines } = autoCreateCategoriesFromLines(parsed);
  return applyCounterpartyCategories(autoLines);
}

function reconcileLines(
  text: string,
  lines: BankLine[]
): { totals: ReturnType<typeof summarizeTotals>; reconciliation: Reconciliation } {
  const totals = summarizeTotals(lines);
  const oficial = extractStatementOfficialTotals(text);
  return { totals, reconciliation: reconcileTotals(oficial, totals, TOL) };
}

/** Quita una línea y recalcula. */
function totalsWithout(lines: BankLine[], dropId: string) {
  return summarizeTotals(lines.filter((l) => l.id !== dropId));
}

/** Invierte el signo de una línea. */
function totalsWithFlip(lines: BankLine[], flipId: string) {
  return summarizeTotals(
    lines.map((l) =>
      l.id === flipId
        ? { ...l, amount: -l.amount, direction: l.amount >= 0 ? "cargo" : "abono" }
        : l
    )
  );
}

/** Cambia el monto de una línea. */
function totalsWithAmount(lines: BankLine[], lineId: string, amount: number) {
  return summarizeTotals(
    lines.map((l) =>
      l.id === lineId
        ? {
            ...l,
            amount,
            direction: amount >= 0 ? "abono" : "cargo",
          }
        : l
    )
  );
}

function findSuspects(
  lines: BankLine[],
  text: string,
  rec: Reconciliation
): AutoReviewSuspect[] {
  const oficial = extractStatementOfficialTotals(text);
  const found: AutoReviewSuspect[] = [];
  const seen = new Set<string>();

  const push = (s: AutoReviewSuspect) => {
    const key = `${s.lineId}|${s.reason.slice(0, 40)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(s);
  };

  // A) Impreso vs Δsaldo ya marcado
  for (const line of lines) {
    if (line.reviewNote && /impreso|discrepancia|Δsaldo/i.test(line.reviewNote)) {
      push({
        lineId: line.id,
        date: line.date,
        description: line.description,
        amount: line.amount,
        reason: line.reviewNote,
      });
    }
  }

  const diffIng = rec.diffIngresos;
  const diffGas = rec.diffGastos;

  // B) Monto ≈ diferencia de ingresos o gastos
  for (const line of lines) {
    const abs = Math.abs(line.amount);
    if (diffIng != null && !rec.matchIngresos && near(abs, Math.abs(diffIng), 0.05)) {
      push({
        lineId: line.id,
        date: line.date,
        description: line.description,
        amount: line.amount,
        reason: `Monto ${money(line.amount)} ≈ diferencia de depósitos (${money(
          diffIng
        )})`,
        suggestedAmount:
          line.amount > 0 && diffIng > 0
            ? 0
            : line.amount > 0
              ? Math.round((line.amount - diffIng) * 100) / 100
              : undefined,
      });
    }
    if (diffGas != null && !rec.matchGastos && near(abs, Math.abs(diffGas), 0.05)) {
      push({
        lineId: line.id,
        date: line.date,
        description: line.description,
        amount: line.amount,
        reason: `Monto ${money(line.amount)} ≈ diferencia de cargos (${money(
          diffGas
        )})`,
      });
    }
  }

  // C) Dejar fuera una línea hace que cuadre
  for (const line of lines) {
    const t = totalsWithout(lines, line.id);
    const r = reconcileTotals(oficial, t, TOL);
    if (r.matchCompleto && !rec.matchCompleto) {
      push({
        lineId: line.id,
        date: line.date,
        description: line.description,
        amount: line.amount,
        reason: `Si se excluye este movimiento, los totales cuadran con el PDF`,
        suggestedAmount: 0,
      });
    } else {
      const betterIng =
        diffIng != null &&
        r.diffIngresos != null &&
        Math.abs(r.diffIngresos) < Math.abs(diffIng) - TOL;
      const betterGas =
        diffGas != null &&
        r.diffGastos != null &&
        Math.abs(r.diffGastos) < Math.abs(diffGas) - TOL;
      if (betterIng || betterGas) {
        push({
          lineId: line.id,
          date: line.date,
          description: line.description,
          amount: line.amount,
          reason: `Excluir este movimiento reduce el descuadre (diff dep ${
            r.diffIngresos ?? "—"
          }, cargos ${r.diffGastos ?? "—"})`,
        });
      }
    }
  }

  // D) Invertir signo hace que cuadre
  for (const line of lines) {
    const t = totalsWithFlip(lines, line.id);
    const r = reconcileTotals(oficial, t, TOL);
    if (r.matchCompleto && !rec.matchCompleto) {
      const flipped = -line.amount;
      push({
        lineId: line.id,
        date: line.date,
        description: line.description,
        amount: line.amount,
        reason: `El signo parece invertido: con ${money(
          flipped
        )} el estado cuadra`,
        suggestedAmount: flipped,
      });
    }
  }

  // E) Ajustar monto al valor que cierra la diferencia (una sola línea)
  if (!rec.matchIngresos && diffIng != null && Math.abs(diffIng) > TOL) {
    for (const line of lines) {
      if (line.amount <= 0) continue;
      const suggested =
        Math.round((line.amount - diffIng) * 100) / 100;
      if (suggested < 0 || near(suggested, line.amount, 0.005)) continue;
      const t = totalsWithAmount(lines, line.id, suggested);
      const r = reconcileTotals(oficial, t, TOL);
      if (r.matchIngresos) {
        push({
          lineId: line.id,
          date: line.date,
          description: line.description,
          amount: line.amount,
          reason: `Ajustar ingreso a ${money(
            suggested
          )} cierra la diferencia de depósitos`,
          suggestedAmount: suggested,
        });
      }
    }
  }
  if (!rec.matchGastos && diffGas != null && Math.abs(diffGas) > TOL) {
    for (const line of lines) {
      if (line.amount >= 0) continue;
      const suggested =
        Math.round((line.amount - diffGas) * 100) / 100;
      if (suggested > 0 || near(suggested, line.amount, 0.005)) continue;
      const t = totalsWithAmount(lines, line.id, suggested);
      const r = reconcileTotals(oficial, t, TOL);
      if (r.matchGastos) {
        push({
          lineId: line.id,
          date: line.date,
          description: line.description,
          amount: line.amount,
          reason: `Ajustar cargo a ${money(
            suggested
          )} cierra la diferencia de otros cargos`,
          suggestedAmount: suggested,
        });
      }
    }
  }

  // F) Dos líneas cuya suma ≈ diferencia (hasta 50 candidatos)
  const candidates = lines
    .slice()
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 50);

  if (!rec.matchIngresos && diffIng != null && Math.abs(diffIng) > TOL) {
    const incomes = candidates.filter((l) => l.amount > 0);
    outerIng: for (let i = 0; i < incomes.length; i++) {
      for (let j = i + 1; j < incomes.length; j++) {
        const sum = incomes[i].amount + incomes[j].amount;
        if (near(sum, Math.abs(diffIng), 0.05)) {
          for (const line of [incomes[i], incomes[j]]) {
            push({
              lineId: line.id,
              date: line.date,
              description: line.description,
              amount: line.amount,
              reason: `Par de ingresos suma ${money(
                sum
              )} ≈ diff depósitos; revisa ambos`,
            });
          }
          break outerIng;
        }
      }
    }
  }
  if (!rec.matchGastos && diffGas != null && Math.abs(diffGas) > TOL) {
    const expenses = candidates.filter((l) => l.amount < 0);
    outerGas: for (let i = 0; i < expenses.length; i++) {
      for (let j = i + 1; j < expenses.length; j++) {
        const sum = Math.abs(expenses[i].amount) + Math.abs(expenses[j].amount);
        if (near(sum, Math.abs(diffGas), 0.05)) {
          for (const line of [expenses[i], expenses[j]]) {
            push({
              lineId: line.id,
              date: line.date,
              description: line.description,
              amount: line.amount,
              reason: `Par de cargos suma ${money(
                -sum
              )} ≈ diff otros cargos; revisa ambos`,
            });
          }
          break outerGas;
        }
      }
    }
  }

  return rankAndDedupeSuspects(found);
}

/** Prioriza exclusiones / monto≈diff sobre ajustes especulativos. */
function suspectPriority(s: AutoReviewSuspect): number {
  const r = s.reason.toLowerCase();
  if (r.includes("si se excluye") || r.includes("cuadran con el pdf")) return 100;
  if (r.includes("signo parece invertido")) return 95;
  if (r.includes("≈ diferencia")) return 90;
  if (r.includes("discrepancia") || r.includes("impreso")) return 70;
  if (r.includes("par de")) return 60;
  if (r.includes("reduce el descuadre")) return 40;
  if (r.includes("ajustar")) return 20;
  return 10;
}

function rankAndDedupeSuspects(
  found: AutoReviewSuspect[]
): AutoReviewSuspect[] {
  const sorted = found
    .slice()
    .sort((a, b) => suspectPriority(b) - suspectPriority(a));
  const byLine = new Map<string, AutoReviewSuspect>();
  for (const s of sorted) {
    if (!byLine.has(s.lineId)) byLine.set(s.lineId, s);
  }
  // Máximo 5 cuentas distintas; si hay un "excluir y cuadra", solo esa
  const unique = [...byLine.values()];
  const smoking = unique.find(
    (s) => suspectPriority(s) >= 90 && /excluye|invertido|≈ diferencia/i.test(s.reason)
  );
  if (smoking && suspectPriority(smoking) >= 100) {
    return [smoking];
  }
  return unique.slice(0, 5);
}

function markSuspectsOnLines(
  lines: BankLine[],
  suspects: AutoReviewSuspect[]
): BankLine[] {
  const byId = new Map(suspects.map((s) => [s.lineId, s]));
  return lines.map((line) => {
    const s = byId.get(line.id);
    if (!s) return line;
    return {
      ...line,
      needsReview: true,
      reviewNote: s.reason,
    };
  });
}

export interface AutoReviewResult {
  lines: BankLine[];
  summaryByCategory: Record<string, number>;
  totals: { ingresos: number; gastos: number; neto: number };
  reconciliation: Reconciliation;
  autoReview: AutoReviewReport;
}

/**
 * Lee el texto del estado varias veces y localiza la cuenta distinta.
 */
export function runAutoReview(
  text: string,
  rules: RecurringRule[]
): AutoReviewResult {
  const passes: AutoReviewPass[] = [];
  let best: {
    strategy: AmountStrategy;
    lines: BankLine[];
    totals: ReturnType<typeof summarizeTotals>;
    reconciliation: Reconciliation;
    score: number;
  } | null = null;

  // Varias lecturas del mismo documento (estrategias distintas)
  for (const strat of STRATEGIES) {
    const parsed = extractLinesFromText(text, rules, {
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
    if (reconciliation.matchCompleto) break;
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
  let suspects: AutoReviewSuspect[] = [];

  // 4ª pasada: si aún no cuadra, buscar la cuenta distinta
  if (!reconciliation.matchCompleto) {
    suspects = findSuspects(lines, text, reconciliation);
    lines = markSuspectsOnLines(lines, suspects);
  }

  const matched = reconciliation.matchCompleto;
  let message: string;
  if (matched) {
    message = `Cuadra tras ${passes.length} lectura(s). Mejor estrategia: ${
      STRATEGIES.find((s) => s.id === best!.strategy)?.label || best.strategy
    }.`;
  } else if (suspects.length) {
    const top = suspects[0];
    message = `Tras ${passes.length} lecturas aún no cuadra. Cuenta sospechosa: ${
      top.date || "?"
    } · ${top.description.slice(0, 60)} · ${money(top.amount)}. ${
      top.reason
    }. Se marcaron ${suspects.length} movimiento(s) en Revisar.`;
  } else {
    message = `Tras ${passes.length} lecturas no se encontró una sola cuenta culpable. Diff depósitos: ${
      reconciliation.diffIngresos ?? "—"
    }; diff cargos: ${reconciliation.diffGastos ?? "—"}. Revisa montos a mano.`;
  }

  const autoReview: AutoReviewReport = {
    ranAt: new Date().toISOString(),
    matched,
    bestStrategy: best.strategy,
    passes,
    suspects,
    message,
  };

  return {
    lines,
    summaryByCategory: summarizeByCategory(lines),
    totals,
    reconciliation,
    autoReview,
  };
}

/** Aplica el resultado de auto-review sobre un StatementRun (mutación). */
export function applyAutoReviewToRun(
  run: StatementRun,
  rules: RecurringRule[]
): AutoReviewResult {
  const text = run.textFull || run.textPreview || "";
  const result = runAutoReview(text, rules);
  run.lines = result.lines;
  run.summaryByCategory = result.summaryByCategory;
  run.totals = result.totals;
  run.reconciliation = result.reconciliation;
  run.autoReview = result.autoReview;
  return result;
}
