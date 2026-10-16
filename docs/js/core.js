/* Core logic for the Vehicle Maintenance Tracker.
 * Pure functions only (no DOM, no storage) so they run in the browser and in Node tests.
 * Dates are ISO strings "YYYY-MM-DD" (local calendar dates, handled with UTC math to avoid DST drift).
 * Money is plain numbers rounded to cents with round2().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SERVICE_TYPES = ['Oil change', 'Tires', 'Brakes', 'Inspection', 'Registration', 'Insurance', 'Repairs',
    'Fuel', 'Battery', 'Fluids', 'Transmission', 'Alignment', 'Winch / equipment', 'Other'];
  const EXPENSE_CATEGORIES = ['Fuel', 'Tolls', 'Insurance', 'Registration', 'Repairs', 'Other'];
  const VEHICLE_KINDS = ['Tow truck', 'Service vehicle', 'Personal', 'Trailer / equipment', 'Other'];

  // Suggested intervals when adding a reminder (all editable by the user).
  const REMINDER_PRESETS = {
    'Oil change': { intervalMonths: 6, intervalMiles: 5000 },
    'Tires': { intervalMonths: 6, intervalMiles: 7500 },
    'Brakes': { intervalMonths: 12, intervalMiles: 25000 },
    'Inspection': { intervalMonths: 12, intervalMiles: null },
    'Registration': { intervalMonths: 12, intervalMiles: null },
    'Insurance': { intervalMonths: 6, intervalMiles: null },
    'Battery': { intervalMonths: 48, intervalMiles: null },
    'Fluids': { intervalMonths: 12, intervalMiles: 30000 },
    'Transmission': { intervalMonths: 24, intervalMiles: 60000 },
    'Alignment': { intervalMonths: 12, intervalMiles: 12000 },
    'Winch / equipment': { intervalMonths: 12, intervalMiles: null }
  };

  const DEFAULT_SETTINGS = { businessName: "JD's Towing", soonDays: 30, soonMiles: 500, lastBackup: null };
  const BACKUP_APP = 'vehicle-tracker';
  const BACKUP_VERSION = 1;

  /* ---------- small helpers ---------- */
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const toNum = (v) => (isNum(v) ? Number(v) : null);
  const money = (v) => (isNum(v) ? round2(v) : 0);
  const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(t);
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return t;
  }
  const isoFromUTC = (t) => new Date(t).toISOString().slice(0, 10);
  const isValidISO = (s) => parseISO(s) !== null;
  function todayISO(now) {
    const d = now instanceof Date ? now : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); // local calendar date
  }
  function addMonths(iso, n) {
    const t = parseISO(iso);
    if (t === null) return null;
    const d = new Date(t);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    const target = new Date(Date.UTC(y, m + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return isoFromUTC(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last)));
  }
  function addDays(iso, n) { const t = parseISO(iso); return t === null ? null : isoFromUTC(t + n * 86400000); }
  function daysBetween(fromISO, toISO) { // toISO - fromISO in whole days
    const a = parseISO(fromISO), b = parseISO(toISO);
    return a === null || b === null ? null : Math.round((b - a) / 86400000);
  }
  const monthOf = (iso) => String(iso || '').slice(0, 7);

  /* ---------- records ---------- */
  /** Total defaults to parts + labor when not entered. */
  function serviceTotal(s) {
    if (isNum(s.total)) return round2(s.total);
    return round2(money(s.parts) + money(s.labor));
  }
  const vehicleLabel = (v) => v ? v.name : '(deleted vehicle)';
  function vehicleMap(data) { const m = new Map(); for (const v of data.vehicles || []) m.set(v.id, v); return m; }

  /** Returns an error string or null. `existing` = current vehicles (to check duplicate names). */
  function validateVehicle(v, existing) {
    if (!v || !String(v.name || '').trim()) return 'Give the vehicle a name.';
    const n = norm(v.name);
    if (/^[=<>]/.test(n)) return 'Vehicle name cannot start with = < or >.';
    if ((existing || []).some((o) => o.id !== v.id && norm(o.name) === n)) return 'Another vehicle already has that name.';
    if (v.odometer != null && v.odometer !== '' && (!isNum(v.odometer) || Number(v.odometer) < 0)) return 'Odometer must be a positive number.';
    if (v.year != null && v.year !== '' && (!isNum(v.year) || Number(v.year) < 1900 || Number(v.year) > 2100)) return 'Year looks wrong.';
    return null;
  }
  function validateService(s) {
    if (!s.vehicleId) return 'Pick a vehicle.';
    if (!isValidISO(s.date)) return 'Enter a valid date.';
    if (!String(s.type || '').trim()) return 'Pick a service type.';
    for (const k of ['parts', 'labor', 'total']) if (s[k] != null && s[k] !== '' && (!isNum(s[k]) || Number(s[k]) < 0)) return 'Costs must be zero or more.';
    if (s.odometer != null && s.odometer !== '' && (!isNum(s.odometer) || Number(s.odometer) < 0)) return 'Odometer must be a positive number.';
    return null;
  }
  function validateExpense(e) {
    if (!isValidISO(e.date)) return 'Enter a valid date.';
    if (!String(e.category || '').trim()) return 'Pick a category.';
    if (!isNum(e.amount) || Number(e.amount) < 0) return 'Enter an amount (zero or more).';
    if (e.odometer != null && e.odometer !== '' && (!isNum(e.odometer) || Number(e.odometer) < 0)) return 'Odometer must be a positive number.';
    return null;
  }
  function validateReminder(r) {
    if (!r.vehicleId) return 'Pick a vehicle.';
    if (!String(r.type || '').trim()) return 'Enter what to remind about.';
    const hasMonths = isNum(r.intervalMonths) && Number(r.intervalMonths) > 0;
    const hasMiles = isNum(r.intervalMiles) && Number(r.intervalMiles) > 0;
    const hasDue = !!r.dueDate;
    if (!hasMonths && !hasMiles && !hasDue) return 'Set a repeat interval (months and/or miles) or a due date.';
    for (const k of ['baseDate', 'dueDate']) if (r[k] && !isValidISO(r[k])) return 'A date is not valid.';
    return null;
  }

  /** Clean a form object into a stored service record. */
  function cleanService(s) {
    const out = {
      id: s.id || uid(), vehicleId: s.vehicleId, date: s.date, type: String(s.type).trim(),
      odometer: toNum(s.odometer), vendor: String(s.vendor || '').trim(),
      parts: toNum(s.parts), labor: toNum(s.labor), total: null, notes: String(s.notes || '').trim(), receipt: s.receipt || null
    };
    out.total = serviceTotal({ parts: out.parts, labor: out.labor, total: s.total });
    return out;
  }
  function cleanExpense(e) {
    return {
      id: e.id || uid(), vehicleId: e.vehicleId || null, date: e.date, category: String(e.category).trim(),
      amount: round2(e.amount), vendor: String(e.vendor || '').trim(), odometer: toNum(e.odometer), notes: String(e.notes || '').trim()
    };
  }
  function cleanVehicle(v) {
    return {
      id: v.id || uid(), name: String(v.name).trim(), kind: v.kind || 'Tow truck', year: toNum(v.year), make: String(v.make || '').trim(),
      model: String(v.model || '').trim(), vin: String(v.vin || '').trim().toUpperCase(), plate: String(v.plate || '').trim().toUpperCase(),
      odometer: toNum(v.odometer), notes: String(v.notes || '').trim(), photo: v.photo || null
    };
  }
  function cleanReminder(r) {
    return {
      id: r.id || uid(), vehicleId: r.vehicleId, type: String(r.type).trim(),
      intervalMonths: isNum(r.intervalMonths) && Number(r.intervalMonths) > 0 ? Number(r.intervalMonths) : null,
      intervalMiles: isNum(r.intervalMiles) && Number(r.intervalMiles) > 0 ? Number(r.intervalMiles) : null,
      baseDate: r.baseDate || null, baseOdometer: toNum(r.baseOdometer), dueDate: r.dueDate || null, notes: String(r.notes || '').trim()
    };
  }

  /** If a logged odometer is higher than the vehicle's current one, return the vehicle with the new reading. */
  function bumpOdometer(vehicle, reading) {
    if (!vehicle || !isNum(reading)) return vehicle;
    if (!isNum(vehicle.odometer) || Number(reading) > Number(vehicle.odometer)) return Object.assign({}, vehicle, { odometer: Number(reading) });
    return vehicle;
  }

  /* ---------- filtering ---------- */
  /** filter = { vehicleId, from, to, category } (all optional; empty = no restriction). Dates inclusive. */
  function inRange(date, f) {
    if (!date) return false;
    if (f.from && date < f.from) return false;
    if (f.to && date > f.to) return false;
    return true;
  }
  function filterData(data, f) {
    f = f || {};
    const cat = norm(f.category);
    const vehicles = (data.vehicles || []).filter((v) => !f.vehicleId || v.id === f.vehicleId);
    const services = (data.services || []).filter((s) =>
      (!f.vehicleId || s.vehicleId === f.vehicleId) && inRange(s.date, f) && (!cat || norm(s.type) === cat));
    const expenses = (data.expenses || []).filter((e) =>
      (!f.vehicleId || e.vehicleId === f.vehicleId) && inRange(e.date, f) && (!cat || norm(e.category) === cat));
    const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    return { vehicles, services: services.sort(byDateDesc), expenses: expenses.sort(byDateDesc) };
  }

  /* ---------- totals ---------- */
  function totals(services, expenses) {
    let parts = 0, labor = 0, maint = 0, exp = 0;
    for (const s of services || []) { parts += money(s.parts); labor += money(s.labor); maint += serviceTotal(s); }
    for (const e of expenses || []) exp += money(e.amount);
    return { parts: round2(parts), labor: round2(labor), maintenance: round2(maint), expenses: round2(exp), grand: round2(maint + exp) };
  }

  /** Miles = highest minus lowest odometer reading across the given service + expense records (needs two readings). */
  function milesDriven(services, expenses) {
    const r = [];
    for (const s of services || []) if (isNum(s.odometer)) r.push(Number(s.odometer));
    for (const e of expenses || []) if (isNum(e.odometer)) r.push(Number(e.odometer));
    if (r.length < 2) return null;
    const miles = Math.max(...r) - Math.min(...r);
    return miles > 0 ? miles : null;
  }
  const costPerMile = (cost, miles) => (miles && miles > 0 ? round2Cpm(cost / miles) : null);
  const round2Cpm = (n) => Math.round(n * 1000) / 1000; // 3 decimals: cost per mile is often cents-small

  /** Per-vehicle rows. Includes a "(No vehicle)" row (vehicleId null) when matching expenses have no vehicle. */
  function vehicleSummaries(data, f) {
    const sub = filterData(data, f);
    const rows = sub.vehicles.map((v) => {
      const sv = sub.services.filter((s) => s.vehicleId === v.id);
      const ex = sub.expenses.filter((e) => e.vehicleId === v.id);
      const t = totals(sv, ex);
      const miles = milesDriven(sv, ex);
      return { vehicleId: v.id, name: v.name, parts: t.parts, labor: t.labor, maintenance: t.maintenance, expenses: t.expenses,
        grand: t.grand, miles, costPerMile: costPerMile(t.grand, miles), serviceCount: sv.length, expenseCount: ex.length };
    });
    const orphan = sub.expenses.filter((e) => !e.vehicleId);
    if (orphan.length && !(f && f.vehicleId)) {
      const t = totals([], orphan);
      rows.push({ vehicleId: null, name: '(No vehicle)', parts: 0, labor: 0, maintenance: 0, expenses: t.expenses, grand: t.grand,
        miles: null, costPerMile: null, serviceCount: 0, expenseCount: orphan.length });
    }
    return rows;
  }

  function monthlyTotals(services, expenses) {
    const m = new Map();
    const get = (k) => { if (!m.has(k)) m.set(k, { month: k, maintenance: 0, expenses: 0 }); return m.get(k); };
    for (const s of services || []) get(monthOf(s.date)).maintenance += serviceTotal(s);
    for (const e of expenses || []) get(monthOf(e.date)).expenses += money(e.amount);
    return [...m.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((r) => ({
      month: r.month, maintenance: round2(r.maintenance), expenses: round2(r.expenses), total: round2(r.maintenance + r.expenses) }));
  }

  function categoryTotals(services, expenses) {
    const m = new Map();
    const get = (name) => { const k = norm(name); if (!m.has(k)) m.set(k, { category: String(name).trim(), maintenance: 0, expenses: 0 }); return m.get(k); };
    for (const s of services || []) get(s.type).maintenance += serviceTotal(s);
    for (const e of expenses || []) get(e.category).expenses += money(e.amount);
    return [...m.values()].sort((a, b) => a.category.localeCompare(b.category)).map((r) => ({
      category: r.category, maintenance: round2(r.maintenance), expenses: round2(r.expenses), total: round2(r.maintenance + r.expenses) }));
  }

  /* ---------- reminders ---------- */
  /**
   * Work out when a reminder is next due.
   * "Last done" = the newest logged service of the same type for the same vehicle, or the baseline typed into the
   * reminder if that is newer. Next due = last date + months and/or last odometer + miles. A fixed dueDate (e.g. a
   * registration expiry) is used until a matching service is logged within 60 days before it or later.
   * Status: overdue (past date or past mileage), soon (within soonDays / soonMiles), ok, or unknown (nothing to calculate from).
   */
  function computeReminder(rem, vehicle, services, settings, today) {
    const st = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    today = today || todayISO();
    const type = norm(rem.type);
    const matching = (services || []).filter((s) => s.vehicleId === rem.vehicleId && norm(s.type) === type);
    let latest = null;
    for (const s of matching) {
      if (!latest || s.date > latest.date || (s.date === latest.date && Number(s.odometer || 0) > Number(latest.odometer || 0))) latest = s;
    }
    let last = { date: rem.baseDate || null, odometer: isNum(rem.baseOdometer) ? Number(rem.baseOdometer) : null, source: rem.baseDate || isNum(rem.baseOdometer) ? 'reminder' : null };
    if (latest && (!rem.baseDate || latest.date >= rem.baseDate)) {
      last = { date: latest.date, odometer: isNum(latest.odometer) ? Number(latest.odometer) : null, source: 'log' };
    }
    let explicit = !!rem.dueDate;
    if (explicit && latest && latest.date > (rem.baseDate || '') && latest.date >= addDays(rem.dueDate, -60)) explicit = false;

    let nextDate = null;
    if (explicit) nextDate = rem.dueDate;
    else if (last.date && isNum(rem.intervalMonths) && Number(rem.intervalMonths) > 0) nextDate = addMonths(last.date, Number(rem.intervalMonths));
    let nextOdometer = null;
    if (last.odometer !== null && isNum(rem.intervalMiles) && Number(rem.intervalMiles) > 0) nextOdometer = last.odometer + Number(rem.intervalMiles);

    const cur = vehicle && isNum(vehicle.odometer) ? Number(vehicle.odometer) : null;
    const daysLeft = nextDate ? daysBetween(today, nextDate) : null;
    const milesLeft = nextOdometer !== null && cur !== null ? nextOdometer - cur : null;

    let status = 'unknown';
    const reasons = [];
    if (daysLeft !== null || milesLeft !== null) {
      status = 'ok';
      if ((daysLeft !== null && daysLeft < 0) || (milesLeft !== null && milesLeft < 0)) status = 'overdue';
      else if ((daysLeft !== null && daysLeft <= st.soonDays) || (milesLeft !== null && milesLeft <= st.soonMiles)) status = 'soon';
      if (daysLeft !== null && (status === 'overdue' ? daysLeft < 0 : status === 'soon' ? daysLeft <= st.soonDays : false)) reasons.push('date');
      if (milesLeft !== null && (status === 'overdue' ? milesLeft < 0 : status === 'soon' ? milesLeft <= st.soonMiles : false)) reasons.push('miles');
    }
    return { reminderId: rem.id, vehicleId: rem.vehicleId, type: rem.type, lastDate: last.date, lastOdometer: last.odometer, lastSource: last.source,
      nextDate, nextOdometer, daysLeft, milesLeft, status, reasons, currentOdometer: cur };
  }

  const STATUS_RANK = { overdue: 0, soon: 1, ok: 2, unknown: 3 };
  /** All reminders with computed status, most urgent first. */
  function allReminders(data, today) {
    const vm = vehicleMap(data);
    const out = (data.reminders || []).map((r) => Object.assign(computeReminder(r, vm.get(r.vehicleId), data.services, data.settings, today),
      { vehicleName: vehicleLabel(vm.get(r.vehicleId)), reminder: r }));
    out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]
      || (a.daysLeft === null ? 1e9 : a.daysLeft) - (b.daysLeft === null ? 1e9 : b.daysLeft)
      || (a.milesLeft === null ? 1e9 : a.milesLeft) - (b.milesLeft === null ? 1e9 : b.milesLeft));
    return out;
  }
  /** Reminder's baseline after "Mark done": today's date/odometer, one-off due date cleared. */
  function markDone(rem, date, odometer) {
    return Object.assign({}, rem, { baseDate: date, baseOdometer: toNum(odometer), dueDate: null });
  }

  /* ---------- CSV ---------- */
  /** RFC-4180 CSV. Text starting with = + - @ (which a spreadsheet could run as a formula) gets a leading single quote. */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(headers, rows) {
    const lines = [headers.map(csvCell).join(',')];
    for (const r of rows) lines.push(r.map(csvCell).join(','));
    return '\ufeff' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8
  }

  /* ---------- export model (shared by xlsx + csv) ---------- */
  const VEHICLE_HEADERS = ['Name', 'Type', 'Year', 'Make', 'Model', 'VIN', 'Plate', 'Current Odometer', 'Notes'];
  const MAINT_HEADERS = ['Date', 'Vehicle', 'Odometer', 'Service Type', 'Vendor', 'Parts', 'Labor', 'Total', 'Notes', 'Receipt Photo'];
  const EXPENSE_HEADERS = ['Date', 'Vehicle', 'Category', 'Vendor', 'Amount', 'Odometer', 'Notes'];
  const NO_VEHICLE = '(No vehicle)';

  function describeFilter(f, data) {
    f = f || {};
    const v = f.vehicleId ? ((data.vehicles || []).find((x) => x.id === f.vehicleId) || {}).name || '(unknown)' : 'All vehicles';
    const d = f.from || f.to ? (f.from || 'start') + ' to ' + (f.to || 'today') : 'All dates';
    return { vehicle: v, dates: d, category: f.category ? f.category : 'All categories',
      text: 'Vehicle: ' + v + '  |  Dates: ' + d + '  |  Category: ' + (f.category ? f.category : 'All') };
  }

  function buildExportModel(data, f, now) {
    f = f || {};
    const sub = filterData(data, f);
    const vm = vehicleMap(data);
    const asc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const vehicles = sub.vehicles.map((v) => [v.name, v.kind || '', v.year, v.make, v.model, v.vin, v.plate, v.odometer, v.notes]);
    const maintenance = sub.services.slice().sort(asc).map((s) => [s.date, vehicleLabel(vm.get(s.vehicleId)), s.odometer, s.type, s.vendor,
      money(s.parts), money(s.labor), serviceTotal(s), s.notes, s.receipt ? 'Yes' : 'No']);
    const expenses = sub.expenses.slice().sort(asc).map((e) => [e.date, e.vehicleId ? vehicleLabel(vm.get(e.vehicleId)) : NO_VEHICLE, e.category,
      e.vendor, money(e.amount), e.odometer, e.notes]);
    const perVehicle = vehicleSummaries(data, f);
    const monthly = monthlyTotals(sub.services, sub.expenses);
    const byCategory = categoryTotals(sub.services, sub.expenses);
    const tot = totals(sub.services, sub.expenses);
    const reminderRows = allReminders({ vehicles: data.vehicles, services: data.services, settings: data.settings,
      reminders: (data.reminders || []).filter((r) => !f.vehicleId || r.vehicleId === f.vehicleId) }, todayISO(now))
      .map((r) => [r.vehicleName, r.type, r.lastDate, r.lastOdometer, r.nextDate, r.nextOdometer, r.daysLeft, r.milesLeft,
        { overdue: 'Overdue', soon: 'Due soon', ok: 'OK', unknown: 'Needs info' }[r.status]]);
    return { filter: describeFilter(f, data), generated: todayISO(now), businessName: (data.settings && data.settings.businessName) || DEFAULT_SETTINGS.businessName,
      headers: { vehicles: VEHICLE_HEADERS, maintenance: MAINT_HEADERS, expenses: EXPENSE_HEADERS,
        reminders: ['Vehicle', 'Item', 'Last Done', 'Last Odometer', 'Next Due Date', 'Next Due Odometer', 'Days Left', 'Miles Left', 'Status'] },
      vehicles, maintenance, expenses, reminders: reminderRows, perVehicle, monthly, byCategory, totals: tot };
  }
  const csvFor = (model, which) => toCSV(model.headers[which], model[which]);

  /* ---------- backup / restore ---------- */
  function buildBackup(data, opts) {
    opts = opts || {};
    const keepPhotos = opts.includePhotos !== false;
    return {
      app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: (opts.now instanceof Date ? opts.now : new Date()).toISOString(),
      vehicles: (data.vehicles || []).map((v) => keepPhotos ? v : Object.assign({}, v, { photo: null })),
      services: (data.services || []).map((s) => keepPhotos ? s : Object.assign({}, s, { receipt: null })),
      expenses: data.expenses || [], reminders: data.reminders || [], settings: data.settings || {}
    };
  }
  function validateBackup(b) {
    const errors = [];
    if (!b || typeof b !== 'object') return { ok: false, errors: ['Not a backup file.'] };
    if (b.app !== BACKUP_APP) errors.push('This file is not a Vehicle Tracker backup.');
    if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) errors.push('Backup version is newer than this app understands.');
    for (const k of ['vehicles', 'services', 'expenses', 'reminders']) if (!Array.isArray(b[k])) errors.push('Missing "' + k + '" list.');
    if (!errors.length) {
      for (const k of ['vehicles', 'services', 'expenses', 'reminders']) for (const r of b[k]) if (!r || typeof r !== 'object' || !r.id) { errors.push('A record in "' + k + '" has no id.'); break; }
      for (const v of b.vehicles) if (!v.name) { errors.push('A vehicle has no name.'); break; }
      for (const s of b.services) if (!isValidISO(s.date) || !s.vehicleId) { errors.push('A service record is missing its date or vehicle.'); break; }
      for (const e of b.expenses) if (!isValidISO(e.date) || !isNum(e.amount)) { errors.push('An expense record is missing its date or amount.'); break; }
    }
    return { ok: errors.length === 0, errors, counts: errors.length ? null : { vehicles: b.vehicles.length, services: b.services.length, expenses: b.expenses.length, reminders: b.reminders.length } };
  }
  /** mode "replace" = backup becomes everything; "merge" = union by id, backup wins on same id. Returns { data, dropped }. */
  function applyBackup(current, b, mode) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, mode === 'replace' ? b.settings : Object.assign({}, b.settings, current.settings));
    const mergeList = (cur, inc) => {
      if (mode === 'replace') return inc.map((r) => Object.assign({}, r));
      const m = new Map(cur.map((r) => [r.id, r]));
      for (const r of inc) m.set(r.id, Object.assign({}, m.get(r.id) || {}, r));
      return [...m.values()];
    };
    const vehicles = mergeList(current.vehicles || [], b.vehicles);
    const ids = new Set(vehicles.map((v) => v.id));
    let dropped = 0;
    const keep = (r) => { if (ids.has(r.vehicleId)) return true; dropped++; return false; };
    const services = mergeList(current.services || [], b.services).filter(keep);
    const reminders = mergeList(current.reminders || [], b.reminders).filter(keep);
    const expenses = mergeList(current.expenses || [], b.expenses).map((e) => {
      if (e.vehicleId && !ids.has(e.vehicleId)) { dropped++; return Object.assign({}, e, { vehicleId: null }); }
      return e;
    });
    return { data: { vehicles, services, expenses, reminders, settings }, dropped };
  }

  return { SERVICE_TYPES, EXPENSE_CATEGORIES, VEHICLE_KINDS, REMINDER_PRESETS, DEFAULT_SETTINGS, NO_VEHICLE,
    round2, isNum, toNum, money, uid, norm, parseISO, isValidISO, todayISO, addMonths, addDays, daysBetween, monthOf,
    serviceTotal, vehicleLabel, vehicleMap, validateVehicle, validateService, validateExpense, validateReminder,
    cleanService, cleanExpense, cleanVehicle, cleanReminder, bumpOdometer,
    filterData, totals, milesDriven, costPerMile, vehicleSummaries, monthlyTotals, categoryTotals,
    computeReminder, allReminders, markDone, csvCell, toCSV, buildExportModel, csvFor, describeFilter,
    buildBackup, validateBackup, applyBackup };
});
