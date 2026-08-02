/**
 * Verificación de estados de cuenta desde la 1ª lectura:
 * 1) Lee totales oficiales y comprueba identidad de saldos
 * 2) Prueba varias estrategias de parseo
 * 3) Corrige errores de puntos/comas/folios hasta cuadrar
 * 4) Si forceSolve: garantiza cuadre (ajuste de conciliación al final)
 */
import { randomUUID } from "crypto";
import {
  extractLinesFromText,
  moneyTypoVariants,
  summarizeByCategory,
  summarizeTotals,
  type AmountStrategy,
} from "./parseStatement";
import {
  extractStatementOfficialTotals,
  reconcileTotals,
  type Reconciliation,
  type StatementOfficialTotals,
} from "./statementSummary";
import { autoCreateCategoriesFromLines } from "./autoCategories";
import { applyCounterpartyCategories } from "./counterparties";
import type {
  AutoReviewPass,
  AutoReviewReport,
  AutoReviewSuspect,
  BankLine,
  RecurringRule,
} from "./types";

const TOL = 1;

export interface VerifyOptions {
  /** Si true, al final añade ajustes para cuadrar sí o sí */
  forceSolve?: boolean;
}

export interface VerifyResult {
  lines: BankLine[];
  summaryByCategory: Record<string, number>;
  totals: { ingresos: number; gastos: number; neto: number };
  reconciliation: Reconciliation;
  autoReview: AutoReviewReport;
  /** true si ya cuadró en la verificación (sin botón) */
  verified: boolean;
}

const STRATEGIES: { id: AmountStrategy; label: string }[] = [
  { id: "delta", label: "Δsaldo + reparación dígitos pegados" },
  { id: "rebased", label: "cadena rebasada con impresos" },
  { id: "printed", label: "montos impresos" },
  { id: "hybrid", label: "híbrida" },
];

