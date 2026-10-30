const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/p-format-core');
const formatter = require('../js/prompt-formatter');
const lexicon = require('../js/lexicon-store');
const deps = {formatter, lexicon};
const titles = ['Subject & Character', 'Facial Features', 'Character Details', 'Outfit', 'Pose / Composition', 'Environment & Lighting', 'STYLE REFERENCES', 'QUALITY / TECHNICAL TAGS'];
const headers = text => text.split('\n').filter(line => line.startsWith('// ❖ ')).map(line => line.slice(5));

test('unheaded English tags map to all eight exact sections without adding tags', () => {
  const result = core.local('adult traveler, blue eyes, short hair, blue coat, standing, forest, watercolor, masterpiece', deps);
  assert.deepEqual(headers(result.text), titles);
  assert.equal(result.count, 8);
  assert.deepEqual(Object.values(result.fields).map(tags => tags.length), Array(8).fill(1));
  assert.deepEqual(result.unresolved, []);
});
test('empty source keeps all eight empty sections', () => {
  const result = core.local('', deps);
  assert.deepEqual(headers(result.text), titles);
  assert.equal(result.count, 0);
});
test('common Chinese phrases translate offline into all eight sections', () => {
  const result = core.local('成年旅行者，藍色眼睛，短髮，藍色外套，站立，森林，水彩，高品質', deps);
  assert.equal(result.count, 8);
  assert.equal(result.fields.subject[0], 'adult traveler');
  assert.equal(result.fields.face[0], 'blue eyes');
  assert.equal(result.fields.outfit[0], 'blue coat');
  assert.equal(result.fields.env[0], 'forest');
  assert.equal(result.fields.styleRef[0], 'watercolor');
  assert.doesNotMatch(result.text, /[\u4e00-\u9fff]/);
});
test('common Chinese description is covered by longest matching phrases, without inventing age', () => {
  const result = core.local('一位穿著藍色外套的旅行者，在森林裡站著，微笑', deps);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.fields.subject, ['traveler']);
  assert.deepEqual(result.fields.outfit, ['blue coat']);
  assert.deepEqual(result.fields.pose, ['standing']);
  assert.deepEqual(result.fields.env, ['forest']);
  assert.deepEqual(result.fields.face, ['smiling']);
});
test('unrecognized non-English fragment is preserved for review, never guessed or silently inserted', () => {
  const result = core.local('藍色外套，星塵折光紋', deps);
  assert.deepEqual(result.fields.outfit, ['blue coat']);
  assert.deepEqual(result.unresolved, ['星塵折光紋']);
  assert.doesNotMatch(result.text, /星塵/);
});
test('simple English sentences become separate source-based tags', () => {
  const result = core.local('An adult traveler is walking through a rainy city wearing a long blue coat.', deps);
  assert.deepEqual(result.fields.subject, ['adult traveler']);
  assert.deepEqual(result.fields.pose, ['walking']);
  assert.deepEqual(result.fields.env, ['through a rainy city']);
  assert.deepEqual(result.fields.outfit, ['long blue coat']);
});
test('actions, depth of field, palettes and accessories use the intended categories', () => {
  const result = core.local('holding a blue coat, shallow depth of field, monochrome palette, handmade brooch', deps);
  assert.deepEqual(result.fields.pose, ['holding a blue coat']);
  assert.deepEqual(result.fields.env, ['shallow depth of field']);
  assert.deepEqual(result.fields.styleRef, ['monochrome palette']);
  assert.deepEqual(result.fields.details, ['handmade brooch']);
});
test('weighted groups, nested commas and model tokens stay intact', () => {
  const result = core.local('(blue eyes:1.2), (long hair, red ribbon:1.1), blue coat (silver buttons, gold trim), <lora:travel_style:0.7>', deps);
  assert.deepEqual(result.fields.face, ['(blue eyes:1.2)']);
  assert.deepEqual(result.fields.details, ['(long hair, red ribbon:1.1)']);
  assert.deepEqual(result.fields.outfit, ['blue coat (silver buttons, gold trim)']);
  assert.deepEqual(result.fields.quality, ['<lora:travel_style:0.7>']);
});
test('source headings are respected, JOB merges into pose, negative and parameters stay separate', () => {
  const result = core.local('角色：成年旅行者\n服裝：藍色外套\nJOB / Act: reading a map\nNegative prompt: 模糊, watermark\nSteps: 30, Seed: 1', deps);
  assert.deepEqual(headers(result.text), titles);
  assert.deepEqual(result.fields.subject, ['adult traveler']);
  assert.deepEqual(result.fields.outfit, ['blue coat']);
  assert.deepEqual(result.fields.pose, ['reading a map']);
  assert.equal(result.negative, 'blurry, watermark');
  assert.doesNotMatch(result.text, /JOB|Steps|Seed|watermark/);
});
test('Chinese weighted groups translate without losing weights or introducing bracket fragments', () => {
  const result = core.local('(藍色眼睛:1.2), [銀色長髮，蝴蝶結:0.8]\nNegative prompt: (模糊:1.2)', deps);
  assert.deepEqual(result.fields.face, ['(blue eyes:1.2)']);
  assert.deepEqual(result.fields.details, ['[long silver hair, ribbon:0.8]']);
  assert.equal(result.negative, '(blurry:1.2)');
  assert.deepEqual(result.unresolved, []);
  const unknown = core.local('(星塵折光紋:1.2)', deps);
  assert.deepEqual(unknown.unresolved, ['(星塵折光紋:1.2)']);
  assert.equal(unknown.count, 0);
});
test('simple present-tense actions are separated from the character details', () => {
  const result = core.local('A traveler with blue eyes and short hair stands in the forest.', deps);
  assert.deepEqual(result.fields.details, ['short hair']);
  assert.deepEqual(result.fields.pose, ['standing']);
  assert.deepEqual(result.fields.env, ['in the forest']);
});
test('unknown English remains visible with a classification review warning', () => {
  const result = core.local('customToken_XYZ, blue coat, blue coat', deps);
  assert.deepEqual(result.uncertain, ['customToken_XYZ']);
  assert.deepEqual(result.fields.subject, ['customToken_XYZ']);
  assert.equal(result.fields.outfit.length, 1);
});
function appContext() {
  const nodes = new Map(), timers = new Map();
  let timer = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {value: '', textContent: '', hidden: false, disabled: false, listeners: {},
      focus() {}, select() {}, addEventListener(name, fn) {this.listeners[name] = fn;},
      fire(name, event = {}) {return this.listeners[name](event);}});
    return nodes.get(id);
  };
  let requests = 0;
  const ctx = {document: {getElementById: node}, VoidPFormat: core, VoidPromptFormatter: formatter, VoidLexicon: lexicon,
    localStorage: {getItem() {throw Error('Credential/storage access is prohibited');}},
    fetch() {requests++; throw Error('Network is prohibited');},
    navigator: {clipboard: {async writeText(value) {ctx.copied = value;}}},
    setTimeout(fn) {timers.set(++timer, fn); return timer;}, clearTimeout(id) {timers.delete(id);}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/p-format-app.js'), 'utf8'), ctx);
  return {node, ctx, timers, requests: () => requests};
}
test('UI converts English and Chinese with network and credential access prohibited', async () => {
  const {node, requests, ctx} = appContext();
  for (const text of ['adult traveler, blue coat', '成年旅行者，藍色外套']) {
    node('p-input').value = text;
    node('p-run').fire('click');
    assert.match(node('p-output').value, /Outfit\nblue coat/);
    assert.match(node('p-status').textContent, /本機分類完成/);
    assert.equal(node('p-copy').disabled, false);
  }
  await node('p-copy').fire('click');
  assert.equal(ctx.copied, node('p-output').value);
  assert.equal(requests(), 0);
});
test('paste/input automatically converts, clear resets output and review without changing source on conversion', () => {
  const {node, timers} = appContext();
  node('p-input').value = '藍色外套，星塵折光紋';
  node('p-input').fire('input');
  [...timers.values()][0]();
  assert.equal(node('p-input').value, '藍色外套，星塵折光紋');
  assert.equal(node('p-review-wrap').hidden, false);
  assert.match(node('p-review').textContent, /星塵折光紋/);
  node('p-clear').fire('click');
  assert.equal(node('p-input').value, '');
  assert.equal(node('p-copy').disabled, true);
  assert.equal(node('p-review-wrap').hidden, true);
  assert.deepEqual(headers(node('p-output').value), titles);
});
test('converter page blocks connections and contains no API setup UI', () => {
  const html = fs.readFileSync(path.join(__dirname, '../p-format.html'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /p-settings|p-api-key|AI 設定/);
});
