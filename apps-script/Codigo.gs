/**
 * ============================================================
 * Apps Script — Bodasesor Ventas / Finanzas (UN solo /exec)
 * VERSION: 2026-07-20-v23
 * ============================================================
 * PEGAR TODO ESTE ARCHIVO (borrar lo anterior → pegar → Guardar)
 *
 * Luego:
 *   1) authorizeDrive_ → ▶ Ejecutar (Drive)  [si aún no]
 *   2) restoreMetricasSemanal_ → ▶ Ejecutar
 *      (o desde Hostinger: POST /api/ventas/setup-metricas-auto)
 *   3) Implementar → Nueva versión → misma URL /exec
 *
 * REGLA v23:
 *   - Metricas YYYY (original) NUNCA se modifica
 *   - Todo lo nuevo va a Metricas YYYY Auto (copia de prueba)
 *   - action doPost: setupMetricasAuto
 *
 * doPost: Eventos | upsertEstadoResultados | upsertBanco | setupMetricasAuto | archive
 * ============================================================
 */
var SCRIPT_VERSION = '2026-07-20-v23';
var METRICAS_MARKER = 'BOT_METRICAS_V14';
var METRICAS_SEMANAL_MARKER = 'BOT_METRICAS_SEMANAL_V23';
var PNL_MARKER = 'BOT_PNL_MESES_V17';
var ER_MARKER = 'BOT_ESTADO_RESULTADOS_V20';
var YEAR = 2026;
var EVENTOS_SHEET = 'Eventos ' + YEAR;
var METRICAS_SHEET = 'Metricas ' + YEAR;
/** Copia de prueba: aquí vive el semanal. La original no se toca. */
var METRICAS_AUTO_SHEET = 'Metricas ' + YEAR + ' Auto';
var PL_SHEET = 'P&L ' + YEAR;
var ER_SHEET = 'Estado de Resultados ' + YEAR;
var BANCO_SHEET = 'Banco ' + YEAR;
var ANALISIS_SHEET = 'Analisis ' + YEAR;
var ARCHIVE_SHEET = 'Estados Archive';
var ARCHIVE_FOLDER_NAME = 'Bodasesor Estados de Cuenta';

var DEFAULT_SHEET_NAME = EVENTOS_SHEET;
var DEAL_ID_COL = 20; // T
var CLIENTE_COL = 1; // A
var SEMANA_CIERRE_COL = 21; // U — WEEKNUM(Fecha de cierre)
var MAX_CLIENT_SCAN = 500;
var MAX_WEEKS = 53;

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

/** Info del Spreadsheet al que está ligado este script. */
function spreadsheetInfo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    names.push(sheets[i].getName());
  }
  return {
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    existingSheets: names,
    erExists: names.indexOf(ER_SHEET) !== -1,
  };
}

function doGet() {
  var info = spreadsheetInfo_();
  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    ping: true,
    erSheet: ER_SHEET,
    hasEstadoResultados: true,
    erExists: info.erExists,
    spreadsheetId: info.spreadsheetId,
    spreadsheetName: info.spreadsheetName,
    spreadsheetUrl: info.spreadsheetUrl,
    existingSheets: info.existingSheets,
    sheets: [
      EVENTOS_SHEET,
      METRICAS_SHEET,
      METRICAS_AUTO_SHEET,
      ER_SHEET,
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
  // U Semana cierre (lunes=inicio, tipo 2) — alimenta resumen semanal
  sheet
    .getRange(row, SEMANA_CIERRE_COL)
    .setFormula(
      '=IF(C' + row + '="","",IFERROR(WEEKNUM(C' + row + ',2),""))'
    );
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
  sh.getRange(rowIndex, 26, 1, 2).setNumberFormat('$#,##0.00');

  var totals = {
    ingresos: Number(data.ingresos) || 0,
    gastos: Number(data.gastos) || 0,
    neto: Number(data.neto) || 0,
    otros: Number(data.otros) || 0,
    depositosOficiales:
      data.depositosOficiales == null ? 0 : Number(data.depositosOficiales),
    retirosOficiales:
      data.retirosOficiales == null ? 0 : Number(data.retirosOficiales),
  };

  // Destino visible: Estado de Resultados (no el estado de cuenta)
  var erCol = pasteMonthToEstadoResultados_(ss, month, by, totals);
  try {
    // Banco = respaldo técnico; no debe ser lo que veas al abrir el Sheet
    sh.hideSheet();
  } catch (hideErr) {}
  bringEstadoResultadosFront_(ss);

  var info = spreadsheetInfo_();
  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    action: action,
    row: rowIndex,
    sheetName: ER_SHEET,
    erSheet: ER_SHEET,
    erMonthCol: erCol,
    erExists: info.erExists,
    bancoSheet: BANCO_SHEET,
    bancoHidden: true,
    periodKey: periodKey,
    spreadsheetId: info.spreadsheetId,
    spreadsheetName: info.spreadsheetName,
    spreadsheetUrl: info.spreadsheetUrl,
    existingSheets: info.existingSheets,
    message:
      'Enviado a Sheet «' +
      info.spreadsheetName +
      '» → pestaña ' +
      ER_SHEET +
      ' (col ' +
      erCol +
      ').',
  });
}

