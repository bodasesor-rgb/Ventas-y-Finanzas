import type { FilaVentas, KommoLead } from "./types";
export type ReminderKind = "semana" | "vispera";
export interface KommoTaskResult {
    ok: boolean;
    dealId: string;
    skipped?: string;
    /** "kommo" o "sheet": de dónde salió la fecha del evento. */
    fechaSource?: string;
    fechaDelEvento?: string;
    created: Array<{
        kind: ReminderKind;
        completeTill: string;
        text: string;
    }>;
    alreadyThere: ReminderKind[];
    tooLate: ReminderKind[];
    error?: string;
}
/** "DD/MM/YYYY" + hora local México → unix segundos. */
export declare function mxUnixAt_(fechaDMY: string, hour: number): number | null;
/**
 * Quita las tareas de recordatorio Bodasesor ([evt:semana|vispera:dealId])
 * de un lead. Intenta borrar; si el token no tiene scope DELETE, las completa.
 */
export declare function deleteEventReminderTasks(leadId: number): Promise<{
    ok: boolean;
    dealId: string;
    deleted: number;
    completed?: number;
    method?: "deleted" | "completed";
    texts: string[];
    error?: string;
}>;
/**
 * Crea las tareas de recordatorio que falten para un deal cerrado.
 * Idempotente: relee las tareas del lead y salta las que ya tienen la marca.
 * NUNCA crea tareas en leads que no estén ganados (status 142).
 */
export declare function ensureEventReminderTasks(lead: KommoLead, fila: FilaVentas): Promise<KommoTaskResult>;
export interface BackfillResult {
    eventosFuturos: number;
    creadas: number;
    items: Array<Record<string, unknown>>;
}
/**
 * Repasa los eventos futuros del Sheet y crea las tareas que falten.
 *
 * Se parte del Sheet y no de los cierres de Kommo por dos razones: Kommo
 * ignora order[closed_at]=desc (devuelve los más viejos de la ventana) y
 * muchas fechas de evento solo existen en el Sheet porque se corrigen a mano.
 *
 * Es el reintento que hace que una caída de la API de Kommo durante el cierre
 * no deje al evento sin recordatorio para siempre.
 */
export declare function backfillEventReminderTasks(): Promise<BackfillResult>;
export interface WeeklyKommoDigestResult {
    ok: boolean;
    skipped?: string;
    weekKey: string;
    semanaDel: string;
    semanaAl: string;
    eventos: number;
    created?: boolean;
    completeTill?: string;
    text?: string;
    error?: string;
}
/**
 * Tarea única en el calendario de Kommo: "Esta semana: N evento(s)".
 * Aparece en Calendario (no en un chat de lead abierto). Idempotente por semana.
 */
export declare function ensureWeeklyKommoDigest(opts?: {
    force?: boolean;
}): Promise<WeeklyKommoDigestResult>;
