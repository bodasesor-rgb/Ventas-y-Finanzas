/**
 * Fila del Sheet real:
 * Cliente | Fecha del evento | Fecha de cierre | Genero | Telefono | Correo |
 * Tipo de evento | Invitados | Dirección de evento | Horario | Venta | Costo |
 * Pagado | Por pagar | Ganancia | Margen | Link cotización | Mes cierre |
 * Forma de Pago | IVA | Kommo Deal ID
 *
 * El script NO calcula Por pagar / Ganancia / Margen ni edita Costo / Pagado / IVA.
 */
export interface FilaVentas {
  cliente: string;
  fechaDelEvento: string;
  fechaDeCierre: string;
  genero: string;
  telefono: string;
  correo: string;
  tipoDeEvento: string;
  invitados: string;
  direccionDeEvento: string;
  horario: string;
  venta: string;
  costo: string;
  pagado: string;
  porPagar: string;
  ganancia: string;
  margen: string;
  linkCotizacion: string;
  mesCierre: string;
  formaDePago: string;
  iva: string;
  /** Llave de idempotencia — columna U */
  kommoDealId: string;
}

export interface KommoCustomFieldValue {
  field_id: number;
  field_name?: string;
  field_code?: string;
  values?: Array<{ value?: string | number | boolean; enum_id?: number }>;
}

export interface KommoContactEmbedded {
  id?: number;
  name?: string;
  custom_fields_values?: KommoCustomFieldValue[];
}

export interface KommoLead {
  id: number;
  name?: string;
  status_id?: number;
  closed_at?: number;
  updated_at?: number;
  created_at?: number;
  price?: number;
  custom_fields_values?: KommoCustomFieldValue[];
  _embedded?: {
    contacts?: KommoContactEmbedded[];
  };
}

export interface KommoWebhookBody {
  leads?: {
    status?: Array<Partial<KommoLead> & { id: number | string }>;
    update?: Array<Partial<KommoLead> & { id: number | string }>;
    add?: Array<Partial<KommoLead> & { id: number | string }>;
  };
  account?: { subdomain?: string; id?: number | string };
}
