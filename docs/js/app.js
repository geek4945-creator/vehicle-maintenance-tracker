/* Vehicle Maintenance Tracker – UI. Plain JS, no framework. Logic lives in core.js; storage in db.js. */
(function () {
  'use strict';
  const C = window.Core;
  const APP_VERSION = '1.0.0';
  const S = {
    db: null, data: { vehicles: [], services: [], expenses: [], reminders: [], settings: Object.assign({}, C.DEFAULT_SETTINGS) },
    view: 'home', param: null,
    filter: { vehicleId: '', from: '', to: '', category: '', preset: 'all' }
  };
  const $app = document.getElementById('app');
  const $title = document.getElementById('title');

  /* ---------- tiny DOM helper ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    const add = (x) => { if (x === null || x === undefined || x === false) return; if (Array.isArray(x)) x.forEach(add); else el.appendChild(x instanceof Node ? x : document.createTextNode(String(x))); };
    kids.forEach(add);
    if (value !== undefined) el.value = value;
    return el;
  }
  const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const fm = (n) => moneyFmt.format(Number(n) || 0);
  const fi = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-US'));
  const cpmFmt = (n) => (n === null || n === undefined ? '–' : '$' + n.toFixed(3) + '/mi');
  function fd(iso) {
    const t = C.parseISO(iso);
    return t === null ? '' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  const today = () => C.todayISO();
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const vmap = () => C.vehicleMap(S.data);

  let toastTimer;
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  /* ---------- persistence helpers ---------- */
  async function reloadAll() {
    const d = await S.db.loadAll();
    S.data = { vehicles: d.vehicles, services: d.services, expenses: d.expenses, reminders: d.reminders, settings: Object.assign({}, C.DEFAULT_SETTINGS, d.settings) };
  }
  function upsert(list, rec) { const i = list.findIndex((r) => r.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec); }
  async function put(store, rec) { await S.db.put(store, rec); upsert(S.data[store], rec); }
  async function remove(store, id) { await S.db.del(store, id); S.data[store] = S.data[store].filter((r) => r.id !== id); }
  async function bump(vehicleId, odo) {
    const v = S.data.vehicles.find((x) => x.id === vehicleId);
    const nv = C.bumpOdometer(v, odo);
    if (v && nv !== v) await put('vehicles', nv);
  }
  async function saveSettings(patch) { S.data.settings = Object.assign({}, S.data.settings, patch); await S.db.putSettings(S.data.settings); }
  async function guard(fn) { try { await fn(); } catch (e) { console.error(e); toast('Could not save: ' + (e.message || e), 5000); } }

  /* ---------- modals (Android back button closes the top one) ---------- */
  const modals = [];
  function openModal(content, opts) {
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back && !(opts && opts.sticky)) closeModal(); } });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
    back.appendChild(box);
    document.getElementById('modal-root').appendChild(back);
    modals.push(back);
    history.pushState({ modal: modals.length }, '');
    return back;
  }
  let skipPop = false;
  function closeModal() { if (modals.length) history.back(); }
  function dropTopModal() { const m = modals.pop(); if (m) m.remove(); }
  window.addEventListener('popstate', () => { if (skipPop) return; if (modals.length) dropTopModal(); else route(); });
  /** Close every open modal in one history step, then continue. */
  function closeAllModals(cb) {
    const n = modals.length;
    if (!n) return cb && cb();
    modals.splice(0).forEach((m) => m.remove());
    skipPop = true;
    const once = () => { window.removeEventListener('popstate', once); skipPop = false; setTimeout(() => cb && cb(), 0); };
    window.addEventListener('popstate', once);
    history.go(-n);
  }
  /** Close just the top modal, then continue. */
  function afterClose(fn) {
    if (!modals.length) return fn();
    const once = () => { window.removeEventListener('popstate', once); setTimeout(fn, 0); };
    window.addEventListener('popstate', once); history.back();
  }

  /* ---------- images ---------- */
  function pickImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }
  /** Photo field: returns { el, get() }. */
  function photoField(label, initial, maxDim) {
    let val = initial || null;
    const prev = h('div');
    const input = h('input', { type: 'file', accept: 'image/*', onchange: async () => {
      const f = input.files[0]; if (!f) return;
      try { val = await pickImage(f, maxDim, 0.72); paint(); } catch (e) { toast(e.message); }
      input.value = '';
    } });
    function paint() {
      prev.replaceChildren();
      if (val) {
        prev.appendChild(h('img', { class: 'photo-prev', src: val, alt: label, onclick: () => viewImage(val) }));
        prev.appendChild(h('button', { type: 'button', class: 'btn danger', onclick: () => { val = null; paint(); } }, 'Remove photo'));
      }
    }
    paint();
    return { el: h('div', { class: 'field' }, h('label', { class: 'f' }, label + ' (optional)'), prev, input), get: () => val };
  }
  function viewImage(src) {
    openModal([h('img', { class: 'img-full', src, alt: 'Photo' }), h('div', { class: 'btns' }, h('button', { class: 'btn block', onclick: closeModal }, 'Close'))]);
  }

  /* ---------- file saving (browser download or Android share sheet) ---------- */
  const capPlugins = () => (window.Capacitor && window.Capacitor.Plugins) || {};
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && capPlugins().Filesystem && capPlugins().Share);
  const blobToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  async function saveFile(name, blob) {
    if (isNative()) {
      const { Filesystem, Share } = capPlugins();
      const path = 'exports/' + name;
      await Filesystem.writeFile({ path, data: await blobToB64(blob), directory: 'CACHE', recursive: true });
      const { uri } = await Filesystem.getUri({ path, directory: 'CACHE' });
      try { await Share.share({ title: name, dialogTitle: 'Save or send ' + name, files: [uri] }); } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
      return 'shared';
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return 'downloaded';
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector('script[data-src="' + src + '"]')) return res();
      const s = document.createElement('script'); s.src = src; s.dataset.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
  }
  const stamp = () => today();
  const fileBase = () => (S.data.settings.businessName || 'Vehicle').replace(/['’]/g, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'Vehicle';

  async function exportXlsx() {
    toast('Building Excel file…');
    try {
      if (!window.ExcelJS) await loadScript('vendor/exceljs.min.js');
      const model = C.buildExportModel(S.data, S.filter);
      const buf = await window.XlsxExport.buildBuffer(window.ExcelJS, model);
      const name = fileBase() + '-Maintenance-' + stamp() + '.xlsx';
      const r = await saveFile(name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      toast(r === 'downloaded' ? 'Saved ' + name + ' to Downloads' : 'Choose where to save ' + name, 3500);
    } catch (e) { console.error(e); toast('Excel export failed: ' + (e.message || e), 6000); }
  }
  async function exportCsv(which) {
    try {
      const model = C.buildExportModel(S.data, S.filter);
      const label = { vehicles: 'Vehicles', maintenance: 'Maintenance-Log', expenses: 'Expenses' }[which];
      const name = fileBase() + '-' + label + '-' + stamp() + '.csv';
      const r = await saveFile(name, new Blob([C.csvFor(model, which)], { type: 'text/csv;charset=utf-8' }));
      toast(r === 'downloaded' ? 'Saved ' + name + ' to Downloads' : 'Choose where to save ' + name, 3500);
    } catch (e) { toast('CSV export failed: ' + (e.message || e), 6000); }
  }

  /* ---------- routing ---------- */
  const TITLES = { home: 'Home', vehicles: 'Vehicles', service: 'Service Log', expenses: 'Expenses', reports: 'Reports & Export', vehicle: 'Vehicle' };
  function go(view, param) { location.hash = '#/' + view + (param ? '/' + encodeURIComponent(param) : ''); }
  function route() {
    const m = /^#\/(\w+)(?:\/(.+))?$/.exec(location.hash);
    S.view = m && VIEWS[m[1]] ? m[1] : 'home';
    S.param = m && m[2] ? decodeURIComponent(m[2]) : null;
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    const navView = S.view === 'vehicle' ? 'vehicles' : S.view;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === navView));
    $title.textContent = (S.data.settings.businessName || '') && S.view === 'home' ? S.data.settings.businessName + ' – Fleet' : TITLES[S.view];
    document.querySelectorAll('.fab').forEach((f) => f.remove());
    $app.replaceChildren(VIEWS[S.view]());
  }
  function fab(label, fn) { document.body.appendChild(h('button', { class: 'fab', 'aria-label': label, onclick: fn }, '+')); }

  /* ---------- shared pieces ---------- */
  const STATUS_LABEL = { overdue: 'Overdue', soon: 'Due soon', ok: 'OK', unknown: 'Set up' };
  function badge(status) { return h('span', { class: 'badge b-' + status }, STATUS_LABEL[status]); }
  function dueText(r) {
    const parts = [];
    if (r.daysLeft !== null) parts.push(r.daysLeft < 0 ? 'Overdue by ' + plural(-r.daysLeft, 'day') : r.daysLeft === 0 ? 'Due today' : 'Due in ' + plural(r.daysLeft, 'day') + ' (' + fd(r.nextDate) + ')');
    if (r.nextOdometer !== null) {
      if (r.milesLeft === null) parts.push('Due at ' + fi(r.nextOdometer) + ' mi (set vehicle odometer)');
      else parts.push(r.milesLeft < 0 ? fi(-r.milesLeft) + ' mi past due' : fi(r.milesLeft) + ' mi left (at ' + fi(r.nextOdometer) + ')');
    }
    if (!parts.length) parts.push(r.status === 'unknown' ? 'Add a last-done date/odometer to start tracking' : 'No next due date');
    return parts.join(' · ');
  }
  function reminderCard(r, opts) {
    opts = opts || {};
    return h('div', { class: 'card' },
      h('div', { class: 'item' },
        h('div', { class: 'main' },
          h('div', { class: 'title' }, r.type, ' ', badge(r.status)),
          h('div', { class: 'sub' }, opts.noVehicle ? '' : r.vehicleName + ' · ', dueText(r)),
          r.lastDate ? h('div', { class: 'sub' }, 'Last done ' + fd(r.lastDate) + (r.lastOdometer !== null ? ' at ' + fi(r.lastOdometer) + ' mi' : '')) : null)),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => serviceForm(null, { vehicleId: r.vehicleId, type: r.type, markReminder: r.reminder }) }, 'Mark done'),
        h('button', { class: 'btn', onclick: () => reminderForm(r.reminder) }, 'Edit')));
  }
  function sumBar(parts) {
    return h('div', { class: 'totalbar' }, parts.map(([label, val]) => h('div', null, h('div', { class: 'small' }, label), h('b', null, val))));
  }
  function empty(msg, btn) { return h('div', { class: 'empty' }, h('p', null, msg), btn || null); }

  /* ---------- filters (shared by Service, Expenses, Reports) ---------- */
  function applyPreset(p) {
    const f = S.filter, t = today(), y = t.slice(0, 4);
    f.preset = p;
    if (p === 'all') { f.from = ''; f.to = ''; }
    else if (p === 'month') { f.from = t.slice(0, 7) + '-01'; f.to = ''; }
    else if (p === '30') { f.from = C.addDays(t, -30); f.to = ''; }
    else if (p === 'year') { f.from = y + '-01-01'; f.to = ''; }
    else if (p === 'lastyear') { f.from = (y - 1) + '-01-01'; f.to = (y - 1) + '-12-31'; }
  }
  function categoryOptions(kind) {
    const set = new Map();
    const add = (c) => { if (c && !set.has(C.norm(c))) set.set(C.norm(c), c); };
    if (kind !== 'expense') { C.SERVICE_TYPES.forEach(add); S.data.services.forEach((s) => add(s.type)); }
    if (kind !== 'service') { C.EXPENSE_CATEGORIES.forEach(add); S.data.expenses.forEach((e) => add(e.category)); }
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }
  function filtersUI(kind) {
    const f = S.filter;
    const presets = [['all', 'All time'], ['month', 'This month'], ['30', 'Last 30 days'], ['year', 'This year'], ['lastyear', 'Last year'], ['custom', 'Custom']];
    const change = (fn) => () => { fn(); render(); };
    return h('div', { class: 'filters' },
      h('div', { class: 'chips' }, presets.map(([k, l]) => h('button', { class: 'chip' + (f.preset === k ? ' on' : ''), onclick: change(() => { if (k === 'custom') f.preset = 'custom'; else applyPreset(k); }) }, l))),
      h('div', { class: 'fgrid' },
        f.preset === 'custom' ? h('div', null, h('label', { class: 'f' }, 'From'), h('input', { type: 'date', value: f.from, onchange: (e) => { f.from = e.target.value; render(); } })) : null,
        f.preset === 'custom' ? h('div', null, h('label', { class: 'f' }, 'To'), h('input', { type: 'date', value: f.to, onchange: (e) => { f.to = e.target.value; render(); } })) : null,
        h('div', null, h('label', { class: 'f' }, 'Vehicle'),
          h('select', { value: f.vehicleId, onchange: (e) => { f.vehicleId = e.target.value; render(); } }, h('option', { value: '' }, 'All vehicles'), S.data.vehicles.map((v) => h('option', { value: v.id }, v.name)))),
        h('div', null, h('label', { class: 'f' }, 'Category'),
          h('select', { value: f.category, onchange: (e) => { f.category = e.target.value; render(); } }, h('option', { value: '' }, 'All categories'), categoryOptions(kind).map((c) => h('option', { value: c }, c))))));
  }

  /* ---------- HOME ---------- */
  function homeView() {
    const d = S.data, root = h('div');
    if (!d.vehicles.length) {
      root.appendChild(h('div', { class: 'card' }, h('h2', null, 'Welcome 👋'), h('p', null, 'Add your trucks and vehicles, log service and expenses, and get reminders before things come due. Everything is stored on this device and works offline.'),
        h('button', { class: 'btn primary block', onclick: () => vehicleForm() }, 'Add your first vehicle')));
      return root;
    }
    const lb = d.settings.lastBackup;
    const age = lb ? C.daysBetween(lb.slice(0, 10), today()) : null;
    if (lb === null || age > 30) root.appendChild(h('div', { class: 'banner' }, lb === null ? 'You haven’t made a backup yet. Your data lives only on this device. ' : 'Last backup was ' + age + ' days ago. ', h('a', { href: '#', style: 'color:inherit;text-decoration:underline', onclick: (e) => { e.preventDefault(); settingsModal(); } }, 'Back up now')));
    const rem = C.allReminders(d, today());
    const nOver = rem.filter((r) => r.status === 'overdue').length, nSoon = rem.filter((r) => r.status === 'soon').length;
    const t = today();
    const mo = C.totals(d.services.filter((s) => C.monthOf(s.date) === t.slice(0, 7)), d.expenses.filter((e) => C.monthOf(e.date) === t.slice(0, 7)));
    const yr = C.totals(d.services.filter((s) => s.date.slice(0, 4) === t.slice(0, 4)), d.expenses.filter((e) => e.date.slice(0, 4) === t.slice(0, 4)));
    root.appendChild(h('div', { class: 'grid g4' },
      h('div', { class: 'stat' + (nOver ? ' bad' : '') }, h('b', null, nOver), h('span', null, 'Overdue')),
      h('div', { class: 'stat' + (nSoon ? ' warn' : '') }, h('b', null, nSoon), h('span', null, 'Due soon')),
      h('div', { class: 'stat' }, h('b', null, fm(mo.grand)), h('span', null, 'Spent this month')),
      h('div', { class: 'stat' }, h('b', null, fm(yr.grand)), h('span', null, 'Spent this year'))));
    root.appendChild(h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: () => serviceForm() }, '+ Service'),
      h('button', { class: 'btn primary', onclick: () => expenseForm() }, '+ Expense'),
      h('button', { class: 'btn', onclick: () => vehicleForm() }, '+ Vehicle')));
    const attention = rem.filter((r) => r.status === 'overdue' || r.status === 'soon');
    root.appendChild(h('h2', null, 'Needs attention'));
    if (!attention.length) root.appendChild(h('div', { class: 'card muted' }, rem.length ? '✅ Nothing is overdue or due soon.' : 'No reminders yet. Open a vehicle and add one (oil change, registration, insurance…).'));
    attention.forEach((r) => root.appendChild(reminderCard(r)));
    const upcoming = rem.filter((r) => r.status === 'ok' || r.status === 'unknown');
    if (upcoming.length) { root.appendChild(h('h2', null, 'Upcoming & other reminders')); upcoming.slice(0, 8).forEach((r) => root.appendChild(reminderCard(r))); }
    return root;
  }

  /* ---------- VEHICLES ---------- */
  function vehicleStatus(vid) {
    const rs = C.allReminders({ vehicles: S.data.vehicles, services: S.data.services, settings: S.data.settings, reminders: S.data.reminders.filter((r) => r.vehicleId === vid) }, today());
    return rs.length ? rs[0].status : null;
  }
  function vehiclesView() {
    const root = h('div');
    if (!S.data.vehicles.length) root.appendChild(empty('No vehicles yet.', h('button', { class: 'btn primary', onclick: () => vehicleForm() }, 'Add a vehicle')));
    S.data.vehicles.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((v) => {
      const st = vehicleStatus(v.id);
      root.appendChild(h('div', { class: 'card tap', onclick: () => go('vehicle', v.id) },
        h('div', { class: 'item' },
          v.photo ? h('img', { class: 'thumb', src: v.photo, alt: '' }) : h('div', { class: 'thumb' }, v.kind === 'Personal' ? '🚗' : '🚚'),
          h('div', { class: 'main' }, h('div', { class: 'title' }, v.name, ' ', st && st !== 'ok' ? badge(st) : null),
            h('div', { class: 'sub' }, [v.year, v.make, v.model].filter(Boolean).join(' ') || v.kind),
            h('div', { class: 'sub' }, (v.plate ? 'Plate ' + v.plate + ' · ' : '') + (v.odometer !== null ? fi(v.odometer) + ' mi' : 'No odometer'))))));
    });
    fab('Add vehicle', () => vehicleForm());
    return root;
  }
  function vehicleDetailView() {
    const v = S.data.vehicles.find((x) => x.id === S.param);
    if (!v) return empty('That vehicle no longer exists.', h('button', { class: 'btn', onclick: () => go('vehicles') }, 'Back to vehicles'));
    const sv = S.data.services.filter((s) => s.vehicleId === v.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    const ex = S.data.expenses.filter((e) => e.vehicleId === v.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    const tot = C.totals(sv, ex), miles = C.milesDriven(sv, ex);
    const rem = C.allReminders({ vehicles: S.data.vehicles, services: S.data.services, settings: S.data.settings, reminders: S.data.reminders.filter((r) => r.vehicleId === v.id) }, today());
    const root = h('div');
    root.appendChild(h('button', { class: 'btn', onclick: () => go('vehicles') }, '← All vehicles'));
    root.appendChild(h('div', { class: 'card', style: 'margin-top:10px' },
      v.photo ? h('img', { class: 'photo-prev', src: v.photo, alt: v.name, onclick: () => viewImage(v.photo) }) : null,
      h('h2', { style: 'margin:0 0 8px' }, v.name),
      h('dl', { class: 'kv' },
        h('dt', null, 'Type'), h('dd', null, v.kind || '–'),
        h('dt', null, 'Vehicle'), h('dd', null, [v.year, v.make, v.model].filter(Boolean).join(' ') || '–'),
        h('dt', null, 'VIN'), h('dd', null, v.vin || '–'),
        h('dt', null, 'Plate'), h('dd', null, v.plate || '–'),
        h('dt', null, 'Odometer'), h('dd', null, v.odometer !== null ? fi(v.odometer) + ' mi' : '–'),
        h('dt', null, 'Notes'), h('dd', null, v.notes || '–')),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => vehicleForm(v) }, 'Edit'),
        h('button', { class: 'btn', onclick: () => odometerModal(v) }, 'Update odometer'))));
    root.appendChild(h('div', { class: 'grid' },
      h('div', { class: 'stat' }, h('b', null, fm(tot.grand)), h('span', null, 'Total spent (all time)')),
      h('div', { class: 'stat' }, h('b', null, cpmFmt(C.costPerMile(tot.grand, miles))), h('span', null, miles ? 'Cost per mile (' + fi(miles) + ' mi logged)' : 'Cost per mile (needs 2+ odometer readings)'))));
    root.appendChild(h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: () => serviceForm(null, { vehicleId: v.id }) }, '+ Service'),
      h('button', { class: 'btn primary', onclick: () => expenseForm(null, { vehicleId: v.id }) }, '+ Expense')));
    root.appendChild(h('h2', null, 'Reminders'));
    if (!rem.length) root.appendChild(h('div', { class: 'card muted' }, 'No reminders for this vehicle yet.'));
    rem.forEach((r) => root.appendChild(reminderCard(r, { noVehicle: true })));
    root.appendChild(h('button', { class: 'btn block', onclick: () => reminderForm(null, { vehicleId: v.id }) }, '+ Add reminder'));
    root.appendChild(h('h2', null, 'Recent service'));
    if (!sv.length) root.appendChild(h('div', { class: 'card muted' }, 'No service logged yet.'));
    sv.slice(0, 5).forEach((s) => root.appendChild(serviceCard(s, true)));
    root.appendChild(h('h2', null, 'Recent expenses'));
    if (!ex.length) root.appendChild(h('div', { class: 'card muted' }, 'No expenses yet.'));
    ex.slice(0, 5).forEach((e) => root.appendChild(expenseCard(e, true)));
    if (sv.length > 5 || ex.length > 5) root.appendChild(h('button', { class: 'btn block', onclick: () => { S.filter.vehicleId = v.id; go('service'); } }, 'See full log for this vehicle'));
    return root;
  }

  /* ---------- SERVICE + EXPENSES lists ---------- */
  function serviceCard(s, noVehicle) {
    const v = vmap().get(s.vehicleId);
    return h('div', { class: 'card tap', onclick: () => serviceForm(s) },
      h('div', { class: 'item' },
        h('div', { class: 'main' }, h('div', { class: 'title' }, s.type, s.receipt ? ' 📎' : ''),
          h('div', { class: 'sub' }, [noVehicle ? null : C.vehicleLabel(v), fd(s.date), s.odometer !== null ? fi(s.odometer) + ' mi' : null, s.vendor || null].filter(Boolean).join(' · ')),
          s.notes ? h('div', { class: 'sub' }, s.notes) : null),
        h('div', { class: 'amt' }, fm(C.serviceTotal(s)), (s.parts || s.labor) ? h('div', { class: 'sub' }, 'P ' + fm(s.parts) + ' · L ' + fm(s.labor)) : null)));
  }
  function expenseCard(e, noVehicle) {
    const v = vmap().get(e.vehicleId);
    return h('div', { class: 'card tap', onclick: () => expenseForm(e) },
      h('div', { class: 'item' },
        h('div', { class: 'main' }, h('div', { class: 'title' }, e.category),
          h('div', { class: 'sub' }, [noVehicle ? null : (e.vehicleId ? C.vehicleLabel(v) : 'No vehicle'), fd(e.date), e.vendor || null].filter(Boolean).join(' · ')),
          e.notes ? h('div', { class: 'sub' }, e.notes) : null),
        h('div', { class: 'amt' }, fm(e.amount))));
  }
  function serviceView() {
    const root = h('div'); root.appendChild(filtersUI('service'));
    const sub = C.filterData(S.data, S.filter), t = C.totals(sub.services, []);
    root.appendChild(sumBar([['Entries', sub.services.length], ['Parts', fm(t.parts)], ['Labor', fm(t.labor)], ['Total', fm(t.maintenance)]]));
    if (!S.data.vehicles.length) root.appendChild(empty('Add a vehicle first.', h('button', { class: 'btn primary', onclick: () => vehicleForm() }, 'Add vehicle')));
    else if (!sub.services.length) root.appendChild(empty('No service entries match these filters.'));
    sub.services.forEach((s) => root.appendChild(serviceCard(s)));
    if (S.data.vehicles.length) fab('Add service entry', () => serviceForm());
    return root;
  }
  function expensesView() {
    const root = h('div'); root.appendChild(filtersUI('expense'));
    const sub = C.filterData(S.data, S.filter), t = C.totals([], sub.expenses);
    root.appendChild(sumBar([['Entries', sub.expenses.length], ['Total', fm(t.expenses)]]));
    if (!sub.expenses.length) root.appendChild(empty('No expenses match these filters.'));
    sub.expenses.forEach((e) => root.appendChild(expenseCard(e)));
    fab('Add expense', () => expenseForm());
    return root;
  }

  /* ---------- REPORTS ---------- */
  function reportsView() {
    const root = h('div'); root.appendChild(filtersUI('both'));
    const model = C.buildExportModel(S.data, S.filter);
    const T = model.totals;
    root.appendChild(sumBar([['Maintenance', fm(T.maintenance)], ['Other expenses', fm(T.expenses)], ['Grand total', fm(T.grand)]]));
    root.appendChild(h('div', { class: 'card' }, h('b', null, 'Export'), h('p', { class: 'muted small', style: 'margin:4px 0 8px' }, 'Uses the filters above (' + model.filter.text + ').'),
      h('button', { class: 'btn primary block', onclick: exportXlsx }, '⬇ Excel workbook (.xlsx)'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => exportCsv('maintenance') }, 'CSV: Service log'),
        h('button', { class: 'btn', onclick: () => exportCsv('expenses') }, 'CSV: Expenses'),
        h('button', { class: 'btn', onclick: () => exportCsv('vehicles') }, 'CSV: Vehicles'))));
    const tbl = (head, rows, foot) => h('div', { class: 'card scroll' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))), foot ? h('tfoot', null, h('tr', null, foot.map((c) => h('td', null, c)))) : null));
    root.appendChild(h('h2', null, 'By vehicle'));
    root.appendChild(model.perVehicle.length ? tbl(['Vehicle', 'Maint.', 'Other', 'Total', 'Miles', '$/mile'],
      model.perVehicle.map((v) => [v.name, fm(v.maintenance), fm(v.expenses), fm(v.grand), v.miles ? fi(v.miles) : '–', cpmFmt(v.costPerMile)]),
      ['Total', fm(T.maintenance), fm(T.expenses), fm(T.grand), '', '']) : empty('No vehicles.'));
    root.appendChild(h('p', { class: 'muted small' }, 'Cost per mile = total cost ÷ (highest − lowest odometer reading logged in this range). Needs two or more readings.'));
    root.appendChild(h('h2', null, 'By month'));
    root.appendChild(model.monthly.length ? tbl(['Month', 'Maint.', 'Other', 'Total'], model.monthly.map((m) => [fd(m.month + '-01').replace(/ 1,/, ''), fm(m.maintenance), fm(m.expenses), fm(m.total)]), ['Total', fm(T.maintenance), fm(T.expenses), fm(T.grand)]) : empty('No data in this range.'));
    root.appendChild(h('h2', null, 'By category'));
    root.appendChild(model.byCategory.length ? tbl(['Category', 'Maint.', 'Other', 'Total'], model.byCategory.map((c) => [c.category, fm(c.maintenance), fm(c.expenses), fm(c.total)])) : empty('No data in this range.'));
    return root;
  }
  const VIEWS = { home: homeView, vehicles: vehiclesView, vehicle: vehicleDetailView, service: serviceView, expenses: expensesView, reports: reportsView };

  /* ---------- form helpers ---------- */
  const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { class: 'f' }, label), input, hint ? h('div', { class: 'muted small' }, hint) : null);
  const numIn = (val, step, extra) => h('input', Object.assign({ type: 'number', inputmode: step === '1' ? 'numeric' : 'decimal', step: step || 'any', min: '0', value: val === null || val === undefined ? '' : val }, extra || {}));
  function vehicleSelect(sel, allowNone) {
    return h('select', { value: sel || '' }, allowNone ? h('option', { value: '' }, 'No specific vehicle') : null, S.data.vehicles.map((v) => h('option', { value: v.id }, v.name)));
  }
  function formShell(title, children, buttons) {
    const err = h('div', { class: 'banner', style: 'display:none', role: 'alert' });
    const showErr = (m) => { err.textContent = m; err.style.display = m ? '' : 'none'; if (m) err.scrollIntoView({ block: 'nearest' }); };
    const form = h('form', { onsubmit: (e) => e.preventDefault(), novalidate: true }, h('h3', null, title), err, children, h('div', { class: 'btns' }, buttons));
    return { form, showErr };
  }

  /* ---------- VEHICLE FORM ---------- */
  function vehicleForm(v) {
    const isNew = !v; v = v || {};
    const name = h('input', { value: v.name || '', placeholder: 'e.g. Truck 1 – Ford F-550', autocomplete: 'off' });
    const kind = h('select', { value: v.kind || 'Tow truck' }, C.VEHICLE_KINDS.map((k) => h('option', { value: k }, k)));
    const year = numIn(v.year, '1', { placeholder: '2019' }), make = h('input', { value: v.make || '', placeholder: 'Ford' }), model = h('input', { value: v.model || '', placeholder: 'F-550' });
    const vin = h('input', { value: v.vin || '', placeholder: '17 characters', autocapitalize: 'characters' }), plate = h('input', { value: v.plate || '', autocapitalize: 'characters' });
    const odo = numIn(v.odometer, '1'), notes = h('textarea', null, v.notes || '');
    const photo = photoField('Photo', v.photo, 1024);
    const save = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
    const { form, showErr } = formShell(isNew ? 'Add vehicle' : 'Edit vehicle', [
      field('Name *', name), field('Type', kind),
      h('div', { class: 'three' }, field('Year', year), field('Make', make), field('Model', model)),
      field('VIN', vin), field('Plate', plate), field('Current odometer (miles)', odo), field('Notes', notes), photo.el],
      [save, h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancel'),
        isNew ? null : h('button', { type: 'button', class: 'btn danger', onclick: () => deleteVehicle(v) }, 'Delete')]);
    form.addEventListener('submit', () => guard(async () => {
      const rec = C.cleanVehicle(Object.assign({}, v, { name: name.value, kind: kind.value, year: year.value, make: make.value, model: model.value, vin: vin.value, plate: plate.value, odometer: odo.value, notes: notes.value, photo: photo.get() }));
      const err = C.validateVehicle(rec, S.data.vehicles); if (err) return showErr(err);
      await put('vehicles', rec);
      afterClose(() => { toast('Vehicle saved'); render(); });
    }));
    openModal(form);
  }
  async function deleteVehicle(v) {
    const ns = S.data.services.filter((s) => s.vehicleId === v.id).length, ne = S.data.expenses.filter((e) => e.vehicleId === v.id).length, nr = S.data.reminders.filter((r) => r.vehicleId === v.id).length;
    if (!confirm('Delete "' + v.name + '" and its ' + ns + ' service entries, ' + ne + ' expenses and ' + nr + ' reminders? This cannot be undone (make a backup first if unsure).')) return;
    await guard(async () => {
      for (const s of S.data.services.filter((x) => x.vehicleId === v.id)) await remove('services', s.id);
      for (const e of S.data.expenses.filter((x) => x.vehicleId === v.id)) await remove('expenses', e.id);
      for (const r of S.data.reminders.filter((x) => x.vehicleId === v.id)) await remove('reminders', r.id);
      await remove('vehicles', v.id);
      if (S.filter.vehicleId === v.id) S.filter.vehicleId = '';
      closeAllModals(() => { toast('Vehicle deleted'); if (location.hash === '#/vehicles') render(); else go('vehicles'); });
    });
  }
  function odometerModal(v) {
    const odo = numIn(v.odometer, '1');
    const { form, showErr } = formShell('Update odometer – ' + v.name, [field('Current odometer (miles)', odo)], [h('button', { type: 'submit', class: 'btn primary' }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancel')]);
    form.addEventListener('submit', () => guard(async () => {
      if (!C.isNum(odo.value) || Number(odo.value) < 0) return showErr('Enter the odometer reading.');
      await put('vehicles', Object.assign({}, v, { odometer: Number(odo.value) }));
      afterClose(() => { toast('Odometer updated'); render(); });
    }));
    openModal(form);
  }

  /* ---------- SERVICE FORM ---------- */
  function serviceForm(s, preset) {
    const isNew = !s || !s.id; preset = preset || {};
    s = s || {};
    if (!S.data.vehicles.length) return toast('Add a vehicle first');
    const vid = s.vehicleId || preset.vehicleId || S.filter.vehicleId || S.data.vehicles[0].id;
    const veh = vehicleSelect(vid);
    const date = h('input', { type: 'date', value: s.date || today() });
    const dl = h('datalist', { id: 'svc-types' }, C.SERVICE_TYPES.map((t) => h('option', { value: t })));
    const type = h('input', { value: s.type || preset.type || '', list: 'svc-types', placeholder: 'Oil change, Tires, Brakes…', autocomplete: 'off' });
    const odo = numIn(s.odometer !== undefined && s.odometer !== null ? s.odometer : (isNew ? ((S.data.vehicles.find((x) => x.id === vid) || {}).odometer) : null), '1');
    const vendor = h('input', { value: s.vendor || '', placeholder: 'Shop / vendor' });
    const parts = numIn(s.parts), labor = numIn(s.labor), total = numIn(s.total);
    let touched = !isNew && C.isNum(s.total) && Math.abs(C.serviceTotal(s) - (C.money(s.parts) + C.money(s.labor))) > 0.004;
    const recalc = () => { if (!touched) total.value = (C.money(parts.value) + C.money(labor.value)) ? C.round2(C.money(parts.value) + C.money(labor.value)) : ''; };
    parts.addEventListener('input', recalc); labor.addEventListener('input', recalc); total.addEventListener('input', () => { touched = total.value !== ''; });
    if (isNew || !touched) total.value = C.serviceTotal(s) || '';
    veh.addEventListener('change', () => { const x = S.data.vehicles.find((q) => q.id === veh.value); if (x && x.odometer !== null && isNew) odo.value = x.odometer; });
    const notes = h('textarea', null, s.notes || '');
    const receipt = photoField('Receipt photo', s.receipt, 1600);
    // Offer a reminder for next time (new entries only, when the type has suggested intervals and none exists yet)
    const remChk = h('input', { type: 'checkbox', style: 'width:28px;min-height:28px;flex:none' });
    const remText = h('span');
    const remBox = h('label', { class: 'card row', style: 'display:none;cursor:pointer' }, remChk, remText);
    const updRem = () => {
      const p = C.REMINDER_PRESETS[Object.keys(C.REMINDER_PRESETS).find((k) => C.norm(k) === C.norm(type.value))];
      const exists = S.data.reminders.some((r) => r.vehicleId === veh.value && C.norm(r.type) === C.norm(type.value));
      if (isNew && !preset.markReminder && p && !exists) {
        remBox.style.display = ''; remChk.checked = true;
        remText.textContent = 'Remind me for the next ' + type.value.toLowerCase() + ' (' + [p.intervalMonths ? 'every ' + p.intervalMonths + ' months' : '', p.intervalMiles ? 'every ' + fi(p.intervalMiles) + ' mi' : ''].filter(Boolean).join(' / ') + ')';
      } else { remBox.style.display = 'none'; remChk.checked = false; }
    };
    type.addEventListener('input', updRem); veh.addEventListener('change', updRem); updRem();
    const { form, showErr } = formShell(isNew ? 'Add service entry' : 'Edit service entry', [
      field('Vehicle *', veh), h('div', { class: 'two' }, field('Date *', date), field('Odometer (mi)', odo)),
      field('Service type *', [type, dl]), field('Vendor / shop', vendor),
      h('div', { class: 'three' }, field('Parts $', parts), field('Labor $', labor), field('Total $', total)),
      h('div', { class: 'muted small', style: 'margin:-6px 0 10px' }, 'Total fills in as parts + labor. Type a different total if tax or fees apply.'),
      field('Notes', notes), receipt.el, remBox],
      [h('button', { type: 'submit', class: 'btn primary' }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancel'),
        isNew ? null : h('button', { type: 'button', class: 'btn danger', onclick: async () => { if (confirm('Delete this service entry?')) await guard(async () => { await remove('services', s.id); afterClose(() => { toast('Deleted'); render(); }); }); } }, 'Delete')]);
    form.addEventListener('submit', () => guard(async () => {
      const raw = { id: s.id, vehicleId: veh.value, date: date.value, type: type.value, odometer: odo.value, vendor: vendor.value, parts: parts.value, labor: labor.value, total: total.value, notes: notes.value, receipt: receipt.get() };
      const err = C.validateService(raw); if (err) return showErr(err);
      const rec = C.cleanService(raw);
      await put('services', rec);
      await bump(rec.vehicleId, rec.odometer);
      if (preset.markReminder) await put('reminders', C.markDone(preset.markReminder, rec.date, rec.odometer));
      else if (remChk.checked) {
        const p = C.REMINDER_PRESETS[Object.keys(C.REMINDER_PRESETS).find((k) => C.norm(k) === C.norm(rec.type))];
        await put('reminders', C.cleanReminder({ vehicleId: rec.vehicleId, type: rec.type, intervalMonths: p.intervalMonths, intervalMiles: p.intervalMiles, baseDate: rec.date, baseOdometer: rec.odometer }));
      }
      afterClose(() => { toast('Service saved'); render(); });
    }));
    openModal(form);
  }

  /* ---------- EXPENSE FORM ---------- */
  function expenseForm(e, preset) {
    const isNew = !e || !e.id; e = e || {}; preset = preset || {};
    const veh = vehicleSelect(e.vehicleId || preset.vehicleId || S.filter.vehicleId || '', true);
    const date = h('input', { type: 'date', value: e.date || today() });
    const cat = h('select', { value: e.category || 'Fuel' }, categoryOptions('expense').map((c) => h('option', { value: c }, c)));
    const amount = numIn(e.amount, '0.01', { placeholder: '0.00' }), vendor = h('input', { value: e.vendor || '', placeholder: 'Station / agency / vendor' });
    const odo = numIn(e.odometer, '1'), notes = h('textarea', null, e.notes || '');
    const { form, showErr } = formShell(isNew ? 'Add expense' : 'Edit expense', [
      field('Vehicle', veh), h('div', { class: 'two' }, field('Date *', date), field('Amount $ *', amount)),
      field('Category *', cat), field('Vendor', vendor), field('Odometer (mi)', odo, 'Optional. Helps cost per mile.'), field('Notes', notes)],
      [h('button', { type: 'submit', class: 'btn primary' }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancel'),
        isNew ? null : h('button', { type: 'button', class: 'btn danger', onclick: async () => { if (confirm('Delete this expense?')) await guard(async () => { await remove('expenses', e.id); afterClose(() => { toast('Deleted'); render(); }); }); } }, 'Delete')]);
    form.addEventListener('submit', () => guard(async () => {
      const raw = { id: e.id, vehicleId: veh.value, date: date.value, category: cat.value, amount: amount.value, vendor: vendor.value, odometer: odo.value, notes: notes.value };
      const err = C.validateExpense(raw); if (err) return showErr(err);
      const rec = C.cleanExpense(raw);
      await put('expenses', rec);
      if (rec.vehicleId) await bump(rec.vehicleId, rec.odometer);
      afterClose(() => { toast('Expense saved'); render(); });
    }));
    openModal(form);
  }

  /* ---------- REMINDER FORM ---------- */
  function reminderForm(r, preset) {
    const isNew = !r; r = r || {}; preset = preset || {};
    const veh = vehicleSelect(r.vehicleId || preset.vehicleId || S.data.vehicles[0].id);
    const dl = h('datalist', { id: 'rem-types' }, C.SERVICE_TYPES.map((t) => h('option', { value: t })));
    const type = h('input', { value: r.type || '', list: 'rem-types', placeholder: 'Oil change, Registration, Insurance…', autocomplete: 'off' });
    const months = numIn(r.intervalMonths, '1'), miles = numIn(r.intervalMiles, '1');
    const baseDate = h('input', { type: 'date', value: r.baseDate || '' }), baseOdo = numIn(r.baseOdometer, '1');
    const due = h('input', { type: 'date', value: r.dueDate || '' }), notes = h('textarea', null, r.notes || '');
    if (isNew) { const x = S.data.vehicles.find((q) => q.id === veh.value); if (x && x.odometer !== null) baseOdo.value = x.odometer; }
    type.addEventListener('change', () => {
      const key = Object.keys(C.REMINDER_PRESETS).find((k) => C.norm(k) === C.norm(type.value));
      if (key && !months.value && !miles.value) { const p = C.REMINDER_PRESETS[key]; months.value = p.intervalMonths || ''; miles.value = p.intervalMiles || ''; }
    });
    const { form, showErr } = formShell(isNew ? 'Add reminder' : 'Edit reminder', [
      field('Vehicle *', veh), field('What *', [type, dl]),
      h('div', { class: 'two' }, field('Repeat every (months)', months), field('Repeat every (miles)', miles)),
      h('div', { class: 'two' }, field('Last done (date)', baseDate), field('Last done (odometer)', baseOdo)),
      field('Or fixed next due date', due, 'Use for things with an expiry, like registration or insurance. Logging a matching service near that date moves it forward.'),
      field('Notes', notes)],
      [h('button', { type: 'submit', class: 'btn primary' }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Cancel'),
        isNew ? null : h('button', { type: 'button', class: 'btn danger', onclick: async () => { if (confirm('Delete this reminder?')) await guard(async () => { await remove('reminders', r.id); afterClose(() => { toast('Deleted'); render(); }); }); } }, 'Delete')]);
    form.addEventListener('submit', () => guard(async () => {
      const raw = { id: r.id, vehicleId: veh.value, type: type.value, intervalMonths: months.value, intervalMiles: miles.value, baseDate: baseDate.value, baseOdometer: baseOdo.value, dueDate: due.value, notes: notes.value };
      const err = C.validateReminder(raw); if (err) return showErr(err);
      await put('reminders', C.cleanReminder(raw));
      afterClose(() => { toast('Reminder saved'); render(); });
    }));
    openModal(form);
  }

  /* ---------- SETTINGS / BACKUP ---------- */
  function settingsModal() {
    const st = S.data.settings;
    const biz = h('input', { value: st.businessName || '' });
    const days = numIn(st.soonDays, '1'), miles = numIn(st.soonMiles, '1');
    const photos = h('input', { type: 'checkbox', checked: true, style: 'width:26px;min-height:26px;flex:none' });
    const file = h('input', { type: 'file', accept: '.json,application/json', onchange: () => { if (file.files[0]) restoreFlow(file.files[0]); file.value = ''; } });
    const lb = st.lastBackup ? 'Last backup: ' + fd(st.lastBackup.slice(0, 10)) : 'No backup made yet.';
    const save = h('button', { class: 'btn primary block', onclick: () => guard(async () => {
      await saveSettings({ businessName: biz.value.trim() || C.DEFAULT_SETTINGS.businessName, soonDays: C.isNum(days.value) ? Math.max(0, Number(days.value)) : 30, soonMiles: C.isNum(miles.value) ? Math.max(0, Number(miles.value)) : 500 });
      afterClose(() => { toast('Settings saved'); render(); });
    }) }, 'Save settings');
    openModal([h('h3', null, 'Settings & backup'),
      field('Business name (used in exports)', biz),
      h('div', { class: 'two' }, field('“Due soon” within (days)', days), field('“Due soon” within (miles)', miles)),
      save,
      h('h2', null, 'Backup & restore'),
      h('p', { class: 'muted small' }, 'Your data is stored only on this device. Export a JSON backup regularly and keep it somewhere safe (Drive, email to yourself). ' + lb),
      h('label', { class: 'row', style: 'margin-bottom:10px;cursor:pointer' }, photos, h('span', null, 'Include vehicle photos and receipt photos (larger file)')),
      h('button', { class: 'btn block', onclick: () => backupExport(photos.checked) }, '⬇ Export backup (JSON)'),
      h('div', { style: 'height:12px' }),
      field('Restore from a backup file', file),
      h('h2', null, 'Danger zone'),
      h('button', { class: 'btn danger block', onclick: eraseAll }, 'Erase all data on this device'),
      h('p', { class: 'muted small' }, 'Vehicle Tracker v' + APP_VERSION + ' · storage: ' + (S.db.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage (fallback)') + ' · works offline'),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'))]);
  }
  async function backupExport(includePhotos) {
    try {
      const b = C.buildBackup(S.data, { includePhotos });
      const name = fileBase() + '-vehicle-tracker-backup-' + stamp() + '.json';
      const r = await saveFile(name, new Blob([JSON.stringify(b)], { type: 'application/json' }));
      await saveSettings({ lastBackup: new Date().toISOString() });
      toast(r === 'downloaded' ? 'Backup saved to Downloads: ' + name : 'Choose where to save the backup', 4000);
    } catch (e) { toast('Backup failed: ' + (e.message || e), 6000); }
  }
  async function restoreFlow(f) {
    let b;
    try { b = JSON.parse(await f.text()); } catch (e) { return toast('That file is not valid JSON.', 5000); }
    const v = C.validateBackup(b);
    if (!v.ok) return toast(v.errors[0], 6000);
    const mode = h('select', null, h('option', { value: 'merge' }, 'Merge – keep my current data and add/update from the backup'), h('option', { value: 'replace' }, 'Replace – erase current data and use the backup'));
    const go2 = h('button', { class: 'btn primary', onclick: () => guard(async () => {
      if (mode.value === 'replace' && !confirm('Replace ALL current data with this backup?')) return;
      const res = C.applyBackup(S.data, b, mode.value);
      await S.db.replaceAll(res.data);
      await reloadAll();
      closeAllModals(() => { toast('Restored ' + res.data.vehicles.length + ' vehicles' + (res.dropped ? ' (' + res.dropped + ' orphan records skipped)' : '')); render(); });
    }) }, 'Restore');
    openModal([h('h3', null, 'Restore backup'), h('p', null, 'File contains ' + plural(v.counts.vehicles, 'vehicle') + ', ' + plural(v.counts.services, 'service entry').replace('entrys', 'entries') + ', ' + plural(v.counts.expenses, 'expense') + ', ' + plural(v.counts.reminders, 'reminder') + '. Exported ' + (b.exportedAt || '').slice(0, 10) + '.'),
      field('How to restore', mode), h('div', { class: 'btns' }, go2, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'))]);
  }
  async function eraseAll() {
    if (!confirm('Erase ALL vehicles, service, expenses and reminders on this device?')) return;
    if (!confirm('Really erase everything? Export a backup first if you might need it.')) return;
    await guard(async () => { await S.db.replaceAll({ settings: S.data.settings }); await reloadAll(); closeAllModals(() => { toast('All data erased'); if (location.hash === '#/home' || !location.hash) render(); else go('home'); }); });
  }

  /* ---------- boot ---------- */
  async function boot() {
    document.getElementById('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
    document.getElementById('btn-settings').addEventListener('click', settingsModal);
    try { S.db = await DB.init(); await reloadAll(); } catch (e) { $app.replaceChildren(h('div', { class: 'banner' }, 'Storage is not available in this browser: ' + e.message)); return; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    route();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
    window.__vt = { S, C, go, route }; // handy for debugging / automated UI tests
  }
  boot();
})();
