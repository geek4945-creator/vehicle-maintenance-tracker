const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/core.js');
const fixture = require('./fixture.js');

test('dates: addMonths clamps to month end, daysBetween, todayISO uses local date', () => {
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(C.addMonths('2026-10-16', 6), '2027-04-16');
  assert.equal(C.addMonths('2026-03-15', -3), '2025-12-15');
  assert.equal(C.daysBetween('2026-10-16', '2026-10-31'), 15);
  assert.equal(C.daysBetween('2026-10-16', '2026-10-10'), -6);
  assert.equal(C.daysBetween('2026-03-07', '2026-03-09'), 2); // across US DST change: still whole days
  assert.equal(C.todayISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(C.isValidISO('2026-02-30'), false);
});

test('service total defaults to parts + labor, explicit total wins', () => {
  assert.equal(C.serviceTotal({ parts: 10.1, labor: 20.2 }), 30.3);
  assert.equal(C.serviceTotal({ parts: 10, labor: 20, total: 35 }), 35);
  assert.equal(C.serviceTotal({ parts: '', labor: null }), 0);
  assert.equal(C.serviceTotal({ parts: 0.1, labor: 0.2 }), 0.3); // no float drift
  const rec = C.cleanService({ vehicleId: 'v1', date: '2026-01-01', type: ' Oil change ', parts: '12.50', labor: '7.25', total: '' });
  assert.equal(rec.total, 19.75); assert.equal(rec.type, 'Oil change');
});

test('totals across services and expenses', () => {
  const d = fixture();
  const t = C.totals(d.services, d.expenses);
  assert.equal(t.parts, 60 + 300.5 + 65 + 1200);
  assert.equal(t.labor, 40 + 200.25 + 40 + 150);
  assert.equal(t.maintenance, 100 + 520 + 105 + 1350 + 80);
  assert.equal(t.expenses, 120.4 + 99.6 + 12.5 + 450 + 316);
  assert.equal(t.grand, C.round2(t.maintenance + t.expenses));
});

test('filters: vehicle, inclusive date range, category (case-insensitive)', () => {
  const d = fixture();
  let r = C.filterData(d, { vehicleId: 'v1' });
  assert.equal(r.services.length, 3); assert.equal(r.expenses.length, 2); assert.equal(r.vehicles.length, 1);
  r = C.filterData(d, { from: '2026-02-01', to: '2026-03-02' });
  assert.deepEqual(r.services.map((s) => s.id).sort(), ['s4', 's5']); // s4 is on the 'from' boundary (02-01); e2 below is on the 'to' boundary (03-02)
  assert.deepEqual(r.expenses.map((e) => e.id).sort(), ['e2', 'e3', 'e4']);
  r = C.filterData(d, { category: 'fuel' });
  assert.equal(r.services.length, 0); assert.equal(r.expenses.length, 2);
  r = C.filterData(d, { category: 'Oil change', vehicleId: 'v1', to: '2026-06-30' });
  assert.deepEqual(r.services.map((s) => s.id), ['s1']);
  assert.equal(r.expenses.length, 0);
  // newest first
  assert.deepEqual(C.filterData(d, {}).services.map((s) => s.id), ['s3', 's2', 's5', 's4', 's1']);
});

test('per-vehicle summary: totals, miles and cost per mile', () => {
  const d = fixture();
  const rows = C.vehicleSummaries(d, {});
  const t1 = rows.find((r) => r.vehicleId === 'v1');
  assert.equal(t1.maintenance, 725); assert.equal(t1.expenses, 220); assert.equal(t1.grand, 945);
  assert.equal(t1.miles, 85000 - 80000);              // readings: services 80000/82500/85000 + fuel 80300
  assert.equal(t1.costPerMile, 0.189);                // 945 / 5000 = 0.189
  const t2 = rows.find((r) => r.vehicleId === 'v2');
  assert.equal(t2.miles, null);                       // only one odometer reading -> no cost per mile
  assert.equal(t2.costPerMile, null);
  const none = rows.find((r) => r.vehicleId === null);
  assert.equal(none.name, '(No vehicle)'); assert.equal(none.expenses, 450);
  // filtered to one vehicle: no "(No vehicle)" row; range changes miles
  const only = C.vehicleSummaries(d, { vehicleId: 'v1', from: '2026-03-01' });
  assert.equal(only.length, 1); assert.equal(only[0].miles, 85000 - 82500); assert.equal(only[0].grand, 520 + 105 + 99.6);
});

test('monthly and category totals', () => {
  const d = fixture();
  const m = C.monthlyTotals(d.services, d.expenses);
  assert.deepEqual(m.map((x) => x.month), ['2026-01', '2026-02', '2026-03', '2026-08', '2026-09']);
  const feb = m.find((x) => x.month === '2026-02');
  assert.equal(feb.maintenance, 1430); assert.equal(feb.expenses, 462.5); assert.equal(feb.total, 1892.5);
  const cats = C.categoryTotals(d.services, d.expenses);
  const fuel = cats.find((c) => c.category === 'Fuel'); assert.equal(fuel.expenses, 220); assert.equal(fuel.maintenance, 0);
  assert.equal(C.round2(cats.reduce((a, c) => a + c.total, 0)), C.totals(d.services, d.expenses).grand);
});

test('reminders: date based status (overdue / soon / ok) and boundaries', () => {
  const v = { id: 'v1', odometer: null };
  const rem = { id: 'r', vehicleId: 'v1', type: 'Inspection', intervalMonths: 12, baseDate: '2025-10-16' };
  const set = { soonDays: 30, soonMiles: 500 };
  let r = C.computeReminder(rem, v, [], set, '2026-10-16');
  assert.equal(r.nextDate, '2026-10-16'); assert.equal(r.daysLeft, 0); assert.equal(r.status, 'soon');
  r = C.computeReminder(rem, v, [], set, '2026-10-17'); assert.equal(r.status, 'overdue'); assert.equal(r.daysLeft, -1);
  r = C.computeReminder(rem, v, [], set, '2026-09-16'); assert.equal(r.daysLeft, 30); assert.equal(r.status, 'soon');
  r = C.computeReminder(rem, v, [], set, '2026-09-15'); assert.equal(r.daysLeft, 31); assert.equal(r.status, 'ok');
});

test('reminders: mileage based status and combined date+miles (either triggers)', () => {
  const v = { id: 'v1', odometer: 84800 };
  const rem = { id: 'r', vehicleId: 'v1', type: 'Oil change', intervalMonths: 6, intervalMiles: 5000, baseDate: '2026-08-20', baseOdometer: 80000 };
  const set = { soonDays: 30, soonMiles: 500 };
  let r = C.computeReminder(rem, v, [], set, '2026-09-01');
  assert.equal(r.nextOdometer, 85000); assert.equal(r.milesLeft, 200); assert.equal(r.status, 'soon'); assert.deepEqual(r.reasons, ['miles']);
  r = C.computeReminder(rem, { id: 'v1', odometer: 85001 }, [], set, '2026-09-01');
  assert.equal(r.status, 'overdue'); assert.equal(r.milesLeft, -1);
  r = C.computeReminder(rem, { id: 'v1', odometer: 81000 }, [], set, '2026-09-01');
  assert.equal(r.status, 'ok');
  r = C.computeReminder(rem, { id: 'v1', odometer: 81000 }, [], set, '2027-03-01'); // date passed, miles fine
  assert.equal(r.status, 'overdue'); assert.deepEqual(r.reasons, ['date']);
  // no vehicle odometer -> mileage can't be judged, date still can
  r = C.computeReminder(rem, { id: 'v1', odometer: null }, [], set, '2026-09-01');
  assert.equal(r.milesLeft, null); assert.equal(r.status, 'ok');
});

test('reminders: last done comes from the newest matching service log', () => {
  const d = fixture();
  const vm = C.vehicleMap(d);
  const r = C.computeReminder(d.reminders[0], vm.get('v1'), d.services, d.settings, '2026-10-16');
  assert.equal(r.lastDate, '2026-08-20'); assert.equal(r.lastOdometer, 85000); assert.equal(r.lastSource, 'log');
  assert.equal(r.nextDate, '2027-02-20'); assert.equal(r.nextOdometer, 90000); assert.equal(r.milesLeft, 5000);
  assert.equal(r.status, 'ok');
  // other vehicle's / other type's services do not count
  const r2 = C.computeReminder(Object.assign({}, d.reminders[0], { vehicleId: 'v2' }), vm.get('v2'), d.services, d.settings, '2026-10-16');
  assert.equal(r2.lastDate, null); assert.equal(r2.status, 'unknown');
  // a baseline newer than the log wins
  const r3 = C.computeReminder(Object.assign({}, d.reminders[0], { baseDate: '2026-10-01', baseOdometer: 85100 }), vm.get('v1'), d.services, d.settings, '2026-10-16');
  assert.equal(r3.lastSource, 'reminder'); assert.equal(r3.nextOdometer, 90100);
});

test('reminders: fixed due date (registration) is used until a renewal is logged', () => {
  const d = fixture();
  const vm = C.vehicleMap(d);
  const rem = d.reminders[1]; // due 2026-10-31, every 12 months
  let r = C.computeReminder(rem, vm.get('v2'), d.services, d.settings, '2026-10-16');
  assert.equal(r.nextDate, '2026-10-31'); assert.equal(r.status, 'soon'); assert.equal(r.daysLeft, 15);
  r = C.computeReminder(rem, vm.get('v2'), d.services, d.settings, '2026-11-02'); assert.equal(r.status, 'overdue');
  const renewed = d.services.concat([{ id: 'x', vehicleId: 'v2', type: 'registration', date: '2026-10-20', odometer: 140600 }]);
  r = C.computeReminder(rem, vm.get('v2'), renewed, d.settings, '2026-11-02');
  assert.equal(r.lastDate, '2026-10-20'); assert.equal(r.nextDate, '2027-10-20'); assert.equal(r.status, 'ok');
  // a service from a year ago does not cancel the current due date
  const old = d.services.concat([{ id: 'y', vehicleId: 'v2', type: 'Registration', date: '2025-10-25' }]);
  r = C.computeReminder(rem, vm.get('v2'), old, d.settings, '2026-11-02');
  assert.equal(r.nextDate, '2026-10-31'); assert.equal(r.status, 'overdue');
});

test('reminders: sorted most urgent first; markDone resets baseline', () => {
  const d = fixture();
  d.vehicles[0].odometer = 91000;           // Truck 1 oil change now overdue by miles
  const list = C.allReminders(d, '2026-10-16');
  assert.deepEqual(list.map((x) => x.status), ['overdue', 'soon']);
  assert.equal(list[0].type, 'Oil change'); assert.equal(list[0].vehicleName, 'Truck 1');
  const done = C.markDone(d.reminders[1], '2026-10-16', 140500);
  assert.equal(done.dueDate, null); assert.equal(done.baseDate, '2026-10-16');
  const r = C.computeReminder(done, C.vehicleMap(d).get('v2'), [], d.settings, '2026-10-17');
  assert.equal(r.nextDate, '2027-10-16'); assert.equal(r.status, 'ok');
});

test('odometer bump only moves forward', () => {
  const v = { id: 'v', odometer: 1000 };
  assert.equal(C.bumpOdometer(v, 900), v);
  assert.equal(C.bumpOdometer(v, 1200).odometer, 1200);
  assert.equal(C.bumpOdometer({ id: 'v', odometer: null }, 50).odometer, 50);
  assert.equal(C.bumpOdometer(v, ''), v);
});

test('validation', () => {
  const vs = fixture().vehicles;
  assert.match(C.validateVehicle({ name: '' }, vs), /name/);
  assert.match(C.validateVehicle({ id: 'new', name: ' truck 1 ' }, vs), /already/);
  assert.equal(C.validateVehicle({ id: 'v1', name: 'Truck 1' }, vs), null); // editing itself is fine
  assert.match(C.validateVehicle({ name: '=SUM(A1)' }, vs), /cannot start/);
  assert.match(C.validateService({ vehicleId: 'v1', date: '2026-13-01', type: 'x' }), /date/);
  assert.match(C.validateService({ vehicleId: 'v1', date: '2026-01-01', type: 'x', parts: -5 }), /Costs/);
  assert.equal(C.validateService({ vehicleId: 'v1', date: '2026-01-01', type: 'x', parts: '10' }), null);
  assert.match(C.validateExpense({ date: '2026-01-01', category: 'Fuel', amount: '' }), /amount/);
  assert.equal(C.validateExpense({ date: '2026-01-01', category: 'Fuel', amount: '0' }), null);
  assert.match(C.validateReminder({ vehicleId: 'v1', type: 'Oil' }), /interval/);
  assert.equal(C.validateReminder({ vehicleId: 'v1', type: 'Oil', intervalMiles: 5000 }), null);
});

test('CSV: quoting, commas, quotes, newlines, formula-injection guard, BOM', () => {
  assert.equal(C.csvCell('a,b'), '"a,b"');
  assert.equal(C.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(C.csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(C.csvCell('=1+1'), "'=1+1");
  assert.equal(C.csvCell(-5.5), '-5.5');
  assert.equal(C.csvCell(null), '');
  const csv = C.toCSV(['A', 'B'], [[1, 'x,y']]);
  assert.equal(csv, '\ufeffA,B\r\n1,"x,y"\r\n');
});

test('backup: build -> validate -> restore round trip (replace) is lossless', () => {
  const d = fixture();
  d.vehicles[0].photo = 'data:image/jpeg;base64,QQ==';
  const b = JSON.parse(JSON.stringify(C.buildBackup(d)));
  assert.equal(C.validateBackup(b).ok, true);
  assert.deepEqual(C.validateBackup(b).counts, { vehicles: 3, services: 5, expenses: 5, reminders: 2 });
  const { data, dropped } = C.applyBackup({ vehicles: [], services: [], expenses: [], reminders: [], settings: {} }, b, 'replace');
  assert.equal(dropped, 0);
  assert.deepEqual(data.vehicles, d.vehicles); assert.deepEqual(data.services, d.services);
  assert.deepEqual(data.expenses, d.expenses); assert.deepEqual(data.reminders, d.reminders);
  assert.equal(data.settings.businessName, "JD's Towing");
});

test('backup: without photos strips images; merge keeps existing photo and adds new records', () => {
  const d = fixture();
  d.vehicles[0].photo = 'data:image/jpeg;base64,QQ==';
  d.services[1].receipt = 'data:image/jpeg;base64,AAAA';
  const lite = C.buildBackup(d, { includePhotos: false });
  assert.equal(lite.vehicles[0].photo, null); assert.equal(lite.services[1].receipt, null);
  assert.equal(d.vehicles[0].photo, 'data:image/jpeg;base64,QQ==', 'source data untouched');
  const current = JSON.parse(JSON.stringify(d));
  current.expenses.push({ id: 'local-only', vehicleId: 'v1', date: '2026-10-01', category: 'Fuel', amount: 50 });
  lite.vehicles[0].name = 'Truck 1 (renamed in backup)';
  const { data } = C.applyBackup(current, lite, 'merge');
  assert.equal(data.vehicles.find((v) => v.id === 'v1').name, 'Truck 1 (renamed in backup)');
  assert.equal(data.vehicles.find((v) => v.id === 'v1').photo, null, 'merge: backup value (null) overrides');
  assert.ok(data.expenses.some((e) => e.id === 'local-only'), 'merge keeps local-only records');
  assert.equal(data.expenses.length, 6);
  assert.equal(data.services.length, 5, 'same ids are not duplicated');
});

test('backup: rejects bad files and drops orphans', () => {
  assert.equal(C.validateBackup(null).ok, false);
  assert.equal(C.validateBackup({ app: 'other', version: 1 }).ok, false);
  const b = C.buildBackup(fixture()); b.version = 99;
  assert.equal(C.validateBackup(b).ok, false);
  const b2 = C.buildBackup(fixture()); b2.services[0].date = 'garbage';
  assert.equal(C.validateBackup(b2).ok, false);
  const b3 = JSON.parse(JSON.stringify(C.buildBackup(fixture()))); b3.vehicles = b3.vehicles.filter((v) => v.id !== 'v2');
  const res = C.applyBackup({ vehicles: [], services: [], expenses: [], reminders: [], settings: {} }, b3, 'replace');
  assert.equal(res.dropped, 4);                                  // s4, s5, e3 (nulled) and r2
  assert.equal(res.data.expenses.find((e) => e.id === 'e3').vehicleId, null);
});
