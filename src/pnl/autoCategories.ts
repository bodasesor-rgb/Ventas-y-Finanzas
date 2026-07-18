import { randomUUID } from "crypto";
import { colorForCategoryId } from "./categoryColors";
import {
  loadCategories,
  loadRules,
  saveCategories,
  saveRules,
  slugCategory,
} from "./store";
import type { BankLine, CategoryDef, RecurringRule } from "./types";

const STOP = new Set([
  "compra",
  "pago",
  "pagos",
  "cargo",
  "abono",
  "spei",
  "transferencia",
  "traspaso",
  "deposito",
  "depósito",
  "recibido",
  "enviado",
  "mexico",
  "méxico",
  "mx",
  "cdmx",
  "tarjeta",
  "debito",
  "débito",
  "credito",
  "crédito",
  "pos",
  "atm",
  "banamex",
  "banco",
  "comision",
  "comisión",
  "iva",
  "ref",
  "folio",
  "autorizacion",
  "autorización",
  "a",
  "de",
  "del",
  "la",
  "el",
  "en",
  "por",
  "con",
  "favor",
  "beneficiario",
  "nombre",
  "cuenta",
  "clabe",
  "efectivo",
  "retiro",
  "dublin",
  "paris",
  "foster",
  "city",
  "francisco",
  "powered",
  "digital",
  "goods",
  "inc",
]);

/**
 * Comercio / marca → categoría AMPLIA (no crear categoría por marca).
 * Netlify/Ebanx/OpenAI → apps (match/etiqueta en reglas).
 */
const MERCHANT_CATEGORY: Record<string, string> = {
  netlify: "apps",
  openai: "apps",
  cursor: "apps",
  replit: "apps",
  ebanx: "apps",
  shopify: "apps",
  gamma: "apps",
  anthropic: "apps",
  claude: "apps",
  sendinblue: "apps",
  brevo: "apps",
  notion: "apps",
  figma: "apps",
  vercel: "apps",
  github: "apps",
  facebk: "ads",
  facebook: "ads",
  meta: "ads",
  google: "ads",
  payu: "ads",
  ads: "ads",
  pass: "pass",
  pase: "pass",
  telcel: "servicios",
  cfe: "servicios",
  uber: "servicios",
  didi: "servicios",
};

/** Categorías que SÍ son válidas; el resto de “auto merchant” se remapea */
const BROAD_CATS = new Set([
  "ads",
  "apps",
  "pass",
  "nomina",
  "proveedor",
  "socio",
  "renta",
  "servicios",
  "comisiones",
  "impuestos",
  "evento",
  "pago",
  "transferencia_persona",
  "ingreso",
  "venta",
  "otro",
  "revisar",
]);

