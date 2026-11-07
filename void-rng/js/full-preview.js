(() => {
  if (parent === window || new URLSearchParams(location.search).get('embed') !== 'full') return;
  const outputs = {style:getStylePromptText, char:buildCharTagsOnly, jewel:buildJewelTagsOnly, space:getSpaceActivePrompt};
  function preview() {
    const prompt = outputs[currentPage]()?.trim() || '';
    parent.postMessage({type:'void-rng-preview', prompt}, location.origin);
  }
  document.addEventListener('click', () => requestAnimationFrame(preview));
  document.addEventListener('input', () => requestAnimationFrame(preview));
  document.addEventListener('change', () => requestAnimationFrame(preview));
  window.addEventListener('message', event => {
    if (event.source === parent && event.origin === location.origin && event.data?.type === 'void-rng-refresh') preview();
  });
  requestAnimationFrame(preview);
})();