function money(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

function near(a: number, b: number, tol = TOL): boolean {
  return Math.abs(a - b) <= tol;
}

function scoreRec(rec: Reconciliation): number {
  let s = 0;
  if (rec.matchIngresos) s += 100;
  if (rec.matchGastos) s += 100;
  if (rec.diffIngresos != null) s -= Math.min(90, Math.abs(rec.diffIngresos) / 400);
  if (rec.diffGastos != null) s -= Math.min(90, Math.abs(rec.diffGastos) / 400);
  return s;
}

function prepare(parsed: BankLine[]): BankLine[] {
  const { lines } = autoCreateCategoriesFromLines(parsed);
  return applyCounterpartyCategories(lines);
}

function withOficial(
  oficial: StatementOfficialTotals,
  lines: BankLine[]
): { totals: ReturnType<typeof summarizeTotals>; reconciliation: Reconciliation } {
  const totals = summarizeTotals(lines);
  return { totals, reconciliation: reconcileTotals(oficial, totals, TOL) };
}

function setAmount(lines: BankLine[], id: string, amount: number, note: string): BankLine[] {
  return lines.map((l) =>
    l.id === id
      ? {
          ...l,
          amount: Math.round(amount * 100) / 100,
          direction: amount >= 0 ? ("abono" as const) : ("cargo" as const),
          needsReview: true,
          reviewNote: note,
        }
      : l
  );
}

function dropLine(lines: BankLine[], id: string): BankLine[] {
  return lines.filter((l) => l.id !== id);
}

/** Identidad: Saldo anterior + depósitos + gastos ≈ saldo al corte */
export function officialSaldoConsistent(
  o: StatementOfficialTotals,
  tol = 2
): boolean {
  if (
    o.saldoAnterior == null ||
    o.saldoCorte == null ||
    o.ingresosOficiales == null ||
    o.gastosOficiales == null
  ) {
    return true; // no se puede validar
  }
  const expected =
    Math.round(
      (o.saldoAnterior + o.ingresosOficiales + o.gastosOficiales) * 100
    ) / 100;
  return Math.abs(expected - o.saldoCorte) <= tol;
}

/**
 * Si el resumen no cuadra con saldos, prueba totales alternos del texto
 * (a veces "Otros cargos" del detalle pisa el del resumen).
 */
export function refineOfficialTotals(text: string): StatementOfficialTotals {
  const base = extractStatementOfficialTotals(text);
  if (officialSaldoConsistent(base)) return base;

  const t = text.replace(/\s+/g, " ");
  const allMoney = [
    ...t.matchAll(/((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/g),
  ].map((m) => Number(m[1].replace(/,/g, "")));

  // Candidatos cerca de etiquetas de cargos/depósitos
  const depMatches = [
    ...t.matchAll(
      /Dep[oó]sitos\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/gi
    ),
  ].map((m) => Number(m[1].replace(/,/g, "")));
  const cargoMatches = [
    ...t.matchAll(
      /(?:Retiros\/compras\/comis\.\/otros cargos|Otros\s+cargos)\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/gi
    ),
  ].map((m) => Number(m[1].replace(/,/g, "")));

  if (
    base.saldoAnterior == null ||
    base.saldoCorte == null ||
    !depMatches.length
  ) {
    return base;
  }

  let best = base;
  let bestErr = Infinity;
  const score = (o: StatementOfficialTotals) => {
    if (
      o.saldoAnterior == null ||
      o.saldoCorte == null ||
      o.ingresosOficiales == null ||
      o.gastosOficiales == null
    )
      return Infinity;
    return Math.abs(
      o.saldoAnterior + o.ingresosOficiales + o.gastosOficiales - o.saldoCorte
    );
  };
  bestErr = score(base);

  for (const dep of [...new Set(depMatches)]) {
    const cargos =
      cargoMatches.length > 0
        ? cargoMatches
        : allMoney.filter((n) => n > 0 && n !== dep);
    for (const cargo of [...new Set(cargos)].slice(0, 12)) {
      const cand: StatementOfficialTotals = {
        ...base,
        depositos: dep,
        ingresosOficiales: dep,
        otrosCargos: cargo,
        gastosOficiales: -Math.abs(cargo),
      };
      const err = score(cand);
      if (err < bestErr) {
        bestErr = err;
        best = cand;
      }
      if (err <= TOL) return cand;
    }
  }
  return best;
}

type Attempt = {
  lines: BankLine[];
  totals: ReturnType<typeof summarizeTotals>;
  reconciliation: Reconciliation;
  strategy: string;
  note: string;
  suspects: AutoReviewSuspect[];
};

function tryTypoFixes(
  lines: BankLine[],
  oficial: StatementOfficialTotals,
  maxLines = 80
): Attempt | null {
  const base = withOficial(oficial, lines);
  if (base.reconciliation.matchCompleto) {
    return {
      lines,
      ...base,
      strategy: "typo",
      note: "ya cuadraba",
      suspects: [],
    };
  }

  const diffIng = base.reconciliation.diffIngresos;
  const diffGas = base.reconciliation.diffGastos;
  const dominant = Math.max(
    Math.abs(diffIng ?? 0),
    Math.abs(diffGas ?? 0)
  );

  const candidates = lines
    .slice()
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, maxLines);

  let bestClose: Attempt | null = null;
  let bestScore = scoreRec(base.reconciliation);

  for (const line of candidates) {
    const variants = moneyTypoVariants(line.amount);
    // Anclar a diff si es tipográficamente cercano
    if (line.amount > 0 && diffIng != null) {
      const target = Math.round((line.amount - diffIng) * 100) / 100;
      const snap = variants.find((v) => near(v.value, target, 1));
      if (snap) variants.unshift({ ...snap, label: `cierra dep (${snap.label})` });
    }
    if (line.amount < 0 && diffGas != null) {
      const target = Math.round((line.amount - diffGas) * 100) / 100;
      const snap = variants.find((v) => near(v.value, target, 1));
      if (snap) variants.unshift({ ...snap, label: `cierra cargo (${snap.label})` });
    }

    const seen = new Set<number>();
    for (const variant of variants) {
      if (seen.has(variant.value)) continue;
      seen.add(variant.value);
      const deltaAmt = Math.abs(variant.value - line.amount);
      if (dominant > 1000 && deltaAmt < dominant * 0.15) continue;

      const next = setAmount(
        lines,
        line.id,
        variant.value,
        `Corregido (${variant.label}): ${money(line.amount)} → ${money(
          variant.value
        )}`
      );
      const got = withOficial(oficial, next);
      const sc = scoreRec(got.reconciliation);
      if (got.reconciliation.matchCompleto) {
        return {
          lines: next,
          ...got,
          strategy: "typo-1",
          note: `Corregido ${line.description.slice(0, 40)}: ${money(
            line.amount
          )} → ${money(variant.value)}`,
          suspects: [
            {
              lineId: line.id,
              date: line.date,
              description: line.description,
              amount: line.amount,
              reason: next.find((l) => l.id === line.id)?.reviewNote || "",
              suggestedAmount: variant.value,
            },
          ],
        };
      }
      if (sc > bestScore) {
        bestScore = sc;
        bestClose = {
          lines: next,
          ...got,
          strategy: "typo-1-partial",
          note: `Mejora parcial en ${line.description.slice(0, 40)}`,
          suspects: [
            {
              lineId: line.id,
              date: line.date,
              description: line.description,
              amount: line.amount,
              reason: next.find((l) => l.id === line.id)?.reviewNote || "",
              suggestedAmount: variant.value,
            },
          ],
        };
      }
    }
  }

  // Dos líneas (solo las 12 más grandes × pocas variantes) si sigue el hueco grande
  if (dominant > 50) {
    const top = candidates.slice(0, 12);
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i];
        const b = top[j];
        const va = moneyTypoVariants(a.amount).slice(0, 8);
        const vb = moneyTypoVariants(b.amount).slice(0, 8);
        for (const x of [{ value: a.amount, label: "=" }, ...va]) {
          for (const y of [{ value: b.amount, label: "=" }, ...vb]) {
            if (x.value === a.amount && y.value === b.amount) continue;
            let next = setAmount(
              lines,
              a.id,
              x.value,
              `Corregido par (${x.label}): ${money(a.amount)} → ${money(x.value)}`
            );
            next = setAmount(
              next,
              b.id,
              y.value,
              `Corregido par (${y.label}): ${money(b.amount)} → ${money(y.value)}`
            );
            const got = withOficial(oficial, next);
            if (got.reconciliation.matchCompleto) {
              return {
                lines: next,
                ...got,
                strategy: "typo-2",
                note: `Corregido par: ${a.description.slice(0, 25)} y ${b.description.slice(
                  0,
                  25
                )}`,
                suspects: [
                  {
                    lineId: a.id,
                    date: a.date,
                    description: a.description,
                    amount: a.amount,
                    reason: `Par tipográfico → ${money(x.value)}`,
                    suggestedAmount: x.value,
                  },
                  {
                    lineId: b.id,
                    date: b.date,
                    description: b.description,
                    amount: b.amount,
                    reason: `Par tipográfico → ${money(y.value)}`,
                    suggestedAmount: y.value,
                  },
                ],
              };
            }
          }
        }
      }
    }
  }

  return bestClose;
}

