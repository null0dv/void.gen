(() => {
  if (parent === window || new URLSearchParams(location.search).get('embed') !== 'full') return;
  const outputs = {style:getStylePromptText, char:buildCharTagsOnly, jewel:buildJewelTagsOnly, space:getSpaceActivePrompt};
  const rolls = {style:generateAll, char:generateChar, jewel:generateJewel, space:generateSpaceCards};
  const current = () => outputs[currentPage]()?.trim() || '';
  function preview() {
    parent.postMessage({type:'void-rng-preview', prompt:current()}, location.origin);
  }
  function whenReady(done, tries = 0) {
    if (document.body.classList.contains('app-ready')) done();
    else if (tries < 200) setTimeout(() => whenReady(done, tries + 1), 50);
    else done(new Error('RNG 載入逾時'));
  }
  function roll(id) {
    whenReady(error => {
      let prompt = '';
      try {
        if (error) throw error;
        (rolls[currentPage] || generateAll)();
        prompt = current();
      } catch (e) {
        error = e;
      }
      parent.postMessage({type:'void-rng-roll-result', id, prompt, error:error ? String(error.message || error) : ''}, location.origin);
      preview();
    });
  }
  document.addEventListener('click', () => requestAnimationFrame(preview));
  document.addEventListener('input', () => requestAnimationFrame(preview));
  document.addEventListener('change', () => requestAnimationFrame(preview));
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === 'void-rng-refresh') preview();
    if (event.data?.type === 'void-rng-roll') roll(event.data.id);
  });
  requestAnimationFrame(preview);
})();
