import type { FilaVentas, KommoLead } from "./types";
/** "14 ago", "14-agosto", "14 de agosto 2026" → YYYY-MM-DD */
export declare function extractFechaFromText(text: string, defaultYear?: number): string;
/**
 * Campo Kommo "Fecha y horario" → columnas Fecha del evento + Horario.
 * Acepta unix, ISO, o texto tipo "14/08/2026 18:00" / "7pm a 12am".
 */
export declare function parseFechaYHorario(raw: unknown): {
    fecha: string;
    horario: string;
};
export declare function mapDealToFilaVentas(lead: KommoLead): FilaVentas;
/** Orden exacto A..T (20 columnas). */
export declare function filaToOrderedValues(fila: FilaVentas): string[];
export declare const SHEET_HEADERS: readonly ["Cliente", "Fecha del evento", "Fecha de cierre", "Telefono", "Correo", "Tipo de evento", "Invitados", "Dirección de evento", "Horario", "Venta", "Costo", "Pagado", "Por pagar", "Ganancia", "Margen", "Link cotización", "Mes cierre", "Forma de Pago", "IVA", "Kommo Deal ID"];
