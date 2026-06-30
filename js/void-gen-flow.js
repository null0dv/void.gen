/* Void.gen — generation UX state (maps status bar messages to a simple state machine) */
(function (global) {
  'use strict';

  const VALID = new Set([
    'idle', 'connecting', 'queued', 'generating', 'saving', 'done', 'error', 'cancelled'
  ]);
  let _state = 'idle';

  function setGenState(next) {
    if (!VALID.has(next)) return;
    _state = next;
    if (document.body) document.body.dataset.voidGenState = next;
  }

  function inferFromStatus(msg, type) {
    const u = String(msg || '').toUpperCase();
    if (type === 'error' || u.includes('ERROR')) return 'error';
    if (u.includes('STOP')) return 'cancelled';
    if (u.includes('GENERAT') || u.includes('ANALYZ') || u.includes('TAGGER')) return 'generating';
    if (u.includes('UPLOAD') || u.includes('CONNECT')) return 'connecting';
    if (u.includes('IMPORT') || u.includes('SAVING') || u.includes('PACKING')) return 'saving';
    if (u.includes('DONE') || u === 'SAVED' || u.includes('SYNCED')) return 'done';
    if (msg === 'Void.gen' || !msg) return 'idle';
    return null;
  }

  global.VoidGenFlow = {
    getState: () => _state,
    setState: setGenState,
    inferFromStatus
  };

  global.voidWrapSetStatus = function wrapSetStatus(orig) {
    if (typeof orig !== 'function') return orig;
    return function (msg, type) {
      const inferred = inferFromStatus(msg, type);
      if (inferred) setGenState(inferred);
      return orig.call(this, msg, type);
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);