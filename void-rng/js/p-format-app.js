(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const source = $('p-input'), output = $('p-output');
  let debounce;
  function status(text) { $('p-status').textContent = text; }
  function reset() {
    clearTimeout(debounce);
    output.value = VoidPFormat.render({});
    $('p-copy').disabled = true;
    $('p-negative-wrap').hidden = true;
    $('p-negative').value = '';
    $('p-review-wrap').hidden = true;
    $('p-review').textContent = '';
    $('p-input-count').textContent = `${source.value.length.toLocaleString()} 字`;
  }
  function run() {
    reset();
    if (!source.value.trim()) { status('貼上 Prompt，會自動在本機分類。'); return; }
    try {
      const result = VoidPFormat.local(source.value, {formatter: VoidPromptFormatter, lexicon: VoidLexicon});
      output.value = result.text;
      $('p-copy').disabled = !result.count;
      $('p-negative').value = result.negative;
      $('p-negative-wrap').hidden = !result.negative;
      const review = [
        ...result.unresolved.map(text => `尚未轉換，原文保留：${text}`),
        ...result.uncertain.map(text => `待確認分類，暫放 Subject & Character：${text}`),
        ...result.warnings,
      ];
      $('p-review').textContent = review.join('\n');
      $('p-review-wrap').hidden = !review.length;
      status(`本機分類完成 · 8 個固定區塊 · ${result.count} 個標籤${review.length ? ` · ${review.length} 項待確認` : ''}${result.negative ? ' · 負向提示詞另列' : ''}`);
    } catch (error) { status(`轉換未完成：${error.message}；輸入原文已保留。`); }
  }
  source.addEventListener('input', () => { reset(); status('等待本機分類…'); debounce = setTimeout(run, 350); });
  source.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(); } });
  $('p-run').addEventListener('click', run);
  $('p-clear').addEventListener('click', () => { source.value = ''; reset(); status('貼上 Prompt，會自動在本機分類。'); source.focus(); });
  async function copy(field) {
    try { await navigator.clipboard.writeText(field.value); status('已複製。'); }
    catch { field.focus(); field.select(); status('內容已選取，請按 Ctrl+C 複製。'); }
  }
  $('p-copy').addEventListener('click', () => copy(output));
  $('p-copy-negative').addEventListener('click', () => copy($('p-negative')));
  reset();
})();
