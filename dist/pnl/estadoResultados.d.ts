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
/** Estado de Resultados anual: columnas por mes, filas tipo Sheet mejoradas. */
export declare function buildEstadoResultados(runs: StatementRun[], year?: number): EstadoResultados;
