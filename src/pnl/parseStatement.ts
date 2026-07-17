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

const NEXT_TX_KEYWORDS =
  "(?:PAGO RECIBIDO|PAGO INTERBANCARIO|PAGO A TERCEROS|ABONO X DEV|DEP[OÓ]SITO |COMISI[OÓ]N |IVA COMISI|COMPRA |CARGO |RETIRO |TRASPASO |PAYU|FACEBK|META |SHOPIFY|EBANX|CURSOR|REPLIT|NETLIFY|OPENAI|GAMMA|SENDINBLUE|LKL\\*|GOOGLE|DIS\\.EFE|PROMOCI[OÓ]N|ANTHROPIC)";

export async function parsePdfToLines(
  buffer: Buffer,
  rules: RecurringRule[]
): Promise<{ text: string; lines: BankLine[] }> {
  const result = await pdf(buffer);
  const text = result.text || "";
  const lines = extractLinesFromText(text, rules);
  return { text, lines };
}

/** Solo el detalle de operaciones en pesos; corta AHORRO FACIL / intereses. */
function isolateDetailSection(text: string): string {
  const start = text.search(/Detalle de Operaciones/i);
  if (start < 0) return text;
  let chunk = text.slice(start);
  const ahorro = chunk.search(/\nAHORRO FACIL\b/i);
  if (ahorro > 0) chunk = chunk.slice(0, ahorro);
  // Evitar tablas de intereses de inversión al final
  const interesesBlock = chunk.search(
    /\n\d{2}[A-Z]{3}SALDO ANTERIOR\s+0\.00|\n\d{2}[A-Z]{3}INTERESES AL\b/i
  );
  if (interesesBlock > 200) chunk = chunk.slice(0, interesesBlock);
  return chunk;
}

function stripPageNoise(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/LUIS ALEJANDRO SANCHEZ CAMPBELL/gi, "\n")
    .replace(/P[aá]gina\s+\d+\s+de\s+\d+/gi, "\n")
    .replace(/Estado de Cuenta/gi, "\n")
    .replace(/Cuenta Priority/gi, "\n")
    .replace(/000181\.B13INDL0\d+\.AR\.\d+\.\d+/gi, "\n")
    .replace(/Detalle de Operaciones[^\n]*/gi, "\n")
    .replace(/FECHACONCEPTORETIROSDEP[ÓO]SITOSSALDO/gi, "\n")
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
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Extrae montos; soporta saldo negativo Banamex escrito como "329.95-".
 * Orden: quitar T.C./POS → separar montos pegados → aplicar signo −.
 */
export function collectMoney(s: string): number[] {
  let t = s
    .replace(/900[01]\/001\d(?=\d{1,3}(?:,\d{3})*\.\d{2})/gi, " ")
    .replace(/\b20\d{6}\b/g, " ")
    .replace(/U\.S\.\s*Dollar\s*T\.C\.\s*\d+\.\d{4,6}/gi, " ")
    .replace(/Mexican Peso T\.C\.[^\d]*/gi, " ")
    .replace(/T\.C\.1\s*\.\d+/gi, " ")
    .replace(/T\.C\.\s*\d+\.\d{4,6}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  t = t.replace(/(\d{1,3}(?:,\d{3})*\.\d{2})(?=\d)/g, "$1 ");
  t = t.replace(/((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})-/g, " -$1 ");

  const out: number[] = [];
  const re = /-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const n = parseMoneyToken(m[0]);
    if (n != null) out.push(n);
  }
  return out;
}

/**
 * Banamex pega código POS + dígito basura + monto:
 *   9000/00126,000.00  →  6,000.00
 */
function stripBanamexPosJunk(body: string): string {
  return body.replace(
    /900[01]\/001\d(?=\d{1,3}(?:,\d{3})*\.\d{2})/gi,
    " "
  );
}