/** Crea/muestra ER y la pone al frente (después de Eventos). */
function bringEstadoResultadosFront_(ss) {
  var erSh = ss.getSheetByName(ER_SHEET);
  if (!erSh) {
    setupEstadoResultados_(ss);
    erSh = ss.getSheetByName(ER_SHEET);
  }
  if (!erSh) return null;
  try {
    erSh.showSheet();
  } catch (e1) {}
  try {
    ss.setActiveSheet(erSh);
    var pos = 1;
    var ev = ss.getSheetByName(EVENTOS_SHEET);
    if (ev) pos = Math.min(ev.getIndex() + 1, ss.getNumSheets());
    ss.moveActiveSheet(pos);
  } catch (e2) {}
  return erSh;
}

/* ===================== Estado de Resultados ===================== */

/**
 * Filas fijas del Estado de Resultados (igual que la web).
 * Columna del mes: B=enero … M=diciembre, N=TOTAL.
 * No cambiar sin bump de ER_MARKER.
 */
var ER_ROW = {
  ingresoHeader: 6,
  intereses: 7,
  venta: 8,
  ingreso: 9,
  cateringI: 10,
  mobiliarioI: 11,
  lugaresI: 12,
  showsI: 13,
  totalIngreso: 14,
  egresoHeader: 16,
  proveedor: 17,
  evento: 18,
  banquete: 19,
  cateringE: 20,
  mobiliarioE: 21,
  lugaresE: 22,
  showsE: 23,
  totalEgreso: 24,
  bruto: 26,
  margenB: 27,
  gastosHeader: 29,
  marketing: 30,
  rh: 31,
  programas: 32,
  impuestos: 33,
  otros: 34,
  totalGastos: 35,
  neto: 37,
  margenN: 38,
  capitalHeader: 40,
  banco: 41,
  capital: 42,
};

function ensureEstadoResultadosLayout_(ss) {
  var sh = ss.getSheetByName(ER_SHEET);
  if (!sh) {
    setupEstadoResultados_(ss);
    return ss.getSheetByName(ER_SHEET);
  }
  var marker = String(sh.getRange('A2').getValue() || '');
  if (marker.indexOf(ER_MARKER) === -1) {
    setupEstadoResultados_(ss);
  }
  return ss.getSheetByName(ER_SHEET);
}

/**
 * Pestaña Estado de Resultados YYYY — misma estructura que la web.
 * Al Enviar se pega la columna del mes. Metricas no se toca.
 */
