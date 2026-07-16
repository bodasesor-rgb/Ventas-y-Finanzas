/**
 * Pegar en: Extensiones → Apps Script del Sheet de ventas.
 * Implementar → Aplicación web → Ejecutar como: yo → Acceso: Cualquiera
 * Luego copiar la URL /exec a APPS_SCRIPT_VENTAS_URL en Hostinger.
 *
 * Sheet ID esperado: 1TWbOOjTnm68n2QioiwRsHvXSuARev2PLIhqr1pVctp8
 */
const SHEET_NAME = 'Eventos 2026'; // nombre exacto de la pestaña
const DEAL_ID_COL = 21;      // U = Kommo Deal ID

// Columnas que escribe el bot (1-based). NO toca L,M,N,O,P,T
const WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18, 19, 21];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const values = data.values;
    const dealId = String(data.dealId || (values && values[20]) || '').trim();

    if (!dealId || !values || values.length < DEAL_ID_COL) {
      return json_({ ok: false, error: 'Faltan dealId o values' });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return json_({ ok: false, error: 'No existe pestaña: ' + SHEET_NAME });
    }

    const lastRow = Math.max(sheet.getLastRow(), 1);
    const ids = lastRow > 1
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
      return json_({ ok: true, action: 'appended', row: rowIndex, dealId: dealId });
    }

    WRITE_COLS.forEach(function (col) {
      sheet.getRange(rowIndex, col).setValue(values[col - 1]);
    });
    return json_({ ok: true, action: 'updated', row: rowIndex, dealId: dealId });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
