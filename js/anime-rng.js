(() => {
  const dialog = document.getElementById('rng-panel');
  const frame = dialog.querySelector('iframe');
  const reference = dialog.querySelector('textarea');
  function open(tags = '') {
    reference.value = tags;
    if (!frame.getAttribute('src')) frame.src = 'void-rng/index.html';
    dialog.showModal();
  }
  document.getElementById('rng-open').onclick = () => open();
  document.getElementById('rng-tags').onclick = () => {
    const tags = document.getElementById('tagger-output').textContent.trim();
    if (tags && !window.VoidRecognition?.isBusy()) open(tags);
  };
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || !dialog.open) return;
    const {type, prompt, append} = event.data || {};
    if (type !== 'void-anime-prompt' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) return;
    const field = document.getElementById('te-prompt');
    if (!field || isGenerating || window.VoidRecognition?.isBusy()) {
      frame.contentWindow.postMessage({type:'void-anime-status', text:'請先選擇草稿，並等目前操作完成。'}, location.origin);
      return;
    }
    const next = [append ? field.value.trim() : '', reference.value.trim(), prompt.trim()].filter(Boolean).join(', ');
    if (currentMode === 'img2txt') setMode('txt2img');
    const editor = document.getElementById('te-prompt') || field;
    editor.value = next;
    editor.dispatchEvent(new Event('input', {bubbles:true}));
    localStorage.setItem('sd-tasks', JSON.stringify(tasks));
    dialog.close();
    setStatus('RNG 提示詞已送入目前草稿', 'ok');
  });
})();