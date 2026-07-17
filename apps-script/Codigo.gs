/**
 * UN solo deploy (/exec) para el Sheet de ventas/finanzas.
 *
 * Pestañas:
 * - Eventos 2026  → el bot SÍ escribe
 * - Metricas 2026 → NO (fórmulas)
 * - P&L 2026      → NO (fórmulas)
 *
 * Columnas Eventos (A–T, sin Genero):
 * Cliente | Fecha evento | Fecha cierre | Telefono | Correo | Tipo evento |
 * Invitados | Dirección | Horario | Venta | Costo | Pagado | Por pagar |
 * Ganancia | Margen | Link | Mes cierre | Forma de Pago | IVA | Kommo Deal ID
 */
const DEFAULT_SHEET_NAME = 'Eventos 2026';
const DEAL_ID_COL = 20; // T = Kommo Deal ID

function isWritableSheet_(name) {
  return /^Eventos \d{4}$/.test(name);
}

// Escribe Kommo. NO toca K,L,M,N,O,S (Costo, Pagado, fórmulas, IVA)
// 1-based: A..J + P..R + T  = 1-10, 16-18, 20
const WRITE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 20];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const values = data.values;
    const dealId = String(data.dealId || (values && values[19]) || '').trim();
    const sheetName = String(data.sheetName || DEFAULT_SHEET_NAME).trim();

    if (!dealId || !values || values.length < DEAL_ID_COL) {
      return json_({ ok: false, error: 'Faltan dealId o values' });
    }

    if (!isWritableSheet_(sheetName)) {
      return json_({
        ok: false,
        error:
          'Pestaña no escribible: ' +
          sheetName +
          '. Solo Eventos YYYY.',
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
      // Fórmulas calculadas en la fila nueva
      sheet.getRange(rowIndex, 13).setFormula('=IF(J' + rowIndex + '="","",J' + rowIndex + '-IF(L' + rowIndex + '="",0,L' + rowIndex + '))'); // Por pagar
      sheet.getRange(rowIndex, 14).setFormula('=IF(J' + rowIndex + '="","",J' + rowIndex + '-IF(K' + rowIndex + '="",0,K' + rowIndex + '))'); // Ganancia
      sheet.getRange(rowIndex, 15).setFormula('=IF(OR(J' + rowIndex + '="",J' + rowIndex + '=0),"",N' + rowIndex + '/J' + rowIndex + ')'); // Margen
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
