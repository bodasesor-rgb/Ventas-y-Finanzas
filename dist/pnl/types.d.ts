/** Valor libre: slug de categoría (ads, ingreso, o personalizada) */
export type PnlCategory = string;
export type CategoryKind = "gasto" | "ingreso" | "neutro";
export interface CategoryDef {
    /** Valor usado en reglas y líneas (slug) */
    id: string;
    label: string;
    kind: CategoryKind;
    /** Color hex para vincular la categoría en la UI */
    color?: string;
    /** Si false, el usuario la creó y puede borrarla */
    builtin?: boolean;
    /** Creada automáticamente al leer un PDF */
    autoCreated?: boolean;
}
export interface RecurringRule {
    id: string;
    /** Texto a buscar en la descripción del movimiento (minúsculas) */
    match: string;
    category: PnlCategory;
    label: string;
    /** Si true, se trata como gasto recurrente fijo */
    frecuente: boolean;
    notes?: string;
}
export interface BankLine {
    id: string;
    raw: string;
    date?: string;
    description: string;
    amount: number;
    /** cargo = negativo/gasto, abono = ingreso */
    direction: "cargo" | "abono" | "unknown";
    category: PnlCategory;
    matchedRuleId?: string;
    needsReview: boolean;
}
export interface StatementRun {
    id: string;
    filename: string;
    uploadedAt: string;
    /** Mes del estado: YYYY-MM */
    periodKey?: string;
    /** ej. junio 2026 */
    periodLabel?: string;
    /** Nombre guardado: 2026-06_estado-cuenta.pdf */
    storedName?: string;
    /** Ruta relativa bajo data/statements/ */
    storedRelativePath?: string;
    /** Copia durable en Google Drive (sobrevive deploys) */
    drivePdfFileId?: string;
    driveRunFileId?: string;
    drivePdfUrl?: string;
    archivedAt?: string;
    textPreview: string;
    /** Texto completo (hasta ~300k) para reparse / debug Banamex */
    textFull?: string;
    parseDebug?: {
        textLength: number;
        pagesHint?: string;
        sampleMid: string;
    };
    lines: BankLine[];
    summaryByCategory: Record<string, number>;
    totals?: {
        ingresos: number;
        gastos: number;
        neto: number;
    };
    /** Totales del resumen del PDF + cruce con lo parseado */
    reconciliation?: {
        oficial: {
            depositos: number | null;
            retirosEfectivo: number | null;
            otrosCargos: number | null;
            ingresosOficiales: number | null;
            gastosOficiales: number | null;
            saldoAnterior: number | null;
            saldoCorte: number | null;
        };
        parseado: {
            ingresos: number;
            gastos: number;
            neto: number;
        };
        diffIngresos: number | null;
        diffGastos: number | null;
        matchIngresos: boolean;
        matchGastos: boolean;
        matchCompleto: boolean;
        tolerancia: number;
    };
    /** Última vez que se envió al Sheet (Banco / P&L) */
    sentToSheetAt?: string;
    sentToSheet?: {
        ok: boolean;
        sheetName?: string;
        row?: number;
        action?: string;
        version?: string;
        error?: string;
    };
}
