/**
 * Huella de evento para no repetir filas en Eventos.
 * Misma lógica que Apps Script v30: cliente + fechas + horario + tipo.
 */

function normKey_(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normFecha_(v: unknown): string {
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
export function eventFingerprintFromValues(values: string[]): string {
  return [
    normKey_(values[0]),
    normFecha_(values[1]),
    normFecha_(values[2]),
    normKey_(values[8]),
    normKey_(values[5]),
  ].join("|");
}

export function eventFingerprintFromFila(fila: {
  cliente: string;
  fechaDelEvento: string;
  fechaDeCierre: string;
  horario: string;
  tipoDeEvento: string;
}): string {
  return [
    normKey_(fila.cliente),
    normFecha_(fila.fechaDelEvento),
    normFecha_(fila.fechaDeCierre),
    normKey_(fila.horario),
    normKey_(fila.tipoDeEvento),
  ].join("|");
}
