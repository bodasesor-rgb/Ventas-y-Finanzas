/**
 * IDs de campos personalizados de Kommo (leads/deals).
 * Pegados por el equipo — no inventar ni inferir otros.
 */
export const KOMMO_FIELD_IDS = {
  /** Link cotización final → columna "Link cotización" */
  LINK_COTIZACION_FINAL: 1049176,
  /** Monto de cierre → columna "Venta" */
  MONTO_CIERRE: 1049178,
  /** Forma de pago → columna "Forma de Pago" */
  FORMA_DE_PAGO: 1049180,
  /** Tipo de evento → columna "Tipo de evento" */
  TIPO_DE_EVENTO: 1048782,
  /** Dirección de evento → columna "Dirección de evento" */
  DIRECCION_EVENTO: 1048774,
  /** Fecha y horario → columnas "Fecha del evento" + "Horario" */
  FECHA_Y_HORARIO: 1048778,
  /** Número de invitados → columna "Invitados" */
  NUMERO_INVITADOS: 1048780,
  /** Requerimientos — fallback para fecha (ej. "Cumpleaños 14 ago. 50 pax") */
  REQUERIMIENTOS: 1048776,
  /** Presupuesto — NO usar como Venta; Venta = Monto de cierre */
  PRESUPUESTO: 1048784,
} as const;

/** Nombre de la columna oculta / última con el deal ID (idempotencia). */
export const DEAL_ID_COLUMN_HEADER = "Kommo Deal ID";
