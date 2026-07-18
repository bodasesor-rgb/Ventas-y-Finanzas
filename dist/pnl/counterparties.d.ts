import type { BankLine } from "./types";
/** Socios — solo estos dos; el resto de traspasos con beneficiario = proveedor */
export declare const PARTNER_NAMES: readonly ["Luis Alejandro Sanchez Campbell", "Alejandro Zorrilla Elorza"];
export type CounterpartyKind = "socio" | "proveedor";
export interface CounterpartyHit {
    name: string;
    kind: CounterpartyKind;
    category: "socio" | "proveedor";
}
/** Normaliza nombre Banamex: "LUIS ALEJANDRO,SANCHEZ/CAMPBELL" → "luis alejandro sanchez campbell" */
export declare function normalizePersonKey(raw: string): string;
export declare function matchPartner(nameOrDesc: string): string | null;
/**
 * Extrae beneficiario de cargos SPEI / interbancario / terceros.
 * Ej: "AL BENEF. LUIS ALEJANDRO,SANCHEZ/CAMPBELL (DATO…"
 */
export declare function extractBeneficiary(description: string): string | null;
export declare function looksLikeOutboundTransfer(description: string): boolean;
export declare function classifyCounterparty(description: string): CounterpartyHit | null;
/** Reescribe categoría de cargos: socios vs proveedores (resto de traspasos). */
export declare function applyCounterpartyCategories(lines: BankLine[]): BankLine[];
