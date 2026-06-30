/* Void.gen boot — protocol check + early stubs (load before main dashboard script) */
(function () {
  'use strict';

  if (location.protocol === 'file:') {
    var showBanner = function () {
      if (document.getElementById('file-protocol-banner')) return;
      document.body.classList.add('file-protocol-warn');
      var bar = document.createElement('div');
      bar.id = 'file-protocol-banner';
      bar.innerHTML =
        '<span>⚠ 請勿用 file:// 開啟 — 圖庫點擊、刪除檔案、資料夾同步可能失效</span>' +
        '<span>請用桌面 <b>VOID.GEN</b> 捷徑 → <code>http://localhost:8080</code></span>' +
        '<button type="button" id="file-protocol-dismiss">知道了</button>';
      document.body.prepend(bar);
      var dismiss = document.getElementById('file-protocol-dismiss');
      if (dismiss) {
        dismiss.addEventListener('click', function () {
          bar.remove();
          document.body.classList.remove('file-protocol-warn');
        });
      }
    };
    if (document.body) showBanner();
    else document.addEventListener('DOMContentLoaded', showBanner);
  }

  var noop = function () {};
  window.openGalleryCard = window.openGalleryCard || noop;
  window.closeLightbox = window.closeLightbox || noop;
  window.toggleFav = window.toggleFav || noop;
  window.setCardRating = window.setCardRating || noop;
  window.deleteFromGallery = window.deleteFromGallery || noop;
})();