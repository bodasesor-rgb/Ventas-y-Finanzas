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

function normalizeNameKey_(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function titleCaseName_(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function nameTokens_(s: string): string[] {
  return s
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^[,.]+|[,.]+$/g, ""))
    .filter(Boolean);
}

/** Domínios genéricos: no usar como “empresa” en el apellido. */
const GENERIC_EMAIL_DOMAINS_ = new Set([
  "gmail",
  "googlemail",
  "hotmail",
  "outlook",
  "live",
  "msn",
  "yahoo",
  "ymail",
  "icloud",
  "me",
  "mac",
  "protonmail",
  "proton",
  "aol",
  "mail",
  "email",
  "gmx",
  "zoho",
]);

/**
 * Del local-part del correo saca apellidos:
 * - s.moisidelis → Moisidelis
 * - alejandra.martinez3 → Martinez
 * - ara.torres.cuevas → Torres Cuevas
 */
export function surnameFromEmailLocal_(
  email: string,
  firstName: string
): string {
  const at = email.indexOf("@");
  if (at <= 0) return "";
  let local = email.slice(0, at).split("+")[0].trim().toLowerCase();
  if (!local) return "";

  const parts = local
    .split(/[._-]+/)
    .map((p) => p.replace(/\d+$/g, ""))
    .filter((p) => p.length >= 2);

  const firstKey = normalizeNameKey_(firstName);
  const surnames: string[] = [];

  for (const part of parts) {
    const key = normalizeNameKey_(part);
    if (!key) continue;
    // inicial: s.moisidelis
    if (key.length === 1) continue;
    // mismo nombre o apodo corto (ara ⊂ araceli, alejandra == alejandra)
    if (
      firstKey &&
      (key === firstKey ||
        firstKey.startsWith(key) ||
        key.startsWith(firstKey))
    ) {
      continue;
    }
    surnames.push(part);
  }

  // local pegado sin puntos: marianarordz25 — si empieza con el nombre, resto = apellido
  if (!surnames.length && parts.length === 0) {
    const glued = local.replace(/\d+$/g, "");
    const gKey = normalizeNameKey_(glued);
    if (firstKey && gKey.startsWith(firstKey) && gKey.length > firstKey.length + 2) {
      surnames.push(glued.slice(firstKey.length));
    }
  } else if (!surnames.length && parts.length === 1) {
    const glued = parts[0];
    const gKey = normalizeNameKey_(glued);
    if (firstKey && gKey.startsWith(firstKey) && gKey.length > firstKey.length + 2) {
      surnames.push(glued.slice(firstKey.length));
    }
  }

  return titleCaseName_(surnames.join(" "));
}

/** agency-ia.com → Agency Ia (solo si no es gmail/hotmail/…). */
export function companyFromEmailDomain_(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "";
  const host = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/>$/, "");
  if (!host || !host.includes(".")) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  const companyLabel = labels[0];
  if (GENERIC_EMAIL_DOMAINS_.has(companyLabel)) return "";
  // agency-ia → Agency Ia
  return titleCaseName_(companyLabel.replace(/[-_]+/g, " "));
}

/**
 * Nombre completo para la columna Cliente.
 * Si solo hay nombre de pila, completa apellido (o empresa) desde el correo.
 */
export function resolveClienteName(
  contact: KommoContactEmbedded | undefined,
  leadName: string | undefined,
  email: string
): string {
  const first = (contact?.first_name || "").trim();
  const last = (contact?.last_name || "").trim();
  if (first && last) return titleCaseName_(`${first} ${last}`);

  const contactName = (contact?.name || "").trim();
  const lead = (leadName || "").trim();
  const contactTokens = nameTokens_(contactName);
  const leadTokens = nameTokens_(lead);

  // Preferir el que ya traiga nombre + apellido
  let base = "";
  if (leadTokens.length >= 2 && leadTokens.length >= contactTokens.length) {
    base = lead;
  } else if (contactTokens.length >= 2) {
    base = contactName;
  } else if (first) {
    base = first;
  } else {
    base = contactName || lead;
  }

  const tokens = nameTokens_(base);
  if (tokens.length >= 2) return titleCaseName_(base);

  const given = tokens[0] || "";
  if (!given) return "";

  const fromMail = email ? surnameFromEmailLocal_(email, given) : "";
  if (fromMail) return titleCaseName_(`${given} ${fromMail}`);

  const company = email ? companyFromEmailDomain_(email) : "";
  if (company) return titleCaseName_(`${given} ${company}`);

  return titleCaseName_(given);
}

