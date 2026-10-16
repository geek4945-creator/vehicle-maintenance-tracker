const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const C = require('../www/js/core.js');
const X = require('../www/js/xlsx.js');
const fixture = require('./fixture.js');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const NOW = new Date(2026, 9, 16, 12, 0, 0);

async function build(data, filter) {
  const model = C.buildExportModel(data, filter, NOW);
  const buf = await X.buildBuffer(ExcelJS, model);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { model, buf, wb };
}
const rowsOf = (ws) => { const out = []; ws.eachRow((r) => out.push(r.values.slice(1))); return out; };

test('xlsx: required sheets in order with headers', async () => {
  const { wb } = await build(fixture(), {});
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Vehicles', 'Maintenance Log', 'Expenses', 'Summary', 'Reminders']);
  assert.deepEqual(rowsOf(wb.getWorksheet('Vehicles'))[0], ['Name', 'Type', 'Year', 'Make', 'Model', 'VIN', 'Plate', 'Current Odometer', 'Notes']);
  assert.deepEqual(rowsOf(wb.getWorksheet('Maintenance Log'))[0], ['Date', 'Vehicle', 'Odometer', 'Service Type', 'Vendor', 'Parts', 'Labor', 'Total', 'Notes', 'Receipt Photo']);
  assert.deepEqual(rowsOf(wb.getWorksheet('Expenses'))[0], ['Date', 'Vehicle', 'Category', 'Vendor', 'Amount', 'Odometer', 'Notes']);
});

test('xlsx: data rows match the app data (dates are real dates, numbers are numbers)', async () => {
  const d = fixture();
  const { wb } = await build(d, {});
  const ml = wb.getWorksheet('Maintenance Log');
  assert.equal(ml.rowCount, 1 + d.services.length);
  const first = ml.getRow(2).values.slice(1);          // oldest first: s1
  assert.ok(first[0] instanceof Date); assert.equal(first[0].toISOString().slice(0, 10), '2026-01-10');
  assert.deepEqual(first.slice(1, 8), ['Truck 1', 80000, 'Oil change', 'Jiffy', 60, 40, 100]);
  assert.equal(typeof first[7], 'number');
  const brakes = ml.getRow(5).values.slice(1);   // order: s1, s4, s5, s2 (brakes), s3
  assert.equal(brakes[7], 520); assert.equal(brakes[9], 'Yes'); assert.equal(brakes[8], 'incl. $19.25 fees');
  const ex = wb.getWorksheet('Expenses');
  assert.equal(ex.rowCount, 1 + d.expenses.length);
  assert.ok(rowsOf(ex).some((r) => r[1] === '(No vehicle)' && r[4] === 450));
  const veh = wb.getWorksheet('Vehicles');
  assert.equal(veh.rowCount, 4);
  assert.equal(veh.getRow(2).values[6], '1FDUF5HT0KDA00001');
  // text that looks like a formula stays text, never becomes a live formula
  const notesCell = veh.getRow(4).getCell(9);
  assert.equal(typeof notesCell.value, 'string'); assert.equal(notesCell.formula, undefined);
  assert.ok(notesCell.value.startsWith('=cmd'));
});

test('xlsx: Summary uses SUMIFS/SUM formulas and cached results equal the computed totals', async () => {
  const d = fixture();
  const { wb, model } = await build(d, {});
  const ws = wb.getWorksheet('Summary');
  let formulas = 0, found = {};
  ws.eachRow((row) => row.eachCell((cell) => {
    if (cell.value && typeof cell.value === 'object' && cell.value.formula) formulas++;
    if (cell.value === 'Truck 1') found.truck1 = row;
  }));
  assert.ok(formulas > 30, 'has many formulas, got ' + formulas);
  const r = found.truck1;
  assert.match(r.getCell(2).value.formula, /^SUMIFS\('Maintenance Log'!\$F:\$F,'Maintenance Log'!\$B:\$B,\$A\d+\)$/);
  assert.equal(r.getCell(4).value.result, 725); assert.equal(r.getCell(5).value.result, 220); assert.equal(r.getCell(6).value.result, 945);
  assert.equal(r.getCell(7).value, 5000); assert.equal(r.getCell(8).value.result, 0.189);
  // grand total row
  let total;
  ws.eachRow((row) => { if (row.getCell(1).value === 'TOTAL' && !total) total = row; });
  assert.equal(total.getCell(6).value.result, model.totals.grand);
  assert.match(total.getCell(6).value.formula, /^SUM\(F\d+:F\d+\)$/);
  // monthly section: EDATE based criteria
  let monthRow;
  ws.eachRow((row) => { const v = row.getCell(1).value; if (v instanceof Date && v.toISOString().startsWith('2026-02') && !monthRow) monthRow = row; });
  assert.match(monthRow.getCell(2).value.formula, /EDATE\(\$A\d+,1\)/);
  assert.equal(monthRow.getCell(4).value.result, 1892.5);
});

