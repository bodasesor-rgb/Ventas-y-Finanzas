import { KOMMO_FIELD_IDS } from "./kommoFieldIds";
import type {
  FilaVentas,
  KommoContactEmbedded,
  KommoCustomFieldValue,
  KommoLead,
} from "./types";

function customFieldValue(
  fields: KommoCustomFieldValue[] | undefined,
  fieldId: number
): string {
  if (!fields?.length) return "";
  const field = fields.find((f) => f.field_id === fieldId);
  const raw = field?.values?.[0]?.value;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

/**
 * Teléfono / email en Kommo suelen vivir en custom fields del contacto
 * (field_code PHONE / EMAIL) o en values tipados. Extraemos de forma
 * determinista sin inventar.
 */
function contactPhone(contact: KommoContactEmbedded | undefined): string {
  if (!contact?.custom_fields_values) return "";
  for (const f of contact.custom_fields_values) {
    const code = (f.field_code || "").toUpperCase();
    const name = (f.field_name || "").toLowerCase();
    const first = f.values?.[0];
    if (!first) continue;
    if (
      code === "PHONE" ||
      name.includes("phone") ||
      name.includes("tel") ||
      name.includes("móvil") ||
      name.includes("movil") ||
      name.includes("celular")
    ) {
      return String(first.value ?? "").trim();
    }
  }
  return "";
}

function contactEmail(contact: KommoContactEmbedded | undefined): string {
  if (!contact?.custom_fields_values) return "";
  for (const f of contact.custom_fields_values) {
    const code = (f.field_code || "").toUpperCase();
    const name = (f.field_name || "").toLowerCase();
    const first = f.values?.[0];
    if (!first) continue;
    if (
      code === "EMAIL" ||
      name.includes("email") ||
      name.includes("correo") ||
      name.includes("mail")
    ) {
      return String(first.value ?? "").trim();
    }
  }
  return "";
}

function unixToIsoDate(unixSeconds: number | undefined): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return "";
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  // Fecha local México no forzada aquí: ISO date UTC (YYYY-MM-DD)
  return d.toISOString().slice(0, 10);
}

function mesFromFechaCierre(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 7) return "";
  const month = Number(fechaIso.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  return String(month);
}

/**
 * Mapea un deal de Kommo a la fila del Sheet de ventas.
 * Solo rellena columnas que vienen de Kommo según el diseño.
 * No calcula ganancia/margen/por pagar.
 */
export function mapDealToFilaVentas(lead: KommoLead): FilaVentas {
  const fields = lead.custom_fields_values;
  const contact = lead._embedded?.contacts?.[0];

  const fechaDeCierre =
    unixToIsoDate(lead.closed_at) ||
    unixToIsoDate(lead.updated_at) ||
    unixToIsoDate(lead.created_at);

  return {
    tipoDeEvento: customFieldValue(fields, KOMMO_FIELD_IDS.TIPO_DE_EVENTO),
    fechaDeCierre,
    // Vacío a propósito (Jotform / manual) — Fase 1
    fechaDelEvento: "",
    cliente: (contact?.name || lead.name || "").trim(),
    genero: "",
    telefono: contactPhone(contact),
    enviarMensaje: "",
    correo: contactEmail(contact),
    invitados: "",
    direccionDeEvento: "",
    horario: "",
    venta: customFieldValue(fields, KOMMO_FIELD_IDS.MONTO_CIERRE),
    // Manual / fórmulas — el script no toca
    costo: "",
    pagado: "",
    porPagar: "",
    pagadoAProveedor: "",
    ganancia: "",
    margen: "",
    linkCotizacion: customFieldValue(
      fields,
      KOMMO_FIELD_IDS.LINK_COTIZACION_FINAL
    ),
    mesCierre: mesFromFechaCierre(fechaDeCierre),
    formaDePago: customFieldValue(fields, KOMMO_FIELD_IDS.FORMA_DE_PAGO),
    kommoDealId: String(lead.id),
  };
}

/** Orden de columnas del Sheet (última = deal ID para idempotencia). */
export function filaToOrderedValues(fila: FilaVentas): string[] {
  return [
    fila.tipoDeEvento,
    fila.fechaDeCierre,
    fila.fechaDelEvento,
    fila.cliente,
    fila.genero,
    fila.telefono,
    fila.enviarMensaje,
    fila.correo,
    fila.invitados,
    fila.direccionDeEvento,
    fila.horario,
    fila.venta,
    fila.costo,
    fila.pagado,
    fila.porPagar,
    fila.pagadoAProveedor,
    fila.ganancia,
    fila.margen,
    fila.linkCotizacion,
    fila.mesCierre,
    fila.formaDePago,
    fila.kommoDealId,
  ];
}

export const SHEET_HEADERS = [
  "Tipo de evento",
  "Fecha de cierre",
  "Fecha del evento",
  "Cliente",
  "Genero",
  "Telefono",
  "Enviar Mensaje",
  "Correo",
  "Invitados",
  "Dirección de evento",
  "Horario",
  "Venta",
  "Costo",
  "Pagado",
  "Por pagar",
  "Pagado a proveedor",
  "Ganancia",
  "Margen",
  "Link cotización",
  "Mes cierre",
  "Forma de Pago",
  "Kommo Deal ID",
] as const;