function setupEstadoResultados_(ss) {
  var sh = ss.getSheetByName(ER_SHEET);
  if (!sh) sh = ss.insertSheet(ER_SHEET);
  sh.getRange('A1:N45').clear();

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

  sh.getRange('A1').setValue('ESTADO DE RESULTADOS · ' + YEAR + ' · Bodasesor');
  sh.getRange('A1').setFontWeight('bold').setFontSize(16);
  sh.getRange('A2').setValue(ER_MARKER + ' · ' + SCRIPT_VERSION);
  sh.getRange('A2').setFontColor('#666666');
  sh.getRange('A3').setValue(
    'Esta es la pestaña principal. Se llena desde /pnl/ → Enviar. ' +
      'Banco queda oculto (respaldo). Metricas no se toca.'
  );

  sh.getRange(5, 1).setValue('Concepto').setFontWeight('bold');
  for (var m = 1; m <= 12; m++) {
    sh.getRange(5, m + 1).setValue(months[m - 1]).setFontWeight('bold');
  }
  sh.getRange(5, 14).setValue('TOTAL').setFontWeight('bold');
  sh.getRange(5, 1, 1, 14).setBackground('#12352e').setFontColor('#ffffff');

  function section_(row, label, bg) {
    sh.getRange(row, 1).setValue(label).setFontWeight('bold');
    sh.getRange(row, 1, 1, 14).setBackground(bg);
  }
  function zeros_(row, label) {
    sh.getRange(row, 1).setValue(label).setFontStyle('italic');
    for (var c = 2; c <= 13; c++) sh.getRange(row, c).setValue(0);
    sh.getRange(row, 14).setFormula('=SUM(B' + row + ':M' + row + ')');
  }
  function sumRow_(row, label, fromR, toR, bg) {
    sh.getRange(row, 1).setValue(label).setFontWeight('bold');
    for (var c = 2; c <= 14; c++) {
      var L = columnToLetter_(c);
      sh.getRange(row, c).setFormula('=SUM(' + L + fromR + ':' + L + toR + ')');
    }
    if (bg) sh.getRange(row, 1, 1, 14).setBackground(bg);
    sh.getRange(row, 1, 1, 14).setBorder(
      true,
      false,
      false,
      false,
      false,
      false,
      '#1c1914',
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM
    );
  }
  function diffRow_(row, label, a, b, bg) {
    sh.getRange(row, 1).setValue(label).setFontWeight('bold');
    for (var c = 2; c <= 14; c++) {
      var L = columnToLetter_(c);
      sh.getRange(row, c).setFormula('=' + L + a + '-' + L + b);
    }
    if (bg) sh.getRange(row, 1, 1, 14).setBackground(bg);
  }
  function marginRow_(row, label, numR, denR) {
    sh.getRange(row, 1).setValue(label).setFontStyle('italic');
    for (var c = 2; c <= 14; c++) {
      var L = columnToLetter_(c);
      sh.getRange(row, c).setFormula(
        '=IF(' + L + denR + '=0,"",' + L + numR + '/' + L + denR + ')'
      );
    }
    sh.getRange(row, 2, 1, 13).setNumberFormat('0.0%');
    sh.getRange(row, 14).setNumberFormat('0.0%');
  }

  // —— Ingreso ——
  section_(ER_ROW.ingresoHeader, 'Ingreso', '#d8f3dc');
  zeros_(ER_ROW.intereses, 'Intereses');
  zeros_(ER_ROW.venta, 'Venta / anticipo');
  zeros_(ER_ROW.ingreso, 'Ingreso');
  zeros_(ER_ROW.cateringI, 'Catering');
  zeros_(ER_ROW.mobiliarioI, 'Mobiliario');
  zeros_(ER_ROW.lugaresI, 'Lugares');
  zeros_(ER_ROW.showsI, 'Shows');
  sumRow_(
    ER_ROW.totalIngreso,
    'TOTAL',
    ER_ROW.intereses,
    ER_ROW.showsI,
    '#b7e4c7'
  );

  // —— Egreso ——
  section_(ER_ROW.egresoHeader, 'Egreso', '#fde2e1');
  zeros_(ER_ROW.proveedor, 'Proveedores');
  zeros_(ER_ROW.evento, 'Costo de evento');
  zeros_(ER_ROW.banquete, 'Banquete');
  zeros_(ER_ROW.cateringE, 'Catering');
  zeros_(ER_ROW.mobiliarioE, 'Mobiliario');
  zeros_(ER_ROW.lugaresE, 'Lugares');
  zeros_(ER_ROW.showsE, 'Shows');
  sumRow_(
    ER_ROW.totalEgreso,
    'TOTAL',
    ER_ROW.proveedor,
    ER_ROW.showsE,
    '#f8b4b4'
  );

  diffRow_(ER_ROW.bruto, 'Ingreso Bruto', ER_ROW.totalIngreso, ER_ROW.totalEgreso, '#fff3bf');
  marginRow_(ER_ROW.margenB, 'Margen', ER_ROW.bruto, ER_ROW.totalIngreso);

  // —— Gastos ——
  section_(ER_ROW.gastosHeader, 'Gastos', '#e7f5ff');
  zeros_(ER_ROW.marketing, 'Marketing');
  zeros_(ER_ROW.rh, 'RH');
  zeros_(ER_ROW.programas, 'Programas');
  zeros_(ER_ROW.impuestos, 'Impuestos');
  zeros_(ER_ROW.otros, 'Otros');
  sumRow_(
    ER_ROW.totalGastos,
    'TOTAL',
    ER_ROW.marketing,
    ER_ROW.otros,
    '#a5d8ff'
  );

  diffRow_(ER_ROW.neto, 'Ingreso Neto', ER_ROW.bruto, ER_ROW.totalGastos, '#d0bfff');
  marginRow_(ER_ROW.margenN, 'Margen', ER_ROW.neto, ER_ROW.totalIngreso);

  section_(ER_ROW.capitalHeader, 'Banco / CAPITAL', '#f3f0ff');
  zeros_(ER_ROW.banco, 'Banco');
  zeros_(ER_ROW.capital, 'CAPITAL');
  sh.getRange(ER_ROW.banco, 1, 1, 14).setBackground('#f3f0ff');
  sh.getRange(ER_ROW.capital, 1, 1, 14).setBackground('#f3f0ff');

  sh.getRange(44, 1).setValue(
    'PDF → /pnl/ → Enviar → se pega la columna del mes aquí. ' +
      'Regenerar layout: restoreEstadoResultados_. Metricas intacta.'
  );
  sh.getRange(44, 1).setFontColor('#555555');

  sh.getRange('B7:N14').setNumberFormat('$#,##0.00');
  sh.getRange('B17:N24').setNumberFormat('$#,##0.00');
  sh.getRange('B26:N26').setNumberFormat('$#,##0.00');
  sh.getRange('B30:N35').setNumberFormat('$#,##0.00');
  sh.getRange('B37:N37').setNumberFormat('$#,##0.00');
  sh.getRange('B41:N42').setNumberFormat('$#,##0.00');

  sh.setColumnWidth(1, 180);
  for (var w = 2; w <= 14; w++) sh.setColumnWidth(w, 88);
  sh.setFrozenRows(5);
  sh.setFrozenColumns(1);

  try {
    sh.showSheet();
    sh.activate();
  } catch (e) {}
}

