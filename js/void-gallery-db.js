/* Void.gen Full — IndexedDB (gallery, lora thumbs, folder handle) */
(function (global) {
  'use strict';

  const _DB_NAME = 'void-gen-db';
  const _DB_STORE = 'gallery';
  const _LORA_THUMB_STORE = 'lora-thumbs';
  const _FOLDER_STORE = 'folder-handle';
  let _idb = null;
  let _idbPromise = null;

  function _openDB() {
    if (_idb) return Promise.resolve(_idb);
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(_DB_NAME, 3);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(_DB_STORE))
          db.createObjectStore(_DB_STORE, { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains(_LORA_THUMB_STORE))
          db.createObjectStore(_LORA_THUMB_STORE, { keyPath: 'name' });
        if (!db.objectStoreNames.contains(_FOLDER_STORE))
          db.createObjectStore(_FOLDER_STORE, { keyPath: 'id' });
      };
      req.onsuccess = e => { _idb = e.target.result; res(_idb); };
      req.onerror = () => { _idbPromise = null; rej(req.error); };
    });
    return _idbPromise;
  }

  async function dbSave(dataUrl, thumbUrl, title, meta) {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const req = db.transaction(_DB_STORE, 'readwrite').objectStore(_DB_STORE)
        .add({ dataUrl, thumbUrl: thumbUrl || dataUrl, title, meta, ts: Date.now() });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function dbLoadById(id) {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const req = db.transaction(_DB_STORE, 'readonly').objectStore(_DB_STORE).get(id);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function dbDelete(id) {
    const db = await _openDB();
    return new Promise(res => {
      db.transaction(_DB_STORE, 'readwrite').objectStore(_DB_STORE).delete(id).onsuccess = res;
    });
  }

  async function dbUpdate(id, patch) {
    const rec = await dbLoadById(id);
    if (!rec) return false;
    if (patch.meta) rec.meta = { ...(rec.meta || {}), ...patch.meta };
    Object.keys(patch).forEach(k => { if (k !== 'meta') rec[k] = patch[k]; });
    const db = await _openDB();
    return new Promise((res, rej) => {
      const req = db.transaction(_DB_STORE, 'readwrite').objectStore(_DB_STORE).put(rec);
      req.onsuccess = () => res(true);
      req.onerror = () => rej(req.error);
    });
  }

  async function dbClear() {
    const db = await _openDB();
    return new Promise(res => {
      db.transaction(_DB_STORE, 'readwrite').objectStore(_DB_STORE).clear().onsuccess = res;
    });
  }

  async function dbLoadAll() {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const req = db.transaction(_DB_STORE, 'readonly').objectStore(_DB_STORE).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function dbDeleteDiskEntries() {
    const db = await _openDB();
    const all = await dbLoadAll();
    const tx = db.transaction(_DB_STORE, 'readwrite');
    const store = tx.objectStore(_DB_STORE);
    all.filter(r => r.source === 'disk').forEach(r => store.delete(r.id));
    return new Promise(res => { tx.oncomplete = res; tx.onerror = res; });
  }

  global._DB_NAME = _DB_NAME;
  global._DB_STORE = _DB_STORE;
  global._LORA_THUMB_STORE = _LORA_THUMB_STORE;
  global._FOLDER_STORE = _FOLDER_STORE;
  global._openDB = _openDB;
  global.dbSave = dbSave;
  global.dbLoadById = dbLoadById;
  global.dbDelete = dbDelete;
  global.dbUpdate = dbUpdate;
  global.dbClear = dbClear;
  global.dbLoadAll = dbLoadAll;
  global.dbDeleteDiskEntries = dbDeleteDiskEntries;
})(typeof window !== 'undefined' ? window : globalThis);