/* Local storage layer. IndexedDB when available (photos/receipts fit), otherwise localStorage as a fallback.
 * Everything stays on the device; there is no server. */
(function (root, factory) { root.DB = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NAME = 'vehicle-tracker', VER = 1;
  const LISTS = ['vehicles', 'services', 'expenses', 'reminders'];

  function openIDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('no indexedDB'));
      const req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        LISTS.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });

  async function idbAdapter() {
    const db = await openIDB();
    return {
      kind: 'indexeddb',
      async loadAll() {
        const tx = db.transaction([...LISTS, 'meta'], 'readonly');
        const out = {};
        for (const s of LISTS) out[s] = await reqP(tx.objectStore(s).getAll());
        const m = await reqP(tx.objectStore('meta').get('settings'));
        out.settings = m ? m.value : {};
        return out;
      },
      async put(store, rec) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(rec); await txDone(tx); },
      async del(store, id) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); await txDone(tx); },
      async putSettings(v) { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ key: 'settings', value: v }); await txDone(tx); },
      async replaceAll(data) {
        const tx = db.transaction([...LISTS, 'meta'], 'readwrite');
        for (const s of LISTS) { const os = tx.objectStore(s); os.clear(); (data[s] || []).forEach((r) => os.put(r)); }
        tx.objectStore('meta').put({ key: 'settings', value: data.settings || {} });
        await txDone(tx);
      }
    };
  }

  function lsAdapter() {
    const KEY = 'vehicle-tracker-data';
    let cache;
    const read = () => { try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { cache = {}; } LISTS.forEach((s) => { cache[s] = cache[s] || []; }); cache.settings = cache.settings || {}; };
    const write = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { throw new Error('Storage is full – export a backup and remove some photos.'); } };
    read();
    return {
      kind: 'localstorage',
      async loadAll() { read(); return JSON.parse(JSON.stringify(cache)); },
      async put(store, rec) { const i = cache[store].findIndex((r) => r.id === rec.id); if (i >= 0) cache[store][i] = rec; else cache[store].push(rec); write(); },
      async del(store, id) { cache[store] = cache[store].filter((r) => r.id !== id); write(); },
      async putSettings(v) { cache.settings = v; write(); },
      async replaceAll(data) { LISTS.forEach((s) => { cache[s] = data[s] || []; }); cache.settings = data.settings || {}; write(); }
    };
  }

  async function init() {
    try { return await idbAdapter(); } catch (e) { console.warn('IndexedDB unavailable, using localStorage', e); return lsAdapter(); }
  }
  return { init, LISTS };
});
