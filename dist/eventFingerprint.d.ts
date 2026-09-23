/**
 * Huella de evento para no repetir filas en Eventos.
 * cliente + fecha evento + horario + tipo (sin fecha de cierre:
 * si Kommo cambia closed_at no se crea otra fila).
 */
/** values[] en orden A..T del Sheet Eventos. */
export declare function eventFingerprintFromValues(values: string[]): string;
export declare function eventFingerprintFromFila(fila: {
    cliente: string;
    fechaDelEvento: string;
    fechaDeCierre?: string;
    horario: string;
    tipoDeEvento: string;
}): string;
