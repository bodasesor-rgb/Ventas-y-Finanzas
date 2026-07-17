import type { BankLine } from "./types";
/**
 * Extrae un nombre de comercio / concepto usable como categoría.
 * Ej: "COMPRA FACEBK *ADS 9001/.." → "Facebk"
 *     "PAGO TELCEL DIGITAL" → "Telcel"
 */
export declare function extractMerchantLabel(description: string): string | null;
/**
 * Para líneas en "revisar" / sin match: crea categoría (y regla) desde el comercio.
 * También asegura categoría "pago" y colores en todas.
 */
export declare function autoCreateCategoriesFromLines(lines: BankLine[]): {
    lines: BankLine[];
    created: string[];
};
