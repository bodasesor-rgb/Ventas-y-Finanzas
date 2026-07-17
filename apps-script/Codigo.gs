/**
 * ============================================================
 * Apps Script — Bodasesor Ventas / Finanzas (UN solo /exec)
 * VERSION: 2026-07-17-v3
 * ============================================================
 * Columnas A–T (20). Deal ID = T.
 * Solo escribe Eventos YYYY.
 * ============================================================
 */
var SCRIPT_VERSION = '2026-07-17-v3';
var DEFAULT_SHEET_NAME = 'Eventos 2026';
var DEAL_ID_COL = 20; // T

function isWritableSheet_(name) {
  return /^Eventos \d{4}$/.test(name);
}

// A–J + P–R + T. No toca K,L,M,N,O,S
var WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 20];

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'Sin postData.contents (el POST llegó vacío)',
      });
    }

    var data = JSON.parse(raw);
    var values = data.values;
    if (!values || !Array.isArray(values)) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'values no es array',
        typeofValues: typeof values,
        rawPreview: String(raw).slice(0, 200),
      });
    }

    values = values.slice(0, DEAL_ID_COL);
    while (values.length < DEAL_ID_COL) values.push('');

    var dealId = String(data.dealId || values[19] || '').trim();
    var sheetName = String(data.sheetName || DEFAULT_SHEET_NAME).trim();

    if (!dealId) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'Falta dealId',
        valuesLength: values.length,
      });
    }

    if (!isWritableSheet_(sheetName)) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'Pestaña no escribible: ' + sheetName,
      });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'No existe pestaña: ' + sheetName,
      });
    }

    var lastRow = Math.max(sheet.getLastRow(), 1);
    var ids =
      lastRow > 1
        ? sheet.getRange(2, DEAL_ID_COL, lastRow, DEAL_ID_COL).getValues()
        : [];

    var rowIndex = -1;
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === dealId) {
        rowIndex = i + 2;
        break;
      }
    }

    if (rowIndex === -1) {
      rowIndex = sheet.getLastRow() + 1;
      sheet.getRange(rowIndex, 1, 1, DEAL_ID_COL).setValues([values]);
      applyCalcFormulas_(sheet, rowIndex);
      return json_({
        ok: true,
        version: SCRIPT_VERSION,
        action: 'appended',
        row: rowIndex,
        dealId: dealId,
        sheetName: sheetName,
      });
    }

    for (var c = 0; c < WRITE_COLS.length; c++) {
      var col = WRITE_COLS[c];
      sheet.getRange(rowIndex, col).setValue(values[col - 1]);
    }
    applyCalcFormulas_(sheet, rowIndex);

    return json_({
      ok: true,
      version: SCRIPT_VERSION,
      action: 'updated',
      row: rowIndex,
      dealId: dealId,
      sheetName: sheetName,
    });
  } catch (err) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: String(err),
    });
  }
}

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

/** Prueba rápida en el editor: Ejecutar → testPing */
function testPing() {
  Logger.log(SCRIPT_VERSION);
}