function tryDropOrFlip(
  lines: BankLine[],
  oficial: StatementOfficialTotals
): Attempt | null {
  const base = withOficial(oficial, lines);
  if (base.reconciliation.matchCompleto) return null;
  const dominant = Math.max(
    Math.abs(base.reconciliation.diffIngresos ?? 0),
    Math.abs(base.reconciliation.diffGastos ?? 0)
  );

  for (const line of lines) {
    if (dominant > 1000 && Math.abs(line.amount) < dominant * 0.2) continue;
    const dropped = dropLine(lines, line.id);
    const got = withOficial(oficial, dropped);
    if (got.reconciliation.matchCompleto) {
      return {
        lines: dropped,
        ...got,
        strategy: "drop",
        note: `Se excluyó movimiento duplicado/basura: ${line.description.slice(
          0,
          50
        )}`,
        suspects: [
          {
            lineId: line.id,
            date: line.date,
            description: line.description,
            amount: line.amount,
            reason: "Excluido: al quitarlo el estado cuadra",
            suggestedAmount: 0,
          },
        ],
      };
    }
  }

  for (const line of lines) {
    const flipped = -line.amount;
    const next = setAmount(
      lines,
      line.id,
      flipped,
      `Signo invertido: ${money(line.amount)} → ${money(flipped)}`
    );
    const got = withOficial(oficial, next);
    if (got.reconciliation.matchCompleto) {
      return {
        lines: next,
        ...got,
        strategy: "flip",
        note: `Signo corregido en ${line.description.slice(0, 40)}`,
        suspects: [
          {
            lineId: line.id,
            date: line.date,
            description: line.description,
            amount: line.amount,
            reason: next.find((l) => l.id === line.id)?.reviewNote || "",
            suggestedAmount: flipped,
          },
        ],
      };
    }
  }
  return null;
}

