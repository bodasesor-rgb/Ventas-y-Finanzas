"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHEET_HEADERS = void 0;
exports.yearFromFecha = yearFromFecha;
exports.extractFechaFromText = extractFechaFromText;
exports.parseFechaYHorario = parseFechaYHorario;
exports.mapDealToFilaVentas = mapDealToFilaVentas;
exports.filaToOrderedValues = filaToOrderedValues;
const kommoFieldIds_1 = require("./kommoFieldIds");
function findField(fields, fieldId) {
    return fields?.find((f) => f.field_id === fieldId);
}
function customFieldRaw(fields, fieldId) {
    const field = findField(fields, fieldId);
    return field?.values?.[0]?.value;
}
function customFieldValue(fields, fieldId) {
    const raw = customFieldRaw(fields, fieldId);
    if (raw === undefined || raw === null)
        return "";
    if (typeof raw === "object") {
        // Dirección inteligente Kommo a veces viene como objeto
        const o = raw;
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
        if (parts.length)
            return parts.join(", ");
        try {
            return JSON.stringify(raw);
        }
        catch {
            return "";
        }
    }
    return String(raw).trim();
}
function contactPhone(contact) {
    if (!contact?.custom_fields_values)
        return "";
    for (const f of contact.custom_fields_values) {
        const code = (f.field_code || "").toUpperCase();
        const name = (f.field_name || "").toLowerCase();
        const first = f.values?.[0];
        if (!first)
            continue;
        if (code === "PHONE" ||
            name.includes("phone") ||
            name.includes("tel") ||
            name.includes("móvil") ||
            name.includes("movil") ||
            name.includes("celular")) {
            return String(first.value ?? "").trim();
        }
    }
    return "";
}
function contactEmail(contact) {
    if (!contact?.custom_fields_values)
        return "";
    for (const f of contact.custom_fields_values) {
        const code = (f.field_code || "").toUpperCase();
        const name = (f.field_name || "").toLowerCase();
        const first = f.values?.[0];
        if (!first)
            continue;
        if (code === "EMAIL" ||
            name.includes("email") ||
            name.includes("correo") ||
            name.includes("mail")) {
            return String(first.value ?? "").trim();
        }
    }
    return "";
}
/** Sheet: siempre día/mes/año */
function formatFechaDMY(day, month, year) {
    const d = String(day).padStart(2, "0");
    const m = String(month).padStart(2, "0");
    const y = String(year);
    return `${d}/${m}/${y}`;
}
function unixToFechaDMY(unixSeconds) {
    if (!unixSeconds || !Number.isFinite(unixSeconds))
        return "";
    const d = new Date(unixSeconds * 1000);
    if (Number.isNaN(d.getTime()))
        return "";
    // Cierre en UTC date parts (closed_at de Kommo es unix)
    return formatFechaDMY(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
}
/** Fecha/hora en zona México (eventos locales). */
function mexicoParts(unixSeconds) {
    const d = new Date(unixSeconds * 1000);
    if (Number.isNaN(d.getTime()))
        return { fecha: "", horario: "" };
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
function yearFromFecha(fecha) {
    if (!fecha)
        return null;
    const dmy = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy)
        return Number(dmy[3]);
    const iso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso)
        return Number(iso[1]);
    return null;
}
const MES_ES = {
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
function extractFechaFromText(text, defaultYear) {
    if (!text)
        return "";
    const yearFallback = defaultYear || new Date().getFullYear();
    // 14/08/2026 or 14-08-2026
    const dmy = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (dmy) {
        let year = dmy[3];
        if (year.length === 2)
            year = `20${year}`;
        return formatFechaDMY(dmy[1], dmy[2], year);
    }
    // 2026-08-14 → 14/08/2026
    const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso)
        return formatFechaDMY(iso[3], iso[2], iso[1]);
    // 14 ago / 14 de agosto / 14-agosto
    const named = text.match(/\b(\d{1,2})\s*(?:de\s+)?[-\s]?([A-Za-zÁÉÍÓÚáéíóú]+)(?:\s+(20\d{2}))?\b/i);
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
function looksLikeTimeOnly(s) {
    const t = s.trim().toLowerCase();
    if (!t)
        return false;
    // "7pm a 12am", "19:00-00:00", "7 pm - 12 am"
    if (/\b\d{1,2}\s*(:\d{2})?\s*(am|pm)\b/.test(t) &&
        !/\b\d{1,2}[\/\-.]\d{1,2}/.test(t) &&
        !/\b(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i.test(t)) {
        return true;
    }
    if (/^\d{1,2}:\d{2}\s*[-aá]\s*\d{1,2}:\d{2}/i.test(t))
        return true;
    return false;
}
/**
 * Campo Kommo "Fecha y horario" → columnas Fecha del evento + Horario.
 * Acepta unix, ISO, o texto tipo "14/08/2026 18:00" / "7pm a 12am".
 */
function parseFechaYHorario(raw) {
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
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) {
        let year = m[3];
        if (year.length === 2)
            year = `20${year}`;
        const fecha = formatFechaDMY(m[1], m[2], year);
        const horario = m[4] != null ? `${m[4].padStart(2, "0")}:${m[5]}` : "";
        return { fecha, horario };
    }
    const fechaNamed = extractFechaFromText(s);
    if (fechaNamed) {
        // Si además hay tramo horario en el mismo texto
        const timeBit = s.match(/(\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)(?:\s*a\s*\d{1,2}\s*(?::\d{2})?\s*(?:am|pm))?)/i);
        return { fecha: fechaNamed, horario: timeBit ? timeBit[1].trim() : "" };
    }
    // YYYY-MM-DD → DD/MM/YYYY
    const isoOnly = s.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
    if (isoOnly) {
        return { fecha: formatFechaDMY(isoOnly[3], isoOnly[2], isoOnly[1]), horario: "" };
    }
    return { fecha: "", horario: s };
}
function mesFromFechaCierre(fecha) {
    if (!fecha)
        return "";
    // DD/MM/YYYY
    const dmy = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) {
        const month = Number(dmy[2]);
        if (month >= 1 && month <= 12)
            return String(month);
        return "";
    }
    // YYYY-MM-DD (legado)
    const iso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
        const month = Number(iso[2]);
        if (month >= 1 && month <= 12)
            return String(month);
    }
    return "";
}
function mapDealToFilaVentas(lead) {
    const fields = lead.custom_fields_values;
    const contact = lead._embedded?.contacts?.[0];
    const fechaDeCierre = unixToFechaDMY(lead.closed_at) ||
        unixToFechaDMY(lead.updated_at) ||
        unixToFechaDMY(lead.created_at);
    let { fecha: fechaDelEvento, horario } = parseFechaYHorario(customFieldRaw(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.FECHA_Y_HORARIO));
    // Fallback fecha: Requerimientos ("14 ago") o link cotización ("14-agosto")
    if (!fechaDelEvento) {
        const yearHint = yearFromFecha(fechaDeCierre) ?? undefined;
        fechaDelEvento =
            extractFechaFromText(customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.REQUERIMIENTOS), yearHint) ||
                extractFechaFromText(customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.LINK_COTIZACION_FINAL), yearHint) ||
                extractFechaFromText(lead.name || "", yearHint);
    }
    return {
        cliente: (contact?.name || lead.name || "").trim(),
        fechaDelEvento,
        fechaDeCierre,
        telefono: contactPhone(contact),
        correo: contactEmail(contact),
        tipoDeEvento: customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.TIPO_DE_EVENTO),
        invitados: customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.NUMERO_INVITADOS),
        direccionDeEvento: customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.DIRECCION_EVENTO),
        horario,
        venta: customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.MONTO_CIERRE),
        costo: "",
        pagado: "",
        porPagar: "",
        ganancia: "",
        margen: "",
        linkCotizacion: customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.LINK_COTIZACION_FINAL),
        mesCierre: mesFromFechaCierre(fechaDeCierre),
        formaDePago: customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.FORMA_DE_PAGO),
        iva: "",
        kommoDealId: String(lead.id),
    };
}
/** Orden exacto A..T (20 columnas). */
function filaToOrderedValues(fila) {
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
exports.SHEET_HEADERS = [
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
];
//# sourceMappingURL=mapDealToFila.js.map