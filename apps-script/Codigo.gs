/**
 * ============================================================
 * Apps Script — Bodasesor Ventas / Finanzas (UN solo /exec)
 * VERSION: 2026-07-18-v12
 * ============================================================
 * PEGAR TODO ESTE ARCHIVO (borrar lo anterior → pegar → Guardar)
 *
 * Luego (IMPORTANTE — Drive):
 *   1) Función authorizeDrive_ → ▶ Ejecutar → aceptar permiso Google Drive
 *   2) Función setupAll_ → ▶ Ejecutar → autorizar Sheets si pide
 *   3) Implementar → Administrar implementaciones → lápiz
 *      → Nueva versión → Implementar (misma URL /exec)
 *
 * Si el panel dice "no permission DriveApp": falta el paso 1.
 *
 * doPost:
 *   - Eventos YYYY (Kommo cierres)
 *   - action=upsertBanco
 *   - action=upsertAnalisis  (pestaña Analisis YYYY)
 *   - action=saveStatementArchive | listStatementArchive | getStatementArchive
 * doGet: { version }
 * setupAll_: Eventos + Metricas + P&L + Banco + Analisis + Estados Archive
 * ============================================================
 */
var SCRIPT_VERSION = '2026-07-18-v12';
var YEAR = 2026;
var EVENTOS_SHEET = 'Eventos ' + YEAR;
var METRICAS_SHEET = 'Metricas ' + YEAR;
var PL_SHEET = 'P&L ' + YEAR;
var BANCO_SHEET = 'Banco ' + YEAR;
var ANALISIS_SHEET = 'Analisis ' + YEAR;
var ARCHIVE_SHEET = 'Estados Archive';
var ARCHIVE_FOLDER_NAME = 'Bodasesor Estados de Cuenta';

var DEFAULT_SHEET_NAME = EVENTOS_SHEET;
var DEAL_ID_COL = 20; // T
var CLIENTE_COL = 1; // A
var MAX_CLIENT_SCAN = 500;

// A–J + P–R + T (no toca K Costo, L Pagado, M/N/O fórmulas, S IVA)
var WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 20];

var EVENTOS_HEADERS = [
  'Cliente',
  'Fecha del evento',
  'Fecha de cierre',
  'Telefono',
  'Correo',
  'Tipo de evento',
  'Invitados',
  'Dirección de evento',
  'Horario',
  'Venta',
  'Costo',
  'Pagado',
  'Por pagar',
  'Ganancia',
  'Margen',
  'Link cotización',
  'Mes cierre',
  'Forma de Pago',
  'IVA',
  'Kommo Deal ID',
];

var BANCO_HEADERS = [
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
  'Socios',
  'Proveedores',
];

function isWritableSheet_(name) {
  return /^Eventos \d{4}$/.test(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doGet() {
  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    ping: true,
    sheets: [
      EVENTOS_SHEET,
      METRICAS_SHEET,
      PL_SHEET,
      BANCO_SHEET,
      ANALISIS_SHEET,
      ARCHIVE_SHEET,
    ],
  });
}

function testPing() {
  Logger.log(SCRIPT_VERSION);
}

/* ===================== Eventos helpers ===================== */

