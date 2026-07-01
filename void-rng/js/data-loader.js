/* VOID.RNG V3 — 載入整合 JSON 辭庫（data/） */
(function (global) {
  'use strict';

  const BASE = 'data/';

  function keyFromFile(name) {
    return name.replace(/\.json$/i, '');
  }

  async function loadAll() {
    const manifest = await (await fetch(BASE + 'manifest.json')).json();
    global.VoidRngData.version = manifest.version ?? null;
    const files = [
      ...(manifest.char || []),
      ...(manifest.style || []),
      ...(manifest.jewel || []),
      ...(manifest.space || []),
      ...(manifest.search || []),
    ];
    const payload = {};
    await Promise.all(files.map(async (file) => {
      const res = await fetch(BASE + file);
      if (!res.ok) throw new Error('載入失敗: ' + file);
      payload[keyFromFile(file)] = await res.json();
    }));
    return payload;
  }

  global.VoidRngData = {
    ready: false,
    version: null,
    payload: null,
    async load() {
      const payload = await loadAll();
      this.payload = payload;
      this.ready = true;
      return payload;
    },
  };
})(window);