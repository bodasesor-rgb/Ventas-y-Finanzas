/**
 * ============================================================
 * Apps Script — Bodasesor Ventas / Finanzas (UN solo /exec)
 * VERSION: 2026-07-18-v8
 * ============================================================
 * doPost  → Eventos | upsertBanco | saveStatementArchive |
 *           listStatementArchive | getStatementArchive
 * doGet   → { version }
 * setupAll_ → fórmulas Eventos + Metricas + P&L
 *
 * Memoria de PDFs: carpeta Drive "Bodasesor Estados de Cuenta"
 * + índice en pestaña "Estados Archive" (sobrevive a deploys).
 * ============================================================
 */
var SCRIPT_VERSION = '2026-07-18-v8';
var DEFAULT_SHEET_NAME = 'Eventos 2026';
var DEAL_ID_COL = 20; // T
var CLIENTE_COL = 1; // A
var METRICAS_SHEET = 'Metricas 2026';
var PL_SHEET = 'P&L 2026';
var ARCHIVE_FOLDER_NAME = 'Bodasesor Estados de Cuenta';
var ARCHIVE_SHEET = 'Estados Archive';
/** No mirar más abajo de esta fila al buscar el último cliente (evita basura) */
var MAX_CLIENT_SCAN = 500;

function isWritableSheet_(name) {
  return /^Eventos \d{4}$/.test(name);
}

// A–J + P–R + T. No toca K,L,M,N,O,S
var WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 20];

/**
 * Última fila con nombre en Cliente (A), luego +1.
 * Si el último está en 66 → regresa 67.
 * Ignora basura lejana: si hay un hueco de ≥15 filas vacías, corta el bloque.
 */
function findNextClientRow_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var scanTo = Math.min(Math.max(lastRow, 2), MAX_CLIENT_SCAN);
  var values = sheet.getRange(2, CLIENTE_COL, scanTo, CLIENTE_COL).getValues();
  var lastFilled = 1; // encabezado
  var emptyStreak = 0;

  for (var i = 0; i < values.length; i++) {
    var cell = String(values[i][0]).trim();
    if (cell !== '') {
      lastFilled = i + 2;
      emptyStreak = 0;
    } else if (lastFilled >= 2) {
      emptyStreak++;
      // Tras el bloque real de clientes, no seguir buscando basura abajo
      if (emptyStreak >= 15) break;
    }
  }

  return lastFilled + 1;
}

function findRowByDealId_(sheet, dealId) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  if (lastRow < 2) return -1;
  var scanTo = Math.min(lastRow, MAX_CLIENT_SCAN);
  var ids = sheet.getRange(2, DEAL_ID_COL, scanTo, DEAL_ID_COL).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === dealId) {
      return i + 2;
    }
  }
  // Si getLastRow es enorme, también buscar más abajo por si quedó un ID viejo
  if (lastRow > MAX_CLIENT_SCAN) {
    var ids2 = sheet
      .getRange(MAX_CLIENT_SCAN + 1, DEAL_ID_COL, lastRow, DEAL_ID_COL)
      .getValues();
    for (var j = 0; j < ids2.length; j++) {
      if (String(ids2[j][0]).trim() === dealId) {
        return MAX_CLIENT_SCAN + 1 + j;
      }
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

/** Abre la URL /exec en el navegador → debe decir version v6 */
function doGet() {
  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    ping: true,
    rule: 'nuevo cliente = ultima fila con Cliente + 1',
  });
}

/**
 * Upsert fila mensual del estado de cuenta banco → pestaña Banco YYYY
 * y refleja Gastos/Ingresos banco en P&L YYYY (cols F/G).
 */