function findNextClientRow_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var scanTo = Math.min(Math.max(lastRow, 2), MAX_CLIENT_SCAN);
  var values = sheet.getRange(2, CLIENTE_COL, scanTo, CLIENTE_COL).getValues();
  var lastFilled = 1;
  var emptyStreak = 0;

  for (var i = 0; i < values.length; i++) {
    var cell = String(values[i][0]).trim();
    if (cell !== '') {
      lastFilled = i + 2;
      emptyStreak = 0;
    } else if (lastFilled >= 2) {
      emptyStreak++;
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
    if (String(ids[i][0]).trim() === dealId) return i + 2;
  }
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

function applyCalcFormulas_(sheet, row) {
  // M Por pagar = Venta - Pagado
  sheet
    .getRange(row, 13)
    .setFormula(
      '=IF(J' + row + '="","",J' + row + '-IF(L' + row + '="",0,L' + row + '))'
    );
  // N Ganancia = Venta - Costo
  sheet
    .getRange(row, 14)
    .setFormula(
      '=IF(J' + row + '="","",J' + row + '-IF(K' + row + '="",0,K' + row + '))'
    );
  // O Margen = Ganancia / Venta
  sheet
    .getRange(row, 15)
    .setFormula(
      '=IF(OR(J' + row + '="",J' + row + '=0),"",N' + row + '/J' + row + ')'
    );
  sheet.getRange(row, 15).setNumberFormat('0.00%');
}

function writeRowValues_(sheet, rowIndex, values) {
  for (var c = 0; c < WRITE_COLS.length; c++) {
    var col = WRITE_COLS[c];
    sheet.getRange(rowIndex, col).setValue(values[col - 1]);
  }
  applyCalcFormulas_(sheet, rowIndex);
}

/* ===================== Banco ===================== */

function ensureBancoSheet_(ss) {
  var sh = ss.getSheetByName(BANCO_SHEET);
  if (!sh) sh = ss.insertSheet(BANCO_SHEET);
  var h1 = String(sh.getRange(1, 1).getValue()).trim();
  var lastH = String(
    sh.getRange(1, BANCO_HEADERS.length).getValue()
  ).trim();
  if (h1 !== 'Mes' || lastH !== 'Proveedores') {
    sh.getRange(1, 1, 1, BANCO_HEADERS.length).setValues([BANCO_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function upsertBanco_(data) {
  var year = Number(data.year) || YEAR;
  var month = Number(data.month);
  var periodKey = String(data.periodKey || '').trim();
  if (!periodKey || !month || month < 1 || month > 12) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'upsertBanco: falta periodKey o month',
    });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureBancoSheet_(ss);

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
    by.socio || 0,
    by.proveedor || 0,
  ];

  var lastRow = Math.max(sh.getLastRow(), 1);
  var rowIndex = -1;
  if (lastRow >= 2) {
    var keys = sh.getRange(2, 2, lastRow, 2).getValues();
    for (var r = 0; r < keys.length; r++) {
      if (String(keys[r][0]).trim() === periodKey) {
        rowIndex = r + 2;
        break;
      }
    }
  }

  var action;
  if (rowIndex === -1) {
    rowIndex = Math.max(sh.getLastRow() + 1, 2);
    action = 'appended';
  } else {
    action = 'updated';
  }

  sh.getRange(rowIndex, 1, 1, rowVals.length).setValues([rowVals]);
  sh.getRange(rowIndex, 4, 1, 18).setNumberFormat('$#,##0.00');

  // Re-enlaza P&L / Metricas con banco
  setupPnL_(ss);
  setupMetricas_(ss);

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: action,
    row: rowIndex,
    sheetName: BANCO_SHEET,
    periodKey: periodKey,
  });
}

/* ===================== Drive archive (PDFs) ===================== */

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
    } catch (err) {}
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

  var storedName = String(
    data.storedName || periodKey + '_estado-cuenta.pdf'
  ).trim();
  var pdfName = periodKey + '_estado-cuenta.pdf';
  var jsonName = periodKey + '_run.json';
  var folder = getArchiveFolder_();

  removeFilesNamedInFolder_(folder, pdfName);
  removeFilesNamedInFolder_(folder, jsonName);

  var pdfFile = folder.createFile(
    Utilities.newBlob(
      Utilities.base64Decode(data.pdfBase64),
      'application/pdf',
      pdfName
    )
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
  var action = rowIndex === -1 ? 'appended' : 'updated';
  if (rowIndex === -1) rowIndex = Math.max(sh.getLastRow() + 1, 2);
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
  var runObj = JSON.parse(runFile.getBlob().getDataAsString('UTF-8'));

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
    pdfBase64: Utilities.base64Encode(pdfFile.getBlob().getBytes()),
    run: runObj,
  });
}

