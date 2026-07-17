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

const MES_ES: Record<string, string> = {
  ene: "01",
  enero: "01",
  feb: "02",
  febrero: "02",
  mar: "03",
  marzo: "03",
  abr: "04",
  abril: "04",
  may: "05",
  mayo: "05",
  jun: "06",
  junio: "06",
  jul: "07",
  julio: "07",
  ago: "08",
  agosto: "08",
  sep: "09",
  sept: "09",
  septiembre: "09",
  oct: "10",
  octubre: "10",
  nov: "11",
  noviembre: "11",
  dic: "12",
  diciembre: "12",
};

/** "14 ago", "14-agosto", "14 de agosto 2026" → YYYY-MM-DD */
export function extractFechaFromText(
  text: string,
  defaultYear?: number
): string {
  if (!text) return "";
  const yearFallback =
    defaultYear || new Date().getFullYear();

  // 14/08/2026 or 14-08-2026
  const dmy = text.match(
    /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/
  );
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  // 2026-08-14
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 14 ago / 14 de agosto / 14-agosto
  const named = text.match(
    /\b(\d{1,2})\s*(?:de\s+)?[-\s]?([A-Za-zÁÉÍÓÚáéíóú]+)(?:\s+(20\d{2}))?\b/i
  );
  if (named) {
    const day = named[1].padStart(2, "0");
    const monKey = named[2]
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");
    const month = MES_ES[monKey];
    if (month) {
      const year = named[3] || String(yearFallback);
      return `${year}-${month}-${day}`;
    }
  }
  return "";
}

function looksLikeTimeOnly(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return false;
  // "7pm a 12am", "19:00-00:00", "7 pm - 12 am"
  if (
    /\b\d{1,2}\s*(:\d{2})?\s*(am|pm)\b/.test(t) &&
    !/\b\d{1,2}[\/\-.]\d{1,2}/.test(t) &&
    !/\b(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i.test(t)
  ) {
    return true;
  }
  if (/^\d{1,2}:\d{2}\s*[-aá]\s*\d{1,2}:\d{2}/i.test(t)) return true;
  return false;
}

/**
 * Campo Kommo "Fecha y horario" → columnas Fecha del evento + Horario.
 * Acepta unix, ISO, o texto tipo "14/08/2026 18:00" / "7pm a 12am".
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

  // Solo horario (muy común en este CRM): "7pm a 12am"
  if (looksLikeTimeOnly(s)) {
    return { fecha: "", horario: s };
  }

  // ISO / "2026-08-14T18:00:00"
  const isoMs = Date.parse(s);
  if (!Number.isNaN(isoMs) && /\d{4}-\d{2}-\d{2}/.test(s)) {
    return mexicoParts(Math.floor(isoMs / 1000));
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

  const fechaNamed = extractFechaFromText(s);
  if (fechaNamed) {
    // Si además hay tramo horario en el mismo texto
    const timeBit = s.match(
      /(\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)(?:\s*a\s*\d{1,2}\s*(?::\d{2})?\s*(?:am|pm))?)/i
    );
    return { fecha: fechaNamed, horario: timeBit ? timeBit[1].trim() : "" };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { fecha: s, horario: "" };

  return { fecha: "", horario: s };
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

  let { fecha: fechaDelEvento, horario } = parseFechaYHorario(
    customFieldRaw(fields, KOMMO_FIELD_IDS.FECHA_Y_HORARIO)
  );

  // Fallback fecha: Requerimientos ("14 ago") o link cotización ("14-agosto")
  if (!fechaDelEvento) {
    const yearHint = fechaDeCierre
      ? Number(fechaDeCierre.slice(0, 4))
      : undefined;
    fechaDelEvento =
      extractFechaFromText(
        customFieldValue(fields, KOMMO_FIELD_IDS.REQUERIMIENTOS),
        yearHint
      ) ||
      extractFechaFromText(
        customFieldValue(fields, KOMMO_FIELD_IDS.LINK_COTIZACION_FINAL),
        yearHint
      ) ||
      extractFechaFromText(lead.name || "", yearHint);
  }

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