/**
 * Pega en Estado de Resultados los montos del mes (columna B…M).
 */
function pasteMonthToEstadoResultados_(ss, month, by, totals) {
  var sh = ensureEstadoResultadosLayout_(ss);
  var col = Number(month) + 1;
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
  if (venta === 0 && ingreso === 0 && (totals.ingresos || 0) > 0) {
    ingreso = totals.ingresos;
  }

  money_(ER_ROW.intereses, abs_(by.intereses));
  money_(ER_ROW.venta, venta);
  money_(ER_ROW.ingreso, ingreso);
  // Líneas de negocio: 0 (manual en Sheet si aplica)
  money_(ER_ROW.cateringI, 0);
  money_(ER_ROW.mobiliarioI, 0);
  money_(ER_ROW.lugaresI, 0);
  money_(ER_ROW.showsI, 0);

  money_(ER_ROW.proveedor, abs_(by.proveedor));
  money_(ER_ROW.evento, abs_(by.evento));
  money_(ER_ROW.banquete, 0);
  money_(ER_ROW.cateringE, 0);
  money_(ER_ROW.mobiliarioE, 0);
  money_(ER_ROW.lugaresE, 0);
  money_(ER_ROW.showsE, 0);

  money_(ER_ROW.marketing, abs_(by.ads));
  money_(ER_ROW.rh, abs_(by.pago) + abs_(by.nomina));
  money_(ER_ROW.programas, abs_(by.apps) + abs_(by.pass));
  money_(ER_ROW.impuestos, abs_(by.impuestos));
  money_(
    ER_ROW.otros,
    abs_(by.comisiones) +
      abs_(by.servicios) +
      abs_(by.transferencia_persona) +
      abs_(by.revisar) +
      abs_(by.otro) +
      abs_(totals.otros)
  );

  money_(ER_ROW.banco, Number(totals.neto) || 0);
  money_(ER_ROW.capital, abs_(by.socio));

  try {
    sh.showSheet();
    sh.activate();
  } catch (e) {}

  return columnToLetter_(col);
}

