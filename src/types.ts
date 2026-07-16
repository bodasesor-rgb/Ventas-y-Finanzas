/**
 * Fila que el módulo de ventas appendaría / actualizaría en el Sheet.
 * Las columnas con fórmula (Por pagar, Ganancia, Margen) y las editadas a mano
 * (Costo, Pagado, Pagado a proveedor) NO se rellenan desde código.
 */
export interface FilaVentas {
  tipoDeEvento: string;
  fechaDeCierre: string;
  fechaDelEvento: string;
  cliente: string;
  genero: string;
  telefono: string;
  enviarMensaje: string;
  correo: string;
  invitados: string;
  direccionDeEvento: string;
  horario: string;
  venta: string;
  costo: string;
  pagado: string;
  porPagar: string;
  pagadoAProveedor: string;
  ganancia: string;
  margen: string;
  linkCotizacion: string;
  mesCierre: string;
  formaDePago: string;
  /** Llave de idempotencia — última columna / oculta */
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