/**
 * Último recurso: líneas de ajuste para forzar cuadre con el PDF.
 */
function forceBalanceAdjustments(
  lines: BankLine[],
  oficial: StatementOfficialTotals
): { lines: BankLine[]; suspects: AutoReviewSuspect[] } {
  let cur = lines.slice();
  let got = withOficial(oficial, cur);
  const suspects: AutoReviewSuspect[] = [];

  if (
    !got.reconciliation.matchIngresos &&
    got.reconciliation.diffIngresos != null &&
    Math.abs(got.reconciliation.diffIngresos) > TOL
  ) {
    const adj = Math.round(-got.reconciliation.diffIngresos * 100) / 100;
    const line: BankLine = {
      id: randomUUID(),
      raw: "AJUSTE CONCILIACION DEPOSITOS",
      date: undefined,
      description: `AJUSTE CONCILIACIÓN depósitos (auto) ${money(adj)}`,
      amount: adj,
      direction: adj >= 0 ? "abono" : "cargo",
      category: "revisar",
      needsReview: true,
      reviewNote:
        "Ajuste forzado para cuadrar Depósitos del PDF. Revisa el movimiento real en el estado.",
    };
    cur = [...cur, line];
    suspects.push({
      lineId: line.id,
      description: line.description,
      amount: adj,
      reason: line.reviewNote!,
      suggestedAmount: adj,
    });
    got = withOficial(oficial, cur);
  }

  if (
    !got.reconciliation.matchGastos &&
    got.reconciliation.diffGastos != null &&
    Math.abs(got.reconciliation.diffGastos) > TOL
  ) {
    const adj = Math.round(-got.reconciliation.diffGastos * 100) / 100;
    const line: BankLine = {
      id: randomUUID(),
      raw: "AJUSTE CONCILIACION CARGOS",
      date: undefined,
      description: `AJUSTE CONCILIACIÓN cargos (auto) ${money(adj)}`,
      amount: adj,
      direction: adj >= 0 ? "abono" : "cargo",
      category: "revisar",
      needsReview: true,
      reviewNote:
        "Ajuste forzado para cuadrar Otros cargos del PDF. Revisa el movimiento real en el estado.",
    };
    cur = [...cur, line];
    suspects.push({
      lineId: line.id,
      description: line.description,
      amount: adj,
      reason: line.reviewNote!,
      suggestedAmount: adj,
    });
  }

  return { lines: cur, suspects };
}

/**
 * Asigna el residual completo al movimiento cuya magnitud más se acerca al diff
 * (mejor que inventar ajuste si hay un candidato claro).
 */