/* ===================== doPost ===================== */

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

    if (data && data.action === 'upsertBanco') return upsertBanco_(data);
    if (data && data.action === 'upsertAnalisis') return upsertAnalisis_(data);
    if (data && data.action === 'saveStatementArchive') {
      return saveStatementArchive_(data);
    }
    if (data && data.action === 'listStatementArchive') {
      return listStatementArchive_();
    }
    if (data && data.action === 'getStatementArchive') {
      return getStatementArchive_(data);
    }
    if (data && data.action === 'setupAll') {
      setupAllSilent_();
      return json_({ ok: true, version: SCRIPT_VERSION, action: 'setupAll' });
    }

    var values = data.values;
    if (!values || !Array.isArray(values)) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'values no es array (¿Apps Script v12 publicado?)',
        typeofValues: typeof values,
        rawPreview: String(raw).slice(0, 200),
      });
    }

    values = values.slice(0, DEAL_ID_COL);
    while (values.length < DEAL_ID_COL) values.push('');

    var dealId = String(data.dealId || values[19] || '').trim();
    var sheetName = String(data.sheetName || EVENTOS_SHEET).trim();

    if (!dealId) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'Falta dealId',
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
    var nextRow = findNextClientRow_(sheet);
    var rowIndex;
    var action;

    if (existingRow !== -1) {
      rowIndex = existingRow;
      writeRowValues_(sheet, rowIndex, values);
      action = 'updated';
    } else {
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

/* ===================== SETUP (Metricas + P&L bien) ===================== */

/**
 * OBLIGATORIO UNA VEZ: authorizeDrive_ → ▶ Ejecutar → Aceptar Drive.
 * Sin esto, saveStatementArchive falla y el panel no guarda PDFs.
 */
function authorizeDrive_() {
  var folder = getArchiveFolder_();
  var sh = ensureArchiveSheet_();
  var msg =
    'Drive OK — ' +
    SCRIPT_VERSION +
    '\n\nCarpeta: ' +
    ARCHIVE_FOLDER_NAME +
    '\nID: ' +
    folder.getId() +
    '\nURL: ' +
    folder.getUrl() +
    '\nPestaña: ' +
    ARCHIVE_SHEET +
    ' (filas: ' +
    sh.getLastRow() +
    ')\n\nAhora: setupAll_ (si falta) → Administrar implementaciones → Nueva versión.';
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
  return folder.getId();
}

/**
 * EJECUTAR DESDE EL EDITOR: selecciona setupAll_ → ▶ Ejecutar
 * Crea/arregla Eventos, Metricas, P&L, Banco, Estados Archive.
 * NO borra clientes ni Costo/Pagado manuales.
 */
function setupAll_() {
  setupAllSilent_();
  var msg =
    'Setup OK — ' +
    SCRIPT_VERSION +
    '\n\n' +
    '✓ ' +
    EVENTOS_SHEET +
    ' (fórmulas M/N/O + tabla W:AB)\n' +
    '✓ ' +
    METRICAS_SHEET +
    ' (ventas + banco por mes)\n' +
    '✓ ' +
    PL_SHEET +
    ' (P&L completo)\n' +
      '✓ ' +
      BANCO_SHEET +
      ' (estados de cuenta)\n' +
      '✓ ' +
      ANALISIS_SHEET +
      ' (top proveedores / socios)\n' +
      '✓ ' +
      ARCHIVE_SHEET +
      ' + carpeta Drive PDFs\n\n' +
      'Siguiente: Administrar implementaciones → Nueva versión → Implementar';
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
}

function setupAllSilent_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var eventos = ensureEventosSheet_(ss);
  setupEventosRowFormulas_(eventos);
  setupMonthlyTable_(eventos);
  ensureBancoSheet_(ss);
  ensureArchiveSheet_();
  getArchiveFolder_();
  setupMetricas_(ss);
  setupPnL_(ss);
  ensureAnalisisSheet_(ss, YEAR);
}

