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
 * Crea las tareas de recordatorio que falten para un deal cerrado.
 * Idempotente: relee las tareas del lead y salta las que ya tienen la marca.
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
