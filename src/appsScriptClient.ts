export interface AppsScriptWriteResult {
  ok: boolean;
  action?: "appended" | "updated";
  row?: number;
  dealId?: string;
  error?: string;
  raw?: string;
}

/**
 * Envía la fila al webhook de Google Apps Script.
 * El script en Sheets hace append o update por kommoDealId.
 */
export async function writeFilaToAppsScript(
  dealId: string,
  values: string[],
  sheetName = "Eventos 2026"
): Promise<AppsScriptWriteResult> {
  // Hostinger usa URL_BODASESOR_DIRECCION_SHEETS; APPS_SCRIPT_VENTAS_URL queda como alias
  const url = (
    process.env.URL_BODASESOR_DIRECCION_SHEETS ||
    process.env.APPS_SCRIPT_VENTAS_URL ||
    ""
  ).trim();
  if (!url) {
    throw new Error(
      "Falta URL_BODASESOR_DIRECCION_SHEETS (URL /exec del Apps Script)"
    );
  }
  if (!url.includes("script.google.com") || !url.includes("/exec")) {
    throw new Error(
      "URL_BODASESOR_DIRECCION_SHEETS debe ser la URL de Apps Script que termina en /exec (no el link del Sheet ni el ID de implementación)"
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId, values, sheetName }),
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