/** Regenera SOLO Estado de Resultados. NO toca Metricas. */
function restoreEstadoResultados_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var banco = ensureBancoSheet_(ss);
  try {
    banco.hideSheet();
  } catch (e) {}
  setupEstadoResultados_(ss);
  var msg =
    'Estado de Resultados listo — ' +
    SCRIPT_VERSION +
    '\n\nPestaña visible: ' +
    ER_SHEET +
    '\nBanco queda oculto (respaldo).\n' +
    'Al Enviar desde /pnl/ se pega la columna del mes.\n' +
    'Metricas NO se modificó.';
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
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

    if (data && data.action === 'upsertEstadoResultados') {
      return upsertBanco_(data); // mismo payload; destino visible = ER
    }
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
      return json_({
        ok: true,
        version: SCRIPT_VERSION,
        action: 'setupAll',
        erSheet: ER_SHEET,
      });
    }
    if (data && data.action === 'setupEstadoResultados') {
      var ssEr = SpreadsheetApp.getActiveSpreadsheet();
      var bancoSh = ensureBancoSheet_(ssEr);
      try {
        bancoSh.hideSheet();
      } catch (eHide) {}
      setupEstadoResultados_(ssEr);
      bringEstadoResultadosFront_(ssEr);
      var infoEr = spreadsheetInfo_();
      return json_({
        ok: true,
        version: SCRIPT_VERSION,
        action: 'setupEstadoResultados',
        erSheet: ER_SHEET,
        erExists: infoEr.erExists,
        spreadsheetId: infoEr.spreadsheetId,
        spreadsheetName: infoEr.spreadsheetName,
        spreadsheetUrl: infoEr.spreadsheetUrl,
        existingSheets: infoEr.existingSheets,
        message:
          'Pestaña creada en «' +
          infoEr.spreadsheetName +
          '»: ' +
          ER_SHEET +
          '. Ábrela abajo o con el link del Sheet.',
      });
    }
    if (data && data.action === 'setupMetricasAuto') {
      var resultAuto = ensureMetricasSemanal_();
      var infoAuto = spreadsheetInfo_();
      return json_({
        ok: Boolean(resultAuto && resultAuto.ok),
        version: SCRIPT_VERSION,
        action: 'setupMetricasAuto',
        metricasAutoSheet: METRICAS_AUTO_SHEET,
        metricasOriginal: METRICAS_SHEET,
        duplicated: resultAuto && resultAuto.duplicated,
        anchorCol: resultAuto && resultAuto.anchorCol,
        weeks: resultAuto && resultAuto.weeks,
        error: resultAuto && resultAuto.error,
        spreadsheetId: infoAuto.spreadsheetId,
        spreadsheetName: infoAuto.spreadsheetName,
        spreadsheetUrl: infoAuto.spreadsheetUrl,
        existingSheets: infoAuto.existingSheets,
        message: resultAuto && resultAuto.ok
          ? 'Lista «' +
            METRICAS_AUTO_SHEET +
            '» en «' +
            infoAuto.spreadsheetName +
            '». La original «' +
            METRICAS_SHEET +
            '» no se tocó.'
          : 'No se pudo crear Metricas Auto: ' +
            ((resultAuto && resultAuto.error) || 'error'),
      });
    }

    var values = data.values;
    if (!values || !Array.isArray(values)) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'values no es array (¿Apps Script v19 publicado?)',
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

    // Crea Metricas Auto si falta (original intacta)
    var pipe = { ok: false };
    try {
      pipe = ensureWeeklyPipeline_(SpreadsheetApp.getActiveSpreadsheet()) || {
        ok: false,
      };
    } catch (pipeErr) {
      pipe = { ok: false, error: String(pipeErr) };
      Logger.log('ensureWeeklyPipeline_: ' + pipeErr);
    }

    var infoPipe = spreadsheetInfo_();
    return json_({
      ok: true,
      version: SCRIPT_VERSION,
      action: action,
      row: rowIndex,
      nextRowWouldBe: nextRow,
      dealId: dealId,
      sheetName: sheetName,
      metricasAuto: pipe,
      metricasAutoExists:
        (infoPipe.existingSheets || []).indexOf(METRICAS_AUTO_SHEET) !== -1,
      existingSheets: infoPipe.existingSheets,
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
    ' (fórmulas M/N/O/U + tabla mensual W:AB + semanal AD:AK)\n' +
    '✓ ' +
    ER_SHEET +
    ' (estado de resultados por mes)\n' +
    '✓ ' +
    BANCO_SHEET +
    ' (estados de cuenta, 1 fila/mes)\n' +
    '✓ ' +
    ARCHIVE_SHEET +
    ' + Drive\n\n' +
    'Metricas original NO se tocó.\n' +
    'Copia + semanal: restoreMetricasSemanal_ → «' +
    METRICAS_AUTO_SHEET +
    '»\n' +
    'ER: restoreEstadoResultados_\n\n' +
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
  setupWeeklyTable_(eventos);
  ensureBancoSheet_(ss);
  ensureArchiveSheet_();
  try {
    getArchiveFolder_();
  } catch (err) {}
  // Estado de Resultados + P&L — NUNCA pisa Metricas A:L
  setupEstadoResultados_(ss);
  setupPnL_(ss);
  ensureAnalisisSheet_(ss, YEAR);
}

/**
 * Si falta tabla semanal en Eventos o la pestaña Auto, la prepara.
 * Nunca escribe en Metricas original.
 * Devuelve {ok, error?, sheet?} para poder ver fallos en doPost.
 */
function ensureWeeklyPipeline_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  try {
    var eventos = ensureEventosSheet_(ss);
    if (String(eventos.getRange('AD3').getValue()).trim() !== 'Semana') {
      setupWeeklyTable_(eventos);
    }
    var auto = ss.getSheetByName(METRICAS_AUTO_SHEET);
    if (!auto) {
      return ensureMetricasSemanal_(ss);
    }
    var col = metricasSemanalAnchorCol_(auto);
    var marker = String(auto.getRange(2, col).getValue());
    if (marker.indexOf('BOT_METRICAS_SEMANAL') === -1) {
      return ensureMetricasSemanal_(ss);
    }
    return { ok: true, sheet: METRICAS_AUTO_SHEET, already: true };
  } catch (err) {
    Logger.log('ensureWeeklyPipeline_ fatal: ' + err);
    return { ok: false, error: String(err) };
  }
}

