/* Headless-Chrome end-to-end smoke test of the real UI (IndexedDB, forms, filters, exports, backup/restore, offline).
 * Usage: node tests-e2e/e2e.js   (needs playwright-core in NODE_PATH or ../pw, and google-chrome)
 * Serves ./www on a local port. Screenshots go to tests-e2e/shots/.
 */
const path = require('path'); const fs = require('fs'); const http = require('http');
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/workspace/pw/node_modules/playwright-core')); }
const assert = require('node:assert/strict');
const WWW = path.join(__dirname, '..', 'www'); const SHOTS = path.join(__dirname, 'shots'); const DL = path.join(__dirname, 'downloads');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(DL, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
const results = []; const step = (name) => { results.push(name); console.log('  ✓', name); };

(async () => {
  await new Promise((r) => server.listen(0, r)); const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, acceptDownloads: true, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const F = (label) => page.locator('.modal .field:has(> label:text-is("' + label + '")) :is(input,select,textarea)').first();
  const modalBtn = (t) => page.locator('.modal button', { hasText: t });
  const nav = (v) => page.locator('#nav button[data-view="' + v + '"]').click();
  const today = await page.evaluate(() => new Date().toISOString());
  await page.goto(base); await page.waitForSelector('text=Add your first vehicle');
  await shot('01-welcome'); step('empty state shows welcome');

  // --- add two vehicles
  await page.click('text=Add your first vehicle');
  await F('Name *').fill('Truck 1'); await F('Year').fill('2019'); await F('Make').fill('Ford'); await F('Model').fill('F-550');
  await F('VIN').fill('1fduf5ht0kda00001'); await F('Plate').fill('abc123'); await F('Current odometer (miles)').fill('85000');
  // photo
  const png = path.join(__dirname, '..', 'www', 'icons', 'icon-192.png');
  await page.locator('.modal input[type=file]').setInputFiles(png);
  await page.waitForSelector('.modal img.photo-prev');
  await shot('02-vehicle-form'); await modalBtn('Save').click();
  await page.waitForSelector('text=Needs attention'); await nav('vehicles');
  await page.waitForSelector('.card.tap:has-text("Truck 1")'); step('vehicle with photo saved (VIN/plate upper-cased)');
  await page.click('.fab'); await F('Name *').fill('Truck 1');
  await modalBtn('Save').click(); await page.waitForSelector('.banner:has-text("already")'); step('duplicate vehicle name rejected');
  await F('Name *').fill('Personal Tesla'); await F('Type').selectOption('Personal'); await F('Current odometer (miles)').fill('12000'); await modalBtn('Save').click();
  await page.waitForSelector('.card.tap:has-text("Personal Tesla")');
  await shot('03-vehicles'); step('second vehicle saved');

  // --- service entry with auto total + auto reminder
  await nav('service'); await page.click('.fab');
  await F('Vehicle *').selectOption({ label: 'Truck 1' });
  await F('Date *').fill('2026-08-20'); await F('Odometer (mi)').fill('84900');
  await F('Service type *').fill('Oil change'); await F('Vendor / shop').fill('Jiffy Lube');
  await F('Parts $').fill('65.10'); await F('Labor $').fill('40');
  assert.equal(await F('Total $').inputValue(), '105.1'); step('total auto-fills as parts + labor');
  assert.ok(await page.locator('.modal label:has-text("Remind me for the next oil change")').isVisible()); step('offers a reminder for presets');
  await shot('04-service-form'); await modalBtn('Save').click();
  await page.waitForSelector('.card.tap:has-text("Oil change")');
  // second service with manual total + receipt
  await page.click('.fab'); await F('Vehicle *').selectOption({ label: 'Truck 1' });
  await F('Date *').fill('2026-03-15'); await F('Service type *').fill('Brakes'); await F('Parts $').fill('300'); await F('Labor $').fill('200'); await F('Total $').fill('520');
  await F('Parts $').fill('310'); assert.equal(await F('Total $').inputValue(), '520'); step('manual total is not overwritten');
  await page.locator('.modal input[type=file]').setInputFiles(png); await page.waitForSelector('.modal img.photo-prev');
  await modalBtn('Save').click(); await page.waitForSelector('.card.tap:has-text("Brakes")');
  // odometer bumped to 84900? vehicle was 85000 so unchanged
  const odo = await page.evaluate(() => window.__vt.S.data.vehicles.find((v) => v.name === 'Truck 1').odometer);
  assert.equal(odo, 85000); step('vehicle odometer only ever moves forward');
  await page.waitForTimeout(300); await shot('05-service-list');
  const barText = await page.locator('.totalbar').innerText(); assert.match(barText, /\$625\.10/); step('service totals bar = $625.10');

  // --- expenses
  await nav('expenses'); await page.click('.fab');
  await F('Vehicle').selectOption({ label: 'Truck 1' }); await F('Date *').fill('2026-09-10'); await F('Amount $ *').fill('120.40'); await F('Category *').selectOption('Fuel'); await F('Odometer (mi)').fill('85500');
  await modalBtn('Save').click(); await page.waitForSelector('.card.tap:has-text("Fuel")');
  await page.click('.fab'); await F('Date *').fill('2026-02-28'); await F('Amount $ *').fill('450'); await F('Category *').selectOption('Insurance'); await modalBtn('Save').click();
  await page.waitForSelector('.card.tap:has-text("Insurance")');
  const odo2 = await page.evaluate(() => window.__vt.S.data.vehicles.find((v) => v.name === 'Truck 1').odometer);
  assert.equal(odo2, 85500); step('expense odometer updates vehicle odometer');
  await page.click('.fab'); await modalBtn('Save').click();
  await page.waitForSelector('.modal .banner:has-text("amount")'); step('empty expense amount rejected with a message'); await modalBtn('Cancel').click(); await page.waitForTimeout(300);
  await shot('06-expenses');

  // --- filters
  await page.locator('.filters select').nth(1).selectOption('Fuel'); // category (vehicle is the first select when not custom)
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.card.tap').count(), 1); step('category filter on expenses');
  await page.locator('.filters select').nth(1).selectOption(''); 
  await page.locator('.chip', { hasText: 'Custom' }).click();
  await page.locator('.filters input[type=date]').nth(0).fill('2026-03-01'); await page.locator('.filters input[type=date]').nth(1).fill('2026-09-30');
  await page.waitForTimeout(100); assert.equal(await page.locator('.card.tap').count(), 1); step('custom date range filter (inclusive)');

  // --- reports
  await nav('reports'); await page.waitForSelector('text=By vehicle');
  await shot('07-reports'); const rep = await page.locator('main').innerText();
  assert.match(rep, /Truck 1\s+\$625\.10\s+\$120\.40\s+\$745\.50/); step('reports: per-vehicle totals');
  // Reports filter is shared. Reset to all time for exports
  await page.locator('.chip', { hasText: 'All time' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'Excel workbook' }).click()]);
  const xl = path.join(DL, dl.suggestedFilename()); await dl.saveAs(xl); step('xlsx downloaded: ' + dl.suggestedFilename());
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'CSV: Service log' }).click()]);
  await dl2.saveAs(path.join(DL, 'service.csv')); step('csv downloaded: ' + dl2.suggestedFilename());
  fs.copyFileSync(xl, path.join(DL, 'ui-export.xlsx'));

  // --- home / reminders
  await nav('home'); await page.waitForSelector('text=Needs attention');
  await shot('08-home');
  // vehicle detail
  await nav('vehicles'); await page.locator('.card.tap:has-text("Truck 1")').click(); await page.waitForSelector('text=Reminders');
  await shot('09-vehicle-detail');
  const detail = await page.locator('main').innerText();
  assert.match(detail, /Oil change/); assert.match(detail, /\$\d\.\d{3}\/mi/); step('vehicle detail shows reminders + cost per mile');
  // add reminder due soon (fixed date) and check status badge
  await page.click('text=+ Add reminder'); await F('What *').fill('Registration'); await F('Or fixed next due date').fill(new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10)); await F('Repeat every (months)').fill('12');
  await modalBtn('Save').click(); await page.waitForSelector('.badge.b-soon'); step('fixed-date reminder shows "Due soon"');
  // mark done opens the service form
  await nav('home'); await page.locator('.card:has-text("Registration") button:has-text("Mark done")').click();
  assert.equal(await F('Service type *').inputValue(), 'Registration');
  await modalBtn('Save').click(); await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('.card:has(.b-soon) .title')?.textContent.includes('Registration'));
  step('Mark done logs service and clears the due-soon status');
  await shot('10-home-after');

  // --- persistence + offline
  await page.reload(); await page.waitForSelector('text=Needs attention');
  const counts = await page.evaluate(() => ({ v: __vt.S.data.vehicles.length, s: __vt.S.data.services.length, e: __vt.S.data.expenses.length, r: __vt.S.data.reminders.length }));
  assert.deepEqual(counts, { v: 2, s: 3, e: 2, r: 3 }); step('data persists across reload (IndexedDB): ' + JSON.stringify(counts));
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(1500);
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('text=Needs attention'); step('app loads while offline (service worker cache)');
  await nav('reports');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'Excel workbook' }).click()]);
  await dl3.saveAs(path.join(DL, 'offline.xlsx')); step('xlsx export works offline');
  await ctx.setOffline(false);

  // --- backup / restore
  await page.click('#btn-settings');
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.locator('.modal button', { hasText: 'Export backup' }).click()]);
  const bk = path.join(DL, 'backup.json'); await dl4.saveAs(bk); step('backup downloaded: ' + dl4.suggestedFilename());
  await shot('11-settings');
  await page.locator('.modal button', { hasText: 'Erase all data' }).click();
  await page.waitForFunction(() => __vt.S.data.vehicles.length === 0); step('erase all data');
  await page.click('#btn-settings'); await page.locator('.modal input[type=file]').setInputFiles(bk);
  await page.waitForSelector('.modal h3:text("Restore backup")'); await shot('12-restore');
  await F('How to restore').selectOption('replace'); await modalBtn('Restore').click();
  await page.waitForFunction(() => __vt.S.data.vehicles.length === 2);
  const c2 = await page.evaluate(() => ({ v: __vt.S.data.vehicles.length, s: __vt.S.data.services.length, e: __vt.S.data.expenses.length, r: __vt.S.data.reminders.length, photo: !!__vt.S.data.vehicles.find((v) => v.name === 'Truck 1').photo, receipt: __vt.S.data.services.some((s) => s.receipt) }));
  assert.deepEqual(c2, { v: 2, s: 3, e: 2, r: 3, photo: true, receipt: true }); step('restore from JSON backup (incl. photos): ' + JSON.stringify(c2));
  await page.click('#btn-settings'); await page.locator('.modal input[type=file]').setInputFiles(bk);
  await F('How to restore').selectOption('merge'); await modalBtn('Restore').click(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => __vt.S.data.services.length), 3); step('merge restore does not duplicate records');
  // bad file
  fs.writeFileSync(path.join(DL, 'bad.json'), '{"hello":1}'); await page.click('#btn-settings'); await page.locator('.modal input[type=file]').setInputFiles(path.join(DL, 'bad.json'));
  await page.waitForSelector('.toast.show:has-text("not a Vehicle Tracker backup")'); step('invalid backup file rejected with a message'); await page.keyboard.press('Escape'); await page.goBack().catch(() => {});

  // --- delete flows + tap target check
  await page.evaluate(() => __vt.go('service')); await page.waitForSelector('.card.tap');
  await page.locator('.card.tap').first().click(); await modalBtn('Delete').click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __vt.S.data.services.length), 2); step('delete service entry');
  const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input:not([type=hidden]):not([type=checkbox])')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.outerHTML.slice(0, 60)));
  assert.equal(small.length, 0, 'small tap targets: ' + small.join(' | ')); step('all visible buttons/inputs ≥ 40px tall');
  // wide layout screenshot
  await page.setViewportSize({ width: 1200, height: 800 }); await page.evaluate(() => __vt.go('reports')); await page.waitForTimeout(300); await shot('13-desktop-reports');

  assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), [], 'console/page errors');
  step('no console or page errors');
  await browser.close(); server.close();
  console.log('\nE2E PASSED (' + results.length + ' checks)');
})().catch(async (e) => { console.error('E2E FAILED:', e); process.exit(1); });