function softClean(body: string): string {
  return stripBanamexPosJunk(body)
    .replace(/\b20\d{6}\b/g, " ")
    .replace(/(\d{10,})(\d,\d{3}\.\d{2})/g, " $2 ")
    .replace(/\b\d{12,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae movimiento + saldo (legado / debug).
 * El parser principal usa cadena de saldos.
 */
export function extractMoveAndSaldo(body: string): {
  move: number;
  saldo: number | null;
  suspicious: boolean;
} | null {
  const original = body.replace(/\s+/g, " ").trim();

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

  const nums = collectMoney(original);
  if (nums.length >= 2) {
    const move = Math.abs(nums[nums.length - 2]);
    const saldo = nums[nums.length - 1];
    return {
      move,
      saldo,
      suspicious: move > 150_000,
    };
  }
  if (nums.length === 1) {
    return { move: Math.abs(nums[0]), saldo: null, suspicious: true };
  }
  return null;
}

export function detectDirection(desc: string): BankLine["direction"] {
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
    /^DEPOSITO CANALES\b/i.test(head) ||
    /^PROMOCI[OÓ]N\b/i.test(head)
  ) {
    return "abono";
  }

  if (
    /^(RETIRO|COMISI[OÓ]N|IVA |CARGO|COMPRA|TRASPASO|PAYU|FACEBK|META|SHOPIFY|EBANX|CURSOR|REPLIT|SENDINBLUE|GOOGLE|NETLIFY|OPENAI|GAMMA|LKL|DIS\.EFE|ANTHROPIC)/i.test(
      head
    )
  ) {
    return "cargo";
  }

  return "cargo";
}

/** Parte bloques pegados sin comerse el "-" de saldo negativo. */
function splitMergedBodies(rawBody: string): string[] {
  const re = new RegExp(
    `(?<=\\d\\.\\d{2}-)\\s*(?=${NEXT_TX_KEYWORDS})|(?<=\\d\\.\\d{2})\\s+(?=${NEXT_TX_KEYWORDS})`,
    "i"
  );
  return rawBody
    .split(re)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);
}

function cleanDescription(body: string): string {
  let desc = softClean(body);
  desc = desc
    .replace(/U\.S\.\s*Dollar\s*T\.C\.\s*\d+\.\d{4,6}/gi, " ")
    .replace(/Mexican Peso T\.C\.[^\d]*/gi, " ")
    .replace(/T\.C\.1\s*\.\d+/gi, " ")
    .replace(/-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g, " ")
    .replace(/(?<![\d,.])\b\d{6,8}\b(?![\d,.])/g, " ")
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return desc.slice(0, 220);
}

function monthToken(mon: string): string {
  const ent = Object.entries(MONTH_NUM).find(([, v]) => v === mon);
  return (ent?.[0] || mon).toUpperCase();
}

interface RawRow {
  date: string;
  day: string;
  mon: string;
  body: string;
  desc: string;
  printedMove: number | null;
  saldo: number | null;
  skipTx?: boolean;
}

/**
 * Parser Banamex por cadena de saldos:
 * monto = Δsaldo (fuente de verdad). Así Depósitos/Retiros cuadran con el PDF.
 */
function extractBanamex(text: string, rules: RecurringRule[]): BankLine[] {
  const detail = isolateDetailSection(text);
  const cleaned = mergeUsdContinuations(stripPageNoise(detail));
  const out: BankLine[] = [];

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

  const rows: RawRow[] = [];
  let openingSaldo: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const end = i + 1 < tokens.length ? tokens[i + 1].start : cleaned.length;
    const rawBody = cleaned.slice(tok.bodyStart, end).replace(/\s+/g, " ").trim();
    if (!rawBody) continue;

    if (/^SALDO ANTERIOR/i.test(rawBody)) {
      const nums = collectMoney(rawBody);
      if (nums.length) openingSaldo = nums[nums.length - 1];
      continue;
    }

    // Basura de tablas de intereses / resumen
    if (/^INTERESES AL/i.test(rawBody)) continue;
    if (
      /^(Resumen|Saldo promedio|Dep[oó]sitos|Otros cargos|Inter[eé]s Aplicable|AHORRO )/i.test(
        rawBody
      )
    ) {
      continue;
    }

    // Exención informativa: actualiza saldo, no cuenta como movimiento
    if (/^EXENCION COBRO/i.test(rawBody)) {
      const nums = collectMoney(rawBody);
      if (nums.length) {
        rows.push({
          date: `${tok.day}/${tok.mon}`,
          day: tok.day,
          mon: tok.mon,
          body: rawBody,
          desc: "EXENCION COBRO COMISION",
          printedMove: null,
          saldo: nums[nums.length - 1],
          skipTx: true,
        });
      }
      continue;
    }

    // Comisión: "PERIODO MAY01 AL MAY29500.003,169.72"
    const periodo = rawBody.match(
      /PERIODO\s+[A-ZÁÉÍÓÚ]{3}\d{0,2}\s+AL\s+[A-ZÁÉÍÓÚ]{3}(\d{2})(\d[\d,]*\.\d{2})\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i
    );
    if (periodo && /COMISI/i.test(rawBody)) {
      rows.push({
        date: `${tok.day}/${tok.mon}`,
        day: tok.day,
        mon: tok.mon,
        body: rawBody,
        desc: cleanDescription(rawBody),
        printedMove: parseMoneyToken(periodo[2]),
        saldo: parseMoneyToken(periodo[3]),
      });
      continue;
    }

    for (const body of splitMergedBodies(rawBody)) {
      if (/^SALDO ANTERIOR/i.test(body)) continue;

      const nums = collectMoney(body);
      let printedMove: number | null = null;
      let saldo: number | null = null;
      if (nums.length >= 2) {
        printedMove = nums[nums.length - 2];
        saldo = nums[nums.length - 1];
      } else if (nums.length === 1) {
        saldo = nums[0];
      }

      const desc = cleanDescription(body);
      if (desc.length < 3) continue;
      if (/^PAGO RECIBIDO DE SU REF\.?/i.test(desc.trim()) && desc.length < 40) {
        // Puede ser abono real corto; no filtrar si hay saldo
        if (saldo == null) continue;
      }

      rows.push({
        date: `${tok.day}/${tok.mon}`,
        day: tok.day,
        mon: tok.mon,
        body,
        desc,
        printedMove,
        saldo,
      });
    }
  }

  let prevSaldo = openingSaldo;
  if (prevSaldo == null) {
    // Fallback: primer saldo de fila si no hubo SALDO ANTERIOR
    const first = rows.find((r) => r.saldo != null);
    if (first?.saldo != null && first.printedMove != null) {
      prevSaldo = Math.round((first.saldo + Math.abs(first.printedMove)) * 100) / 100;
    }
  }

  for (const row of rows) {
    if (row.saldo == null) continue;

    if (prevSaldo == null) {
      prevSaldo = row.saldo;
      continue;
    }

    if (row.skipTx) {
      prevSaldo = row.saldo;
      continue;
    }

    const delta = Math.round((row.saldo - prevSaldo) * 100) / 100;
    prevSaldo = row.saldo;

    if (Math.abs(delta) < 0.005) continue;

    const amount = Math.abs(delta);
    const direction: BankLine["direction"] = delta > 0 ? "abono" : "cargo";
    const signed = direction === "abono" ? amount : -amount;

    // Impreso vs Δ: si no cuadra, el Δ manda (folios/POS pegados)
    const printedAbs =
      row.printedMove == null ? null : Math.abs(row.printedMove);
    const printedMismatch =
      printedAbs != null && Math.abs(printedAbs - amount) > 0.05;

    const desc = row.desc;
    // No dedupe por monto+fecha: Banamex repite cargos idénticos (ej. 2× STP $1,000)

    const cat = categorizeLine(desc, signed, direction, rules);
    const suspicious =
      printedMismatch ||
      amount > 150_000 ||
      (direction === "abono" &&
        !/^(PAGO RECIBIDO|ABONO|DEP[OÓ]SITO|PROMOCI[OÓ]N)/i.test(desc.trim()));

    out.push({
      id: randomUUID(),
      raw: `${row.day}${monthToken(row.mon)} ${row.body.slice(0, 160)}`,
      date: row.date,
      description: desc,
      amount: Math.round(signed * 100) / 100,
      direction,
      category: cat.category,
      matchedRuleId: cat.matchedRuleId,
      needsReview: Boolean(cat.needsReview || suspicious),
    });
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
