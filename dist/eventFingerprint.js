"use strict";
/**
 * Huella de evento para no repetir filas en Eventos.
 * cliente + fecha evento + horario + tipo (sin fecha de cierre:
 * si Kommo cambia closed_at no se crea otra fila).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventFingerprintFromValues = eventFingerprintFromValues;
exports.eventFingerprintFromFila = eventFingerprintFromFila;
function normKey_(v) {
    return String(v ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}
function normFecha_(v) {
    const s = String(v ?? "").trim();
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
        const day = m[1].padStart(2, "0");
        const mon = m[2].padStart(2, "0");
        const year = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${day}/${mon}/${year}`;
    }
    return normKey_(s);
}
/** values[] en orden A..T del Sheet Eventos. */
function eventFingerprintFromValues(values) {
    return [
        normKey_(values[0]),
        normFecha_(values[1]),
        normKey_(values[8]),
        normKey_(values[5]),
    ].join("|");
}
function eventFingerprintFromFila(fila) {
    return [
        normKey_(fila.cliente),
        normFecha_(fila.fechaDelEvento),
        normKey_(fila.horario),
        normKey_(fila.tipoDeEvento),
    ].join("|");
}
//# sourceMappingURL=eventFingerprint.js.map