function tryAbsorbResidual(
  lines: BankLine[],
  oficial: StatementOfficialTotals
): Attempt | null {
  const base = withOficial(oficial, lines);
  if (base.reconciliation.matchCompleto) return null;

  const { diffIngresos, diffGastos } = base.reconciliation;

  if (diffIngresos != null && Math.abs(diffIngresos) > TOL) {
    const incomes = lines
      .filter((l) => l.amount > 0)
      .sort(
        (a, b) =>
          Math.abs(Math.abs(a.amount) - Math.abs(diffIngresos)) -
          Math.abs(Math.abs(b.amount) - Math.abs(diffIngresos))
      );
    for (const line of incomes.slice(0, 8)) {
      const target = Math.round((line.amount - diffIngresos) * 100) / 100;
      if (target < 0) continue;
      // Solo si el cambio es “explicable” (misma orden o tipográfico)
      // Solo absorber si el monto nuevo es variante tipográfica del actual
      // (evita duplicar un cargo chico correcto cuando falta otro movimiento)
      const typoOk = moneyTypoVariants(line.amount).some((v) =>
        near(v.value, target, 1)
      );
      if (!typoOk) continue;
      const next = setAmount(
        lines,
        line.id,
        target,
        `Ajuste a depósitos oficiales: ${money(line.amount)} → ${money(target)}`
      );
      const got = withOficial(oficial, next);
      if (got.reconciliation.matchIngresos) {
        // puede faltar gastos; devolvemos si mejora ingresos y no empeora mucho
        if (
          got.reconciliation.matchCompleto ||
          scoreRec(got.reconciliation) > scoreRec(base.reconciliation)
        ) {
          if (got.reconciliation.matchCompleto) {
            return {
              lines: next,
              ...got,
              strategy: "absorb-ing",
              note: `Ingreso ajustado a totales del PDF`,
              suspects: [
                {
                  lineId: line.id,
                  date: line.date,
                  description: line.description,
                  amount: line.amount,
                  reason: next.find((l) => l.id === line.id)?.reviewNote || "",
                  suggestedAmount: target,
                },
              ],
            };
          }
        }
      }
    }
  }

  if (diffGastos != null && Math.abs(diffGastos) > TOL) {
    const expenses = lines
      .filter((l) => l.amount < 0)
      .sort(
        (a, b) =>
          Math.abs(Math.abs(a.amount) - Math.abs(diffGastos)) -
          Math.abs(Math.abs(b.amount) - Math.abs(diffGastos))
      );
    for (const line of expenses.slice(0, 12)) {
      const target = Math.round((line.amount - diffGastos) * 100) / 100;
      if (target > 0) continue;
      const typoOk = moneyTypoVariants(line.amount).some((v) =>
        near(v.value, target, 1)
      );
      // También: el propio monto ≈ todo el diff (línea basura del tamaño del hueco)
      const isTheDiff =
        near(Math.abs(line.amount), Math.abs(diffGastos), 1) &&
        Math.abs(line.amount) >= 1000;
      if (!typoOk && !isTheDiff) continue;
      const next = setAmount(
        lines,
        line.id,
        target,
        `Ajuste a cargos oficiales: ${money(line.amount)} → ${money(target)}`
      );
      const got = withOficial(oficial, next);
      if (got.reconciliation.matchCompleto) {
        return {
          lines: next,
          ...got,
          strategy: "absorb-gas",
          note: `Cargo ajustado a totales del PDF`,
          suspects: [
            {
              lineId: line.id,
              date: line.date,
              description: line.description,
              amount: line.amount,
              reason: next.find((l) => l.id === line.id)?.reviewNote || "",
              suggestedAmount: target,
            },
          ],
        };
      }
    }
  }

  return null;
}

/**
 * Motor principal: verificar lectura y corregir antes de aceptar números.
 */
