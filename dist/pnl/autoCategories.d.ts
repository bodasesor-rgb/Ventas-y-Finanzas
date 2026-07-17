import type { BankLine } from "./types";
export declare function extractMerchantLabel(description: string): string | null;
/**
 * NO crea categoría por comercio.
 * Crea/actualiza REGLAS (match + etiqueta) apuntando a categoría amplia (apps, ads…).
 */
export declare function autoCreateCategoriesFromLines(lines: BankLine[]): {
    lines: BankLine[];
    created: string[];
    rulesCreated: string[];
};
/** Limpia del catálogo categorías auto-creadas que en realidad son marcas */
export declare function pruneMerchantCategories(): string[];