function upsertBanco_(data) {
  var year = Number(data.year) || new Date().getFullYear();
  var month = Number(data.month);
  var periodKey = String(data.periodKey || '').trim();
  if (!periodKey || !month || month < 1 || month > 12) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'upsertBanco: falta periodKey o month',
    });
  }

  var sheetName = 'Banco ' + year;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName);
  var headers = [
    'Mes',
    'Periodo',
    'Label',
    'Ingresos banco',
    'Gastos banco',
    'Neto',
    'Ads',
    'Apps',
    'Pass',
    'Comisiones',
    'Servicios',
    'Pagos',
    'Transferencias',
    'Evento',
    'Revisar',
    'Otro',
    'Ingreso cat',
    'Venta cat',
    'Otros cats',
    'Depósitos oficial',
    'Retiros oficial',
    'Cuadra',
    'Actualizado',
    'RunId',
    'Archivo',
  ];

  if (!sh) {
    sh = ss.insertSheet(sheetName);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else if (String(sh.getRange(1, 1).getValue()).trim() !== 'Mes') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  var by = {};
  var cats = data.byCategory || [];
  for (var i = 0; i < cats.length; i++) {
    by[cats[i].id] = Number(cats[i].amount) || 0;
  }

  var rowVals = [
    month,
    periodKey,
    String(data.periodLabel || periodKey),
    Number(data.ingresos) || 0,
    Number(data.gastos) || 0,
    Number(data.neto) || 0,
    by.ads || 0,
    by.apps || 0,
    by.pass || 0,
    by.comisiones || 0,
    by.servicios || 0,
    by.pago || 0,
    by.transferencia_persona || 0,
    by.evento || 0,
    by.revisar || 0,
    by.otro || 0,
    by.ingreso || 0,
    by.venta || 0,
    Number(data.otros) || 0,
    data.depositosOficiales == null ? '' : Number(data.depositosOficiales),
    data.retirosOficiales == null ? '' : Number(data.retirosOficiales),
    data.cuadra ? 'SI' : 'NO',
    new Date(),
    String(data.runId || ''),
    String(data.filename || ''),
  ];

  var lastRow = Math.max(sh.getLastRow(), 1);
  var rowIndex = -1;
  if (lastRow >= 2) {
    var keys = sh.getRange(2, 2, lastRow, 2).getValues(); // col B Periodo
    for (var r = 0; r < keys.length; r++) {
      if (String(keys[r][0]).trim() === periodKey) {
        rowIndex = r + 2;
        break;
      }
    }
  }

  var action;
  if (rowIndex === -1) {
    rowIndex = sh.getLastRow() + 1;
    if (rowIndex < 2) rowIndex = 2;
    action = 'appended';
  } else {
    action = 'updated';
  }

  sh.getRange(rowIndex, 1, 1, rowVals.length).setValues([rowVals]);
  sh.getRange(rowIndex, 4, 1, 16).setNumberFormat('$#,##0.00');

  linkPnLBanco_(ss, year);

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: action,
    row: rowIndex,
    sheetName: sheetName,
    periodKey: periodKey,
  });
}

/** P&L YYYY cols F/G = Ingresos/Gastos banco del mes */
function linkPnLBanco_(ss, year) {
  var plName = 'P&L ' + year;
  var bancoName = 'Banco ' + year;
  var sh = ss.getSheetByName(plName);
  if (!sh) return;
  sh.getRange('F3').setValue('Ingresos banco');
  sh.getRange('G3').setValue('Gastos banco');
  for (var m = 1; m <= 12; m++) {
    var r = 3 + m;
    sh.getRange(r, 6).setFormula(
      "=IFERROR(SUMIF('" + bancoName + "'!$A:$A,A" + r + ",'" + bancoName + "'!$D:$D),0)"
    );
    sh.getRange(r, 7).setFormula(
      "=IFERROR(SUMIF('" + bancoName + "'!$A:$A,A" + r + ",'" + bancoName + "'!$E:$E),0)"
    );
  }
  sh.getRange('F4:G15').setNumberFormat('$#,##0.00');
  sh.getRange(16, 6).setFormula('=SUM(F4:F15)');
  sh.getRange(16, 7).setFormula('=SUM(G4:G15)');
  sh.getRange('F16:G16').setNumberFormat('$#,##0.00');
}

function getArchiveFolder_() {
  var it = DriveApp.getFoldersByName(ARCHIVE_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(ARCHIVE_FOLDER_NAME);
}

function ensureArchiveSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ARCHIVE_SHEET);
  var headers = [
    'Periodo',
    'Label',
    'PdfFileId',
    'RunFileId',
    'PdfUrl',
    'StoredName',
    'Actualizado',
    'RunId',
  ];
  if (!sh) {
    sh = ss.insertSheet(ARCHIVE_SHEET);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else if (String(sh.getRange(1, 1).getValue()).trim() !== 'Periodo') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function removeFilesNamedInFolder_(folder, name) {
  var files = folder.getFilesByName(name);
  while (files.hasNext()) {
    try {
      files.next().setTrashed(true);
    } catch (err) {
      /* ignore */
    }
  }
}

function findArchiveRow_(sh, periodKey) {
  var lastRow = Math.max(sh.getLastRow(), 1);
  if (lastRow < 2) return -1;
  var keys = sh.getRange(2, 1, lastRow, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === periodKey) return i + 2;
  }
  return -1;
}

