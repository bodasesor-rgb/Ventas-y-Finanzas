/**
 * ============================================================
 * Apps Script — Bodasesor Ventas / Finanzas (UN solo /exec)
 * VERSION: 2026-07-20-v17
 * ============================================================
 * PEGAR TODO ESTE ARCHIVO (borrar lo anterior → pegar → Guardar)
 *
 * Luego:
 *   1) authorizeDrive_ → ▶ Ejecutar (Drive)
 *   2) restorePnLBanco_ → ▶ Arma columnas ene–dic (NO toca Metricas)
 *   3) Implementar → Nueva versión → misma URL /exec
 *
 * REGLA v17:
 *   - "Enviar al P&L" escribe Banco YYYY + pega resultados en la
 *     columna del mes en P&L YYYY (ene=B … dic=M)
 *   - Metricas NUNCA se toca
 *
 * doPost: Eventos | upsertBanco | upsertAnalisis | archive Drive
 * ============================================================
 */
var SCRIPT_VERSION = '2026-07-20-v17';
var METRICAS_MARKER = 'BOT_METRICAS_V14';
var PNL_MARKER = 'BOT_PNL_MESES_V17';
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

/** 1→A, 2→B, … 27→AA */
function columnToLetter_(col) {
  var n = Number(col);
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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
    // Montos salidos (positivos) para leer fácil en Metricas
    Math.abs(by.socio || 0),
    Math.abs(by.proveedor || 0),
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
  // Formato Socios / Proveedores (cols 26-27)
  sh.getRange(rowIndex, 26, 1, 2).setNumberFormat('$#,##0.00');

  // Pega resultados en la columna del mes en P&L (sin tocar Metricas)
  var pnlCol = pasteMonthToPnL_(ss, month, by, {
    ingresos: Number(data.ingresos) || 0,
    gastos: Number(data.gastos) || 0,
    neto: Number(data.neto) || 0,
    otros: Number(data.otros) || 0,
  });

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: action,
    row: rowIndex,
    sheetName: BANCO_SHEET,
    pnlSheet: PL_SHEET,
    pnlMonthCol: pnlCol,
    periodKey: periodKey,
  });
}

/**
 * Asegura layout P&L (columnas por mes). Solo regenera si falta el marcador v17.
 * Nunca toca Metricas.
 */
function ensurePnLLayout_(ss) {
  var sh = ss.getSheetByName(PL_SHEET);
  if (!sh) {
    setupPnL_(ss);
    return ss.getSheetByName(PL_SHEET);
  }
  var marker = String(sh.getRange('A2').getValue() || '');
  if (marker.indexOf(PNL_MARKER) === -1) {
    setupPnL_(ss);
  }
  return ss.getSheetByName(PL_SHEET);
}

/**
 * Pega en P&L los resultados del mes en su columna (B=ene … M=dic).
 * Filas manuales (Intereses, Catering…, Impuestos) no se pisan.
 * TOTAL / Bruto / Margen / Neto siguen siendo fórmulas.
 */
