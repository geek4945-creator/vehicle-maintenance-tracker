# Vehicle Maintenance Tracker (JD's Towing)

**Live web app:** https://geek4945-creator.github.io/vehicle-maintenance-tracker/  
**Android APK:** see the [latest release](https://github.com/geek4945-creator/vehicle-maintenance-tracker/releases/latest)

One responsive web app (PWA) that works as a normal website **and** installs on Android, plus an optional Android APK built from the same code with Capacitor. No server, no account, no CDN: all data lives on the device (IndexedDB) and the app works offline.

## What it does

* **Vehicles** – name, type (tow truck / service vehicle / personal / trailer), year/make/model, VIN, plate, current odometer, notes, optional photo. Edit/delete. Names must be unique (the Excel summary matches on name).
* **Service log** per vehicle – date, odometer, service type (presets: oil change, tires, brakes, inspection, registration, insurance, repairs, fuel, battery, fluids, transmission, alignment, winch/equipment, other – or type your own), vendor, **parts / labor / total** (total auto-fills as parts + labor, type a different total for tax/fees), notes, optional receipt photo. Edit/delete. Saving an odometer higher than the vehicle's current one updates the vehicle.
* **Expenses** – fuel, tolls, insurance, registration, repairs, other; date, amount, vendor, optional vehicle and odometer, notes.
* **Reminders** – per vehicle, by **months and/or miles** (either one triggers), or a **fixed due date** (registration/insurance expiry). "Last done" comes from the newest matching service entry (same vehicle + same type) or from the baseline you type in. The Home screen shows **Overdue / Due soon / OK** with days or miles left; "Due soon" thresholds (30 days / 500 miles) are in Settings. **Mark done** logs the service and resets the reminder. When you log an oil change/tires/etc. the form offers to create the reminder for next time.
* **Filters** (Service, Expenses, Reports share them): vehicle, date range (all time / this month / last 30 days / this year / last year / custom), category.
* **Reports** – totals, per-vehicle table, monthly table, category table, **cost per mile** per vehicle (total cost ÷ (highest − lowest odometer reading logged in the selected range); needs two or more readings, otherwise shows –).
* **Excel export (.xlsx)**, built in the browser/app with a bundled copy of ExcelJS (`www/vendor/exceljs.min.js`). Sheets: **Vehicles**, **Maintenance Log**, **Expenses**, **Summary** (per-vehicle, monthly and by-category totals as live `SUMIFS`/`SUM` formulas over the log sheets, with cached values so any viewer shows numbers), plus a bonus **Reminders** sheet. It honours the selected vehicle, date range and category. Dates are real Excel dates and money is numeric. **CSV** export (service log, expenses, vehicles; UTF-8 with BOM, text starting with `= + - @` is quoted with a leading `'` so Excel never runs it as a formula).
* **Backup / restore** – JSON export (optionally without photos) and import, either **Merge** (union by id, backup wins on conflicts) or **Replace**. The app nags on Home if you have never backed up or it has been over 30 days. *Your data exists only on this device, so back up regularly (email the JSON to yourself or save it to Drive).*

## Install on Android

### Option A – install the web app (PWA, no APK)
1. Host the `www/` folder (see "Hosting" below) over **https**.
2. On the phone open the site in **Chrome** → menu (⋮) → **Install app** (or *Add to Home screen*).
3. It opens full-screen from the home screen, works offline after the first load, and keeps its data in the browser's storage for that site. Use Settings → Export backup regularly. (Clearing Chrome's "site data" for the site erases the data.)

### Option B – APK sideload (`vehicle-tracker.apk`)
1. Copy `vehicle-tracker.apk` to the phone (email, Drive, USB) and open it.
2. When Android asks, allow your browser/Files app to **install unknown apps** (Settings → Apps → Special access → Install unknown apps), then tap **Install**.
3. Open **Vehicle Tracker**. Excel/CSV/backup files open Android's **share sheet** (save to Drive, Files, email…).
The APK is signed with a private key created on the build machine (`/workspace/vehicle-tracker-keystore/`, **not** inside the zip). Keep that key: future versions only install over this one if signed with the same key. Play Protect may show an "unverified developer" warning for sideloaded apps; that is normal.

**Updating the APK:** open the ⚙ Settings screen → **App updates → Check for updates**. The app checks this repo's latest GitHub release (also once a day when opened), downloads the APK and opens Android's installer. The first time, allow *Install unknown apps* for Vehicle Tracker. Your data is kept.

## Use on the web / desktop
Open `index.html` through any web server (service workers and IndexedDB do not work from `file://`). Data is per browser profile and per site address.

## Hosting (static files)
Everything is in `www/` (relative paths, so sub-folders work). Any static host works: copy `www/` to the web root, or

* **Local test:** `npm run serve` → http://localhost:8080 (or `python3 -m http.server 8080 --directory www`).
* **GitHub Pages (this repo):** Pages serves the `docs/` folder on `main`, which is a copy of `www/` (run `rm -rf docs && cp -r www docs && touch docs/.nojekyll` after changing `www/`). To host your own fork: push the project, then Settings → Pages → deploy from a branch → set the folder to `/www` (or copy the contents of `www/` to a `gh-pages` branch / `docs/` folder). The site is served over https, which Chrome requires for installing a PWA.
* Netlify / Cloudflare Pages / S3 / nginx: publish the `www` directory; no build step, no server code.
When you change files, bump `VERSION` in `www/sw.js` so installed copies refresh.

