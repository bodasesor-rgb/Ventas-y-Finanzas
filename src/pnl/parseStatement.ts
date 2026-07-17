import pdf from "pdf-parse";
import { categorizeLine } from "./categorize";
import type { BankLine, RecurringRule } from "./types";
import { randomUUID } from "crypto";

const MONTH_RE = "ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC";
const MONTH_NUM: Record<string, string> = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dic: "12",
};

export async function parsePdfToLines(
  buffer: Buffer,
  rules: RecurringRule[]
): Promise<{ text: string; lines: BankLine[] }> {
  const result = await pdf(buffer);
  const text = result.text || "";
  const lines = extractLinesFromText(text, rules);
  return { text, lines };
}

function stripPageNoise(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/LUIS ALEJANDRO SANCHEZ CAMPBELL/gi, "\n")
    .replace(/P[aá]gina\s+\d+\s+de\s+\d+/gi, "\n")
    .replace(/Estado de Cuenta/gi, "\n")
    .replace(/Cuenta Priority/gi, "\n")
    .replace(/000181\.B13INDL010\.AR\.\d+\.\d+/gi, "\n")
    .replace(/Detalle de Operaciones[^\n]*/gi, "\n")
    .replace(/FECHACONCEPTORETIROSDEP[ÓO]SITOSSALDO/gi, "\n")
    // Solo el bloque de teléfonos VIP (NO borrar la continuación del movimiento)
    .replace(/Centro de Atenci[oó]n VIP\n?/gi, "\n")
    .replace(/Ciudad de M[eé]xico:\s*[\d ]+/gi, "\n")
    .replace(/Otra ciudad, sin costo:\s*[\d ]+/gi, "\n")
    .replace(/E\.U\.A\.\s*o\s*Canad[aá]:\s*[\d ]+/gi, "\n")
    .replace(/Otro pa[ií]s por cobrar a E\.U\.A\.:\s*[^\n]+/gi, "\n")
    .replace(/Suc\.\s*\d+[^\n]*/gi, "\n")
    .replace(/CAMINO A SANTA TERESA[^\n]*/gi, "\n")
    .replace(/FUENTES DEL PEDREGAL[^\n]*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Une continuaciones Banamex tras salto de página:
 * el monto MXN de USD a veces queda en líneas "20260603 U.S. Dollar T.C. ..."
 * sin nuevo DDMMM.
 */
function mergeUsdContinuations(text: string): string {
  return text.replace(
    /\n(?=20\d{6}\s+U\.S\.\s*Dollar\s*T\.C\.)/gi,
    " "
  );
}

function parseMoneyToken(tok: string): number | null {
  const n = Number(String(tok).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function collectMoney(s: string): number[] {
  const normalized = s.replace(
    /(\d{1,3}(?:,\d{3})*\.\d{2})(?=\d)/g,
    "$1 "
  );
  const out: number[] = [];
  const re = /(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const n = parseMoneyToken(m[0]);
    if (n != null && n <= 2_000_000) out.push(n);
  }
  return out;
}

/**
 * Banamex pega código POS + dígito basura + monto:
 *   9000/00126,000.00  →  6,000.00   (el "2" sobra)
 *   9001/0011500.00    →  500.00     (el "1" sobra)
 *   9000/0012389.76    →  389.76
 */
function stripBanamexPosJunk(body: string): string {
  return body.replace(
    /900[01]\/001\d(?=\d{1,3}(?:,\d{3})*\.\d{2})/gi,
    " "
  );
}

/** Limpieza suave: NO romper el tipo de cambio ni montos */
function softClean(body: string): string {
  return stripBanamexPosJunk(body)
    .replace(/\b20\d{6}\b/g, " ")
    // Folio Banamex + monto: …000002,200.00 → 2,200.00
    .replace(/(\d{10,})(\d,\d{3}\.\d{2})/g, " $2 ")
    .replace(/\b\d{12,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae movimiento + saldo.
 * Prioridad: cola USD/T.C. → par final de montos MXN.
 */
export function extractMoveAndSaldo(body: string): {
  move: number;
  saldo: number | null;
  suspicious: boolean;
} | null {
  const original = body.replace(/\s+/g, " ").trim();

  // 0) Comisión Banamex: "PERIODO MAY01 AL MAY29500.003,169.72"
  //    → día 29 + monto 500.00 + saldo 3,169.72
  const periodo = original.match(
    /PERIODO\s+[A-ZÁÉÍÓÚ]{3}\d{0,2}\s+AL\s+[A-ZÁÉÍÓÚ]{3}(\d{2})(\d[\d,]*\.\d{2})\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i
  );
  if (periodo) {
    const move = parseMoneyToken(periodo[2]);
    const saldo = parseMoneyToken(periodo[3]);
    if (move != null) {
      return { move, saldo, suspicious: false };
    }
  }

  // 1) USD con T.C. (montos MXN pegados al tipo de cambio)
  const tc = original.match(
    /U\.S\.\s*Dollar\s*T\.C\.\s*(\d+\.\d{4,6})(.*)$/i
  );
  if (tc) {
    const afterTc = softClean(tc[2] || "");
    const nums = collectMoney(afterTc);
    if (nums.length >= 2) {
      return {
        move: nums[nums.length - 2],
        saldo: nums[nums.length - 1],
        suspicious: nums[nums.length - 2] > 150_000,
      };
    }
    if (nums.length === 1) {
      return { move: nums[0], saldo: null, suspicious: true };
    }
  }

  // 2) MXN normal — primer par monto+saldo (evita comerse el siguiente movimiento)
  let s = softClean(original);
  s = s
    .replace(/U\.S\.\s*Dollar\s*T\.C\.\s*\d+\.\d{4,6}/gi, " ")
    .replace(/\bT\.C\.\s*\d+\.\d{4,6}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  s = s.replace(/(?<![\d,.])\b\d{6,8}\b(?![\d,.])/g, " ").replace(/\s+/g, " ");

  // Cortar basura de otras secciones del PDF
  s = s.split(/\bAHORRO FACIL\b/i)[0];
  s = s.split(/\bPeriododel\b/i)[0];
  s = s.split(/\bGAT Nominal\b/i)[0];

  const normalized = s.replace(
    /(\d{1,3}(?:,\d{3})*\.\d{2})(?=\d)/g,
    "$1 "
  );
  const pair = normalized.match(
    /((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s+((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/
  );
  if (pair) {
    const move = parseMoneyToken(pair[1]);
    const saldo = parseMoneyToken(pair[2]);
    if (move != null) {
      return {
        move,
        saldo,
        suspicious: move > 150_000 || (saldo != null && move > saldo * 10),
      };
    }
  }

  const nums = collectMoney(normalized);
  if (!nums.length) return null;
  return {
    move: nums[0],
    saldo: nums.length > 1 ? nums[1] : null,
    suspicious: nums[0] > 100_000,
  };
}

export function detectDirection(desc: string): BankLine["direction"] {
  // Solo el inicio: el PDF a veces pega el siguiente movimiento en el mismo bloque
  const d = desc.replace(/\s+/g, " ").trim();
  const head = d.slice(0, 120);

  if (/^PAGO INTERBANCARIO A\b/i.test(head) || /^PAGO A TERCEROS\b/i.test(head)) {
    return "cargo";
  }

  if (
    /^PAGO RECIBIDO\b/i.test(head) ||
    /^SPEI RECIBIDO\b/i.test(head) ||
    /^ABONO\b/i.test(head) ||
    /^DEP[OÓ]SITO\b/i.test(head) ||
    /^DEPOSITO CANALES\b/i.test(head)
  ) {
    return "abono";
  }

  if (
    /^(RETIRO|COMISI[OÓ]N|IVA |CARGO|COMPRA|TRASPASO|PROMOCION|PAYU|FACEBK|META|SHOPIFY|EBANX|CURSOR|REPLIT|SENDINBLUE|GOOGLE|NETLIFY|OPENAI|GAMMA|LKL)/i.test(
      head
    )
  ) {
    return "cargo";
  }

  return "cargo";
}

/** Parte bloques pegados: "...329.95 PAGO RECIBIDO DE..." */
function splitMergedBodies(rawBody: string): string[] {
  const parts = rawBody.split(
    /(?<=\d\.\d{2})\s*-?\s*(?=(?:PAGO RECIBIDO|PAGO INTERBANCARIO|PAGO A TERCEROS|ABONO X DEV|DEP[OÓ]SITO |COMISI[OÓ]N |IVA COMISI|COMPRA |CARGO |RETIRO |TRASPASO |PAYU|FACEBK|META |SHOPIFY|EBANX|CURSOR|REPLIT|NETLIFY|OPENAI|GAMMA|SENDINBLUE|LKL\*|GOOGLE))/i
  );
  return parts.map((p) => p.trim()).filter((p) => p.length > 3);
}

function cleanDescription(body: string): string {
  let desc = softClean(body);
  desc = desc
    .replace(/U\.S\.\s*Dollar\s*T\.C\.\s*\d+\.\d{4,6}/gi, " ")
    .replace(/(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g, " ")
    .replace(/(?<![\d,.])\b\d{6,8}\b(?![\d,.])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return desc.slice(0, 220);
}

function monthToken(mon: string): string {
  const ent = Object.entries(MONTH_NUM).find(([, v]) => v === mon);
  return (ent?.[0] || mon).toUpperCase();
}

function extractBanamex(text: string, rules: RecurringRule[]): BankLine[] {
  const cleaned = mergeUsdContinuations(stripPageNoise(text));
  const out: BankLine[] = [];
  const seen = new Set<string>();

  const tokens: { day: string; mon: string; bodyStart: number; start: number }[] =
    [];
  const re = new RegExp(`(\\d{1,2})(${MONTH_RE})`, "gi");
  let tm: RegExpExecArray | null;
  while ((tm = re.exec(cleaned)) !== null) {
    tokens.push({
      day: tm[1].padStart(2, "0"),
      mon: MONTH_NUM[tm[2].toLowerCase()] || tm[2],
      start: tm.index,
      bodyStart: tm.index + tm[0].length,
    });
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const end = i + 1 < tokens.length ? tokens[i + 1].start : cleaned.length;
    const rawBody = cleaned.slice(tok.bodyStart, end).replace(/\s+/g, " ").trim();
    if (!rawBody) continue;
    if (/^SALDO ANTERIOR/i.test(rawBody)) continue;

    const bodies = splitMergedBodies(rawBody);
    for (const body of bodies) {
      if (/^SALDO ANTERIOR/i.test(body)) continue;
      if (/PROMOCI[OÓ]N\s+COMPRAS\s+EXTRANJERO/i.test(body)) continue;

      const money = extractMoveAndSaldo(body);
      if (!money) continue;

      const desc = cleanDescription(body);
      if (desc.length < 3) continue;
      if (
        /^(Resumen|Saldo promedio|Dep[oó]sitos|Otros cargos|Inter[eé]s Aplicable|PERIODO |AHORRO )/i.test(
          desc
        )
      ) {
        continue;
      }
      // Basura de PDF: "PAGO RECIBIDO DE SU REF." sin ordenante real
      if (/^PAGO RECIBIDO DE SU REF\.?/i.test(desc.trim()) && desc.length < 40) {
        continue;
      }

      const move = money.move;
      const direction = detectDirection(desc);
      const signed =
        direction === "abono" ? Math.abs(move) : -Math.abs(move);
      const suspicious =
        money.suspicious ||
        Math.abs(signed) > 150_000 ||
        (direction === "abono" &&
          !/^(PAGO RECIBIDO|ABONO|DEP[OÓ]SITO)/i.test(desc.trim()));

      const date = `${tok.day}/${tok.mon}`;
      const key = `${date}|${desc.slice(0, 40)}|${signed.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cat = categorizeLine(desc, signed, direction, rules);
      out.push({
        id: randomUUID(),
        raw: `${tok.day}${monthToken(tok.mon)} ${body.slice(0, 160)}`,
        date,
        description: desc,
        amount: Math.round(signed * 100) / 100,
        direction,
        category: cat.category,
        matchedRuleId: cat.matchedRuleId,
        needsReview: Boolean(cat.needsReview || suspicious),
      });
    }
  }

  return out;
}

export function extractLinesFromText(
  text: string,
  rules: RecurringRule[]
): BankLine[] {
  const banamexHits = (
    text.match(new RegExp(`\\d{1,2}(?:${MONTH_RE})`, "gi")) || []
  ).length;
  if (banamexHits >= 5) {
    const lines = extractBanamex(text, rules);
    if (lines.length > 0) return lines;
  }
  return extractGeneric(text, rules);
}

function extractGeneric(text: string, rules: RecurringRule[]): BankLine[] {
  const out: BankLine[] = [];
  const seen = new Set<string>();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 5);
  const re =
    /^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+(-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/;

  for (const raw of lines) {
    const m = raw.match(re);
    if (!m) continue;
    const amount = Number(m[3].replace(/[$,]/g, ""));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const desc = m[2].trim();
    const key = `${m[1]}|${desc}|${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const direction = detectDirection(desc);
    const signed =
      direction === "abono" ? Math.abs(amount) : -Math.abs(amount);
    const cat = categorizeLine(desc, signed, direction, rules);
    out.push({
      id: randomUUID(),
      raw,
      date: m[1],
      description: desc,
      amount: signed,
      direction,
      category: cat.category,
      matchedRuleId: cat.matchedRuleId,
      needsReview: cat.needsReview,
    });
  }
  return out;
}

export function summarizeByCategory(lines: BankLine[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const line of lines) {
    summary[line.category] = (summary[line.category] || 0) + line.amount;
  }
  return summary;
}

export function summarizeTotals(lines: BankLine[]): {
  ingresos: number;
  gastos: number;
  neto: number;
} {
  let ingresos = 0;
  let gastos = 0;
  for (const line of lines) {
    if (line.amount >= 0) ingresos += line.amount;
    else gastos += line.amount;
  }
  return {
    ingresos: Math.round(ingresos * 100) / 100,
    gastos: Math.round(gastos * 100) / 100,
    neto: Math.round((ingresos + gastos) * 100) / 100,
  };
}
