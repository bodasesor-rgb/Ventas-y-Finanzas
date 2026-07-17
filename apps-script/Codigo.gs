/**
 * UN solo deploy (/exec) para el Sheet de ventas/finanzas.
 *
 * Pestañas del archivo:
 * - Eventos 2026  → el bot SÍ escribe (append/update por Kommo Deal ID)
 * - Metricas 2026 → NO escribe el bot (fórmulas / manual)
 * - P&L 2026      → NO escribe el bot (fórmulas / manual)
 *
 * El Node manda: { dealId, values, sheetName }
 * sheetName por defecto: "Eventos 2026"
 */
const DEFAULT_SHEET_NAME = 'Eventos 2026';
const DEAL_ID_COL = 21; // U = Kommo Deal ID

/** Solo pestañas "Eventos YYYY". Metricas/P&L nunca. */
function isWritableSheet_(name) {
  return /^Eventos \d{4}$/.test(name);
}

// Columnas que escribe el bot (1-based). NO toca L,M,N,O,P,T
const WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18, 19, 21];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const values = data.values;
    const dealId = String(data.dealId || (values && values[20]) || '').trim();
    const sheetName = String(data.sheetName || DEFAULT_SHEET_NAME).trim();

    if (!dealId || !values || values.length < DEAL_ID_COL) {
      return json_({ ok: false, error: 'Faltan dealId o values' });
    }

    if (!isWritableSheet_(sheetName)) {
      return json_({
        ok: false,
        error:
          'Pestaña no escribible por el bot: ' +
          sheetName +
          '. Solo Eventos YYYY. Metricas/P&L son fórmulas.',
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
      sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
      return json_({
        ok: true,
        action: 'appended',
        row: rowIndex,
        dealId: dealId,
        sheetName: sheetName,
      });
    }

    WRITE_COLS.forEach(function (col) {
      sheet.getRange(rowIndex, col).setValue(values[col - 1]);
    });
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
