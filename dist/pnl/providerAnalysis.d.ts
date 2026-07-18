import type { StatementRun } from "./types";
export interface ProviderRankRow {
    name: string;
    kind: "socio" | "proveedor";
    total: number;
    payments: number;
    shareOfProviders: number;
    byMonth: Record<string, number>;
}
export interface MonthAnalysis {
    periodKey: string;
    periodLabel: string;
    ingresos: number;
    gastos: number;
    neto: number;
    socios: number;
    proveedores: number;
    ads: number;
    apps: number;
    comisiones: number;
    servicios: number;
    otrosGastos: number;
    topProveedores: {
        name: string;
        total: number;
        payments: number;
    }[];
    cuadra: boolean | null;
}
export interface YearAnalysis {
    year: number;
    monthsPresent: string[];
    runsCount: number;
    ingresos: number;
    gastos: number;
    neto: number;
    sociosTotal: number;
    proveedoresTotal: number;
    topProveedores: ProviderRankRow[];
    top5Proveedores: ProviderRankRow[];
    socios: ProviderRankRow[];
    concentracion: {
        top1Share: number;
        top3Share: number;
        top5Share: number;
    };
    byMonth: MonthAnalysis[];
    byCategory: {
        id: string;
        total: number;
    }[];
}
export declare function buildYearAnalysis(runs: StatementRun[], year?: number): YearAnalysis;
