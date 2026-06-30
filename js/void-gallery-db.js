/* Void.gen Full — IndexedDB (gallery, lora thumbs, folder handle) */
(function (global) {
  'use strict';

  const _DB_NAME = 'void-gen-db';
  const _DB_STORE = 'gallery';
  const _LORA_THUMB_STORE = 'lora-thumbs';
  const _FOLDER_STORE = 'folder-handle';
  const _DB_VERSION = 4;
  let _idb = null;
  let _idbPromise = null;

  function _ensureGalleryIndexes(store) {
    if (!store.indexNames.contains('ts')) store.createIndex('ts', 'ts', { unique: false });
    if (!store.indexNames.contains('source')) store.createIndex('source', 'source', { unique: false });
    if (!store.indexNames.contains('filename')) store.createIndex('filename', 'filename', { unique: false });
  }

  function _openDB() {
    if (_idb) return Promise.resolve(_idb);
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(_DB_NAME, _DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        let gallery;
        if (!db.objectStoreNames.contains(_DB_STORE)) {
          gallery = db.createObjectStore(_DB_STORE, { keyPath: 'id', autoIncrement: true });
        } else if (e.oldVersion < _DB_VERSION) {
          gallery = e.target.transaction.objectStore(_DB_STORE);
        }
        if (gallery) _ensureGalleryIndexes(gallery);
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

  function _toListItem(rec) {
    return {
      id: rec.id,
      thumbUrl: rec.thumbUrl || null,
      title: rec.title,
      meta: rec.meta,
      ts: rec.ts,
      filename: rec.filename,
      source: rec.source,
    };
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

  async function dbBatchPut(records) {
    if (!records.length) return 0;
    const db = await _openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(_DB_STORE, 'readwrite');
      const store = tx.objectStore(_DB_STORE);
      records.forEach(rec => store.put(rec));
      tx.oncomplete = () => res(records.length);
      tx.onerror = () => rej(tx.error);
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

  /** Lightweight list for gallery grid — omits dataUrl from returned objects. */
  async function dbLoadGalleryList() {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const out = [];
      const store = db.transaction(_DB_STORE, 'readonly').objectStore(_DB_STORE);
      const src = store.indexNames.contains('ts') ? store.index('ts') : store;
      const req = src.openCursor(null, 'prev');
      req.onsuccess = e => {
        const cur = e.target.result;
        if (!cur) return res(out);
        const r = cur.value;
        if (r.source !== 'disk') out.push(_toListItem(r));
        cur.continue();
      };
      req.onerror = () => rej(req.error);
    });
  }

  async function dbDeleteDiskEntries() {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(_DB_STORE, 'readwrite');
      const store = tx.objectStore(_DB_STORE);
      const useIndex = store.indexNames.contains('source');
      const req = useIndex
        ? store.index('source').openCursor(IDBKeyRange.only('disk'))
        : store.openCursor();
      req.onsuccess = e => {
        const cur = e.target.result;
        if (!cur) return;
        if (!useIndex && cur.value.source !== 'disk') { cur.continue(); return; }
        cur.delete();
        cur.continue();
      };
      req.onerror = () => rej(req.error);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
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
  global.dbBatchPut = dbBatchPut;
  global.dbClear = dbClear;
  global.dbLoadAll = dbLoadAll;
  global.dbLoadGalleryList = dbLoadGalleryList;
  global.dbDeleteDiskEntries = dbDeleteDiskEntries;
})(typeof window !== 'undefined' ? window : globalThis);