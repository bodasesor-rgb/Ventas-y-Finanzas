import fs from "fs";
import path from "path";

const STORE_PATH = path.join(process.cwd(), "data", "ventas-fingerprints.json");

interface FingerprintStore {
  /** fingerprint → dealId que ya tiene esa fila */
  byFingerprint: Record<string, string>;
  updatedAt: string | null;
}

let memory: FingerprintStore = { byFingerprint: {}, updatedAt: null };
let hydrated = false;

function load_(): FingerprintStore {
  if (hydrated) return memory;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(
        fs.readFileSync(STORE_PATH, "utf8")
      ) as FingerprintStore;
      memory = {
        byFingerprint: raw.byFingerprint || {},
        updatedAt: raw.updatedAt || null,
      };
    }
  } catch (err) {
    console.warn("[ventas-fp] no se pudo leer store", err);
  }
  hydrated = true;
  return memory;
}

function save_(): void {
  try {
    hydrated = true;
    memory.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(memory, null, 2));
  } catch (err) {
    console.warn("[ventas-fp] no se pudo guardar store", err);
  }
}

/** Si otro deal ya subió la misma huella → dealId existente; si no, null. */
export function findDuplicateDealId(
  fingerprint: string,
  dealId: string
): string | null {
  if (!fingerprint || fingerprint === "||||") return null;
  load_();
  const prev = memory.byFingerprint[fingerprint];
  if (prev && prev !== dealId) return prev;
  return null;
}

export function rememberFingerprint(
  fingerprint: string,
  dealId: string
): void {
  if (!fingerprint || fingerprint === "||||" || !dealId) return;
  load_();
  memory.byFingerprint[fingerprint] = dealId;
  save_();
}

export function getFingerprintStoreStatus(): {
  count: number;
  updatedAt: string | null;
} {
  load_();
  return {
    count: Object.keys(memory.byFingerprint).length,
    updatedAt: memory.updatedAt,
  };
}
