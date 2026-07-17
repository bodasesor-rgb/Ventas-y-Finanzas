/**
 * ============================================================
 * Apps Script — Bodasesor Ventas / Finanzas (UN solo /exec)
 * VERSION: 2026-07-17-v5
 * ============================================================
 * doPost  → append/update Eventos YYYY (Kommo)
 * setupAll_ → EJECUTAR UNA VEZ desde el editor para enlazar
 *             fórmulas Eventos + tabla mensual + Metricas + P&L
 * ============================================================
 */
var SCRIPT_VERSION = '2026-07-17-v5';
var DEFAULT_SHEET_NAME = 'Eventos 2026';
var DEAL_ID_COL = 20; // T
var CLIENTE_COL = 1; // A
var METRICAS_SHEET = 'Metricas 2026';
var PL_SHEET = 'P&L 2026';

function isWritableSheet_(name) {
  return /^Eventos \d{4}$/.test(name);
}

// A–J + P–R + T. No toca K,L,M,N,O,S
var WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 20];

/**
 * Primera fila vacía en columna Cliente (A), desde la fila 2.
 * Así el nuevo cierre va junto al bloque de clientes, no al final
 * del Sheet (getLastRow pega abajo si hay basura en la fila 1000).
 */
function findFirstEmptyClientRow_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var scanTo = Math.max(lastRow, 2);
  // Mirar un poco más abajo por si hay huecos
  scanTo = Math.max(scanTo, 2);
  var values = sheet.getRange(2, CLIENTE_COL, scanTo, CLIENTE_COL).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === '') {
      return i + 2;
    }
  }
  return scanTo + 1;
}

function findRowByDealId_(sheet, dealId) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, DEAL_ID_COL, lastRow, DEAL_ID_COL).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === dealId) {
      return i + 2;
    }
  }
  return -1;
}

function writeRowValues_(sheet, rowIndex, values) {
  for (var c = 0; c < WRITE_COLS.length; c++) {
    var col = WRITE_COLS[c];
    sheet.getRange(rowIndex, col).setValue(values[col - 1]);
  }
  applyCalcFormulas_(sheet, rowIndex);
}

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

    var existingRow = findRowByDealId_(sheet, dealId);
    var firstEmpty = findFirstEmptyClientRow_(sheet);
    var rowIndex;
    var action;

    if (existingRow === -1) {
      // Cliente nuevo → primera fila vacía del bloque (no al final del Sheet)
      rowIndex = firstEmpty;
      sheet.getRange(rowIndex, 1, 1, DEAL_ID_COL).setValues([values]);
      applyCalcFormulas_(sheet, rowIndex);
      action = 'appended';
    } else if (existingRow > firstEmpty) {
      // Quedó huérfano abajo (basura / getLastRow viejo) → subir al hueco
      sheet.getRange(existingRow, 1, 1, DEAL_ID_COL).clearContent();
      sheet.getRange(existingRow, 13, 1, 3).clearContent(); // M N O
      rowIndex = firstEmpty;
      sheet.getRange(rowIndex, 1, 1, DEAL_ID_COL).setValues([values]);
      applyCalcFormulas_(sheet, rowIndex);
      action = 'moved';
    } else {
      rowIndex = existingRow;
      writeRowValues_(sheet, rowIndex, values);
      action = 'updated';
    }

    return json_({
      ok: true,
      version: SCRIPT_VERSION,
      action: action,
      row: rowIndex,
      previousRow: existingRow === -1 ? null : existingRow,
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

/**
 * ============================================================
 * SETUP — ejecutar UNA VEZ desde el editor (▶ setupAll_)
 * Enlaza Eventos + tabla mensual + Metricas + P&L con fórmulas.
 * NO borra Costo/Pagado ni datos de clientes.
 * ============================================================
 */
function setupAll_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var eventos = ss.getSheetByName(DEFAULT_SHEET_NAME);
  if (!eventos) throw new Error('No existe pestaña: ' + DEFAULT_SHEET_NAME);

  setupEventosRowFormulas_(eventos);
  setupMonthlyTable_(eventos);
  setupMetricas_(ss);
  setupPnL_(ss);

  SpreadsheetApp.getUi().alert(
    'Setup OK (' +
      SCRIPT_VERSION +
      ')\n\n' +
      '1) Fórmulas M/N/O en Eventos 2026\n' +
      '2) Tabla mensual en W:AB (SUMIF vivos)\n' +
      '3) Metricas 2026 enlazada\n' +
      '4) P&L 2026 enlazada\n\n' +
      'Luego: Nueva versión de la App web si cambiaste doPost.'
  );
}

/** M/N/O en todas las filas con Cliente (evita #DIV/0! en vacías) */
function setupEventosRowFormulas_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var clientes = sheet.getRange(2, 1, lastRow, 1).getValues();
  for (var i = 0; i < clientes.length; i++) {
    var row = i + 2;
    if (String(clientes[i][0]).trim() === '') {
      sheet.getRange(row, 13, 1, 3).clearContent(); // M N O vacías
      continue;
    }
    applyCalcFormulas_(sheet, row);
  }
}

/**
 * Tabla mensual en W3:AB16
 * Mes | Pagado | Por pagar | Valor total | Ganancia total | # Eventos
 */
