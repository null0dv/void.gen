(() => {
  const dialog = document.getElementById('rng-panel');
  const frame = dialog.querySelector('iframe');
  const reference = document.getElementById('rng-reference');
  const result = document.getElementById('rng-result');
  const feedback = document.getElementById('rng-feedback');
  let lastPreview = '';
  let frameReady = null;
  let rollId = 0;
  const pendingRolls = new Map();

  function loadFrame() {
    if (!frameReady) {
      if (frame.getAttribute('src') && frame.contentDocument?.readyState === 'complete') frameReady = Promise.resolve();
      else {
        frameReady = new Promise(resolve => frame.addEventListener('load', resolve, {once:true}));
        if (!frame.getAttribute('src')) frame.src = 'void-rng/index.html?embed=full';
      }
    }
    return frameReady;
  }

  function open(tags) {
    if (tags !== undefined) reference.value = tags;
    feedback.textContent = '可在預覽中編輯，再送入目前任務。';
    VoidStudio.navigate('rng');
    if (!frame.getAttribute('src')) loadFrame();
    else frame.contentWindow.postMessage({type:'void-rng-refresh'}, location.origin);
  }

  async function roll(button) {
    if (isGenerating || window.VoidRecognition?.isBusy()) { setStatus('請等目前操作完成再抽詞', 'err'); return; }
    if (button?.dataset.busy) return;
    if (button) { button.dataset.busy = '1'; button.style.opacity = '.4'; }
    const id = ++rollId;
    try {
      await loadFrame();
      const prompt = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pendingRolls.delete(id); reject(new Error('RNG 沒有回應')); }, 20000);
        pendingRolls.set(id, data => {
          clearTimeout(timer);
          data.error ? reject(new Error(data.error)) : resolve(data.prompt);
        });
        frame.contentWindow.postMessage({type:'void-rng-roll', id}, location.origin);
      });
      if (!prompt) throw new Error('這次沒抽到提示詞，請確認 RNG 頁有勾選欄位');
      if (prompt.length > 20000) throw new Error('提示詞超過 20,000 字元');
      if (currentMode === 'img2txt') setMode('txt2img');
      const editor = document.getElementById('te-prompt');
      if (!editor) throw new Error('請先選擇草稿');
      editor.value = prompt;
      editor.dispatchEvent(new Event('input', {bubbles:true}));
      localStorage.setItem('sd-tasks', JSON.stringify(tasks));
      setStatus('已從 RNG 隨機抽一組提示詞', 'ok');
    } catch (error) {
      setStatus('隨機抽詞失敗：' + error.message, 'err');
    } finally {
      if (button) { delete button.dataset.busy; button.style.opacity = ''; }
    }
  }
  window.VoidRngBridge = {roll};

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
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'void-rng-roll-result') {
      const finish = pendingRolls.get(event.data.id);
      pendingRolls.delete(event.data.id);
      finish?.(event.data);
      return;
    }
    if (dialog.hidden) return;
    const {type, prompt} = event.data || {};
    if (type !== 'void-rng-preview' || typeof prompt !== 'string' || prompt.length > 20000 || prompt === lastPreview) return;
    lastPreview = prompt;
    result.value = prompt;
  });
})();
