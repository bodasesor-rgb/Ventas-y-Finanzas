import type { FilaVentas, KommoLead } from "./types";
export declare function mapDealToFilaVentas(lead: KommoLead): FilaVentas;
/** Orden exacto A..T (20 columnas). */
export declare function filaToOrderedValues(fila: FilaVentas): string[];
export declare const SHEET_HEADERS: readonly ["Cliente", "Fecha del evento", "Fecha de cierre", "Telefono", "Correo", "Tipo de evento", "Invitados", "Dirección de evento", "Horario", "Venta", "Costo", "Pagado", "Por pagar", "Ganancia", "Margen", "Link cotización", "Mes cierre", "Forma de Pago", "IVA", "Kommo Deal ID"];