function setupMonthlyTable_(sheet) {
  sheet.getRange('W3:AB3').setValues([
    ['Mes', 'Pagado', 'Por pagar', 'Valor total', 'Ganancia total', '# Eventos'],
  ]);

  for (var m = 1; m <= 12; m++) {
    var r = 3 + m; // fila 4 = mes 1 … fila 15 = mes 12
    sheet.getRange(r, 23).setValue(m); // W
    sheet.getRange(r, 24).setFormula('=SUMIF($Q:$Q,W' + r + ',$L:$L)'); // X Pagado
    sheet.getRange(r, 25).setFormula('=SUMIF($Q:$Q,W' + r + ',$M:$M)'); // Y Por pagar
    sheet.getRange(r, 26).setFormula('=SUMIF($Q:$Q,W' + r + ',$J:$J)'); // Z Valor
    sheet.getRange(r, 27).setFormula('=SUMIF($Q:$Q,W' + r + ',$N:$N)'); // AA Ganancia
    sheet.getRange(r, 28).setFormula('=COUNTIFS($Q:$Q,W' + r + ',$A:$A,"<>")'); // AB #
  }

  sheet.getRange(16, 23).setValue('Total anual');
  sheet.getRange(16, 24).setFormula('=SUM(X4:X15)');
  sheet.getRange(16, 25).setFormula('=SUM(Y4:Y15)');
  sheet.getRange(16, 26).setFormula('=SUM(Z4:Z15)');
  sheet.getRange(16, 27).setFormula('=SUM(AA4:AA15)');
  sheet.getRange(16, 28).setFormula('=SUM(AB4:AB15)');

  sheet.getRange('X4:AA16').setNumberFormat('$#,##0.00');
}

/** Metricas 2026: mirror de la tabla mensual de Eventos */
function setupMetricas_(ss) {
  var sh = ss.getSheetByName(METRICAS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(METRICAS_SHEET);
  }
  sh.clear();
  sh.getRange('A1').setValue('Metricas 2026 — enlazado a Eventos 2026 (solo lectura)');
  sh.getRange('A3:F3').setValues([
    ['Mes', 'Pagado', 'Por pagar', 'Valor total', 'Ganancia total', '# Eventos'],
  ]);

  for (var m = 1; m <= 12; m++) {
    var r = 3 + m;
    var src = 3 + m; // misma fila en Eventos W
    sh.getRange(r, 1).setValue(m);
    sh.getRange(r, 2).setFormula("='Eventos 2026'!X" + src);
    sh.getRange(r, 3).setFormula("='Eventos 2026'!Y" + src);
    sh.getRange(r, 4).setFormula("='Eventos 2026'!Z" + src);
    sh.getRange(r, 5).setFormula("='Eventos 2026'!AA" + src);
    sh.getRange(r, 6).setFormula("='Eventos 2026'!AB" + src);
  }

  sh.getRange(16, 1).setValue('Total anual');
  sh.getRange(16, 2).setFormula("='Eventos 2026'!X16");
  sh.getRange(16, 3).setFormula("='Eventos 2026'!Y16");
  sh.getRange(16, 4).setFormula("='Eventos 2026'!Z16");
  sh.getRange(16, 5).setFormula("='Eventos 2026'!AA16");
  sh.getRange(16, 6).setFormula("='Eventos 2026'!AB16");
  sh.getRange('B4:E16').setNumberFormat('$#,##0.00');
}

/**
 * P&L 2026 (simple):
 * Ingresos (= Valor total) | Costo total | Ganancia | Margen
 * por mes, desde Eventos.
 */
function setupPnL_(ss) {
  var sh = ss.getSheetByName(PL_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PL_SHEET);
  }
  sh.clear();
  sh.getRange('A1').setValue('P&L 2026 — enlazado a Eventos 2026');
  sh.getRange('A3:E3').setValues([
    ['Mes', 'Ingresos (Venta)', 'Costo total', 'Ganancia', 'Margen'],
  ]);

  for (var m = 1; m <= 12; m++) {
    var r = 3 + m;
    sh.getRange(r, 1).setValue(m);
    // Ingresos = Valor total Eventos Z
    sh.getRange(r, 2).setFormula("='Eventos 2026'!Z" + r);
    // Costo = SUMIF costo por mes
    sh.getRange(r, 3).setFormula("=SUMIF('Eventos 2026'!$Q:$Q,A" + r + ",'Eventos 2026'!$K:$K)");
    // Ganancia
    sh.getRange(r, 4).setFormula("='Eventos 2026'!AA" + r);
    // Margen
    sh.getRange(r, 5).setFormula('=IF(B' + r + '=0,"",D' + r + '/B' + r + ')');
  }

  sh.getRange(16, 1).setValue('Total anual');
  sh.getRange(16, 2).setFormula('=SUM(B4:B15)');
  sh.getRange(16, 3).setFormula('=SUM(C4:C15)');
  sh.getRange(16, 4).setFormula('=SUM(D4:D15)');
  sh.getRange(16, 5).setFormula('=IF(B16=0,"",D16/B16)');
  sh.getRange('B4:D16').setNumberFormat('$#,##0.00');
  sh.getRange('E4:E16').setNumberFormat('0.00%');
}

function testPing() {
  Logger.log(SCRIPT_VERSION);
}
