import { KOMMO_FIELD_IDS } from "./kommoFieldIds";
import type {
  FilaVentas,
  KommoContactEmbedded,
  KommoCustomFieldValue,
  KommoLead,
} from "./types";

function findField(
  fields: KommoCustomFieldValue[] | undefined,
  fieldId: number
): KommoCustomFieldValue | undefined {
  return fields?.find((f) => f.field_id === fieldId);
}

function customFieldRaw(
  fields: KommoCustomFieldValue[] | undefined,
  fieldId: number
): unknown {
  const field = findField(fields, fieldId);
  return field?.values?.[0]?.value;
}

function customFieldValue(
  fields: KommoCustomFieldValue[] | undefined,
  fieldId: number
): string {
  const raw = customFieldRaw(fields, fieldId);
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "object") {
    // Dirección inteligente Kommo a veces viene como objeto
    const o = raw as Record<string, unknown>;
    const parts = [
      o.address_line_1,
      o.address_line_2,
      o.city,
      o.state,
      o.zip,
      o.country,
    ]
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean);
    if (parts.length) return parts.join(", ");
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  return String(raw).trim();
}

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
  return d.toISOString().slice(0, 10);
}

/** Fecha/hora en zona México (eventos locales). */
function mexicoParts(unixSeconds: number): { fecha: string; horario: string } {
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return { fecha: "", horario: "" };
  const fecha = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const horario = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { fecha, horario };
}

/**
 * Campo Kommo "Fecha y horario" → columnas Fecha del evento + Horario.
 * Acepta unix, ISO, o texto tipo "14/08/2026 18:00".
 */
export function parseFechaYHorario(raw: unknown): {
  fecha: string;
  horario: string;
} {
  if (raw === undefined || raw === null || raw === "") {
    return { fecha: "", horario: "" };
  }

  if (typeof raw === "number" && Number.isFinite(raw) && raw > 1e9) {
    return mexicoParts(raw > 1e12 ? Math.floor(raw / 1000) : raw);
  }

  const s = String(raw).trim();
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    return mexicoParts(n > 1e12 ? Math.floor(n / 1000) : n);
  }

  // ISO / "2026-08-14T18:00:00"
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) {
    return mexicoParts(Math.floor(iso / 1000));
  }

  // "14/08/2026 18:00" o "14-08-2026 18:00"
  const m = s.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (m) {
    const day = m[1].padStart(2, "0");
    const month = m[2].padStart(2, "0");
    let year = m[3];
    if (year.length === 2) year = `20${year}`;
    const fecha = `${year}-${month}-${day}`;
    const horario =
      m[4] != null ? `${m[4].padStart(2, "0")}:${m[5]}` : "";
    return { fecha, horario };
  }

  // Solo fecha ISO ya recortada
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { fecha: s, horario: "" };

  return { fecha: s, horario: "" };
}

function mesFromFechaCierre(fechaIso: string): string {
  if (!fechaIso || fechaIso.length < 7) return "";
  const month = Number(fechaIso.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  return String(month);
}

export function mapDealToFilaVentas(lead: KommoLead): FilaVentas {
  const fields = lead.custom_fields_values;
  const contact = lead._embedded?.contacts?.[0];

  const fechaDeCierre =
    unixToIsoDate(lead.closed_at) ||
    unixToIsoDate(lead.updated_at) ||
    unixToIsoDate(lead.created_at);

  const { fecha: fechaDelEvento, horario } = parseFechaYHorario(
    customFieldRaw(fields, KOMMO_FIELD_IDS.FECHA_Y_HORARIO)
  );

  return {
    cliente: (contact?.name || lead.name || "").trim(),
    fechaDelEvento,
    fechaDeCierre,
    telefono: contactPhone(contact),
    correo: contactEmail(contact),
    tipoDeEvento: customFieldValue(fields, KOMMO_FIELD_IDS.TIPO_DE_EVENTO),
    invitados: customFieldValue(fields, KOMMO_FIELD_IDS.NUMERO_INVITADOS),
    direccionDeEvento: customFieldValue(
      fields,
      KOMMO_FIELD_IDS.DIRECCION_EVENTO
    ),
    horario,
    venta: customFieldValue(fields, KOMMO_FIELD_IDS.MONTO_CIERRE),
    costo: "",
    pagado: "",
    porPagar: "",
    ganancia: "",
    margen: "",
    linkCotizacion: customFieldValue(
      fields,
      KOMMO_FIELD_IDS.LINK_COTIZACION_FINAL
    ),
    mesCierre: mesFromFechaCierre(fechaDeCierre),
    formaDePago: customFieldValue(fields, KOMMO_FIELD_IDS.FORMA_DE_PAGO),
    iva: "",
    kommoDealId: String(lead.id),
  };
}

/** Orden exacto A..T (20 columnas). */
export function filaToOrderedValues(fila: FilaVentas): string[] {
  return [
    fila.cliente,
    fila.fechaDelEvento,
    fila.fechaDeCierre,
    fila.telefono,
    fila.correo,
    fila.tipoDeEvento,
    fila.invitados,
    fila.direccionDeEvento,
    fila.horario,
    fila.venta,
    fila.costo,
    fila.pagado,
    fila.porPagar,
    fila.ganancia,
    fila.margen,
    fila.linkCotizacion,
    fila.mesCierre,
    fila.formaDePago,
    fila.iva,
    fila.kommoDealId,
  ];
}

export const SHEET_HEADERS = [
  "Cliente",
  "Fecha del evento",
  "Fecha de cierre",
  "Telefono",
  "Correo",
  "Tipo de evento",
  "Invitados",
  "Dirección de evento",
  "Horario",
  "Venta",
  "Costo",
  "Pagado",
  "Por pagar",
  "Ganancia",
  "Margen",
  "Link cotización",
  "Mes cierre",
  "Forma de Pago",
  "IVA",
  "Kommo Deal ID",
] as const;
