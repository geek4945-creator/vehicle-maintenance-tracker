/* Builds the Excel workbook from the export model (Core.buildExportModel).
 * Works in the browser (global ExcelJS) and in Node (pass require('exceljs')).
 * Sheets: Vehicles, Maintenance Log, Expenses, Summary (formulas), Reminders.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.XlsxExport = factory(root.Core);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  const FMT = { money: '$#,##0.00;[Red]-$#,##0.00', date: 'yyyy-mm-dd', month: 'mmm yyyy', int: '#,##0', cpm: '$#,##0.000' };
  const dateVal = (iso) => (iso ? new Date(Core.parseISO(iso)) : null); // UTC midnight -> correct Excel serial
  const blank = (v) => (v === null || v === undefined || v === '' ? null : v);

  function styleHeader(row, cols) {
    row.height = 22;
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    }
  }

  function dataSheet(wb, name, headers, rows, widths, formats) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(headers);
    styleHeader(ws.getRow(1), headers.length);
    for (const r of rows) ws.addRow(r.map(blank));
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    Object.keys(formats).forEach((col) => { ws.getColumn(+col).numFmt = formats[col]; });
    ws.getRow(1).eachCell((c) => { c.numFmt = 'General'; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    return ws;
  }

  function buildWorkbook(ExcelJS, model) {
    const wb = new ExcelJS.Workbook();
    wb.creator = model.businessName || 'Vehicle Tracker';
    wb.created = new Date();

    // Vehicles
    dataSheet(wb, 'Vehicles', model.headers.vehicles, model.vehicles, [24, 18, 8, 14, 16, 22, 12, 16, 40], { 3: '0', 8: FMT.int });

    // Maintenance Log: A Date B Vehicle C Odometer D Type E Vendor F Parts G Labor H Total I Notes J Receipt
    const ml = model.maintenance.map((r) => [dateVal(r[0])].concat(r.slice(1)));
    dataSheet(wb, 'Maintenance Log', model.headers.maintenance, ml, [12, 24, 12, 18, 22, 12, 12, 12, 40, 14],
      { 1: FMT.date, 3: FMT.int, 6: FMT.money, 7: FMT.money, 8: FMT.money });

    // Expenses: A Date B Vehicle C Category D Vendor E Amount F Odometer G Notes
    const ex = model.expenses.map((r) => [dateVal(r[0])].concat(r.slice(1)));
    dataSheet(wb, 'Expenses', model.headers.expenses, ex, [12, 24, 16, 22, 12, 12, 40], { 1: FMT.date, 5: FMT.money, 6: FMT.int });

    // Summary
    const ws = wb.addWorksheet('Summary');
    [28, 16, 16, 18, 16, 16, 14, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getCell('A1').value = (model.businessName || '') + ' – Vehicle Maintenance Summary';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = 'Filters applied: ' + model.filter.text;
    ws.getCell('A3').value = 'Generated: ' + model.generated + '. Totals below are live formulas over the Maintenance Log and Expenses sheets.';
    ws.getCell('A3').font = { italic: true, color: { argb: 'FF666666' } };

    const ML = "'Maintenance Log'!", EX = 'Expenses!';
    const section = (row, title, headers) => {
      ws.getCell('A' + row).value = title;
      ws.getCell('A' + row).font = { bold: true, size: 12 };
      headers.forEach((h, i) => { ws.getRow(row + 1).getCell(i + 1).value = h; });
      styleHeader(ws.getRow(row + 1), headers.length);
    };
    const setF = (cell, formula, result, fmt) => { cell.value = { formula, result }; if (fmt) cell.numFmt = fmt; };
    const bold = (row, n) => { for (let c = 1; c <= n; c++) { row.getCell(c).font = { bold: true }; row.getCell(c).border = { top: { style: 'thin' } }; } };

    // --- per vehicle
    let r = 5;
    section(r, 'Per-vehicle totals', ['Vehicle', 'Parts', 'Labor', 'Maintenance Total', 'Other Expenses', 'Grand Total', 'Miles Driven*', 'Cost per Mile']);
    r += 2;
    const pvStart = r;
    for (const v of model.perVehicle) {
      const row = ws.getRow(r);
      row.getCell(1).value = v.name;
      setF(row.getCell(2), `SUMIFS(${ML}$F:$F,${ML}$B:$B,$A${r})`, v.parts, FMT.money);
      setF(row.getCell(3), `SUMIFS(${ML}$G:$G,${ML}$B:$B,$A${r})`, v.labor, FMT.money);
      setF(row.getCell(4), `SUMIFS(${ML}$H:$H,${ML}$B:$B,$A${r})`, v.maintenance, FMT.money);
      setF(row.getCell(5), `SUMIFS(${EX}$E:$E,${EX}$B:$B,$A${r})`, v.expenses, FMT.money);
      setF(row.getCell(6), `D${r}+E${r}`, v.grand, FMT.money);
      if (v.miles) { row.getCell(7).value = v.miles; row.getCell(7).numFmt = FMT.int; }
      setF(row.getCell(8), `IF(AND(ISNUMBER(G${r}),G${r}>0),F${r}/G${r},"")`, v.costPerMile === null ? '' : v.costPerMile, FMT.cpm);
      r++;
    }
    const pvEnd = r - 1;
    const T = model.totals;
    const trow = ws.getRow(r);
    trow.getCell(1).value = 'TOTAL';
    const sumCol = (col, res, fmt) => setF(trow.getCell(col), pvEnd >= pvStart ? `SUM(${String.fromCharCode(64 + col)}${pvStart}:${String.fromCharCode(64 + col)}${pvEnd})` : '0', res, fmt);
    sumCol(2, T.parts, FMT.money); sumCol(3, T.labor, FMT.money); sumCol(4, T.maintenance, FMT.money); sumCol(5, T.expenses, FMT.money); sumCol(6, T.grand, FMT.money);
    bold(trow, 8);
    r++;
    ws.getCell('A' + r).value = '* Miles driven = highest minus lowest odometer reading logged in the selected range (needs 2+ readings). Cost per mile = Grand Total ÷ Miles.';
    ws.getCell('A' + r).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
    r += 2;

    // --- monthly
    section(r, 'Monthly totals', ['Month', 'Maintenance', 'Other Expenses', 'Total']);
    r += 2;
    const mStart = r;
    for (const m of model.monthly) {
      const row = ws.getRow(r);
      row.getCell(1).value = new Date(Core.parseISO(m.month + '-01')); row.getCell(1).numFmt = FMT.month; row.getCell(1).alignment = { horizontal: 'left' };
      setF(row.getCell(2), `SUMIFS(${ML}$H:$H,${ML}$A:$A,">="&$A${r},${ML}$A:$A,"<"&EDATE($A${r},1))`, m.maintenance, FMT.money);
      setF(row.getCell(3), `SUMIFS(${EX}$E:$E,${EX}$A:$A,">="&$A${r},${EX}$A:$A,"<"&EDATE($A${r},1))`, m.expenses, FMT.money);
      setF(row.getCell(4), `B${r}+C${r}`, m.total, FMT.money);
      r++;
    }
    const mEnd = r - 1;
    const mrow = ws.getRow(r);
    mrow.getCell(1).value = 'TOTAL';
    [['B', 2, T.maintenance], ['C', 3, T.expenses], ['D', 4, T.grand]].forEach(([L, c, res]) => setF(mrow.getCell(c), mEnd >= mStart ? `SUM(${L}${mStart}:${L}${mEnd})` : '0', res, FMT.money));
    bold(mrow, 4);
    r += 3;

    // --- by category
    section(r, 'By category', ['Category', 'Maintenance', 'Other Expenses', 'Total']);
    r += 2;
    const cStart = r;
    for (const c of model.byCategory) {
      const row = ws.getRow(r);
      row.getCell(1).value = c.category;
      setF(row.getCell(2), `SUMIFS(${ML}$H:$H,${ML}$D:$D,$A${r})`, c.maintenance, FMT.money);
      setF(row.getCell(3), `SUMIFS(${EX}$E:$E,${EX}$C:$C,$A${r})`, c.expenses, FMT.money);
      setF(row.getCell(4), `B${r}+C${r}`, c.total, FMT.money);
      r++;
    }
    const cEnd = r - 1;
    const crow = ws.getRow(r);
    crow.getCell(1).value = 'TOTAL';
    [['B', 2, T.maintenance], ['C', 3, T.expenses], ['D', 4, T.grand]].forEach(([L, c, res]) => setF(crow.getCell(c), cEnd >= cStart ? `SUM(${L}${cStart}:${L}${cEnd})` : '0', res, FMT.money));
    bold(crow, 4);

    // Reminders
    const rem = model.reminders.map((x) => [x[0], x[1], dateVal(x[2]), x[3], dateVal(x[4]), x[5], x[6], x[7], x[8]]);
    dataSheet(wb, 'Reminders', model.headers.reminders, rem, [24, 20, 13, 14, 14, 16, 11, 11, 12], { 3: FMT.date, 4: FMT.int, 5: FMT.date, 6: FMT.int });

    return wb;
  }

  async function buildBuffer(ExcelJS, model) {
    return buildWorkbook(ExcelJS, model).xlsx.writeBuffer();
  }
  return { buildWorkbook, buildBuffer };
});