/** Sheet: siempre día/mes/año */
function formatFechaDMY(day: string | number, month: string | number, year: string | number): string {
  const d = String(day).padStart(2, "0");
  const m = String(month).padStart(2, "0");
  const y = String(year);
  return `${d}/${m}/${y}`;
}

function unixToFechaDMY(unixSeconds: number | undefined): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return "";
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  // Cierre en UTC date parts (closed_at de Kommo es unix)
  return formatFechaDMY(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
}

/** Fecha/hora en zona México (eventos locales). */
function mexicoParts(unixSeconds: number): { fecha: string; horario: string } {
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return { fecha: "", horario: "" };
  const fecha = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const horario = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { fecha, horario };
}

/** Año desde DD/MM/YYYY o YYYY-MM-DD */
export function yearFromFecha(fecha: string): number | null {
  if (!fecha) return null;
  const dmy = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return Number(dmy[3]);
  const iso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Number(iso[1]);
  return null;
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

/** "14 ago", "14-agosto", "14 de agosto 2026" → DD/MM/YYYY */
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
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return formatFechaDMY(dmy[1], dmy[2], year);
  }

  // 2026-08-14 → 14/08/2026
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return formatFechaDMY(iso[3], iso[2], iso[1]);

  // 14 ago / 14 de agosto / 14-agosto
  const named = text.match(
    /\b(\d{1,2})\s*(?:de\s+)?[-\s]?([A-Za-zÁÉÍÓÚáéíóú]+)(?:\s+(20\d{2}))?\b/i
  );
  if (named) {
    const monKey = named[2]
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");
    const month = MES_ES[monKey];
    if (month) {
      const year = named[3] || String(yearFallback);
      return formatFechaDMY(named[1], month, year);
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
    let year = m[3];
    if (year.length === 2) year = `20${year}`;
    const fecha = formatFechaDMY(m[1], m[2], year);
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

  // YYYY-MM-DD → DD/MM/YYYY
  const isoOnly = s.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (isoOnly) {
    return { fecha: formatFechaDMY(isoOnly[3], isoOnly[2], isoOnly[1]), horario: "" };
  }

  return { fecha: "", horario: s };
}

function mesFromFechaCierre(fecha: string): string {
  if (!fecha) return "";
  // DD/MM/YYYY
  const dmy = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const month = Number(dmy[2]);
    if (month >= 1 && month <= 12) return String(month);
    return "";
  }
  // YYYY-MM-DD (legado)
  const iso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return String(month);
  }
  return "";
}

export function mapDealToFilaVentas(lead: KommoLead): FilaVentas {
  const fields = lead.custom_fields_values;
  const contact = lead._embedded?.contacts?.[0];

  const fechaDeCierre =
    unixToFechaDMY(lead.closed_at) ||
    unixToFechaDMY(lead.updated_at) ||
    unixToFechaDMY(lead.created_at);

  let { fecha: fechaDelEvento, horario } = parseFechaYHorario(
    customFieldRaw(fields, KOMMO_FIELD_IDS.FECHA_Y_HORARIO)
  );

  // Fallback fecha: Requerimientos ("14 ago") o link cotización ("14-agosto")
  if (!fechaDelEvento) {
    const yearHint = yearFromFecha(fechaDeCierre) ?? undefined;
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

  const correo = contactEmail(contact);

  return {
    cliente: resolveClienteName(contact, lead.name, correo),
    fechaDelEvento,
    fechaDeCierre,
    telefono: contactPhone(contact),
    correo,
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
