(() => {
  if (parent === window) return;
  const outputs = {style:getStylePromptText, char:buildCharTagsOnly, jewel:buildJewelTagsOnly, space:getSpaceActivePrompt};
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:1000;display:flex;gap:8px;background:#161616;padding:8px;border:1px solid #555;border-radius:8px';
  for (const [label, append] of [['追加到 FULL', true], ['取代 FULL 提示詞', false]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => {
      const prompt = outputs[currentPage]()?.trim();
      if (!prompt) return toast('先抽詞或選擇一張卡');
      parent.postMessage({type:'void-anime-prompt', prompt, append}, location.origin);
    };
    bar.append(button);
  }
  document.body.append(bar);
  window.addEventListener('message', event => {
    if (event.source === parent && event.origin === location.origin && event.data?.type === 'void-anime-status') toast(event.data.text);
  });
})();