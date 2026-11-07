(() => {
  const dialog = document.getElementById('rng-panel');
  const frame = dialog.querySelector('iframe');
  const reference = document.getElementById('rng-reference');
  const result = document.getElementById('rng-result');
  const feedback = document.getElementById('rng-feedback');
  let lastPreview = '';

  function open(tags) {
    if (tags !== undefined) reference.value = tags;
    feedback.textContent = '可在預覽中編輯，再送入目前任務。';
    VoidStudio.navigate('rng');
    if (!frame.getAttribute('src')) frame.src = 'void-rng/index.html?embed=full';
    else frame.contentWindow.postMessage({type:'void-rng-refresh'}, location.origin);
  }

  function send(append) {
    const field = document.getElementById('te-prompt');
    const words = [reference.value.trim(), result.value.trim()].filter(Boolean).join(', ');
    if (!words) { feedback.textContent = '先抽詞、選卡或填入提示詞。'; return; }
    if (!field || isGenerating || window.VoidRecognition?.isBusy()) {
      feedback.textContent = '請先選擇草稿，並等目前操作完成。';
      return;
    }
    const next = [append ? field.value.trim() : '', words].filter(Boolean).join(', ');
    if (next.length > 20000) { feedback.textContent = '草稿超過 20,000 字元，請先精簡。'; return; }
    if (currentMode === 'img2txt') setMode('txt2img');
    const editor = document.getElementById('te-prompt') || field;
    editor.value = next;
    editor.dispatchEvent(new Event('input', {bubbles:true}));
    localStorage.setItem('sd-tasks', JSON.stringify(tasks));
    reference.value = '';
    VoidStudio.navigate('create');
    setStatus('RNG 提示詞已送入目前草稿', 'ok');
  }

  document.getElementById('rng-open').onclick = () => open();
  document.getElementById('rng-back').onclick = () => VoidStudio.navigate('create');
  document.getElementById('rng-tags').onclick = () => {
    const tags = document.getElementById('tagger-output').textContent.trim();
    if (tags && !window.VoidRecognition?.isBusy()) open(tags);
  };
  document.getElementById('rng-append').onclick = () => send(true);
  document.getElementById('rng-replace').onclick = () => send(false);
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || dialog.hidden) return;
    const {type, prompt} = event.data || {};
    if (type !== 'void-rng-preview' || typeof prompt !== 'string' || prompt.length > 20000 || prompt === lastPreview) return;
    lastPreview = prompt;
    result.value = prompt;
  });
})();