function pasteMonthToPnL_(ss, month, by, totals) {
  var sh = ensurePnLLayout_(ss);
  var col = Number(month) + 1; // mes 1 → col B (2)
  if (col < 2 || col > 13) return null;

  function abs_(n) {
    return Math.abs(Number(n) || 0);
  }
  function money_(row, value) {
    sh.getRange(row, col).setValue(Number(value) || 0);
    sh.getRange(row, col).setNumberFormat('$#,##0.00');
  }

  var venta = Number(by.venta) || 0;
  var ingreso = Number(by.ingreso) || 0;
  // Si no hay desglose de cats de ingreso, usa total de abonos del estado
  if (venta === 0 && ingreso === 0 && (totals.ingresos || 0) > 0) {
    ingreso = totals.ingresos;
  }

  // Ingreso (no pisa Intereses ni líneas de negocio manuales)
  money_(8, venta);
  money_(9, ingreso);

  // Egreso
  money_(17, abs_(by.proveedor));
  money_(18, abs_(by.evento));

  // Gastos
  money_(30, abs_(by.ads));
  money_(31, abs_(by.pago));
  money_(32, abs_(by.apps) + abs_(by.pass));
  money_(
    34,
    abs_(by.comisiones) +
      abs_(by.servicios) +
      abs_(by.transferencia_persona) +
      abs_(by.revisar) +
      abs_(by.otro) +
      abs_(totals.otros)
  );

  // Banco / CAPITAL
  money_(40, Number(totals.neto) || 0);
  money_(41, abs_(by.socio));

  return columnToLetter_(col);
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

function deleteStatementArchive_(data) {
  var periodKey = String(data.periodKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'deleteStatementArchive: periodKey inválido',
    });
  }
  var sh = ensureArchiveSheet_();
  var rowIndex = findArchiveRow_(sh, periodKey);
  var pdfFileId = '';
  var runFileId = '';
  if (rowIndex !== -1) {
    var row = sh.getRange(rowIndex, 1, 1, 8).getValues()[0];
    pdfFileId = String(row[2] || '');
    runFileId = String(row[3] || '');
    sh.deleteRow(rowIndex);
  }
  var trashed = [];
  function trashId(id) {
    if (!id) return;
    try {
      DriveApp.getFileById(id).setTrashed(true);
      trashed.push(id);
    } catch (err) {}
  }
  trashId(pdfFileId);
  trashId(runFileId);
  // Por si quedaron archivos con nombre fijo
  try {
    var folder = getArchiveFolder_();
    removeFilesNamedInFolder_(folder, periodKey + '_estado-cuenta.pdf');
    removeFilesNamedInFolder_(folder, periodKey + '_run.json');
  } catch (err2) {}

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: 'deleted',
    periodKey: periodKey,
    trashed: trashed.length,
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
    if (data && data.action === 'deleteStatementArchive') {
      return deleteStatementArchive_(data);
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
        error: 'values no es array (¿Apps Script v17 publicado?)',
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
 * Crea/arregla Eventos, P&L banco, Banco, Archive. NO toca Metricas.
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
    BANCO_SHEET +
    ' (estados de cuenta, 1 fila/mes)\n' +
    '✓ ' +
    PL_SHEET +
    ' (resumen Ingreso/Egreso/Gastos por mes)\n' +
    '✓ ' +
    ARCHIVE_SHEET +
    ' + Drive\n\n' +
    'Metricas NO se tocó.\n' +
    'P&L: restorePnLBanco_\n\n' +
    'Siguiente: Nueva versión → Implementar';
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
  try {
    getArchiveFolder_();
  } catch (err) {}
  // Solo P&L de banco — NUNCA Metricas
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
 * Metricas YYYY — CICLO ANUAL (ventas + banco).
 * El bot NO la llama en setupAll_ ni al enviar banco.
 * Solo existe por si algún día quieres regenerarla a mano (no recomendado).
 */
function setupMetricas_(ss) {
  var sh = ss.getSheetByName(METRICAS_SHEET);
  if (!sh) sh = ss.insertSheet(METRICAS_SHEET);
  // Zona gestionada A1:L50 — se limpia SOLO aquí, a propósito, al restaurar
  sh.getRange('A1:L50').clear();

  sh.getRange('A1').setValue('Metricas ' + YEAR + ' — Ciclo anual Bodasesor');
  sh.getRange('A1').setFontWeight('bold').setFontSize(16);
  sh.getRange('A2').setValue(METRICAS_MARKER + ' · ' + SCRIPT_VERSION);
  sh.getRange('A2').setFontColor('#666666');
  sh.getRange('B2').setValue(
    'Ventas ← Eventos · Banco ← pestaña Banco · Socios/Proveedores ← cols Z/AA Banco'
  );

  // ===== KPIs ANUALES (ciclo) =====
  sh.getRange('A4').setValue('CICLO ANUAL ' + YEAR);
  sh.getRange('A4').setFontWeight('bold').setFontSize(12);

  sh.getRange('A5:L5').setValues([
    [
      'Ventas (valor)',
      'Pagado',
      'Por pagar',
      'Ganancia eventos',
      '# Eventos',
      'Ingresos banco',
      'Gastos banco',
      'Neto banco',
      'Socios',
      'Proveedores',
      'Resultado (gan+neto)',
      'Margen eventos',
    ],
  ]);
  sh.getRange('A5:L5').setFontWeight('bold');
  sh.getRange('A5:L5').setBackground('#e8f0ee');

  // KPIs (fórmulas finales se fijan al final del layout → filas 38 y 54)
  sh.getRange('A6:L6').setFontWeight('bold').setFontSize(12);

  // ===== CICLO MENSUAL (todo junto) =====
  sh.getRange('A8').setValue('CICLO MENSUAL (ventas + banco)');
  sh.getRange('A8').setFontWeight('bold').setFontSize(12);
  sh.getRange('A9:L9').setValues([
    [
      'Mes',
      'Pagado',
      'Por pagar',
      'Valor ventas',
      'Ganancia',
      '# Eventos',
      'Ing. banco',
      'Gast. banco',
      'Neto banco',
      'Socios',
      'Proveedores',
      'Resultado mes',
    ],
  ]);
  sh.getRange('A9:L9').setFontWeight('bold').setBackground('#f3ebe0');

  for (var m = 1; m <= 12; m++) {
    var r = 9 + m; // 10..21
    var src = 3 + m; // Eventos W tabla fila 4 = mes 1
    sh.getRange(r, 1).setValue(m);
    sh.getRange(r, 2).setFormula("='" + EVENTOS_SHEET + "'!X" + src);
    sh.getRange(r, 3).setFormula("='" + EVENTOS_SHEET + "'!Y" + src);
    sh.getRange(r, 4).setFormula("='" + EVENTOS_SHEET + "'!Z" + src);
    sh.getRange(r, 5).setFormula("='" + EVENTOS_SHEET + "'!AA" + src);
    sh.getRange(r, 6).setFormula("='" + EVENTOS_SHEET + "'!AB" + src);
    sh.getRange(r, 7).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$D:$D),0)"
    );
    sh.getRange(r, 8).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$E:$E),0)"
    );
    sh.getRange(r, 9).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$F:$F),0)"
    );
    // Socios = col Z (26), Proveedores = col AA (27) de Banco
    sh.getRange(r, 10).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$Z:$Z),0)"
    );
    sh.getRange(r, 11).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + r + ",'" + BANCO_SHEET + "'!$AA:$AA),0)"
    );
    sh.getRange(r, 12).setFormula('=E' + r + '+I' + r);
  }
  sh.getRange(22, 1).setValue('TOTAL AÑO');
  sh.getRange(22, 1).setFontWeight('bold');
  sh.getRange(22, 2).setFormula('=SUM(B10:B21)');
  sh.getRange(22, 3).setFormula('=SUM(C10:C21)');
  sh.getRange(22, 4).setFormula('=SUM(D10:D21)');
  sh.getRange(22, 5).setFormula('=SUM(E10:E21)');
  sh.getRange(22, 6).setFormula('=SUM(F10:F21)');
  sh.getRange(22, 7).setFormula('=SUM(G10:G21)');
  sh.getRange(22, 8).setFormula('=SUM(H10:H21)');
  sh.getRange(22, 9).setFormula('=SUM(I10:I21)');
  sh.getRange(22, 10).setFormula('=SUM(J10:J21)');
  sh.getRange(22, 11).setFormula('=SUM(K10:K21)');
  sh.getRange(22, 12).setFormula('=SUM(L10:L21)');
  sh.getRange('B10:E22').setNumberFormat('$#,##0.00');
  sh.getRange('G10:L22').setNumberFormat('$#,##0.00');
  sh.getRange('A22:L22').setBackground('#e8f0ee');

  // ===== Detalle VENTAS =====
  sh.getRange('A24').setValue('DETALLE VENTAS / EVENTOS');
  sh.getRange('A24').setFontWeight('bold');
  sh.getRange('A25:F25').setValues([
    ['Mes', 'Pagado', 'Por pagar', 'Valor total', 'Ganancia', '# Eventos'],
  ]);
  sh.getRange('A25:F25').setFontWeight('bold');
  for (var vm = 1; vm <= 12; vm++) {
    var vr = 25 + vm; // 26..37
    var vs = 3 + vm;
    sh.getRange(vr, 1).setValue(vm);
    sh.getRange(vr, 2).setFormula("='" + EVENTOS_SHEET + "'!X" + vs);
    sh.getRange(vr, 3).setFormula("='" + EVENTOS_SHEET + "'!Y" + vs);
    sh.getRange(vr, 4).setFormula("='" + EVENTOS_SHEET + "'!Z" + vs);
    sh.getRange(vr, 5).setFormula("='" + EVENTOS_SHEET + "'!AA" + vs);
    sh.getRange(vr, 6).setFormula("='" + EVENTOS_SHEET + "'!AB" + vs);
  }
  sh.getRange(38, 1).setValue('Total anual');
  sh.getRange(38, 1).setFontWeight('bold');
  sh.getRange(38, 2).setFormula('=SUM(B26:B37)');
  sh.getRange(38, 3).setFormula('=SUM(C26:C37)');
  sh.getRange(38, 4).setFormula('=SUM(D26:D37)');
  sh.getRange(38, 5).setFormula('=SUM(E26:E37)');
  sh.getRange(38, 6).setFormula('=SUM(F26:F37)');
  sh.getRange('B26:E38').setNumberFormat('$#,##0.00');

  // ===== Detalle BANCO =====
  sh.getRange('A40').setValue('DETALLE BANCO');
  sh.getRange('A40').setFontWeight('bold');
  sh.getRange('A41:G41').setValues([
    [
      'Mes',
      'Ingresos banco',
      'Gastos banco',
      'Neto banco',
      'Socios',
      'Proveedores',
      'Cuadra',
    ],
  ]);
  sh.getRange('A41:G41').setFontWeight('bold');
  for (var bm = 1; bm <= 12; bm++) {
    var br = 41 + bm; // 42..53
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
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + br + ",'" + BANCO_SHEET + "'!$Z:$Z),0)"
    );
    sh.getRange(br, 6).setFormula(
      "=IFERROR(SUMIF('" + BANCO_SHEET + "'!$A:$A,A" + br + ",'" + BANCO_SHEET + "'!$AA:$AA),0)"
    );
    sh.getRange(br, 7).setFormula(
      "=IFERROR(INDEX('" +
        BANCO_SHEET +
        "'!$V:$V,MATCH(A" +
        br +
        ",'" +
        BANCO_SHEET +
        "'!$A:$A,0)),\"\")"
    );
  }
  sh.getRange(54, 1).setValue('Total anual');
  sh.getRange(54, 1).setFontWeight('bold');
  sh.getRange(54, 2).setFormula('=SUM(B42:B53)');
  sh.getRange(54, 3).setFormula('=SUM(C42:C53)');
  sh.getRange(54, 4).setFormula('=SUM(D42:D53)');
  sh.getRange(54, 5).setFormula('=SUM(E42:E53)');
  sh.getRange(54, 6).setFormula('=SUM(F42:F53)');
  sh.getRange('B42:F54').setNumberFormat('$#,##0.00');

  // KPIs anuales (arriba) → totales de detalle
  sh.getRange('A6').setFormula('=D38');
  sh.getRange('B6').setFormula('=B38');
  sh.getRange('C6').setFormula('=C38');
  sh.getRange('D6').setFormula('=E38');
  sh.getRange('E6').setFormula('=F38');
  sh.getRange('F6').setFormula('=B54');
  sh.getRange('G6').setFormula('=C54');
  sh.getRange('H6').setFormula('=D54');
  sh.getRange('I6').setFormula('=E54');
  sh.getRange('J6').setFormula('=F54');
  sh.getRange('K6').setFormula('=D6+H6');
  sh.getRange('L6').setFormula('=IF(A6=0,"",D6/A6)');
  sh.getRange('A6:K6').setNumberFormat('$#,##0.00');
  sh.getRange('L6').setNumberFormat('0.0%');

  sh.getRange('A56').setValue(
    'Nota: Metricas no la toca el bot al enviar estados de cuenta ni con setupAll_. ' +
      'Si la regeneras a mano con setupMetricas_, se pisa tu diseño.'
  );
  sh.getRange('A56').setFontColor('#666666');

  sh.setFrozenRows(5);
  sh.setColumnWidth(1, 110);
  for (var c = 2; c <= 12; c++) sh.setColumnWidth(c, 115);
}

