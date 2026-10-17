/* In-app updater UI (Android app only). Talks to the native AppUpdater plugin, which checks this repo's latest GitHub
   release, downloads the APK and opens Android's installer. Usage: JDUpdater.section({ repo, asset }) returns a DOM node. */
(function () {
  'use strict';
  var DAY = 24 * 3600 * 1000, KEY = 'jd-update-lastcheck', KEYV = 'jd-update-available';
  function native() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; }
  }
  function plugin() { return window.Capacitor.registerPlugin('AppUpdater'); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'onclick') n.addEventListener('click', attrs[k]); else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  var JD = window.JDUpdater = {
    isAndroidApp: native,
    /** Silent once-a-day check on app open. Calls cb(info) when a newer release exists. */
    autoCheck: function (cfg, cb) {
      if (!native()) return;
      try {
        var last = Number(localStorage.getItem(KEY) || 0);
        if (Date.now() - last < DAY) return;
        plugin().check(cfg).then(function (r) {
          localStorage.setItem(KEY, String(Date.now()));
          if (r && r.available) { localStorage.setItem(KEYV, r.version); if (cb) cb(r); } else localStorage.removeItem(KEYV);
        }).catch(function () {});
      } catch (e) {}
    },
    /** Settings block with a "Check for updates" button. Returns null outside the Android app (nothing to update there). */
    section: function (cfg) {
      if (!native()) return null;
      var P = plugin();
      var status = el('div', { class: 'muted small', style: 'margin:6px 0', id: 'jd-upd-status', text: 'Checks the latest release on GitHub. Your data is kept.' });
      var btn = el('button', { type: 'button', class: (cfg && cfg.btnClass) || 'btn', id: 'jd-upd-btn', text: 'Check for updates' });
      var busy = false, pending = null;
      P.info().then(function (i) { status.textContent = 'Installed version ' + i.versionName + '. ' + status.textContent; }).catch(function () {});
      try { P.addListener('progress', function (e) { if (busy && pending) status.textContent = 'Downloading ' + pending.version + '… ' + e.percent + '%'; }); } catch (e) {}
      function setBusy(b, label) { busy = b; btn.disabled = b; if (label) btn.textContent = label; }
      function doInstall() {
        setBusy(true, 'Downloading…'); status.textContent = 'Downloading ' + pending.version + '…';
        P.install({ apkUrl: pending.apkUrl, size: pending.size, version: pending.version }).then(function () {
          setBusy(false, 'Install update ' + pending.version); status.textContent = 'Confirm in the Android installer. If it didn’t open, tap again.';
        }).catch(function (e) {
          setBusy(false, 'Install update ' + pending.version); status.textContent = (e && e.message) || 'The update didn’t finish. Tap to try again.';
        });
      }
      btn.addEventListener('click', function () {
        if (busy) return;
        if (pending) { doInstall(); return; }
        setBusy(true, 'Checking…'); status.textContent = 'Checking GitHub…';
        P.check(cfg).then(function (r) {
          localStorage.setItem(KEY, String(Date.now()));
          if (r.available) {
            pending = r; localStorage.setItem(KEYV, r.version);
            setBusy(false, 'Download & install ' + r.version); status.textContent = 'Update ' + r.version + ' is available (you have ' + r.current + ').';
          } else {
            localStorage.removeItem(KEYV);
            setBusy(false, 'Check for updates'); status.textContent = 'You’re up to date (' + r.current + ').';
          }
        }).catch(function (e) { setBusy(false, 'Check for updates'); status.textContent = (e && e.message) || 'Couldn’t check for updates.'; });
      });
      return el('div', { class: 'jd-update', style: 'margin:12px 0' }, [el('h4', { text: 'App updates', style: 'margin:0 0 4px' }), status, btn]);
    }
  };
})();
