/** Si otro deal ya subió la misma huella → dealId existente; si no, null. */
export declare function findDuplicateDealId(fingerprint: string, dealId: string): string | null;
export declare function rememberFingerprint(fingerprint: string, dealId: string): void;
export declare function getFingerprintStoreStatus(): {
    count: number;
    updatedAt: string | null;
};
