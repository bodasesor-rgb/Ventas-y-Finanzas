import type { StatementRun } from "./types";

export type ErRowKind = "section" | "line" | "total" | "calc" | "margin";

export interface ErRow {
  id: string;
  label: string;
  kind: ErRowKind;
  /** Montos por mes (1..12). Vacío = null (se muestra —). */
  months: (number | null)[];
  total: number | null;
  /** Para UI: tint */
  tone?: "income" | "expense" | "result" | "capital" | "muted";
}

export interface EstadoResultados {
  year: number;
  months: string[];
  monthsPresent: string[];
  runsCount: number;
  rows: ErRow[];
}

const MONTH_LABELS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function absAmt(n: number | undefined | null): number {
  return Math.abs(Number(n) || 0);
}

function empty12(): (number | null)[] {
  return Array.from({ length: 12 }, () => null);
}

function sumArr(arr: (number | null)[]): number {
  return round2(arr.reduce<number>((s, v) => s + (v == null ? 0 : v), 0));
}

function hasAny(arr: (number | null)[]): boolean {
  return arr.some((v) => v != null && v !== 0);
}

type MonthBucket = {
  venta: number;
  ingreso: number;
  intereses: number;
  proveedor: number;
  evento: number;
  ads: number;
  apps: number;
  pass: number;
  pago: number;
  comisiones: number;
  servicios: number;
  transferencia: number;
  revisar: number;
  otro: number;
  otros: number;
  socio: number;
  neto: number;
  ingresosTot: number;
  filled: boolean;
};

function emptyBucket(): MonthBucket {
  return {
    venta: 0,
    ingreso: 0,
    intereses: 0,
    proveedor: 0,
    evento: 0,
    ads: 0,
    apps: 0,
    pass: 0,
    pago: 0,
    comisiones: 0,
    servicios: 0,
    transferencia: 0,
    revisar: 0,
    otro: 0,
    otros: 0,
    socio: 0,
    neto: 0,
    ingresosTot: 0,
    filled: false,
  };
}

function fillFromRun(run: StatementRun): MonthBucket {
  const s = run.summaryByCategory || {};
  const known = new Set([
    "venta",
    "ingreso",
    "intereses",
    "proveedor",
    "evento",
    "ads",
    "apps",
    "pass",
    "pago",
    "comisiones",
    "servicios",
    "transferencia_persona",
    "revisar",
    "otro",
    "socio",
    "nomina",
    "impuestos",
    "renta",
  ]);
  let otros = 0;
  for (const [id, amt] of Object.entries(s)) {
    if (!known.has(id)) otros += absAmt(amt);
  }
  let venta = Number(s.venta) || 0;
  let ingreso = Number(s.ingreso) || 0;
  const ingresosTot = run.totals?.ingresos ?? 0;
  if (venta === 0 && ingreso === 0 && ingresosTot > 0) {
    ingreso = ingresosTot;
  }
  return {
    venta: round2(Math.max(0, venta)),
    ingreso: round2(Math.max(0, ingreso)),
    intereses: round2(Math.max(0, Number(s.intereses) || 0)),
    proveedor: round2(absAmt(s.proveedor)),
    evento: round2(absAmt(s.evento)),
    ads: round2(absAmt(s.ads)),
    apps: round2(absAmt(s.apps)),
    pass: round2(absAmt(s.pass)),
    pago: round2(absAmt(s.pago) + absAmt(s.nomina)),
    comisiones: round2(absAmt(s.comisiones)),
    servicios: round2(absAmt(s.servicios)),
    transferencia: round2(absAmt(s.transferencia_persona)),
    revisar: round2(absAmt(s.revisar)),
    otro: round2(absAmt(s.otro)),
    otros: round2(otros + absAmt(s.renta) + absAmt(s.impuestos)),
    socio: round2(absAmt(s.socio)),
    neto: round2(run.totals?.neto ?? 0),
    ingresosTot: round2(ingresosTot),
    filled: true,
  };
}

