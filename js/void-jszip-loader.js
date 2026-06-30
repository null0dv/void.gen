/* Load JSZip only when exporting gallery ZIP */
(function (global) {
  'use strict';
  let _loading = null;
  const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  global.voidLoadJSZip = function voidLoadJSZip() {
    if (global.JSZip) return Promise.resolve(global.JSZip);
    if (_loading) return _loading;
    _loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = () => resolve(global.JSZip);
      s.onerror = () => { _loading = null; reject(new Error('JSZip load failed')); };
      document.head.appendChild(s);
    });
    return _loading;
  };
})(typeof window !== 'undefined' ? window : globalThis);