## Rebuilding the APK yourself
Needs JDK 17, Android SDK (platform 34, build-tools 34.0.0), Node 18+, internet on the first run.
```bash
npm install
./scripts/build-apk.sh          # release APK -> android/app/build/outputs/apk/release/app-release.apk
./scripts/build-apk.sh debug    # debug-signed APK, no keystore needed
```
Release signing reads `storeFile/storePassword/keyAlias/keyPassword` from `/workspace/vehicle-tracker-keystore/keystore.properties` (override with `VT_KEYSTORE_PROPS=/path/to/keystore.properties`); without it the release APK is unsigned (Android won't install an unsigned APK - use `debug`). Create a key with `keytool -genkeypair -keystore my.jks -alias vehicletracker -keyalg RSA -keysize 2048 -validity 10000`.

No Android SDK? Use **PWABuilder** (https://www.pwabuilder.com): enter your hosted https URL, choose *Android*, download the package and sideload/publish it. The manifest and 192/512 + maskable icons are already included.

## Project layout
```
www/                 the app (this folder is all you deploy)
  index.html, css/app.css, manifest.webmanifest, sw.js (offline cache)
  js/core.js         all logic: totals, filters, reminders, CSV, export model, backup (pure, unit-tested)
  js/xlsx.js         builds the workbook from the export model
  js/db.js           IndexedDB storage (localStorage fallback)
  js/app.js          UI
  vendor/            exceljs.min.js (+ licence)
android/             Capacitor Android project (config in capacitor.config.json)
tests/               unit + export tests (node:test) and verify_xlsx.py (openpyxl + LibreOffice)
tests-e2e/e2e.js     headless-Chrome UI test (needs playwright-core + google-chrome)
scripts/             make_icons.py, vendor.js, build-apk.sh
```

## Tests
```bash
npm install
npm test            # 24 unit/export tests: totals, filters, cost per mile, reminders due logic, CSV, backup/restore, xlsx contents read back with ExcelJS
npm run test:xlsx   # openpyxl reads the generated .xlsx files and recomputes expected totals independently; LibreOffice recalculates every Summary formula
npm run test:e2e    # drives the real UI in headless Chrome (phone viewport): add/edit/delete, filters, exports, backup/restore, offline
```

## What was and was not verified (honest list)
**Verified here (Linux sandbox, 2026-10-16):**
* 24 automated unit/export tests pass (`npm test`).
* The generated `.xlsx` files open with **openpyxl** (formulas and cached values), have the required sheets in order, the right row counts and totals for three filter cases (all data, one vehicle + date range, category), real dates and numeric money; and **LibreOffice recalculated all Summary formulas** from scratch and matched the stored numbers (0 mismatches).
* A headless-Chrome run of the real UI (390×844 phone viewport) passed 30 checks, including: data surviving a reload (IndexedDB), the app loading and exporting Excel **while offline**, the downloaded `.xlsx`/`.csv`/backup files, backup → erase → restore (with photos), merge restore not duplicating, invalid backup rejected, and no console errors.
* The release APK builds, is signed (v1 + v2 signatures verify with `apksigner`), has package `com.jdstowing.vehicletracker`, and contains the web app and ExcelJS.

**Not verified:**
* **The APK was never run.** It was not tested on a physical Android phone, and an attempted emulator run failed: the sandbox has no hardware virtualization (/dev/kvm), and the software-emulated Android 35 image never finished booting. So the Capacitor wrapper behaviour (WebView, IndexedDB persistence in the APK, saving/sharing the Excel file through Android's share sheet, camera picker) is **untested**; the same web code was tested in desktop Chrome only. The share-sheet path for exports uses the standard Capacitor Filesystem + Share plugins and is the part most worth checking first on your phone. If it misbehaves, the PWA install (Option A) uses plain browser downloads, which were tested.
* Real Microsoft Excel was not available; the file is standard OOXML written by ExcelJS and was checked with openpyxl and LibreOffice only. Formulas use `SUMIFS` and `EDATE` (Excel 2007+).
* Camera capture for receipts inside the APK (the picker offers "Take photo" only if Android grants the camera permission) was not tested; picking an existing image works in the browser tests.
* PWA installation from Chrome on Android ("Install app") needs the app hosted on https; the manifest, icons and service worker are in place and offline loading was verified in desktop Chrome, but the actual install prompt was not exercised.
* iPhone/Safari was not tested (should work as an Add-to-Home-Screen web app, but unverified).
* Large data volumes (thousands of entries, many photos) were not load-tested. Photos are downscaled (vehicle photos 1024 px, receipts 1600 px, JPEG).

## Known limits / design notes
* Data is local to one device/browser; there is no sync between phone and web. Use backup/restore (or Merge restore) to move data.
* Don't log the same cost both as a service entry and as an expense – the Summary adds both.
* Cost per mile is an approximation from the odometer readings you logged in the selected range.
* Deleting a vehicle deletes its service entries, expenses and reminders (it asks first).
* Reminder matching is by the exact service-type text (case-insensitive), e.g. a reminder "Oil change" is reset by service entries typed "oil change".
