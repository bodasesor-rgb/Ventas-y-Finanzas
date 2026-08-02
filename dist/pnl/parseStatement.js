"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePdfToLines = parsePdfToLines;
exports.unglueMoneyText = unglueMoneyText;
exports.collectMoney = collectMoney;
exports.moneyTypoVariants = moneyTypoVariants;
exports.extractMoveAndSaldo = extractMoveAndSaldo;
exports.detectDirection = detectDirection;
exports.extractLinesFromText = extractLinesFromText;
exports.summarizeByCategory = summarizeByCategory;
exports.summarizeTotals = summarizeTotals;
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const categorize_1 = require("./categorize");
const crypto_1 = require("crypto");
const MONTH_RE = "ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC";
const MONTH_NUM = {
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
const NEXT_TX_KEYWORDS = "(?:PAGO RECIBIDO|PAGO INTERBANCARIO|PAGO A TERCEROS|ABONO X DEV|DEP[OÓ]SITO |COMISI[OÓ]N |IVA COMISI|COMPRA |CARGO |RETIRO |TRASPASO |PAYU|FACEBK|META |SHOPIFY|EBANX|CURSOR|REPLIT|NETLIFY|OPENAI|GAMMA|SENDINBLUE|LKL\\*|GOOGLE|DIS\\.EFE|PROMOCI[OÓ]N|ANTHROPIC)";
async function parsePdfToLines(buffer, rules) {
    const result = await (0, pdf_parse_1.default)(buffer);
    const text = result.text || "";
    const lines = extractLinesFromText(text, rules);
    return { text, lines };
}
/** Solo el detalle de operaciones en pesos; corta AHORRO FACIL / intereses. */
function isolateDetailSection(text) {
    const start = text.search(/Detalle de Operaciones/i);
    if (start < 0)
        return text;
    let chunk = text.slice(start);
    const ahorro = chunk.search(/\nAHORRO FACIL\b/i);
    if (ahorro > 0)
        chunk = chunk.slice(0, ahorro);
    // Evitar tablas de intereses de inversión al final
    const interesesBlock = chunk.search(/\n\d{2}[A-Z]{3}SALDO ANTERIOR\s+0\.00|\n\d{2}[A-Z]{3}INTERESES AL\b/i);
    if (interesesBlock > 200)
        chunk = chunk.slice(0, interesesBlock);
    return chunk;
}
function stripPageNoise(text) {
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
function mergeUsdContinuations(text) {
    return text.replace(/\n(?=20\d{6}\s+U\.S\.\s*Dollar\s*T\.C\.)/gi, " ");
}
function parseMoneyToken(tok) {
    const n = Number(String(tok).replace(/,/g, ""));
    if (!Number.isFinite(n))
        return null;
    return Math.round(n * 100) / 100;
}
/**
 * Separa montos Banamex pegados y quita basura de folios/POS/T.C.
 * Casos típicos:
 *   500.003,169.72      → 500.00 + 3,169.72
 *   400.00785,432.10    → 400.00 + 785,432.10
 *   9000/00126,000.00   → 6,000.00
 */
function unglueMoneyText(s) {
    let t = String(s || "")
        .replace(/\r/g, " ")
        .replace(/U\.S\.\s*Dollar\s*T\.C\.\s*\d+\.\d{4,6}/gi, " ")
        .replace(/Mexican Peso T\.C\.[^\d]*/gi, " ")
        .replace(/T\.C\.1\s*\.\d+/gi, " ")
        .replace(/T\.C\.\s*\d+\.\d{4,6}/gi, " ")
        // POS Banamex: 9000/0012 + dígito basura, sin comerse el monto
        //   9000/00126,000.00 → 6,000.00
        .replace(/900[01]\/001\d(?=\d{1,3}(?:,\d{3})*\.\d{2})/gi, " ")
        // Fechas AAAAMMDD sueltas
        .replace(/\b20\d{6}\b/g, " ")
        // Folios largos pegados delante de monto con coma de miles
        .replace(/\d{8,}(?=\d{1,3}(?:,\d{3})+\.\d{2})/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    // Clave: partir SIEMPRE tras los centavos si sigue un dígito
    //   400.00785,432.10 → 400.00 785,432.10
    //   500.003,169.72   → 500.00 3,169.72
    //   214600.00785,400 → 214600.00 785,400.00
    t = t.replace(/(\.\d{2})(?=\d)/g, "$1 ");
    // Saldo negativo Banamex: 329.95-
    t = t.replace(/((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})-/g, " -$1 ");
    return t.replace(/\s+/g, " ").trim();
}
/**
 * Extrae montos; soporta saldo negativo Banamex escrito como "329.95-".
 * Orden: quitar T.C./POS → separar montos pegados → aplicar signo −.
 */
function collectMoney(s) {
    const t = unglueMoneyText(s);
    const out = [];
    const re = /-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}/g;
    let m;
    while ((m = re.exec(t)) !== null) {
        const n = parseMoneyToken(m[0]);
        if (n != null)
            out.push(n);
    }
    return out;
}
/**
 * Variantes típicas por puntos/comas o dígitos de folio pegados.
 * Sirve para revisión automática de descuadres grandes.
 */
function moneyTypoVariants(amount) {
    const sign = amount < 0 ? -1 : 1;
    const abs = Math.abs(amount);
    if (!(abs > 0))
        return [];
    const seen = new Set();
    const out = [];
    const add = (v, label) => {
        const r = Math.round(v * 100) / 100;
        if (!Number.isFinite(r) || r === 0)
            return;
        if (Math.abs(r) === abs)
            return;
        if (seen.has(r))
            return;
        seen.add(r);
        out.push({ value: r, label });
    };
    for (const f of [10, 100, 1000, 10_000, 100_000]) {
        add(sign * abs * f, `coma/punto ×${f}`);
        add(sign * (abs / f), `coma/punto ÷${f}`);
    }
    // Quitar 1–4 dígitos basura al inicio (folio pegado: 785400.00 → 400.00)
    const cents = Math.round(abs * 100);
    const digits = String(cents);
    for (let cut = 1; cut <= Math.min(4, digits.length - 3); cut++) {
        const rest = Number(digits.slice(cut)) / 100;
        if (rest >= 0.01)
            add(sign * rest, `sin ${cut} dígito(s) de folio al inicio`);
    }
    // Quedar solo con los últimos 3–6 dígitos enteros + centavos
    for (const keep of [3, 4, 5, 6]) {
        if (digits.length > keep + 2) {
            const rest = Number(digits.slice(-(keep + 2))) / 100;
            if (rest >= 0.01)
                add(sign * rest, `últimos ${keep} dígitos + centavos`);
        }
    }
    return out;
}
/**
 * Banamex pega código POS + dígito basura + monto:
 *   9000/00126,000.00  →  6,000.00
 */
function stripBanamexPosJunk(body) {
    return unglueMoneyText(body);
}
function softClean(body) {
    return stripBanamexPosJunk(body)
        .replace(/\b\d{12,}\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Extrae movimiento + saldo (legado / debug).
 * El parser principal usa cadena de saldos.
 */
function extractMoveAndSaldo(body) {
    const original = body.replace(/\s+/g, " ").trim();
    const periodo = original.match(/PERIODO\s+[A-ZÁÉÍÓÚ]{3}\d{0,2}\s+AL\s+[A-ZÁÉÍÓÚ]{3}(\d{2})(\d[\d,]*\.\d{2})\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
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
function detectDirection(desc) {
    const d = desc.replace(/\s+/g, " ").trim();
    const head = d.slice(0, 120);
    if (/^PAGO INTERBANCARIO A\b/i.test(head) || /^PAGO A TERCEROS\b/i.test(head)) {
        return "cargo";
    }
    if (/^PAGO RECIBIDO\b/i.test(head) ||
        /^SPEI RECIBIDO\b/i.test(head) ||
        /^ABONO\b/i.test(head) ||
        /^DEP[OÓ]SITO\b/i.test(head) ||
        /^DEPOSITO CANALES\b/i.test(head) ||
        /^PROMOCI[OÓ]N\b/i.test(head)) {
        return "abono";
    }
    if (/^(RETIRO|COMISI[OÓ]N|IVA |CARGO|COMPRA|TRASPASO|PAYU|FACEBK|META|SHOPIFY|EBANX|CURSOR|REPLIT|SENDINBLUE|GOOGLE|NETLIFY|OPENAI|GAMMA|LKL|DIS\.EFE|ANTHROPIC)/i.test(head)) {
        return "cargo";
    }
    return "cargo";
}
/** Parte bloques pegados sin comerse el "-" de saldo negativo. */
function splitMergedBodies(rawBody) {
    const re = new RegExp(`(?<=\\d\\.\\d{2}-)\\s*(?=${NEXT_TX_KEYWORDS})|(?<=\\d\\.\\d{2})\\s+(?=${NEXT_TX_KEYWORDS})`, "i");
    return rawBody
        .split(re)
        .map((p) => p.trim())
        .filter((p) => p.length > 3);
}
function cleanDescription(body) {
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
function monthToken(mon) {
    const ent = Object.entries(MONTH_NUM).find(([, v]) => v === mon);
    return (ent?.[0] || mon).toUpperCase();
}
/**
 * Parser Banamex por cadena de saldos:
 * monto = Δsaldo (fuente de verdad). Así Depósitos/Retiros cuadran con el PDF.
 * Estrategias alternativas sirven para revisión automática cuando no cuadra.
 */
function extractBanamex(text, rules, options = {}) {
    const strategy = options.amountStrategy || "delta";
    const detail = isolateDetailSection(text);
    const cleaned = mergeUsdContinuations(stripPageNoise(detail));
    const out = [];
    const tokens = [];
    const re = new RegExp(`(\\d{1,2})(${MONTH_RE})`, "gi");
    let tm;
    while ((tm = re.exec(cleaned)) !== null) {
        tokens.push({
            day: tm[1].padStart(2, "0"),
            mon: MONTH_NUM[tm[2].toLowerCase()] || tm[2],
            start: tm.index,
            bodyStart: tm.index + tm[0].length,
        });
    }
    const rows = [];
    let openingSaldo = null;
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        const end = i + 1 < tokens.length ? tokens[i + 1].start : cleaned.length;
        const rawBody = cleaned.slice(tok.bodyStart, end).replace(/\s+/g, " ").trim();
        if (!rawBody)
            continue;
        if (/^SALDO ANTERIOR/i.test(rawBody)) {
            const nums = collectMoney(rawBody);
            if (nums.length)
                openingSaldo = nums[nums.length - 1];
            continue;
        }
        // Basura de tablas de intereses / resumen
        if (/^INTERESES AL/i.test(rawBody))
            continue;
        if (/^(Resumen|Saldo promedio|Dep[oó]sitos|Otros cargos|Inter[eé]s Aplicable|AHORRO )/i.test(rawBody)) {
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
        const periodo = rawBody.match(/PERIODO\s+[A-ZÁÉÍÓÚ]{3}\d{0,2}\s+AL\s+[A-ZÁÉÍÓÚ]{3}(\d{2})(\d[\d,]*\.\d{2})\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/i);
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
            if (/^SALDO ANTERIOR/i.test(body))
                continue;
            const nums = collectMoney(body);
            let printedMove = null;
            let saldo = null;
            if (nums.length >= 2) {
                printedMove = nums[nums.length - 2];
                saldo = nums[nums.length - 1];
            }
            else if (nums.length === 1) {
                saldo = nums[0];
            }
            const desc = cleanDescription(body);
            if (desc.length < 3)
                continue;
            if (/^PAGO RECIBIDO DE SU REF\.?/i.test(desc.trim()) && desc.length < 40) {
                // Puede ser abono real corto; no filtrar si hay saldo
                if (saldo == null)
                    continue;
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
        if (row.saldo == null)
            continue;
        if (prevSaldo == null) {
            prevSaldo = row.saldo;
            continue;
        }
        if (row.skipTx) {
            prevSaldo = row.saldo;
            continue;
        }
        const delta = Math.round((row.saldo - prevSaldo) * 100) / 100;
        if (Math.abs(delta) < 0.005) {
            prevSaldo = row.saldo;
            continue;
        }
        const deltaAbs = Math.abs(delta);
        const printedAbs = row.printedMove == null ? null : Math.abs(row.printedMove);
        const printedMismatch = printedAbs != null && Math.abs(printedAbs - deltaAbs) > 0.05;
        /**
         * Saldo contaminado por dígitos pegados (ej. cargo $400 + basura → Δ $785,400).
         * Si el Δ es mucho mayor que el impreso, confiar en el impreso y rebasar la cadena.
         * No rebasar con impresos irrisorios ($0.01): suelen ser basura de parseo.
         */
        const saldoPolluted = printedMismatch &&
            printedAbs != null &&
            printedAbs >= 1 &&
            deltaAbs >= Math.max(printedAbs * 8, printedAbs + 500);
        /** Impreso contaminado (POS/folio); el Δsaldo es más creíble. */
        const printedPolluted = printedMismatch &&
            printedAbs != null &&
            deltaAbs > 0 &&
            printedAbs >= Math.max(deltaAbs * 8, deltaAbs + 500);
        let amount = deltaAbs;
        let direction = delta > 0 ? "abono" : "cargo";
        let reviewNote;
        let rebaseChain = false;
        if (strategy === "rebased" && printedAbs != null && printedMismatch) {
            amount = printedAbs;
            direction = detectDirection(row.desc);
            if (direction === "unknown") {
                direction = delta > 0 ? "abono" : "cargo";
            }
            rebaseChain = true;
            reviewNote = `Relectura rebasada: impreso $${printedAbs.toFixed(2)} (Δsaldo era $${deltaAbs.toFixed(2)}; posible punto/coma/folio)`;
        }
        else if (strategy === "printed" && printedAbs != null) {
            amount = printedAbs;
            direction = delta > 0 ? "abono" : "cargo";
            if (printedMismatch) {
                reviewNote = `Monto impreso $${printedAbs.toFixed(2)} ≠ Δsaldo $${deltaAbs.toFixed(2)}; se usó el impreso`;
            }
        }
        else if ((strategy === "hybrid" || strategy === "delta") &&
            saldoPolluted &&
            printedAbs != null) {
            // Reparación por defecto: no arrastrar un saldo basura al resto del mes
            amount = printedAbs;
            direction = detectDirection(row.desc);
            if (direction === "unknown") {
                direction = delta > 0 ? "abono" : "cargo";
            }
            rebaseChain = true;
            reviewNote = `Saldo con dígitos pegados: se usó $${printedAbs.toFixed(2)} (Δ leído $${deltaAbs.toFixed(2)})`;
        }
        else if (strategy === "hybrid" && printedMismatch && printedAbs != null && !printedPolluted) {
            amount = printedAbs;
            direction = delta > 0 ? "abono" : "cargo";
            reviewNote = `Discrepancia impreso/Δsaldo; híbrida usó $${printedAbs.toFixed(2)} (Δ era $${deltaAbs.toFixed(2)})`;
        }
        else if (printedMismatch && printedAbs != null) {
            reviewNote = printedPolluted
                ? `Impreso $${printedAbs.toFixed(2)} parece folio/POS; prevalece Δsaldo $${deltaAbs.toFixed(2)}`
                : `Impreso $${printedAbs.toFixed(2)} ≠ Δsaldo $${deltaAbs.toFixed(2)}; prevalece Δsaldo`;
        }
        const signed = direction === "abono" ? amount : -amount;
        const desc = row.desc;
        if (rebaseChain) {
            prevSaldo = Math.round((prevSaldo + signed) * 100) / 100;
        }
        else {
            prevSaldo = row.saldo;
        }
        const cat = (0, categorize_1.categorizeLine)(desc, signed, direction, rules);
        const suspicious = printedMismatch ||
            Boolean(reviewNote) ||
            amount > 150_000 ||
            (direction === "abono" &&
                !/^(PAGO RECIBIDO|ABONO|DEP[OÓ]SITO|PROMOCI[OÓ]N)/i.test(desc.trim()));
        out.push({
            id: (0, crypto_1.randomUUID)(),
            raw: `${row.day}${monthToken(row.mon)} ${row.body.slice(0, 160)}`,
            date: row.date,
            description: desc,
            amount: Math.round(signed * 100) / 100,
            direction,
            category: cat.category,
            matchedRuleId: cat.matchedRuleId,
            needsReview: Boolean(cat.needsReview || suspicious),
            reviewNote,
        });
    }
    return out;
}
function extractLinesFromText(text, rules, options = {}) {
    const banamexHits = (text.match(new RegExp(`\\d{1,2}(?:${MONTH_RE})`, "gi")) || []).length;
    if (banamexHits >= 5) {
        const lines = extractBanamex(text, rules, options);
        if (lines.length > 0)
            return lines;
    }
    return extractGeneric(text, rules);
}
function extractGeneric(text, rules) {
    const out = [];
    const seen = new Set();
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 5);
    const re = /^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+(-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/;
    for (const raw of lines) {
        const m = raw.match(re);
        if (!m)
            continue;
        const amount = Number(m[3].replace(/[$,]/g, ""));
        if (!Number.isFinite(amount) || amount === 0)
            continue;
        const desc = m[2].trim();
        const key = `${m[1]}|${desc}|${amount}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const direction = detectDirection(desc);
        const signed = direction === "abono" ? Math.abs(amount) : -Math.abs(amount);
        const cat = (0, categorize_1.categorizeLine)(desc, signed, direction, rules);
        out.push({
            id: (0, crypto_1.randomUUID)(),
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
function summarizeByCategory(lines) {
    const summary = {};
    for (const line of lines) {
        summary[line.category] = (summary[line.category] || 0) + line.amount;
    }
    return summary;
}
function summarizeTotals(lines) {
    let ingresos = 0;
    let gastos = 0;
    for (const line of lines) {
        if (line.amount >= 0)
            ingresos += line.amount;
        else
            gastos += line.amount;
    }
    return {
        ingresos: Math.round(ingresos * 100) / 100,
        gastos: Math.round(gastos * 100) / 100,
        neto: Math.round((ingresos + gastos) * 100) / 100,
    };
}
//# sourceMappingURL=parseStatement.js.map