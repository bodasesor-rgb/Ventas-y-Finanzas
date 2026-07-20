export interface AppsScriptWriteResult {
  ok: boolean;
  version?: string;
  action?: "appended" | "updated" | "moved" | string;
  row?: number;
  dealId?: string;
  sheetName?: string;
  erSheet?: string;
  erMonthCol?: string;
  pnlSheet?: string;
  pnlMonthCol?: string;
  message?: string;
  error?: string;
  raw?: string;
  /** Archive / Drive */
  pdfFileId?: string;
  runFileId?: string;
  pdfUrl?: string;
  periodKey?: string;
  items?: unknown[];
  count?: number;
  pdfBase64?: string;
  run?: unknown;
  storedName?: string;
  periodLabel?: string;
}

function appsScriptUrl(): string {
  return (
    process.env.URL_BODASESOR_DIRECCION_SHEETS ||
    process.env.APPS_SCRIPT_VENTAS_URL ||
    ""
  ).trim();
}

export function getAppsScriptUrl(): string {
  return appsScriptUrl();
}

/**
 * POST genérico al Apps Script /exec (Eventos, Banco, etc.).
 */
export async function postToAppsScript(
  payload: Record<string, unknown>
): Promise<AppsScriptWriteResult> {
  const url = appsScriptUrl();
  if (!url) {
    throw new Error(
      "Falta URL_BODASESOR_DIRECCION_SHEETS (URL /exec del Apps Script)"
    );
  }
  if (!url.includes("script.google.com") || !url.includes("/exec")) {
    throw new Error(
      "URL_BODASESOR_DIRECCION_SHEETS debe ser la URL de Apps Script que termina en /exec"
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const text = await res.text();
  let parsed: AppsScriptWriteResult;
  try {
    parsed = JSON.parse(text) as AppsScriptWriteResult;
  } catch {
    throw new Error(
      `Apps Script respondió no-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`
    );
  }

  if (!res.ok || parsed.ok === false) {
    throw new Error(
      parsed.error ||
        `Apps Script error HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  }

  return { ...parsed, raw: text.slice(0, 500) };
}

/**
 * Envía la fila al webhook de Google Apps Script (Eventos).
 */
export async function writeFilaToAppsScript(
  dealId: string,
  values: string[],
  sheetName = "Eventos 2026"
): Promise<AppsScriptWriteResult> {
  return postToAppsScript({ dealId, values, sheetName });
}
