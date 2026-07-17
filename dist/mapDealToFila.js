"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHEET_HEADERS = void 0;
exports.mapDealToFilaVentas = mapDealToFilaVentas;
exports.filaToOrderedValues = filaToOrderedValues;
const kommoFieldIds_1 = require("./kommoFieldIds");
function customFieldValue(fields, fieldId) {
    if (!fields?.length)
        return "";
    const field = fields.find((f) => f.field_id === fieldId);
    const raw = field?.values?.[0]?.value;
    if (raw === undefined || raw === null)
        return "";
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
function unixToIsoDate(unixSeconds) {
    if (!unixSeconds || !Number.isFinite(unixSeconds))
        return "";
    const d = new Date(unixSeconds * 1000);
    if (Number.isNaN(d.getTime()))
        return "";
    return d.toISOString().slice(0, 10);
}
function mesFromFechaCierre(fechaIso) {
    if (!fechaIso || fechaIso.length < 7)
        return "";
    const month = Number(fechaIso.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > 12)
        return "";
    return String(month);
}
function mapDealToFilaVentas(lead) {
    const fields = lead.custom_fields_values;
    const contact = lead._embedded?.contacts?.[0];
    const fechaDeCierre = unixToIsoDate(lead.closed_at) ||
        unixToIsoDate(lead.updated_at) ||
        unixToIsoDate(lead.created_at);
    return {
        cliente: (contact?.name || lead.name || "").trim(),
        fechaDelEvento: "",
        fechaDeCierre,
        telefono: contactPhone(contact),
        correo: contactEmail(contact),
        tipoDeEvento: customFieldValue(fields, kommoFieldIds_1.KOMMO_FIELD_IDS.TIPO_DE_EVENTO),
        invitados: "",
        direccionDeEvento: "",
        horario: "",
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