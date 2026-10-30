/* Local vocabulary commits and visible, consistent accounting. */
const LEXICON_JOURNAL_KEY = 'void-char-lexicon-journal-v1';

function readLexiconJournal() {
  const raw = localStorage.getItem(LEXICON_JOURNAL_KEY);
  if (!raw) return { startedAt: null, events: [], totals: { tags: 0, entries: 0, templates: 0 } };
  const data = JSON.parse(raw);
  if (!Array.isArray(data.events) || !data.totals) throw new Error('Invalid vocabulary journal');
  return data;
}

function persistCharVocabulary(slots, source) {
  const clean = {};
  for (const section of CHAR_SECTIONS) {
    const value = finalizeSlotText(section.key, slots[section.key] || '');
    if (!value || (section.key === 'job' && !sanitizeJobBankEntry(value))) continue;
    clean[section.key] = VoidLexicon.unique(splitPromptTags(value)).join(', ');
  }
  if (!Object.values(clean).some(Boolean)) throw new Error('EMPTY_VOCABULARY');
  const change = VoidLexicon.prepare(charBanks, charTemplates, clean);
  const journal = readLexiconJournal();
  const now = Date.now();
  if (!journal.startedAt) journal.startedAt = now;
  if (change.addedEntries || change.addedTemplates) {
    journal.events.push({ ts: now, source, tags: change.addedTags, entries: change.addedEntries,
      segments: change.addedSegments, templates: change.addedTemplates });
    journal.events = journal.events.slice(-500);
    journal.totals.tags += change.addedTags;
    journal.totals.entries += change.addedEntries;
    journal.totals.templates += change.addedTemplates;
  }
  const extra = {};
  for (const section of CHAR_SECTIONS) {
    const defaults = new Set((DEFAULT_CHAR_BANKS[section.key] || []).map(VoidLexicon.key));
    extra[section.key] = change.banks[section.key].filter(v => !defaults.has(VoidLexicon.key(v)));
  }
  const defaults = new Set(DEFAULT_TEMPLATES.map(VoidLexicon.signature));
  const savedTemplates = change.templates.filter(t => !defaults.has(VoidLexicon.signature(t)));
  VoidLexicon.transaction(localStorage, {
    'void-char-banks': JSON.stringify(extra),
    'void-char-templates': JSON.stringify(savedTemplates),
    [LEXICON_JOURNAL_KEY]: JSON.stringify(journal),
  });
  charBanks = change.banks;
  charTemplates = change.templates;
  if (typeof VoidSearch !== 'undefined') VoidSearch.rebuildLearnedRules(getLearnedSearchTags);
  if (typeof VoidPreference !== 'undefined') VoidPreference.invalidateModel();
  renderBankStats();
  return { ...change, slots: clean };
}

function vocabularySaveMessage(change) {
  return change.addedEntries || change.addedTemplates
    ? `新增 ${change.addedTags} 個唯一標籤 · ${change.addedEntries} 筆條目 · ${change.addedTemplates} 個範本`
    : '內容已在辭庫中，未重複新增';
}

function renderLexiconOverview() {
  const stats = VoidLexicon.metrics(charBanks);
  for (const id of ['lexicon-overview', 'lexicon-dialog-overview']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = `<span><strong>${stats.tags.toLocaleString()}</strong> 唯一標籤</span>`
      + `<span><strong>${stats.entries.toLocaleString()}</strong> 詞庫條目</span>`
      + `<span><strong>${stats.segments.toLocaleString()}</strong> 描述段</span>`
      + `<span><strong>${charTemplates.length.toLocaleString()}</strong> 範本</span>`;
  }
  const pill = document.getElementById('char-lexicon-pill');
  if (pill) pill.textContent = `唯一標籤 ${stats.tags.toLocaleString()}`;
  const activity = document.getElementById('lexicon-activity');
  if (!activity) return;
  try {
    const journal = readLexiconJournal();
    if (!journal.startedAt) {
      activity.textContent = '從下一次入庫開始記錄增長；既有內容保留。探索次數不計為新增詞數。';
      return;
    }
    const labels = { liked: '喜歡入庫', learn: '學習入庫' };
    const recent = journal.events.slice(-5).reverse();
    const total = journal.totals;
    activity.innerHTML = `<p>自 ${new Date(journal.startedAt).toLocaleDateString('zh-TW')} 起：新增 ${total.tags} 個唯一標籤 · ${total.entries} 筆條目 · ${total.templates} 個範本</p>`
      + (recent.length ? '<ul>' + recent.map(event => `<li>${new Date(event.ts).toLocaleString('zh-TW')} · ${labels[event.source] || '入庫'} · +${event.tags} 標籤 / +${event.entries} 條目 / +${event.templates} 範本</li>`).join('') + '</ul>' : '<p>尚無新增內容。</p>');
  } catch {
    activity.textContent = '新增紀錄無法讀取；請先匯出備份後檢查瀏覽器儲存空間。';
  }
}

function openLexiconPanel() {
  renderLexiconOverview();
  document.getElementById('lexicon-dialog').showModal();
}

function saveLikedVocabulary() {
  const text = document.getElementById('char-output')?.value?.trim();
  if (!text) return toast('請先產生或輸入內容');
  let change;
  try {
    const buckets = autoClassifyPrompt(text);
    change = persistCharVocabulary(bucketsToPromptData(buckets), 'liked');
  } catch (error) {
    console.error('Vocabulary save failed', error);
    return toast(error.message === 'EMPTY_VOCABULARY' ? '沒有可入庫的內容' : '入庫失敗，內容仍保留；請先匯出備份並檢查儲存空間');
  }
  let preferenceSaved = false;
  try {
    preferenceSaved = typeof VoidPreference !== 'undefined' && VoidPreference.reinforceLiked(change.slots, { silent: true });
  } catch (error) { console.error('Preference save failed', error); }
  renderLexiconOverview();
  const meta = document.getElementById('char-meta');
  if (meta) meta.textContent = `${text.length} 字 · 編輯內容 · 學習範本 ${getUserLearnedTemplates().length}`;
  // Do not reroll or replace the user's editable output after liking it.
  toast(`已加入辭庫 · ${vocabularySaveMessage(change)}${preferenceSaved ? ' · 已記住偏好' : ' · 偏好未儲存，請稍後重試'}`);
}