function ensureEventosSheet_(ss) {
  var sh = ss.getSheetByName(EVENTOS_SHEET);
  if (!sh) sh = ss.insertSheet(EVENTOS_SHEET);
  // Encabezados si faltan
  if (String(sh.getRange(1, 1).getValue()).trim() !== 'Cliente') {
    sh.getRange(1, 1, 1, EVENTOS_HEADERS.length).setValues([EVENTOS_HEADERS]);
    sh.setFrozenRows(1);
  }
  // Col U: Semana cierre (no pisa A–T)
  if (String(sh.getRange(1, SEMANA_CIERRE_COL).getValue()).trim() === '') {
    sh.getRange(1, SEMANA_CIERRE_COL).setValue('Semana cierre');
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
 * Tabla SEMANAL Eventos en AD3:AK57 (semanas 1–53 por Fecha de cierre).
 * Fuente para el bloque semanal de Metricas. No toca filas de clientes.
 */
function setupWeeklyTable_(sheet) {
  sheet.getRange('AD3:AK3').setValues([
    [
      'Semana',
      'Desde',
      'Hasta',
      'Pagado',
      'Por pagar',
      'Valor total',
      'Ganancia',
      '# Eventos',
    ],
  ]);
  sheet.getRange('AD3:AK3').setFontWeight('bold');
  // Inicio semana 1 (lunes de la semana que contiene 1-ene; WEEKNUM tipo 2)
  var jan1 = 'DATE(' + YEAR + ',1,1)';
  var week1Start = '(' + jan1 + '-WEEKDAY(' + jan1 + ',2)+1)';

  for (var w = 1; w <= MAX_WEEKS; w++) {
    var r = 3 + w; // 4..56
    sheet.getRange(r, 30).setValue(w); // AD Semana
    sheet
      .getRange(r, 31)
      .setFormula('=' + week1Start + '+' + (w - 1) + '*7'); // AE Desde
    sheet.getRange(r, 32).setFormula('=AE' + r + '+6'); // AF Hasta
    sheet.getRange(r, 33).setFormula('=SUMIF($U:$U,AD' + r + ',$L:$L)'); // AG Pagado
    sheet.getRange(r, 34).setFormula('=SUMIF($U:$U,AD' + r + ',$M:$M)'); // AH Por pagar
    sheet.getRange(r, 35).setFormula('=SUMIF($U:$U,AD' + r + ',$J:$J)'); // AI Venta
    sheet.getRange(r, 36).setFormula('=SUMIF($U:$U,AD' + r + ',$N:$N)'); // AJ Ganancia
    sheet
      .getRange(r, 37)
      .setFormula('=COUNTIFS($U:$U,AD' + r + ',$A:$A,"<>")'); // AK #
  }
  var tot = 3 + MAX_WEEKS + 1; // 57
  sheet.getRange(tot, 30).setValue('Total anual');
  sheet.getRange(tot, 30).setFontWeight('bold');
  sheet.getRange(tot, 33).setFormula('=SUM(AG4:AG56)');
  sheet.getRange(tot, 34).setFormula('=SUM(AH4:AH56)');
  sheet.getRange(tot, 35).setFormula('=SUM(AI4:AI56)');
  sheet.getRange(tot, 36).setFormula('=SUM(AJ4:AJ56)');
  sheet.getRange(tot, 37).setFormula('=SUM(AK4:AK56)');
  sheet.getRange('AE4:AF56').setNumberFormat('dd/mm/yyyy');
  sheet.getRange('AG4:AJ57').setNumberFormat('$#,##0.00');
}

/**
 * Duplica Metricas YYYY → Metricas YYYY Auto (si Auto aún no existe).
 * La pestaña original NO se modifica.
 */
function ensureMetricasAutoSheet_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var auto = ss.getSheetByName(METRICAS_AUTO_SHEET);
  if (auto) {
    return { sheet: auto, duplicated: false, createdBlank: false, error: null };
  }

  // Por si quedó una copia a medias con otro nombre
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var nm = sheets[i].getName();
    if (
      nm === 'Copia de ' + METRICAS_SHEET ||
      nm === 'Copy of ' + METRICAS_SHEET
    ) {
      try {
        sheets[i].setName(METRICAS_AUTO_SHEET);
        return {
          sheet: sheets[i],
          duplicated: true,
          createdBlank: false,
          error: null,
        };
      } catch (renameErr) {
        Logger.log('rename copia: ' + renameErr);
      }
    }
  }

  var src = ss.getSheetByName(METRICAS_SHEET);
  if (src) {
    try {
      auto = src.copyTo(ss);
      auto.setName(METRICAS_AUTO_SHEET);
      try {
        ss.setActiveSheet(auto);
        ss.moveActiveSheet(src.getIndex() + 1);
      } catch (moveErr) {
        Logger.log('moveActiveSheet: ' + moveErr);
      }
      return {
        sheet: auto,
        duplicated: true,
        createdBlank: false,
        error: null,
      };
    } catch (copyErr) {
      Logger.log('copyTo Metricas falló: ' + copyErr);
      // Fallback: pestaña nueva vacía (solo semanal)
      auto = ss.insertSheet(METRICAS_AUTO_SHEET);
      return {
        sheet: auto,
        duplicated: false,
        createdBlank: true,
        error: String(copyErr),
      };
    }
  }

  auto = ss.insertSheet(METRICAS_AUTO_SHEET);
  return { sheet: auto, duplicated: false, createdBlank: true, error: null };
}