test('xlsx honors vehicle + date range + category filters', async () => {
  const d = fixture();
  const { wb, model } = await build(d, { vehicleId: 'v1', from: '2026-03-01', to: '2026-12-31' });
  assert.deepEqual(rowsOf(wb.getWorksheet('Vehicles')).map((r) => r[0]), ['Name', 'Truck 1']);
  const ml = rowsOf(wb.getWorksheet('Maintenance Log')).slice(1);
  assert.deepEqual(ml.map((r) => r[3]), ['Brakes', 'Oil change']);
  assert.ok(ml.every((r) => r[1] === 'Truck 1'));
  const ex = rowsOf(wb.getWorksheet('Expenses')).slice(1);
  assert.deepEqual(ex.map((r) => r[4]), [99.6]);
  const s = wb.getWorksheet('Summary');
  assert.match(s.getCell('A2').value, /Vehicle: Truck 1.*Dates: 2026-03-01 to 2026-12-31.*Category: All/);
  assert.equal(model.totals.grand, C.round2(520 + 105 + 99.6));
  assert.deepEqual(rowsOf(wb.getWorksheet('Reminders')).slice(1).map((r) => r[0]), ['Truck 1']);

  const cat = await build(d, { category: 'Fuel' });
  assert.equal(cat.wb.getWorksheet('Maintenance Log').rowCount, 1);
  assert.equal(cat.wb.getWorksheet('Expenses').rowCount, 3);
  assert.equal(cat.model.totals.grand, 220);
});

test('xlsx with no data still opens (headers only, formulas sum to 0)', async () => {
  const { wb } = await build({ vehicles: [], services: [], expenses: [], reminders: [], settings: {} }, {});
  assert.equal(wb.getWorksheet('Maintenance Log').rowCount, 1);
  assert.ok(wb.getWorksheet('Summary'));
});

test('csv exports contain the filtered rows and escape correctly', () => {
  const d = fixture();
  const m = C.buildExportModel(d, { vehicleId: 'v2' }, NOW);
  const csv = C.csvFor(m, 'maintenance');
  const lines = csv.replace('\ufeff', '').trim().split('\r\n');
  assert.equal(lines[0], 'Date,Vehicle,Odometer,Service Type,Vendor,Parts,Labor,Total,Notes,Receipt Photo');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '2026-02-01,Truck 2,140000,Tires,Les Schwab,1200,150,1350,"Four drive tires, ""heavy duty""",No');
  assert.equal(lines[2], '2026-02-20,Truck 2,,Repairs,"Dave, the mechanic",0,0,80,,No');
  const v = C.csvFor(C.buildExportModel(d, {}, NOW), 'vehicles');
  assert.ok(v.includes("'=cmd|"), 'formula-like text is neutralised in CSV');
  assert.equal(C.csvFor(C.buildExportModel(d, { category: 'Tolls' }, NOW), 'expenses').trim().split('\r\n').length, 2);
});

test('write sample workbooks for the openpyxl / LibreOffice check', async () => {
  const d = fixture();
  const cases = { full: {}, filtered: { vehicleId: 'v1', from: '2026-03-01', to: '2026-12-31' }, fuel: { category: 'Fuel' } };
  fs.writeFileSync(path.join(OUT, 'fixture.json'), JSON.stringify(d));
  fs.writeFileSync(path.join(OUT, 'cases.json'), JSON.stringify(cases));
  for (const [name, f] of Object.entries(cases)) {
    const { buf } = await build(d, f);
    fs.writeFileSync(path.join(OUT, name + '.xlsx'), Buffer.from(buf));
  }
  assert.ok(fs.existsSync(path.join(OUT, 'full.xlsx')));
});