export function verifyStatementParse(
  text: string,
  rules: RecurringRule[],
  options: VerifyOptions = {}
): VerifyResult {
  const forceSolve = Boolean(options.forceSolve);
  const oficial = refineOfficialTotals(text);
  const passes: AutoReviewPass[] = [];
  const suspects: AutoReviewSuspect[] = [];

  let best: Attempt | null = null;

  // --- Fase 1: varias lecturas del documento ---
  for (const strat of STRATEGIES) {
    const parsed = extractLinesFromText(text, rules, {
      amountStrategy: strat.id,
    });
    const lines = prepare(parsed);
    const got = withOficial(oficial, lines);
    passes.push({
      strategy: strat.id,
      label: `Lectura: ${strat.label}`,
      lineCount: lines.length,
      matchCompleto: got.reconciliation.matchCompleto,
      matchIngresos: got.reconciliation.matchIngresos,
      matchGastos: got.reconciliation.matchGastos,
      diffIngresos: got.reconciliation.diffIngresos,
      diffGastos: got.reconciliation.diffGastos,
    });
    const attempt: Attempt = {
      lines,
      ...got,
      strategy: strat.id,
      note: strat.label,
      suspects: lines
        .filter((l) => l.reviewNote)
        .slice(0, 5)
        .map((l) => ({
          lineId: l.id,
          date: l.date,
          description: l.description,
          amount: l.amount,
          reason: l.reviewNote || "",
        })),
    };
    if (!best || scoreRec(got.reconciliation) > scoreRec(best.reconciliation)) {
      best = attempt;
    }
    if (got.reconciliation.matchCompleto) {
      best = attempt;
      break;
    }
  }

  if (!best) {
    const empty = prepare([]);
    const got = withOficial(oficial, empty);
    return {
      lines: empty,
      summaryByCategory: {},
      totals: got.totals,
      reconciliation: got.reconciliation,
      verified: false,
      autoReview: {
        ranAt: new Date().toISOString(),
        matched: false,
        bestStrategy: "none",
        passes,
        suspects: [],
        message: "No se leyeron movimientos. Vuelve a subir el PDF.",
      },
    };
  }

  // --- Fase 2: si no cuadra, corregir tipografía / exclusiones (aún 1ª verificación) ---
  if (!best.reconciliation.matchCompleto) {
    const typo = tryTypoFixes(best.lines, oficial);
    if (typo) {
      passes.push({
        strategy: typo.strategy,
        label: `Verificación: ${typo.note}`,
        lineCount: typo.lines.length,
        matchCompleto: typo.reconciliation.matchCompleto,
        matchIngresos: typo.reconciliation.matchIngresos,
        matchGastos: typo.reconciliation.matchGastos,
        diffIngresos: typo.reconciliation.diffIngresos,
        diffGastos: typo.reconciliation.diffGastos,
      });
      if (
        scoreRec(typo.reconciliation) > scoreRec(best.reconciliation) ||
        typo.reconciliation.matchCompleto
      ) {
        best = typo;
        suspects.push(...typo.suspects);
      }
    }
  }

  if (!best.reconciliation.matchCompleto) {
    const drop = tryDropOrFlip(best.lines, oficial);
    if (drop) {
      passes.push({
        strategy: drop.strategy,
        label: `Verificación: ${drop.note}`,
        lineCount: drop.lines.length,
        matchCompleto: drop.reconciliation.matchCompleto,
        matchIngresos: drop.reconciliation.matchIngresos,
        matchGastos: drop.reconciliation.matchGastos,
        diffIngresos: drop.reconciliation.diffIngresos,
        diffGastos: drop.reconciliation.diffGastos,
      });
      best = drop;
      suspects.push(...drop.suspects);
    }
  }

  if (!best.reconciliation.matchCompleto) {
    const absorb = tryAbsorbResidual(best.lines, oficial);
    if (absorb?.reconciliation.matchCompleto) {
      passes.push({
        strategy: absorb.strategy,
        label: `Verificación: ${absorb.note}`,
        lineCount: absorb.lines.length,
        matchCompleto: true,
        matchIngresos: true,
        matchGastos: true,
        diffIngresos: absorb.reconciliation.diffIngresos,
        diffGastos: absorb.reconciliation.diffGastos,
      });
      best = absorb;
      suspects.push(...absorb.suspects);
    }
  }

  // --- Fase 3: solo en revisión forzada — garantizar cuadre ---
  if (forceSolve && !best.reconciliation.matchCompleto) {
    // Reintentar tipografía otra vez sobre la mejor base
    const again = tryTypoFixes(best.lines, oficial, 120);
    if (again?.reconciliation.matchCompleto) {
      best = again;
      suspects.push(...again.suspects);
    }
  }

  if (forceSolve && !best.reconciliation.matchCompleto) {
    const { lines: forced, suspects: adjSuspects } = forceBalanceAdjustments(
      best.lines,
      oficial
    );
    const got = withOficial(oficial, forced);
    passes.push({
      strategy: "force-adjust",
      label: "Ajuste de conciliación forzado (garantiza cuadre)",
      lineCount: forced.length,
      matchCompleto: got.reconciliation.matchCompleto,
      matchIngresos: got.reconciliation.matchIngresos,
      matchGastos: got.reconciliation.matchGastos,
      diffIngresos: got.reconciliation.diffIngresos,
      diffGastos: got.reconciliation.diffGastos,
    });
    best = {
      lines: forced,
      ...got,
      strategy: "force-adjust",
      note: "Ajuste de conciliación aplicado para cuadrar con el PDF",
      suspects: adjSuspects,
    };
    suspects.push(...adjSuspects);
  }

  // Marcar sospechosos si aún no cuadra (1ª lectura sin force)
  let finalLines = best.lines;
  if (!best.reconciliation.matchCompleto && suspects.length === 0) {
    const flagged = best.lines
      .filter((l) => l.reviewNote || Math.abs(l.amount) > 50_000)
      .slice(0, 5);
    for (const l of flagged) {
      suspects.push({
        lineId: l.id,
        date: l.date,
        description: l.description,
        amount: l.amount,
        reason:
          l.reviewNote ||
          "Monto grande: conviene revisar puntos/comas en el PDF",
      });
    }
    finalLines = best.lines.map((l) => {
      const s = suspects.find((x) => x.lineId === l.id);
      return s ? { ...l, needsReview: true, reviewNote: s.reason } : l;
    });
  } else if (suspects.length) {
    const byId = new Map(suspects.map((s) => [s.lineId, s]));
    finalLines = best.lines.map((l) => {
      const s = byId.get(l.id);
      return s && !l.reviewNote
        ? { ...l, needsReview: true, reviewNote: s.reason }
        : l;
    });
  }

  const finals = withOficial(oficial, finalLines);
  const matched = finals.reconciliation.matchCompleto;

  let message: string;
  if (matched && best.strategy === "force-adjust") {
    message = `Cuadrado con ajuste de conciliación. Revisa las líneas «AJUSTE CONCILIACIÓN» marcadas en Revisar.`;
  } else if (matched && suspects.some((s) => s.suggestedAmount != null)) {
    const top = suspects.find((s) => s.suggestedAmount != null)!;
    message = `Verificado y corregido: ${top.description.slice(0, 50)} ${money(
      top.amount
    )} → ${money(top.suggestedAmount!)}. Ya cuadra con el PDF.`;
  } else if (matched) {
    message = `Verificado en la 1ª lectura (${passes.length} pasada(s)). Cuadra con Depósitos y Otros cargos del PDF.`;
  } else {
    message = `1ª lectura verificada: aún no cuadra (diff dep ${
      finals.reconciliation.diffIngresos ?? "—"
    }, cargos ${
      finals.reconciliation.diffGastos ?? "—"
    }). Usa «Revisar automáticamente» — forzará el cuadre.`;
  }

  return {
    lines: finalLines,
    summaryByCategory: summarizeByCategory(finalLines),
    totals: finals.totals,
    reconciliation: finals.reconciliation,
    verified: matched,
    autoReview: {
      ranAt: new Date().toISOString(),
      matched,
      bestStrategy: best.strategy,
      passes,
      suspects,
      message,
    },
  };
}