/**
 * Ancla del bloque semanal en la pestaña Auto.
 * Preferimos columna N; si N está ocupada sin marker → AA.
 */
function metricasSemanalAnchorCol_(sh) {
  var n2 = String(sh.getRange(2, 14).getValue()); // N2
  if (n2.indexOf('BOT_METRICAS_SEMANAL') !== -1) return 14;
  var aa2 = String(sh.getRange(2, 27).getValue()); // AA2
  if (aa2.indexOf('BOT_METRICAS_SEMANAL') !== -1) return 27;
  if (String(sh.getRange(1, 14).getValue()).trim() === '') return 14;
  return 27;
}

/**
 * Escribe el resumen SEMANAL en Metricas YYYY Auto (copia).
 * Nunca escribe en Metricas YYYY original.
 */
function ensureMetricasSemanal_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var eventos = ss.getSheetByName(EVENTOS_SHEET);
  if (!eventos) return { ok: false, error: 'Falta ' + EVENTOS_SHEET };

  // Ligero: no reescribe todas las filas de clientes (eso puede tumbar el /exec)
  ensureEventosSheet_(ss);
  setupWeeklyTable_(eventos);
  // Solo fórmulas U en filas con cliente (necesario para SUMIF semanal)
  try {
    var lastRow = Math.max(eventos.getLastRow(), 2);
    var clientes = eventos.getRange(2, 1, lastRow, 1).getValues();
    for (var i = 0; i < clientes.length; i++) {
      if (String(clientes[i][0]).trim() === '') continue;
      var row = i + 2;
      eventos
        .getRange(row, SEMANA_CIERRE_COL)
        .setFormula(
          '=IF(C' + row + '="","",IFERROR(WEEKNUM(C' + row + ',2),""))'
        );
    }
  } catch (uErr) {
    Logger.log('fórmulas U: ' + uErr);
  }

  var dup = ensureMetricasAutoSheet_(ss);
  var sh = dup.sheet;
  if (!sh) return { ok: false, error: 'No se pudo crear ' + METRICAS_AUTO_SHEET };
  var col0 = metricasSemanalAnchorCol_(sh); // 14=N o 27=AA
  var rows = MAX_WEEKS + 4;

  sh.getRange(1, col0, rows, col0 + 7).clearContent();

  sh.getRange(1, col0).setValue(
    'RESUMEN SEMANAL — Eventos ' + YEAR + ' (pestaña de prueba)'
  );
  sh.getRange(1, col0).setFontWeight('bold').setFontSize(13);
  sh.getRange(2, col0).setValue(
    METRICAS_SEMANAL_MARKER + ' · ' + SCRIPT_VERSION
  );
  sh.getRange(2, col0).setFontColor('#666666');
  sh.getRange(2, col0 + 1).setValue(
    'Copia de «' +
      METRICAS_SHEET +
      '». Por Fecha de cierre (semana inicia lunes). La original no se toca.'
  );

  sh.getRange(3, col0, 1, 8).setValues([
    [
      'Semana',
      'Desde',
      'Hasta',
      'Pagado',
      'Por pagar',
      'Valor ventas',
      'Ganancia',
      '# Eventos',
    ],
  ]);
  sh.getRange(3, col0, 1, 8).setFontWeight('bold').setBackground('#e8f0ee');

  for (var w = 1; w <= MAX_WEEKS; w++) {
    var r = 3 + w; // 4..56
    var srcRow = 3 + w; // Eventos fila 4 = semana 1
    sh.getRange(r, col0).setValue(w);
    sh.getRange(r, col0 + 1).setFormula(
      "='" + EVENTOS_SHEET + "'!AE" + srcRow
    );
    sh.getRange(r, col0 + 2).setFormula(
      "='" + EVENTOS_SHEET + "'!AF" + srcRow
    );
    sh.getRange(r, col0 + 3).setFormula(
      "='" + EVENTOS_SHEET + "'!AG" + srcRow
    );
    sh.getRange(r, col0 + 4).setFormula(
      "='" + EVENTOS_SHEET + "'!AH" + srcRow
    );
    sh.getRange(r, col0 + 5).setFormula(
      "='" + EVENTOS_SHEET + "'!AI" + srcRow
    );
    sh.getRange(r, col0 + 6).setFormula(
      "='" + EVENTOS_SHEET + "'!AJ" + srcRow
    );
    sh.getRange(r, col0 + 7).setFormula(
      "='" + EVENTOS_SHEET + "'!AK" + srcRow
    );
  }

  var totR = 3 + MAX_WEEKS + 1; // 57
  var srcTot = 57;
  sh.getRange(totR, col0).setValue('TOTAL AÑO');
  sh.getRange(totR, col0).setFontWeight('bold');
  sh.getRange(totR, col0 + 3).setFormula(
    "='" + EVENTOS_SHEET + "'!AG" + srcTot
  );
  sh.getRange(totR, col0 + 4).setFormula(
    "='" + EVENTOS_SHEET + "'!AH" + srcTot
  );
  sh.getRange(totR, col0 + 5).setFormula(
    "='" + EVENTOS_SHEET + "'!AI" + srcTot
  );
  sh.getRange(totR, col0 + 6).setFormula(
    "='" + EVENTOS_SHEET + "'!AJ" + srcTot
  );
  sh.getRange(totR, col0 + 7).setFormula(
    "='" + EVENTOS_SHEET + "'!AK" + srcTot
  );
  sh.getRange(totR, col0, 1, 8).setBackground('#e8f0ee');

  sh.getRange(4, col0 + 1, 3 + MAX_WEEKS, col0 + 2).setNumberFormat(
    'dd/mm/yyyy'
  );
  sh.getRange(4, col0 + 3, totR, col0 + 6).setNumberFormat('$#,##0.00');

  for (var c = 0; c < 8; c++) {
    sh.setColumnWidth(col0 + c, c === 0 ? 90 : 110);
  }

  try {
    sh.activate();
  } catch (actErr) {}

  return {
    ok: true,
    sheet: METRICAS_AUTO_SHEET,
    originalUntouched: METRICAS_SHEET,
    duplicated: dup.duplicated,
    createdBlank: dup.createdBlank,
    anchorCol: columnToLetter_(col0),
    weeks: MAX_WEEKS,
  };
}

