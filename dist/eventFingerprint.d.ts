/**
 * Huella de evento para no repetir filas en Eventos.
 * Misma lógica que Apps Script v30: cliente + fechas + horario + tipo.
 */
/** values[] en orden A..T del Sheet Eventos. */
export declare function eventFingerprintFromValues(values: string[]): string;
export declare function eventFingerprintFromFila(fila: {
    cliente: string;
    fechaDelEvento: string;
    fechaDeCierre: string;
    horario: string;
    tipoDeEvento: string;
}): string;
