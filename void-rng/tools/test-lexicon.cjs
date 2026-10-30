const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lib = require('../js/lexicon-store.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}
function context() {
  const slots = { subject: 'adult traveler', face: 'smiling eyes', outfit: 'blue coat', pose: 'walking' };
  const ctx = { console, Date, localStorage: storage(), VoidLexicon: lib,
    CHAR_SECTIONS: Object.keys(slots).map(key => ({ key })),
    charBanks: Object.fromEntries(Object.keys(slots).map(k => [k, []])), charTemplates: [],
    DEFAULT_CHAR_BANKS: {}, DEFAULT_TEMPLATES: [],
    finalizeSlotText: (_, text) => text, sanitizeJobBankEntry: () => true,
    splitPromptTags: lib.split, getLearnedSearchTags: () => ({}), renderBankStats: () => {},
    getUserLearnedTemplates: () => [], getCharHistory: () => [], getCharSlots: () => slots,
    document: { getElementById: () => null }, toast: () => {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/preference-engine.js'), ctx);
  vm.runInContext(read('js/lexicon-ui.js'), ctx);
  return { ctx, slots };
}
test('tag splitting preserves weighted groups and deduplicates spelling variants', () => {
  assert.deepEqual(lib.split('// ❖ Subject\nadult traveler, (soft light, rain:1.2), city'), ['adult traveler', '(soft light, rain:1.2)', 'city']);
  assert.deepEqual(lib.unique(['Blue_coat', 'blue coat', '(blue coat:1.2)']), ['Blue_coat', '(blue coat:1.2)']);
});
test('metrics distinguish entries, segments, and cross-section unique tags', () => {
  const result = lib.metrics({ subject: ['traveler, blue coat', 'traveler'], outfit: ['BLUE_COAT'] });
  assert.equal(result.entries, 3);
  assert.equal(result.segments, 1);
  assert.equal(result.tags, 2);
});
test('same subject/outfit with different pose is a distinct template; repeated saves are idempotent', () => {
  const { ctx, slots } = context();
  const first = ctx.persistCharVocabulary(slots, 'liked');
  assert.equal(first.addedTags, 4);
  assert.equal(first.addedTemplates, 1);
  const again = ctx.persistCharVocabulary({ ...slots, outfit: 'BLUE_COAT' }, 'liked');
  assert.equal(again.addedEntries, 0);
  assert.equal(again.addedTemplates, 0);
  assert.equal(ctx.persistCharVocabulary({ ...slots, pose: 'standing' }, 'liked').addedTemplates, 1);
  const journal = JSON.parse(ctx.localStorage.getItem('void-char-lexicon-journal-v1'));
  assert.equal(journal.events.length, 2);
  assert.equal(journal.totals.tags, 5);
});
test('quota failure rolls back disk and does not change in-memory vocabulary', () => {
  const { ctx, slots } = context();
  const realSet = ctx.localStorage.setItem;
  ctx.localStorage.setItem = (key, value) => {
    if (key === 'void-char-templates') throw new Error('quota');
    realSet(key, value);
  };
  assert.throws(() => ctx.persistCharVocabulary(slots, 'liked'), /quota/);
  assert.equal(ctx.localStorage.getItem('void-char-banks'), null);
  assert.equal(ctx.charBanks.subject.length, 0);
  assert.equal(ctx.charTemplates.length, 0);
});
test('liking upgrades a sample once and stores its supplied edited content', () => {
  const { ctx, slots } = context();
  ctx.VoidPreference.recordSample(slots, null, { source: 'learn' });
  ctx.VoidPreference.reinforceLiked(slots, { silent: true });
  ctx.VoidPreference.reinforceLiked(slots, { silent: true });
  let saved = JSON.parse(ctx.localStorage.getItem('void-char-pref-samples'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].meta.liked, true);
  ctx.VoidPreference.reinforceLiked({ ...slots, pose: 'reading' }, { silent: true });
  saved = JSON.parse(ctx.localStorage.getItem('void-char-pref-samples'));
  assert.equal(saved.length, 2);
  assert.equal(saved[1].slots.pose, 'reading');
});
test('learned combination keeps face/outfit/pose positions after model rebuild', () => {
  const { ctx } = context();
  ctx.VoidPreference.recordSample({ subject: 'adult traveler', face: 'zesty smile', outfit: 'amber coat', pose: 'walking' });
  const model = ctx.VoidPreference.getModel();
  assert.ok(model.tripleFreq['zesty smile|||amber coat|||walking']);
  assert.equal(model.tripleFreq['amber coat|||walking|||zesty smile'], undefined);
});
test('like action ingests visible edited text and leaves the textarea unchanged', () => {
  const { ctx, slots } = context();
  const output = { value: 'adult traveler, blue coat, reading' };
  ctx.document.getElementById = id => id === 'char-output' ? output : null;
  ctx.autoClassifyPrompt = text => { assert.equal(text, output.value); return { ...slots, pose: 'reading' }; };
  ctx.bucketsToPromptData = x => x;
  ctx.saveLikedVocabulary();
  ctx.saveLikedVocabulary();
  assert.equal(output.value, 'adult traveler, blue coat, reading');
  assert.deepEqual([...ctx.charBanks.pose], ['reading']);
  assert.equal(JSON.parse(ctx.localStorage.getItem('void-char-pref-samples')).length, 1);
});
test('existing user export survives save and reload without removing entries', () => {
  const { ctx, slots } = context();
  const baseline = JSON.parse(read('data/char-banks.json'));
  ctx.charBanks = structuredClone(baseline);
  ctx.DEFAULT_CHAR_BANKS = baseline;
  ctx.CHAR_SECTIONS = Object.keys(baseline).map(key => ({ key }));
  ctx.persistCharVocabulary(slots, 'liked');
  for (const [key, entries] of Object.entries(baseline)) {
    assert.ok(entries.every(entry => ctx.charBanks[key].includes(entry)));
  }
});