/**
 * EJECUTAR UNA VEZ:
 * 1) Duplica Metricas YYYY → Metricas YYYY Auto
 * 2) Pone el resumen semanal en la copia
 * La pestaña original queda intacta.
 */
function restoreMetricasSemanal_() {
  var result = ensureMetricasSemanal_();
  var msg = result.ok
    ? 'Metricas Auto OK — ' +
      SCRIPT_VERSION +
      '\n\n' +
      (result.duplicated
        ? '✓ Se duplicó «' + METRICAS_SHEET + '» → «' + METRICAS_AUTO_SHEET + '»\n'
        : result.createdBlank
          ? '✓ Se creó «' + METRICAS_AUTO_SHEET + '» (no había original)\n'
          : '✓ Usando pestaña existente «' + METRICAS_AUTO_SHEET + '»\n') +
      '✓ Resumen semanal en columna ' +
      result.anchorCol +
      '+\n' +
      '✓ Semanas 1–' +
      result.weeks +
      ' ← ' +
      EVENTOS_SHEET +
      '\n' +
      '✓ «' +
      METRICAS_SHEET +
      '» original NO se modificó\n\n' +
      'Revisa la pestaña Auto. Si te late, después migrás todo ahí.\n' +
      'Siguiente: Nueva versión → Implementar'
    : 'Error: ' + (result.error || 'desconocido');
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
  return result;
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

/** Regenera Estado de Resultados + P&L layout. NO toca Metricas. */
function restorePnLBanco_() {
  restoreEstadoResultados_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupPnL_(ss);
}

/**
 * Ya NO reescribe Metricas (para no pisar tu dashboard).
 * Solo regenera Estado de Resultados (+ P&L layout).
 */
function restoreMetricasPnL_() {
  var msg =
    'v18: esta función YA NO reescribe Metricas.\n\n' +
    'Regenera: ' +
    ER_SHEET +
    ' (+ P&L).\n' +
    'Preferido: restoreEstadoResultados_';
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
