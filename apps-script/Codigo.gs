/**
 * ============================================================
 * Apps Script — Bodasesor Ventas / Finanzas (UN solo /exec)
 * ============================================================
 * INCLUYE:
 * 1) Lee JSON: { dealId, values[20], sheetName }
 * 2) Solo escribe pestañas "Eventos YYYY" (Metricas/P&L = no)
 * 3) Idempotencia por Kommo Deal ID (columna T = 20)
 * 4) Append o update (no duplica)
 * 5) NO pisa: Costo(K), Pagado(L), Por pagar(M), Ganancia(N),
 *    Margen(O), IVA(S) — esos son manual / fórmulas
 * 6) Al append (y si faltan en update) pone fórmulas:
 *    M = Venta-Pagado | N = Venta-Costo | O = Ganancia/Venta
 *
 * COLUMNAS Eventos (A–T):
 * A Cliente | B Fecha evento | C Fecha cierre | D Telefono | E Correo
 * F Tipo evento | G Invitados | H Dirección | I Horario | J Venta
 * K Costo | L Pagado | M Por pagar | N Ganancia | O Margen
 * P Link | Q Mes cierre | R Forma de Pago | S IVA | T Kommo Deal ID
 * ============================================================
 */
const DEFAULT_SHEET_NAME = 'Eventos 2026';
const DEAL_ID_COL = 20; // T

function isWritableSheet_(name) {
  return /^Eventos \d{4}$/.test(name);
}

// Columnas que el bot SÍ escribe (1-based). Resto intocable.
const WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 20];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const values = (data.values || []).slice(0, DEAL_ID_COL);
    const dealId = String(data.dealId || values[19] || '').trim();
    const sheetName = String(data.sheetName || DEFAULT_SHEET_NAME).trim();

    if (!dealId || values.length < DEAL_ID_COL) {
      return json_({ ok: false, error: 'Faltan dealId o values (se esperan 20 columnas A–T)' });
    }

    if (!isWritableSheet_(sheetName)) {
      return json_({
        ok: false,
        error: 'Pestaña no escribible: ' + sheetName + '. Solo Eventos YYYY.',
      });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) {
      return json_({ ok: false, error: 'No existe pestaña: ' + sheetName });
    }

    const lastRow = Math.max(sheet.getLastRow(), 1);
    const ids =
      lastRow > 1
        ? sheet.getRange(2, DEAL_ID_COL, lastRow, DEAL_ID_COL).getValues()
        : [];

    let rowIndex = -1;
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === dealId) {
        rowIndex = i + 2;
        break;
      }
    }

    if (rowIndex === -1) {
      rowIndex = sheet.getLastRow() + 1;
      // Asegura array de 20 celdas
      while (values.length < DEAL_ID_COL) values.push('');
      sheet.getRange(rowIndex, 1, 1, DEAL_ID_COL).setValues([values]);
      applyCalcFormulas_(sheet, rowIndex);
      return json_({
        ok: true,
        action: 'appended',
        row: rowIndex,
        dealId: dealId,
        sheetName: sheetName,
      });
    }

    // Update: solo columnas Kommo; no toca K,L,M,N,O,S
    WRITE_COLS.forEach(function (col) {
      sheet.getRange(rowIndex, col).setValue(values[col - 1]);
    });
    applyCalcFormulas_(sheet, rowIndex);

    return json_({
      ok: true,
      action: 'updated',
      row: rowIndex,
      dealId: dealId,
      sheetName: sheetName,
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Por pagar (M), Ganancia (N), Margen (O) */
function applyCalcFormulas_(sheet, row) {
  sheet
    .getRange(row, 13)
    .setFormula(
      '=IF(J' + row + '="","",J' + row + '-IF(L' + row + '="",0,L' + row + '))'
    );
  sheet
    .getRange(row, 14)
    .setFormula(
      '=IF(J' + row + '="","",J' + row + '-IF(K' + row + '="",0,K' + row + '))'
    );
  sheet
    .getRange(row, 15)
    .setFormula(
      '=IF(OR(J' + row + '="",J' + row + '=0),"",N' + row + '/J' + row + ')'
    );
  sheet.getRange(row, 15).setNumberFormat('0.00%');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
