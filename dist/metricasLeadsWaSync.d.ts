/** Clasificación de etapa según nombre (reglas Bodasesor). */
export declare function classifyStatusName_(name: string): "no_contestaron" | "llenado" | "other";
/**
 * Solo mails reales con asunto que diga cotización.
 * No cuenta chats Lucy ni outgoing_mail sin asunto (no se puede filtrar publicidad).
 */
export declare function countsAsCotizacionMail_(opts: {
    subject: string;
    type?: string;
}): boolean;
export type WeekLeadsWa = {
    weekStart: string;
    leads: number;
    correo: number;
    noContestaron: number;
    llenado: number;
    porcentaje: number;
};
export declare function syncMetricasLeadsWa(opts?: {
    force?: boolean;
    lookbackDays?: number;
    pipelineId?: number;
}): Promise<{
    ok: boolean;
    sheetName: string;
    pipeline?: {
        id: number;
        name: string;
    };
    statusMap?: Array<{
        id: number;
        name: string;
        class: string;
    }>;
    updatedCells: number;
    weeks: WeekLeadsWa[];
    skipped?: boolean;
    error?: string;
    hint?: string;
    mailSample?: string[];
}>;
export declare function leadsWaProbe(): Promise<{
    ok: boolean;
    pipelines: {
        id: number;
        name: string;
        is_main: boolean | undefined;
        statuses: {
            id: number;
            name: string;
            class: "no_contestaron" | "llenado" | "other";
        }[];
    }[];
    selected: {
        id: number;
        name: string;
    } | null;
    mailProbe: Record<string, unknown>;
}>;
/**
 * Fallback Correo: leads creados en la semana cuya etapa actual es
 * "Cotización realizada" o posterior de engagement (aprox. mails de cotización).
 */
export declare function isCotizacionStatus_(name: string): boolean;
