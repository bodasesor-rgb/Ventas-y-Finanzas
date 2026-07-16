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
  values: string[]
): Promise<AppsScriptWriteResult> {
  const url = process.env.APPS_SCRIPT_VENTAS_URL?.trim();
  if (!url) {
    throw new Error("Falta APPS_SCRIPT_VENTAS_URL en variables de entorno");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId, values }),
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