function line(
  id: string,
  label: string,
  pick: (b: MonthBucket) => number,
  buckets: MonthBucket[],
  tone?: ErRow["tone"]
): ErRow {
  const months = buckets.map((b) => (b.filled ? round2(pick(b)) : null));
  const total = hasAny(months) ? sumArr(months) : null;
  return { id, label, kind: "line", months, total, tone };
}

function section(id: string, label: string, tone?: ErRow["tone"]): ErRow {
  return {
    id,
    label,
    kind: "section",
    months: empty12(),
    total: null,
    tone,
  };
}

function totalRow(
  id: string,
  label: string,
  sources: ErRow[],
  tone?: ErRow["tone"]
): ErRow {
  const months = empty12().map((_, mi) => {
    const any = sources.some((r) => r.months[mi] != null);
    if (!any) return null;
    return round2(
      sources.reduce((s, r) => s + (r.months[mi] == null ? 0 : Number(r.months[mi])), 0)
    );
  });
  return {
    id,
    label,
    kind: "total",
    months,
    total: hasAny(months) ? sumArr(months) : null,
    tone,
  };
}

function diffRow(
  id: string,
  label: string,
  a: ErRow,
  b: ErRow,
  tone?: ErRow["tone"]
): ErRow {
  const months = empty12().map((_, mi) => {
    if (a.months[mi] == null && b.months[mi] == null) return null;
    return round2(Number(a.months[mi] || 0) - Number(b.months[mi] || 0));
  });
  return {
    id,
    label,
    kind: "calc",
    months,
    total: hasAny(months) ? sumArr(months) : null,
    tone,
  };
}

function marginRow(id: string, label: string, num: ErRow, den: ErRow): ErRow {
  const months = empty12().map((_, mi) => {
    const d = Number(den.months[mi] || 0);
    const n = Number(num.months[mi] || 0);
    if (den.months[mi] == null && num.months[mi] == null) return null;
    if (d === 0) return null;
    return round2(n / d);
  });
  const dt = Number(den.total || 0);
  const nt = Number(num.total || 0);
  return {
    id,
    label,
    kind: "margin",
    months,
    total: dt === 0 || den.total == null ? null : round2(nt / dt),
    tone: "result",
  };
}

