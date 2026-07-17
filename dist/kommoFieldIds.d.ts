/**
 * IDs de campos personalizados de Kommo (leads/deals).
 * Pegados por el equipo — no inventar ni inferir otros.
 */
export declare const KOMMO_FIELD_IDS: {
    /** Link cotización final → columna "Link cotización" */
    readonly LINK_COTIZACION_FINAL: 1049176;
    /** Monto de cierre → columna "Venta" */
    readonly MONTO_CIERRE: 1049178;
    /** Forma de pago → columna "Forma de Pago" */
    readonly FORMA_DE_PAGO: 1049180;
    /** Tipo de evento → columna "Tipo de evento" */
    readonly TIPO_DE_EVENTO: 1048782;
    /** Dirección de evento — Fase 1: no se escribe al Sheet (queda vacío / Jotform) */
    readonly DIRECCION_EVENTO: 1048774;
    /** Fecha y horario — Fase 1: no se escribe al Sheet */
    readonly FECHA_Y_HORARIO: 1048778;
    /** Número de invitados — Fase 1: no se escribe al Sheet */
    readonly NUMERO_INVITADOS: 1048780;
    /** Requerimientos — no mapea al Sheet de ventas */
    readonly REQUERIMIENTOS: 1048776;
    /** Presupuesto — NO usar como Venta; Venta = Monto de cierre */
    readonly PRESUPUESTO: 1048784;
};
/** Nombre de la columna oculta / última con el deal ID (idempotencia). */
export declare const DEAL_ID_COLUMN_HEADER = "Kommo Deal ID";
