/* Paste, preview, copy, and apply the formatter without invoking generation. */
let promptFormatterResult = null;
let promptFormatterTimer = null;
let promptFormatterUndo = null;

function openPromptFormatter() {
  const dialog = document.getElementById('prompt-format-dialog');
  if (!dialog.open) dialog.showModal();
  document.getElementById('prompt-format-input').focus();
  refreshPromptFormatter();
}

function queuePromptFormatter() {
  clearTimeout(promptFormatterTimer);
  promptFormatterTimer = setTimeout(refreshPromptFormatter, 250);
}

function refreshPromptFormatter() {
  clearTimeout(promptFormatterTimer);
  const source = document.getElementById('prompt-format-input').value;
  promptFormatterResult = VoidPromptFormatter.convert(source, {
    sections: CHAR_SECTIONS, split: splitPromptTags, classify: classifyTag, key: VoidLexicon.key,
  });
  const result = promptFormatterResult;
  document.getElementById('prompt-format-preview').value = result.text;
  document.getElementById('prompt-format-negative').value = result.negative;
  document.getElementById('prompt-format-metadata').value = result.metadata;
  document.getElementById('prompt-format-negative-wrap').hidden = !result.negative;
  document.getElementById('prompt-format-metadata-wrap').hidden = !result.metadata;
  document.getElementById('prompt-format-status').textContent = source.trim()
    ? `${result.count} 個標籤／片段 · ${Object.keys(result.slots).length} 個區塊 · 整理 ${result.duplicates} 個重複項目${result.negative ? ' · 負向提示詞已分開' : ''}`
    : '貼上後自動轉換；保留原有內容，空白區塊不補詞。';
  document.getElementById('prompt-format-warnings').textContent = result.warnings.join('\n');
  document.getElementById('prompt-format-apply').disabled = !result.text;
  document.getElementById('prompt-format-copy').disabled = !result.text;
  return result;
}

async function copyPromptFormat(part = 'positive') {
  const result = refreshPromptFormatter();
  const value = part === 'negative' ? result.negative : result.text;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast(part === 'negative' ? '已複製負向提示詞' : '已複製轉換結果');
  } catch {
    const field = document.getElementById(part === 'negative' ? 'prompt-format-negative' : 'prompt-format-preview');
    field.focus();
    field.select();
    toast('請按 Ctrl+C 複製已選取的內容');
  }
}

function applyPromptFormat() {
  const result = refreshPromptFormatter();
  if (!result.text) return;
  const output = document.getElementById('char-output');
  promptFormatterUndo = { text: output.value, slots: { ...charSlots }, fmt: charFmt,
    included: Object.fromEntries(CHAR_SECTIONS.map(section => [section.key, document.getElementById('char-inc-' + section.key)?.checked])),
    meta: document.getElementById('char-meta').textContent,
    status: document.getElementById('char-status-bar').innerHTML };
  CHAR_SECTIONS.forEach(section => {
    charSlots[section.key] = result.slots[section.key] || '';
    const checkbox = document.getElementById('char-inc-' + section.key);
    if (checkbox) checkbox.checked = !!result.slots[section.key];
  });
  charFmt = 'structured';
  document.getElementById('char-fmt-structured')?.classList.add('on');
  document.getElementById('char-fmt-flat')?.classList.remove('on');
  output.value = result.text;
  output.classList.remove('empty');
  document.getElementById('char-meta').textContent = `${result.text.length} 字 · 格式轉換 · ${Object.keys(result.slots).length} 個區塊`;
  document.getElementById('char-status-bar').textContent = '已套用貼入內容 · 可直接編輯或喜歡並入庫';
  document.getElementById('prompt-format-undo').hidden = false;
  renderCharTable();
  scheduleRailBadgeSync();
  saveActiveSession();
  document.getElementById('prompt-format-dialog').close();
  toast(result.negative ? '正向內容已套用；負向提示詞保留在轉換視窗，可另外複製' : '已轉成分段格式並套用，可撤銷本次轉換');
}

function undoPromptFormat() {
  if (!promptFormatterUndo) return;
  const saved = promptFormatterUndo;
  charSlots = { ...saved.slots };
  charFmt = saved.fmt;
  CHAR_SECTIONS.forEach(section => {
    const checkbox = document.getElementById('char-inc-' + section.key);
    if (checkbox && saved.included[section.key] !== undefined) checkbox.checked = saved.included[section.key];
  });
  document.getElementById('char-fmt-structured')?.classList.toggle('on', charFmt === 'structured');
  document.getElementById('char-fmt-flat')?.classList.toggle('on', charFmt === 'flat');
  const output = document.getElementById('char-output');
  output.value = saved.text;
  output.classList.toggle('empty', !saved.text);
  document.getElementById('char-meta').textContent = saved.meta;
  document.getElementById('char-status-bar').innerHTML = saved.status;
  renderCharTable();
  scheduleRailBadgeSync();
  saveActiveSession();
  promptFormatterUndo = null;
  document.getElementById('prompt-format-undo').hidden = true;
  toast('已還原轉換前的內容');
}
