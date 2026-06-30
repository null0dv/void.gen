/* VOID.RNG — standalone bootstrap */
(function () {
  'use strict';

  if (location.protocol === 'file:') {
    const el = document.getElementById('boot-error');
    if (el) {
      el.textContent = '請勿用 file:// 開啟。請雙擊 VOID-RNG.cmd，以 http://127.0.0.1:8787/ 開啟。';
      el.classList.add('show');
    }
    return;
  }

  function showBootError(msg) {
    const el = document.getElementById('boot-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
  }

  function clearBootError() {
    document.getElementById('boot-error')?.classList.remove('show');
  }

  function bindGlobalClicks() {
    document.body.addEventListener('click', (e) => {
      const tab = e.target.closest('.page-tab[data-page]');
      if (tab && typeof window.switchPage === 'function') {
        e.preventDefault();
        window.switchPage(tab.dataset.page, tab);
      }
    });
  }

  function coreReady() {
    return typeof window.switchPage === 'function'
      && typeof window.generateChar === 'function'
      && typeof window.generateAll === 'function'
      && typeof window.toast === 'function';
  }

  function waitForEngine(maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        if (coreReady() || window.__VOID_RNG_ENGINE__) {
          resolve(coreReady() || !!window.__VOID_RNG_ENGINE__);
          return;
        }
        if (Date.now() - start >= maxMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 40);
      })();
    });
  }

  async function boot() {
    bindGlobalClicks();
    try {
      if (window.VoidRngData) {
        await VoidRngData.load();
      }
      if (typeof window.bootVoidRng === 'function') {
        window.bootVoidRng();
      }
      const ok = await waitForEngine(8000);
      if (!ok) {
        const eng = document.getElementById('rng-engine-script');
        const src = eng?.getAttribute('src') || '(unknown)';
        showBootError(
          '引擎載入失敗。請確認 VOID.RNG 伺服器（8787）運行中並 Ctrl+F5。'
          + ' Network 檢查 ' + src + ' 是否 200。'
        );
        return;
      }
      clearBootError();
      document.body.classList.add('app-ready');
    } catch (e) {
      console.error(e);
      showBootError('載入失敗：' + (e.message || e) + ' — 請確認 data/ 辭庫可讀取。');
    }
  }

  const engScript = document.getElementById('rng-engine-script');
  if (engScript) {
    engScript.addEventListener('error', () => {
      showBootError('無法載入 rng-engine.js — 請先啟動 VOID-RNG.cmd。');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('error', (e) => {
    if (e.filename && String(e.filename).includes('rng-engine')) {
      showBootError('引擎錯誤：' + (e.message || 'unknown'));
    }
  });
})();