export function extractMerchantLabel(description: string): string | null {
  let s = String(description || "")
    .replace(/\*/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  const tokens = s
    .split(" ")
    .map((t) => t.trim())
    .filter(
      (t) => t.length >= 3 && !STOP.has(t.toLowerCase()) && !/^\d+$/.test(t)
    );

  if (!tokens.length) return null;

  const upper = s.toUpperCase();
  const afterPago = upper.match(
    /\b(?:COMPRA|PAGO|CARGO|ABONO)\s+([A-ZÁÉÍÓÚÑ0-9]{3,}(?:\s+[A-ZÁÉÍÓÚÑ0-9]{3,}){0,2})/
  );
  if (afterPago) {
    const chunk = afterPago[1]
      .split(/\s+/)
      .filter((t) => !STOP.has(t.toLowerCase()) && t.length >= 3)
      .slice(0, 2)
      .join(" ");
    if (chunk) return titleCase(chunk.slice(0, 40));
  }

  return titleCase(tokens.slice(0, 2).join(" ").slice(0, 40));
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function ensureBroadCategory(id: string, label: string, kind: CategoryDef["kind"]): void {
  const cats = loadCategories();
  if (cats.some((c) => c.id === id)) return;
  cats.push({
    id,
    label,
    kind,
    color: colorForCategoryId(id, cats.length),
    builtin: true,
  });
  saveCategories(cats);
}

function ensureRule(match: string, categoryId: string, label: string): string {
  const rules = loadRules();
  const m = match.toLowerCase();
  const existing = rules.find((r) => r.match === m);
  if (existing) {
    if (existing.category !== categoryId && !BROAD_CATS.has(existing.category)) {
      existing.category = categoryId;
      saveRules(rules);
    }
    return existing.id;
  }
  const rule: RecurringRule = {
    id: `auto-${randomUUID().slice(0, 8)}`,
    match: m,
    category: categoryId,
    label,
    frecuente: true,
    notes: "Match automático (comercio → categoría amplia)",
  };
  rules.push(rule);
  saveRules(rules);
  return rule.id;
}

function guessBroadCategory(description: string, merchant: string | null): string {
  const desc = description.toLowerCase();
  const token = (merchant || "").split(/\s+/)[0].toLowerCase();

  if (MERCHANT_CATEGORY[token]) return MERCHANT_CATEGORY[token];
  for (const [k, cat] of Object.entries(MERCHANT_CATEGORY)) {
    if (desc.includes(k)) return cat;
  }

  // Heurística apps / software
  if (
    /\b(dublin|san francisco|digital goods|ai powered|software|saas|app)\b/i.test(
      description
    )
  ) {
    return "apps";
  }
  if (/\b(facebk|facebook|meta|google|ads)\b/i.test(desc)) return "ads";
  if (/\b(comisi[oó]n|iva comisi)\b/i.test(desc)) return "comisiones";
  // Los traspasos con beneficiario los reclasifica applyCounterpartyCategories
  if (/\b(pago interbancario|traspaso|beneficiario)\b/i.test(desc)) {
    return "transferencia_persona";
  }
  if (/\bpago\b/i.test(desc)) return "pago";
  return "revisar";
}

function remapNarrowCategory(categoryId: string): string {
  if (BROAD_CATS.has(categoryId)) return categoryId;
  // Categorías viejas auto-creadas tipo "netlify_san" → apps
  const base = categoryId.split("_")[0].toLowerCase();
  if (MERCHANT_CATEGORY[base]) return MERCHANT_CATEGORY[base];
  if (
    /netlify|openai|cursor|replit|ebanx|shopify|gamma|anthropic|sendin|brevo|vercel|github|figma|notion/i.test(
      categoryId
    )
  ) {
    return "apps";
  }
  if (/facebk|facebook|meta|google|payu/i.test(categoryId)) return "ads";
  return "revisar";
}

/**
 * NO crea categoría por comercio.
 * Crea/actualiza REGLAS (match + etiqueta) apuntando a categoría amplia (apps, ads…).
 */
export function autoCreateCategoriesFromLines(lines: BankLine[]): {
  lines: BankLine[];
  created: string[];
  rulesCreated: string[];
} {
  ensureBroadCategory("apps", "Apps / software", "gasto");
  ensureBroadCategory("pago", "Pago", "gasto");

  const cats = loadCategories();
  let dirty = false;
  cats.forEach((c, i) => {
    if (!c.color) {
      c.color = colorForCategoryId(c.id, i);
      dirty = true;
    }
  });
  if (dirty) saveCategories(cats);

  // Añadir defaults de apps si faltan reglas conocidas
  for (const [match, cat] of Object.entries(MERCHANT_CATEGORY)) {
    ensureRule(match, cat, titleCase(match));
  }

  const created: string[] = []; // ya no creamos categorías merchant
  const rulesCreated: string[] = [];

  const out = lines.map((line) => {
    if (line.direction === "abono" && line.amount > 0) {
      return {
        ...line,
        category: line.category === "venta" ? "venta" : "ingreso",
        needsReview: false,
      };
    }

    if (line.direction === "cargo" && line.amount > 0) {
      line = { ...line, amount: -Math.abs(line.amount) };
    }

    // Remapear categorías estrechas viejas (netlify, ebanx…)
    let category = remapNarrowCategory(line.category || "revisar");

    if (category !== "revisar" && BROAD_CATS.has(category) && line.matchedRuleId) {
      return { ...line, category };
    }

    const merchant = extractMerchantLabel(line.description);
    const broad = guessBroadCategory(line.description, merchant);
    category = broad;

    if (merchant) {
      const matchToken = merchant.split(/\s+/)[0].toLowerCase();
      const genericMatch =
        /^(instrucciones|interbancario|terceros|penalizacion|aut|para|suc|ref|mismo|dia|transferencia)$/i;
      if (
        matchToken.length >= 4 &&
        !STOP.has(matchToken) &&
        !genericMatch.test(matchToken)
      ) {
        const label = titleCase(matchToken); // "Netlify", no "Netlify San"
        const ruleId = ensureRule(matchToken, broad, label);
        if (!rulesCreated.includes(label)) rulesCreated.push(label);
        return {
          ...line,
          category: broad,
          matchedRuleId: line.matchedRuleId || ruleId,
          needsReview: broad === "revisar" || Math.abs(line.amount) >= 20_000,
        };
      }
    }

    return {
      ...line,
      category,
      needsReview: category === "revisar" || Math.abs(line.amount) >= 20_000,
    };
  });

  return { lines: out, created, rulesCreated };
}

/** Limpia del catálogo categorías auto-creadas que en realidad son marcas */
export function pruneMerchantCategories(): string[] {
  const cats = loadCategories();
  const removed: string[] = [];
  const cleaned = cats.filter((c) => {
    if (BROAD_CATS.has(c.id) || c.builtin) return true;
    if (c.autoCreated) {
      removed.push(c.id);
      return false;
    }
    // Marca colada como categoría (netlify, ebanx…)
    const base = c.id.split("_")[0].toLowerCase();
    if (MERCHANT_CATEGORY[base]) {
      removed.push(c.id);
      return false;
    }
    return true;
  });
  if (cleaned.length !== cats.length) saveCategories(cleaned);
  return [...new Set(removed)];
}