function ensureEventosSheet_(ss) {
  var sh = ss.getSheetByName(EVENTOS_SHEET);
  if (!sh) sh = ss.insertSheet(EVENTOS_SHEET);
  // Encabezados si faltan
  if (String(sh.getRange(1, 1).getValue()).trim() !== 'Cliente') {
    sh.getRange(1, 1, 1, EVENTOS_HEADERS.length).setValues([EVENTOS_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function setupEventosRowFormulas_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var clientes = sheet.getRange(2, 1, lastRow, 1).getValues();
  for (var i = 0; i < clientes.length; i++) {
    var row = i + 2;
    if (String(clientes[i][0]).trim() === '') {
      sheet.getRange(row, 13, 1, 3).clearContent();
      continue;
    }
    applyCalcFormulas_(sheet, row);
  }
  // Formato dinero en Venta/Costo/Pagado
  if (lastRow >= 2) {
    sheet.getRange(2, 10, lastRow, 12).setNumberFormat('$#,##0.00');
    sheet.getRange(2, 13, lastRow, 14).setNumberFormat('$#,##0.00');
  }
}

/** Tabla mensual Eventos en W3:AB16 */
function setupMonthlyTable_(sheet) {
  sheet.getRange('W3:AB3').setValues([
    ['Mes', 'Pagado', 'Por pagar', 'Valor total', 'Ganancia total', '# Eventos'],
  ]);
  for (var m = 1; m <= 12; m++) {
    var r = 3 + m;
    sheet.getRange(r, 23).setValue(m);
    sheet.getRange(r, 24).setFormula('=SUMIF($Q:$Q,W' + r + ',$L:$L)');
    sheet.getRange(r, 25).setFormula('=SUMIF($Q:$Q,W' + r + ',$M:$M)');
    sheet.getRange(r, 26).setFormula('=SUMIF($Q:$Q,W' + r + ',$J:$J)');
    sheet.getRange(r, 27).setFormula('=SUMIF($Q:$Q,W' + r + ',$N:$N)');
    sheet.getRange(r, 28).setFormula('=COUNTIFS($Q:$Q,W' + r + ',$A:$A,"<>")');
  }
  sheet.getRange(16, 23).setValue('Total anual');
  sheet.getRange(16, 24).setFormula('=SUM(X4:X15)');
  sheet.getRange(16, 25).setFormula('=SUM(Y4:Y15)');
  sheet.getRange(16, 26).setFormula('=SUM(Z4:Z15)');
  sheet.getRange(16, 27).setFormula('=SUM(AA4:AA15)');
  sheet.getRange(16, 28).setFormula('=SUM(AB4:AB15)');
  sheet.getRange('X4:AA16').setNumberFormat('$#,##0.00');
}

/**
 * Metricas YYYY — panel de control
 * Bloque A: ventas/eventos (desde tabla W:AB de Eventos)
 * Bloque B: banco (desde Banco YYYY)
 */
function setupMetricas_(ss) {
  var sh = ss.getSheetByName(METRICAS_SHEET);
  if (!sh) sh = ss.insertSheet(METRICAS_SHEET);
  sh.clear();

  sh.getRange('A1').setValue('Metricas ' + YEAR + ' — Bodasesor');
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);

  // --- Ventas / Eventos ---
  sh.getRange('A3').setValue('VENTAS / EVENTOS');
  sh.getRange('A3').setFontWeight('bold');
  sh.getRange('A4:F4').setValues([
    ['Mes', 'Pagado', 'Por pagar', 'Valor total', 'Ganancia', '# Eventos'],
  ]);
  sh.getRange('A4:F4').setFontWeight('bold');

  for (var m = 1; m <= 12; m++) {
    var r = 4 + m; // fila 5 = mes 1 … fila 16 = mes 12
    var src = 3 + m; // Eventos fila 4 = mes 1
    sh.getRange(r, 1).setValue(m);
    sh.getRange(r, 2).setFormula("='" + EVENTOS_SHEET + "'!X" + src);
    sh.getRange(r, 3).setFormula("='" + EVENTOS_SHEET + "'!Y" + src);
    sh.getRange(r, 4).setFormula("='" + EVENTOS_SHEET + "'!Z" + src);
    sh.getRange(r, 5).setFormula("='" + EVENTOS_SHEET + "'!AA" + src);
    sh.getRange(r, 6).setFormula("='" + EVENTOS_SHEET + "'!AB" + src);
  }
  sh.getRange(17, 1).setValue('Total anual');
  sh.getRange(17, 1).setFontWeight('bold');
  sh.getRange(17, 2).setFormula('=SUM(B5:B16)');
  sh.getRange(17, 3).setFormula('=SUM(C5:C16)');
  sh.getRange(17, 4).setFormula('=SUM(D5:D16)');
  sh.getRange(17, 5).setFormula('=SUM(E5:E16)');
  sh.getRange(17, 6).setFormula('=SUM(F5:F16)');
  sh.getRange('B5:E17').setNumberFormat('$#,##0.00');

  // --- Banco ---
  sh.getRange('A19').setValue('BANCO (estados de cuenta)');
  sh.getRange('A19').setFontWeight('bold');
  sh.getRange('A20:E20').setValues([
    ['Mes', 'Ingresos banco', 'Gastos banco', 'Neto banco', 'Cuadra'],
  ]);
  sh.getRange('A20:E20').setFontWeight('bold');

  for (var bm = 1; bm <= 12; bm++) {
    var br = 20 + bm; // 21..32
    sh.getRange(br, 1).setValue(bm);
    sh.getRange(br, 2).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + br + ",'" + BANCO_SHEET + "'!$D:$D),0)"
    );
    sh.getRange(br, 3).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + br + ",'" + BANCO_SHEET + "'!$E:$E),0)"
    );
    sh.getRange(br, 4).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + br + ",'" + BANCO_SHEET + "'!$F:$F),0)"
    );
    sh.getRange(br, 5).setFormula(
      "=IFERROR(INDEX('" +
        BANCO_SHEET +
        "'!$V:$V,MATCH(A" +
        br +
        ",'" +
        BANCO_SHEET +
        "'!$A:$A,0)),\"\")"
    );
  }
  sh.getRange(33, 1).setValue('Total anual');
  sh.getRange(33, 1).setFontWeight('bold');
  sh.getRange(33, 2).setFormula('=SUM(B21:B32)');
  sh.getRange(33, 3).setFormula('=SUM(C21:C32)');
  sh.getRange(33, 4).setFormula('=SUM(D21:D32)');
  sh.getRange('B21:D33').setNumberFormat('$#,##0.00');

  sh.setColumnWidth(1, 90);
  for (var c = 2; c <= 6; c++) sh.setColumnWidth(c, 120);
}