/** Estado de Resultados anual: columnas por mes, filas tipo Sheet mejoradas. */
export function buildEstadoResultados(
  runs: StatementRun[],
  year = 2026
): EstadoResultados {
  const yearRuns = runs.filter((r) =>
    String(r.periodKey || "").startsWith(`${year}-`)
  );
  const buckets = Array.from({ length: 12 }, () => emptyBucket());
  const monthsPresent: string[] = [];

  for (const run of yearRuns) {
    const key = String(run.periodKey || "");
    const m = Number(key.slice(5, 7));
    if (!m || m < 1 || m > 12) continue;
    buckets[m - 1] = fillFromRun(run);
    monthsPresent.push(key);
  }
  monthsPresent.sort();

  const rows: ErRow[] = [];

  rows.push(section("ingreso_h", "Ingreso", "income"));
  const intereses = line("intereses", "Intereses", (b) => b.intereses, buckets, "income");
  const venta = line("venta", "Venta / anticipo", (b) => b.venta, buckets, "income");
  const ingreso = line("ingreso", "Ingreso", (b) => b.ingreso, buckets, "income");
  // Líneas de negocio (manuales / aún sin cat en banco) — 0 si hay mes cargado
  const cateringI = line(
    "catering_i",
    "Catering",
    (b) => (b.filled ? 0 : 0),
    buckets,
    "muted"
  );
  const mobiliarioI = line("mobiliario_i", "Mobiliario", () => 0, buckets, "muted");
  const lugaresI = line("lugares_i", "Lugares", () => 0, buckets, "muted");
  const showsI = line("shows_i", "Shows", () => 0, buckets, "muted");
  // Solo marcar 0 en meses con datos
  for (const r of [cateringI, mobiliarioI, lugaresI, showsI]) {
    r.months = buckets.map((b) => (b.filled ? 0 : null));
    r.total = hasAny(r.months) ? 0 : null;
  }
  rows.push(intereses, venta, ingreso, cateringI, mobiliarioI, lugaresI, showsI);
  const totIngreso = totalRow(
    "tot_ingreso",
    "TOTAL",
    [intereses, venta, ingreso, cateringI, mobiliarioI, lugaresI, showsI],
    "income"
  );
  rows.push(totIngreso);

  rows.push(section("egreso_h", "Egreso", "expense"));
  const proveedor = line("proveedor", "Proveedores", (b) => b.proveedor, buckets, "expense");
  const evento = line("evento", "Costo de evento", (b) => b.evento, buckets, "expense");
  const banquete = line("banquete", "Banquete", () => 0, buckets, "muted");
  const cateringE = line("catering_e", "Catering", () => 0, buckets, "muted");
  const mobiliarioE = line("mobiliario_e", "Mobiliario", () => 0, buckets, "muted");
  const lugaresE = line("lugares_e", "Lugares", () => 0, buckets, "muted");
  const showsE = line("shows_e", "Shows", () => 0, buckets, "muted");
  for (const r of [banquete, cateringE, mobiliarioE, lugaresE, showsE]) {
    r.months = buckets.map((b) => (b.filled ? 0 : null));
    r.total = hasAny(r.months) ? 0 : null;
  }
  rows.push(proveedor, evento, banquete, cateringE, mobiliarioE, lugaresE, showsE);
  const totEgreso = totalRow(
    "tot_egreso",
    "TOTAL",
    [proveedor, evento, banquete, cateringE, mobiliarioE, lugaresE, showsE],
    "expense"
  );
  rows.push(totEgreso);

  const bruto = diffRow("bruto", "Ingreso Bruto", totIngreso, totEgreso, "result");
  const margenB = marginRow("margen_b", "Margen", bruto, totIngreso);
  rows.push(bruto, margenB);

  rows.push(section("gastos_h", "Gastos", "expense"));
  const marketing = line("marketing", "Marketing", (b) => b.ads, buckets, "expense");
  const rh = line("rh", "RH", (b) => b.pago, buckets, "expense");
  const programas = line(
    "programas",
    "Programas",
    (b) => round2(b.apps + b.pass),
    buckets,
    "expense"
  );
  const impuestos = line("impuestos", "Impuestos", () => 0, buckets, "muted");
  impuestos.months = buckets.map((b) => (b.filled ? 0 : null));
  impuestos.total = hasAny(impuestos.months) ? 0 : null;
  const otrosG = line(
    "otros_g",
    "Otros",
    (b) =>
      round2(
        b.comisiones +
          b.servicios +
          b.transferencia +
          b.revisar +
          b.otro +
          b.otros
      ),
    buckets,
    "expense"
  );
  rows.push(marketing, rh, programas, impuestos, otrosG);
  const totGastos = totalRow(
    "tot_gastos",
    "TOTAL",
    [marketing, rh, programas, impuestos, otrosG],
    "expense"
  );
  rows.push(totGastos);

  const neto = diffRow("neto", "Ingreso Neto", bruto, totGastos, "result");
  const margenN = marginRow("margen_n", "Margen", neto, totIngreso);
  rows.push(neto, margenN);

  rows.push(section("capital_h", "Banco / CAPITAL", "capital"));
  rows.push(line("banco", "Banco", (b) => b.neto, buckets, "capital"));
  rows.push(line("capital", "CAPITAL", (b) => b.socio, buckets, "capital"));

  return {
    year,
    months: MONTH_LABELS,
    monthsPresent,
    runsCount: yearRuns.length,
    rows,
  };
}
