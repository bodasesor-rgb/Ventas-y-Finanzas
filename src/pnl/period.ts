const MONTHS_ES: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

const MONTH_LABEL: Record<string, string> = {
  "01": "enero",
  "02": "febrero",
  "03": "marzo",
  "04": "abril",
  "05": "mayo",
  "06": "junio",
  "07": "julio",
  "08": "agosto",
  "09": "septiembre",
  "10": "octubre",
  "11": "noviembre",
  "12": "diciembre",
};

export interface StatementPeriod {
  /** YYYY-MM */
  key: string;
  year: number;
  month: number;
  /** ej. junio 2026 */
  label: string;
  /** ej. 2026-06_estado-cuenta.pdf */
  fileTitle: string;
}

/**
 * Detecta mes/año del estado Banamex u otros.
 * Ej: "PeríodoDel 1 al 30 de junio del 2026"
 *     "Fecha de corte … 30 de junio de 2026"
 */
export function detectPeriodFromText(text: string): StatementPeriod {
  const t = text.replace(/\s+/g, " ");

  let year: number | null = null;
  let month: number | null = null;

  const periodo = t.match(
    /(?:Per[ií]odo|Periodo|Fecha de corte)[^0-9]{0,40}?(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(?:del?\s+)?(\d{4})/i
  );
  if (periodo) {
    const m = MONTHS_ES[periodo[2].toLowerCase()];
    if (m) {
      month = Number(m);
      year = Number(periodo[3]);
    }
  }

  if (!year || !month) {
    const any = t.match(
      /\b(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(?:del?\s+)?(\d{4})\b/i
    );
    if (any) {
      const m = MONTHS_ES[any[2].toLowerCase()];
      if (m) {
        month = Number(m);
        year = Number(any[3]);
      }
    }
  }

  // Fallback: DDMMM / DDMMMYYYY (Banamex pega el año a veces)
  if (!year || !month) {
    const map: Record<string, number> = {
      ene: 1,
      feb: 2,
      mar: 3,
      abr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      ago: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dic: 12,
    };
    const glued = t.match(
      /\b(\d{1,2})(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)(20\d{2})\b/i
    );
    if (glued) {
      month = map[glued[2].slice(0, 3).toLowerCase()] || null;
      year = Number(glued[3]);
    } else {
      const y = t.match(/\b(20\d{2})\b/);
      const dm = t.match(
        /\b(\d{1,2})(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\b/i
      );
      if (y && dm) {
        year = Number(y[1]);
        month = map[dm[2].slice(0, 3).toLowerCase()] || null;
      }
    }
  }

  if (!year || !month) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const mm = String(month).padStart(2, "0");
  const key = `${year}-${mm}`;
  const label = `${MONTH_LABEL[mm] || mm} ${year}`;
  return {
    key,
    year,
    month,
    label,
    fileTitle: `${key}_estado-cuenta.pdf`,
  };
}