/** Guarda PDF + JSON del run en Drive (memoria entre deploys). */
function saveStatementArchive_(data) {
  var periodKey = String(data.periodKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'saveStatementArchive: periodKey inválido',
    });
  }
  if (!data.pdfBase64) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'saveStatementArchive: falta pdfBase64',
    });
  }

  var storedName =
    String(data.storedName || periodKey + '_estado-cuenta.pdf').trim();
  var pdfName = periodKey + '_estado-cuenta.pdf';
  var jsonName = periodKey + '_run.json';
  var folder = getArchiveFolder_();

  removeFilesNamedInFolder_(folder, pdfName);
  removeFilesNamedInFolder_(folder, jsonName);

  var pdfBytes = Utilities.base64Decode(data.pdfBase64);
  var pdfFile = folder.createFile(
    Utilities.newBlob(pdfBytes, 'application/pdf', pdfName)
  );

  var runPayload =
    typeof data.runJson === 'string'
      ? data.runJson
      : JSON.stringify(data.runJson || {});
  var runFile = folder.createFile(
    Utilities.newBlob(runPayload, 'application/json', jsonName)
  );

  var sh = ensureArchiveSheet_();
  var rowIndex = findArchiveRow_(sh, periodKey);
  var rowVals = [
    periodKey,
    String(data.periodLabel || periodKey),
    pdfFile.getId(),
    runFile.getId(),
    pdfFile.getUrl(),
    storedName,
    new Date(),
    String(data.runId || ''),
  ];
  var action;
  if (rowIndex === -1) {
    rowIndex = Math.max(sh.getLastRow() + 1, 2);
    action = 'appended';
  } else {
    action = 'updated';
  }
  sh.getRange(rowIndex, 1, 1, rowVals.length).setValues([rowVals]);

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: action,
    periodKey: periodKey,
    pdfFileId: pdfFile.getId(),
    runFileId: runFile.getId(),
    pdfUrl: pdfFile.getUrl(),
    sheetName: ARCHIVE_SHEET,
    row: rowIndex,
  });
}

function listStatementArchive_() {
  var sh = ensureArchiveSheet_();
  var lastRow = Math.max(sh.getLastRow(), 1);
  var items = [];
  if (lastRow >= 2) {
    var values = sh.getRange(2, 1, lastRow, 8).getValues();
    for (var i = 0; i < values.length; i++) {
      var periodKey = String(values[i][0] || '').trim();
      if (!periodKey) continue;
      items.push({
        periodKey: periodKey,
        periodLabel: String(values[i][1] || periodKey),
        pdfFileId: String(values[i][2] || ''),
        runFileId: String(values[i][3] || ''),
        pdfUrl: String(values[i][4] || ''),
        storedName: String(values[i][5] || ''),
        updatedAt: values[i][6] ? String(values[i][6]) : '',
        runId: String(values[i][7] || ''),
      });
    }
  }
  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: 'listed',
    count: items.length,
    items: items,
  });
}

function getStatementArchive_(data) {
  var periodKey = String(data.periodKey || '').trim();
  if (!periodKey) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'getStatementArchive: falta periodKey',
    });
  }
  var sh = ensureArchiveSheet_();
  var rowIndex = findArchiveRow_(sh, periodKey);
  if (rowIndex === -1) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'No hay archivo archivado para ' + periodKey,
    });
  }
  var row = sh.getRange(rowIndex, 1, 1, 8).getValues()[0];
  var pdfFileId = String(row[2] || '');
  var runFileId = String(row[3] || '');
  if (!pdfFileId || !runFileId) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'Archivo incompleto en índice para ' + periodKey,
    });
  }

  var pdfFile = DriveApp.getFileById(pdfFileId);
  var runFile = DriveApp.getFileById(runFileId);
  var pdfBase64 = Utilities.base64Encode(pdfFile.getBlob().getBytes());
  var runText = runFile.getBlob().getDataAsString('UTF-8');
  var runObj = null;
  try {
    runObj = JSON.parse(runText);
  } catch (err) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'JSON del run corrupto: ' + String(err),
    });
  }

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: 'fetched',
    periodKey: periodKey,
    periodLabel: String(row[1] || periodKey),
    storedName: String(row[5] || periodKey + '_estado-cuenta.pdf'),
    pdfFileId: pdfFileId,
    runFileId: runFileId,
    pdfUrl: String(row[4] || pdfFile.getUrl()),
    pdfBase64: pdfBase64,
    run: runObj,
  });
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

    if (data && data.action === 'upsertBanco') {
      return upsertBanco_(data);
    }
    if (data && data.action === 'saveStatementArchive') {
      return saveStatementArchive_(data);
    }
    if (data && data.action === 'listStatementArchive') {
      return listStatementArchive_();
    }
    if (data && data.action === 'getStatementArchive') {
      return getStatementArchive_(data);
    }

    var values = data.values;
    if (!values || !Array.isArray(values)) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'values no es array (¿falta republicar Apps Script v8?)',
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
    var rowIndex;
    var action;
    var nextRow = findNextClientRow_(sheet);

    if (existingRow !== -1) {
      // Ya existe → solo actualizar esa fila (NO mover, NO duplicar)
      rowIndex = existingRow;
      writeRowValues_(sheet, rowIndex, values);
      action = 'updated';
    } else {
      // Nuevo → siguiente casilla después del último cliente
      rowIndex = nextRow;
      sheet.getRange(rowIndex, 1, 1, DEAL_ID_COL).setValues([values]);
      applyCalcFormulas_(sheet, rowIndex);
      action = 'appended';
    }

    return json_({
      ok: true,
      version: SCRIPT_VERSION,
      action: action,
      row: rowIndex,
      nextRowWouldBe: nextRow,
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