/**
 * P&L YYYY — resultado del negocio por mes
 * Ventas (Eventos) + Banco (estados) → resultado
 */
function setupPnL_(ss) {
  var sh = ss.getSheetByName(PL_SHEET);
  if (!sh) sh = ss.insertSheet(PL_SHEET);
  sh.clear();

  sh.getRange('A1').setValue('P&L ' + YEAR + ' — Bodasesor');
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue(
    'Ventas desde Eventos · Banco desde pestaña Banco (botón Enviar al P&L)'
  );

  sh.getRange('A4:I4').setValues([
    [
      'Mes',
      'Ingresos ventas',
      'Costo eventos',
      'Ganancia eventos',
      'Margen %',
      'Ingresos banco',
      'Gastos banco',
      'Neto banco',
      'Resultado mes',
    ],
  ]);
  sh.getRange('A4:I4').setFontWeight('bold');

  for (var m = 1; m <= 12; m++) {
    var r = 4 + m; // 5..16
    var ev = 3 + m; // Eventos tabla W fila 4 = mes 1
    sh.getRange(r, 1).setValue(m);

    // B Ingresos ventas = Eventos Z (valor total)
    sh.getRange(r, 2).setFormula("='" + EVENTOS_SHEET + "'!Z" + ev);
    // C Costo eventos = SUMIF costo K por mes cierre Q
    sh.getRange(r, 3).setFormula(
      "=SUMIF('" + EVENTOS_SHEET + "'!$Q:$Q,A" + r + ",'" + EVENTOS_SHEET + "'!$K:$K)"
    );
    // D Ganancia eventos = Eventos AA
    sh.getRange(r, 4).setFormula("='" + EVENTOS_SHEET + "'!AA" + ev);
    // E Margen
    sh.getRange(r, 5).setFormula('=IF(B' + r + '=0,"",D' + r + '/B' + r + ')');

    // F/G/H Banco
    sh.getRange(r, 6).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$D:$D),0)"
    );
    sh.getRange(r, 7).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$E:$E),0)"
    );
    sh.getRange(r, 8).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$F:$F),0)"
    );

    // I Resultado = Ganancia eventos + Neto banco
    sh.getRange(r, 9).setFormula('=D' + r + '+H' + r);
  }

  sh.getRange(17, 1).setValue('Total anual');
  sh.getRange(17, 1).setFontWeight('bold');
  sh.getRange(17, 2).setFormula('=SUM(B5:B16)');
  sh.getRange(17, 3).setFormula('=SUM(C5:C16)');
  sh.getRange(17, 4).setFormula('=SUM(D5:D16)');
  sh.getRange(17, 5).setFormula('=IF(B17=0,"",D17/B17)');
  sh.getRange(17, 6).setFormula('=SUM(F5:F16)');
  sh.getRange(17, 7).setFormula('=SUM(G5:G16)');
  sh.getRange(17, 8).setFormula('=SUM(H5:H16)');
  sh.getRange(17, 9).setFormula('=SUM(I5:I16)');

  sh.getRange('B5:D17').setNumberFormat('$#,##0.00');
  sh.getRange('E5:E17').setNumberFormat('0.00%');
  sh.getRange('F5:I17').setNumberFormat('$#,##0.00');

  sh.setColumnWidth(1, 70);
  for (var col = 2; col <= 9; col++) sh.setColumnWidth(col, 130);

  sh.getRange('A19').setValue(
    'Nota: Costo eventos se llena a mano en Eventos col K. Pagado en col L. Banco llega con el botón del panel /pnl/.'
  );
}