/**
 * P&L YYYY — columnas = meses (B=enero … M=diciembre, N=TOTAL).
 * Al "Enviar al P&L" se PEGAN los resultados en la columna del mes.
 * TOTAL / Ingreso Bruto / Margen / Ingreso Neto = fórmulas.
 * No toca Metricas.
 *
 * Filas de datos (pegadas desde web):
 *   Ingreso: venta (8), ingreso (9)
 *   Egreso:  proveedores (17), costo evento (18)
 *   Gastos:  Marketing/ads (30), RH/pagos (31), Programas (32), Otros (34)
 *   Banco (40), CAPITAL/socios (41)
 * Filas en 0 = manuales (Intereses, Catering…, Impuestos, Banquete…)
 */
function setupPnL_(ss) {
  var sh = ss.getSheetByName(PL_SHEET);
  if (!sh) sh = ss.insertSheet(PL_SHEET);
  sh.getRange('A1:N50').clear();

  var months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];

  sh.getRange('A1').setValue('P&L ' + YEAR + ' · Bodasesor');
  sh.getRange('A1').setFontWeight('bold').setFontSize(16);
  sh.getRange('A2').setValue(PNL_MARKER + ' · ' + SCRIPT_VERSION);
  sh.getRange('A2').setFontColor('#666666');
  sh.getRange('A3').setValue(
    'Columnas = meses. Al Enviar al P&L desde /pnl/ se pegan los resultados en esa columna. Metricas no se toca.'
  );

  // Fila 5: headers meses
  sh.getRange(5, 1).setValue('Concepto');
  for (var m = 1; m <= 12; m++) {
    sh.getRange(5, m + 1).setValue(months[m - 1]).setFontWeight('bold');
  }
  sh.getRange(5, 14).setValue('TOTAL').setFontWeight('bold');
  sh.getRange(5, 1, 1, 14).setBackground('#1a1a1a').setFontColor('#ffffff');

  function sectionHeader_(row, label, bg) {
    sh.getRange(row, 1).setValue(label).setFontWeight('bold');
    sh.getRange(row, 1, 1, 14).setBackground(bg || '#e8e8e8');
  }

  function fillZero_(row, label) {
    sh.getRange(row, 1).setValue(label);
    for (var m = 1; m <= 13; m++) {
      sh.getRange(row, m + 1).setValue(0);
    }
  }

  function fillSumRows_(row, label, startRow, endRow, bg) {
    sh.getRange(row, 1).setValue(label).setFontWeight('bold');
    for (var m = 1; m <= 13; m++) {
      var col = columnToLetter_(m + 1);
      sh.getRange(row, m + 1).setFormula(
        '=SUM(' + col + startRow + ':' + col + endRow + ')'
      );
    }
    if (bg) sh.getRange(row, 1, 1, 14).setBackground(bg);
  }

  function fillDiff_(row, label, rowA, rowB, bg) {
    sh.getRange(row, 1).setValue(label).setFontWeight('bold');
    for (var m = 1; m <= 13; m++) {
      var col = columnToLetter_(m + 1);
      sh.getRange(row, m + 1).setFormula('=' + col + rowA + '-' + col + rowB);
    }
    if (bg) sh.getRange(row, 1, 1, 14).setBackground(bg);
  }

  function fillMargin_(row, label, numRow, denRow) {
    sh.getRange(row, 1).setValue(label);
    for (var m = 1; m <= 13; m++) {
      var col = columnToLetter_(m + 1);
      sh.getRange(row, m + 1).setFormula(
        '=IF(' + col + denRow + '=0,"",' + col + numRow + '/' + col + denRow + ')'
      );
    }
    sh.getRange(row, 2, 1, 13).setNumberFormat('0.0%');
    sh.getRange(row, 14).setNumberFormat('0.0%');
  }

  // —— INGRESO ——
  sectionHeader_(6, 'Ingreso', '#d8f3dc');
  fillZero_(7, 'Intereses'); // manual
  fillZero_(8, 'Venta / anticipo'); // pegado desde web
  fillZero_(9, 'Ingreso'); // pegado desde web
  fillZero_(10, 'Catering'); // manual
  fillZero_(11, 'Mobiliario');
  fillZero_(12, 'Lugares');
  fillZero_(13, 'Shows');
  fillSumRows_(14, 'TOTAL', 7, 13, '#b7e4c7');

  // —— EGRESO ——
  sectionHeader_(16, 'Egreso', '#fde2e1');
  fillZero_(17, 'Proveedores'); // pegado
  fillZero_(18, 'Costo de evento'); // pegado
  fillZero_(19, 'Banquete'); // manual
  fillZero_(20, 'Catering');
  fillZero_(21, 'Mobiliario');
  fillZero_(22, 'Lugares');
  fillZero_(23, 'Shows');
  fillSumRows_(24, 'TOTAL', 17, 23, '#f8b4b4');

  // —— Ingreso Bruto / Margen ——
  fillDiff_(26, 'Ingreso Bruto', 14, 24, '#fff3bf');
  fillMargin_(27, 'Margen', 26, 14);

  // —— GASTOS ——
  sectionHeader_(29, 'Gastos', '#e7f5ff');
  fillZero_(30, 'Marketing'); // ads
  fillZero_(31, 'RH'); // pagos
  fillZero_(32, 'Programas'); // apps+pass
  fillZero_(33, 'Impuestos'); // manual
  fillZero_(34, 'Otros');
  fillSumRows_(35, 'TOTAL', 30, 34, '#a5d8ff');

  // —— Ingreso Neto / Margen ——
  fillDiff_(37, 'Ingreso Neto', 26, 35, '#d0bfff');
  fillMargin_(38, 'Margen', 37, 14);

  // —— Banco / CAPITAL ——
  fillZero_(40, 'Banco');
  sh.getRange(40, 1, 1, 14).setBackground('#f3f0ff');
  fillZero_(41, 'CAPITAL');
  sh.getRange(41, 1, 1, 14).setBackground('#f3f0ff');
  sh.getRange(40, 14).setFormula('=SUM(B40:M40)');
  sh.getRange(41, 14).setFormula('=SUM(B41:M41)');

  sh.getRange(43, 1).setValue('Inversión');
  sh.getRange(43, 2).setValue(30000);
  sh.getRange(43, 2).setNumberFormat('$#,##0.00');
  sh.getRange(44, 1).setValue(
    'Al Enviar al P&L se pega la columna del mes (B=enero…M=diciembre). ' +
      'TOTAL/Bruto/Neto/Margen son fórmulas. Filas manuales no se pisan. ' +
      'Regenerar layout: restorePnLBanco_. Metricas intacta.'
  );
  sh.getRange(44, 1).setFontColor('#666666');

  sh.getRange('B7:N14').setNumberFormat('$#,##0.00');
  sh.getRange('B17:N24').setNumberFormat('$#,##0.00');
  sh.getRange('B26:N26').setNumberFormat('$#,##0.00');
  sh.getRange('B30:N35').setNumberFormat('$#,##0.00');
  sh.getRange('B37:N37').setNumberFormat('$#,##0.00');
  sh.getRange('B40:N41').setNumberFormat('$#,##0.00');

  sh.setColumnWidth(1, 160);
  for (var w = 2; w <= 14; w++) sh.setColumnWidth(w, 88);
  sh.setFrozenRows(5);
  sh.setFrozenColumns(1);
}

/** Regenera SOLO P&L banco (por mes). NO toca Metricas. */
function restorePnLBanco_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureBancoSheet_(ss);
  setupPnL_(ss);
  var msg =
    'P&L con columnas por mes listo — ' +
    SCRIPT_VERSION +
    '\n\n' +
    PL_SHEET +
    ': B=enero … M=diciembre.\n' +
    'Al Enviar al P&L se pegan los resultados en esa columna.\n' +
    'Metricas NO se modificó.';
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
}

/**
 * Ya NO reescribe Metricas (para no pisar tu dashboard).
 * Solo regenera el P&L de estados de cuenta.
 */
function restoreMetricasPnL_() {
  var msg =
    'v15: esta función YA NO reescribe Metricas.\n\n' +
    'Solo regenera el P&L de banco (' +
    PL_SHEET +
    ').\n' +
    'Tu hoja Metricas se deja como está.\n\n' +
    'Preferido: ejecuta restorePnLBanco_';
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
  restorePnLBanco_();
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
