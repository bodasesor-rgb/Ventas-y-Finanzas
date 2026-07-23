import type { FilaVentas, KommoContactEmbedded, KommoLead } from "./types";
/**
 * Del local-part del correo saca apellidos:
 * - s.moisidelis → Moisidelis
 * - alejandra.martinez3 → Martinez
 * - ara.torres.cuevas → Torres Cuevas
 */
export declare function surnameFromEmailLocal_(email: string, firstName: string): string;
/** agency-ia.com → Agency Ia (solo si no es gmail/hotmail/…). */
export declare function companyFromEmailDomain_(email: string): string;
/**
 * Nombre completo para la columna Cliente.
 * Si solo hay nombre de pila, completa apellido (o empresa) desde el correo.
 */
export declare function resolveClienteName(contact: KommoContactEmbedded | undefined, leadName: string | undefined, email: string): string;
/** Año desde DD/MM/YYYY o YYYY-MM-DD */
export declare function yearFromFecha(fecha: string): number | null;
/** "14 ago", "14-agosto", "14 de agosto 2026" → DD/MM/YYYY */
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