/* ===================== Analisis (proveedores / socios / anual) ===================== */

function ensureAnalisisSheet_(ss, year) {
  var y = year || YEAR;
  var name = 'Analisis ' + y;
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/**
 * Reescribe Analisis YYYY con resumen mensual, top proveedores y socios.
 * Socios fijos: Luis Alejandro Sanchez Campbell, Alejandro Zorrilla Elorza.
 * Resto de traspasos con nombre = proveedor.
 */
function upsertAnalisis_(data) {
  var year = Number(data.year) || YEAR;
  var a = data.analysis || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureAnalisisSheet_(ss, year);
  var sheetName = 'Analisis ' + year;
  sh.clear();

  sh.getRange('A1').setValue('Analisis ' + year + ' — Bodasesor (banco)');
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue(
    'Socios: Luis Alejandro Sanchez Campbell · Alejandro Zorrilla Elorza. Resto de traspasos con beneficiario = Proveedor.'
  );
  sh.getRange('A3').setValue(
    'Actualizado: ' +
      new Date() +
      ' · Meses: ' +
      ((a.monthsPresent || []).join(', ') || '(sin datos)') +
      ' · Runs: ' +
      (a.runsCount || 0)
  );

  // --- Resumen anual ---
  sh.getRange('A5').setValue('RESUMEN ANUAL');
  sh.getRange('A5').setFontWeight('bold');
  sh.getRange('A6:B11').setValues([
    ['Ingresos', Number(a.ingresos) || 0],
    ['Gastos', Number(a.gastos) || 0],
    ['Neto', Number(a.neto) || 0],
    ['Pagos a socios', Number(a.sociosTotal) || 0],
    ['Pagos a proveedores', Number(a.proveedoresTotal) || 0],
    [
      'Concentración top 1 / top 3 / top 5',
      ((a.concentracion && a.concentracion.top1Share) || 0) * 100 +
        '% / ' +
        ((a.concentracion && a.concentracion.top3Share) || 0) * 100 +
        '% / ' +
        ((a.concentracion && a.concentracion.top5Share) || 0) * 100 +
        '%',
    ],
  ]);
  sh.getRange('B6:B10').setNumberFormat('$#,##0.00');

  // --- Mensual ---
  sh.getRange('A13').setValue('MENSUAL');
  sh.getRange('A13').setFontWeight('bold');
  sh.getRange('A14:K14').setValues([
    [
      'Mes',
      'Label',
      'Ingresos',
      'Gastos',
      'Neto',
      'Socios',
      'Proveedores',
      'Ads',
      'Apps',
      'Comisiones',
      'Cuadra',
    ],
  ]);
  sh.getRange('A14:K14').setFontWeight('bold');

  var months = a.byMonth || [];
  for (var i = 0; i < months.length; i++) {
    var m = months[i];
    var r = 15 + i;
    sh.getRange(r, 1, 1, 11).setValues([
      [
        String(m.periodKey || ''),
        String(m.periodLabel || ''),
        Number(m.ingresos) || 0,
        Number(m.gastos) || 0,
        Number(m.neto) || 0,
        Number(m.socios) || 0,
        Number(m.proveedores) || 0,
        Number(m.ads) || 0,
        Number(m.apps) || 0,
        Number(m.comisiones) || 0,
        m.cuadra === true ? 'SI' : m.cuadra === false ? 'NO' : '',
      ],
    ]);
  }
  if (months.length) {
    sh.getRange(15, 3, months.length, 8).setNumberFormat('$#,##0.00');
  }

  var topStart = 15 + Math.max(months.length, 1) + 2;
  sh.getRange(topStart, 1).setValue('TOP PROVEEDORES DEL AÑO (negociación)');
  sh.getRange(topStart, 1).setFontWeight('bold');
  sh.getRange(topStart + 1, 1, 1, 5).setValues([
    ['#', 'Proveedor', 'Gasto acumulado', '% del gasto proveedores', '# pagos'],
  ]);
  sh.getRange(topStart + 1, 1, 1, 5).setFontWeight('bold');

  var tops = a.topProveedores || a.top5Proveedores || [];
  var maxTop = Math.min(tops.length, 25);
  for (var t = 0; t < maxTop; t++) {
    var p = tops[t];
    sh.getRange(topStart + 2 + t, 1, 1, 5).setValues([
      [
        t + 1,
        String(p.name || ''),
        Number(p.total) || 0,
        Number(p.shareOfProviders) || 0,
        Number(p.payments) || 0,
      ],
    ]);
  }
  if (maxTop) {
    sh.getRange(topStart + 2, 3, maxTop, 1).setNumberFormat('$#,##0.00');
    sh.getRange(topStart + 2, 4, maxTop, 1).setNumberFormat('0.0%');
  }

  var socStart = topStart + 2 + maxTop + 2;
  sh.getRange(socStart, 1).setValue('SOCIOS (traspasos)');
  sh.getRange(socStart, 1).setFontWeight('bold');
  sh.getRange(socStart + 1, 1, 1, 3).setValues([
    ['Socio', 'Total transferido', '# pagos'],
  ]);
  sh.getRange(socStart + 1, 1, 1, 3).setFontWeight('bold');
  var socios = a.socios || [];
  for (var s = 0; s < socios.length; s++) {
    sh.getRange(socStart + 2 + s, 1, 1, 3).setValues([
      [
        String(socios[s].name || ''),
        Number(socios[s].total) || 0,
        Number(socios[s].payments) || 0,
      ],
    ]);
  }
  if (socios.length) {
    sh.getRange(socStart + 2, 2, socios.length, 1).setNumberFormat('$#,##0.00');
  }

  // Top proveedores por mes (bloque a la derecha)
  sh.getRange('M13').setValue('TOP 5 PROVEEDORES POR MES');
  sh.getRange('M13').setFontWeight('bold');
  var col = 13; // M
  var row = 14;
  for (var mi = 0; mi < months.length; mi++) {
    var mm = months[mi];
    sh.getRange(row, col).setValue(String(mm.periodLabel || mm.periodKey));
    sh.getRange(row, col).setFontWeight('bold');
    sh.getRange(row + 1, col, 1, 3).setValues([['Proveedor', 'Gasto', 'Pagos']]);
    var tp = mm.topProveedores || [];
    for (var pi = 0; pi < tp.length; pi++) {
      sh.getRange(row + 2 + pi, col, 1, 3).setValues([
        [
          String(tp[pi].name || ''),
          Number(tp[pi].total) || 0,
          Number(tp[pi].payments) || 0,
        ],
      ]);
    }
    if (tp.length) {
      sh.getRange(row + 2, col + 1, tp.length, 1).setNumberFormat('$#,##0.00');
    }
    row += 9;
  }

  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 160);
  for (var c = 3; c <= 11; c++) sh.setColumnWidth(c, 110);

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: 'upsertAnalisis',
    sheetName: sheetName,
    year: year,
    months: (a.monthsPresent || []).length,
    topProveedores: maxTop,
  });
}
