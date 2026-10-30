const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const formatter = require('../js/prompt-formatter.js');
const lexicon = require('../js/lexicon-store.js');
const sections = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/char-sections.json'), 'utf8'));
const classify = tag => /masterpiece/.test(tag) ? 'quality' : /smil/.test(tag) ? 'face' : /coat/.test(tag) ? 'outfit'
  : /walking|reading/.test(tag) ? 'pose' : /rain|city|light/.test(tag) ? 'env' : /watercolor/.test(tag) ? 'styleRef' : 'subject';
const convert = input => formatter.convert(input, { sections, classify, split: lexicon.split, key: lexicon.key });
test('flat tags are categorized without injecting missing content', () => {
  const result = convert('masterpiece, adult traveler, calm smile, blue coat, walking, rainy city');
  assert.equal(result.count, 6);
  assert.equal(result.slots.outfit, 'blue coat');
  assert.equal(result.slots.pose, 'walking');
  assert.equal(result.slots.details, undefined);
  assert.match(result.text, /\/\/ ❖ Subject & Character\nadult traveler/);
});
test('common clothing and pose tags are categorized even if the old classifier falls back to subject', () => {
  const result = formatter.convert('adult traveler, blue coat, walking, long hair, soft daylight', {
    sections, split: lexicon.split, key: lexicon.key, classify: () => 'subject',
  });
  assert.equal(result.slots.subject, 'adult traveler');
  assert.equal(result.slots.outfit, 'blue coat');
  assert.equal(result.slots.pose, 'walking');
  assert.equal(result.slots.details, 'long hair');
  assert.equal(result.slots.env, 'soft daylight');
});
test('Chinese, Markdown, inline and bracketed headings preserve explicit categories', () => {
  const result = convert('角色：成年旅行者\n**Outfit:** 藍色外套\n[Environment & Lighting]\n雨中的城市\n### Facial Features\ncalm smile');
  assert.equal(result.slots.subject, '成年旅行者');
  assert.equal(result.slots.outfit, '藍色外套');
  assert.equal(result.slots.env, '雨中的城市');
  assert.equal(result.slots.face, 'calm smile');
});
test('negative prompts and A1111 generation parameters never enter positive sections', () => {
  const result = convert('adult traveler, blue coat\nNegative prompt: lowres, blurry\nwatermark\nSteps: 25, Sampler: Euler, Seed: 42');
  assert.equal(result.negative, 'lowres, blurry, watermark');
  assert.match(result.metadata, /Seed: 42/);
  assert.doesNotMatch(result.text, /lowres|blurry|watermark|Seed|Steps/);
});
test('JSON prompt text and negative_prompt are supported', () => {
  const result = convert(JSON.stringify({ prompt: 'adult traveler, blue coat', negative_prompt: 'blurry', seed: 42 }));
  assert.equal(result.slots.outfit, 'blue coat');
  assert.equal(result.negative, 'blurry');
  assert.equal(result.warnings.length, 1);
});
test('weights, nested commas, LoRA tokens and spelling are preserved', () => {
  const result = convert('Outfit: (blue coat, silver buttons:1.2), <lora:travel_style:0.7>, blue coat');
  assert.equal(result.slots.outfit, '(blue coat, silver buttons:1.2), <lora:travel_style:0.7>, blue coat');
  assert.equal(result.count, 3);
});
test('unknown headings and their content are kept with an explanation', () => {
  const result = convert('## Custom accessories\ncompass, paper map\nOutfit: blue coat');
  assert.equal(result.slots.details, 'Custom accessories, compass, paper map');
  assert.equal(result.slots.outfit, 'blue coat');
  assert.equal(result.warnings.length, 1);
});
test('duplicates and Chinese separators are handled within each section', () => {
  const result = convert('Outfit: blue coat，BLUE_COAT；linen scarf\nEnvironment: rainy city、soft light');
  assert.equal(result.slots.outfit, 'blue coat, linen scarf');
  assert.equal(result.slots.env, 'rainy city, soft light');
  assert.equal(result.duplicates, 1);
});
test('canonical section output round trips without changing its content', () => {
  const first = convert('quality: masterpiece\nsubject: adult traveler\noutfit: blue coat\npose: reading a map\nstyle: watercolor');
  assert.equal(convert(first.text).text, first.text);
});
test('empty and negative-only input produce no positive output', () => {
  assert.equal(convert('  ').text, '');
  const negative = convert('Negative prompt: blurry');
  assert.equal(negative.text, '');
  assert.equal(negative.negative, 'blurry');
});

function uiContext() {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', checked: false, hidden: false,
      classList: { add() {}, remove() {}, toggle() {} }, focus() {}, select() {}, showModal() { this.open = true; }, close() { this.open = false; } });
    return elements.get(id);
  };
  const previous = '// ❖ Subject & Character\nadult artist';
  el('char-output').value = previous;
  const ctx = { console, setTimeout, clearTimeout, VoidLexicon: lexicon, VoidPromptFormatter: formatter, CHAR_SECTIONS: sections,
    charSlots: { subject: 'adult artist', outfit: 'green coat' }, charFmt: 'flat', classifyTag: classify,
    splitPromptTags: lexicon.split, renderCharTable() {}, scheduleRailBadgeSync() {},
    saveActiveSession() { ctx.saved = (ctx.saved || 0) + 1; }, toast() {},
    generateChar() { throw Error('Formatter must not generate content'); },
    document: { getElementById: el }, navigator: { clipboard: { async writeText(value) { ctx.copied = value; } } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/prompt-formatter-ui.js'), 'utf8'), ctx);
  return { ctx, el, previous };
}
test('preview does not change output or persist; apply uses the latest input and undo restores the old output', () => {
  const { ctx, el, previous } = uiContext();
  el('prompt-format-input').value = 'adult traveler, blue coat';
  ctx.refreshPromptFormatter();
  assert.equal(el('char-output').value, previous);
  assert.equal(ctx.saved, undefined);
  el('prompt-format-input').value = 'subject: adult traveler\noutfit: yellow coat';
  ctx.applyPromptFormat();
  assert.match(el('char-output').value, /yellow coat/);
  assert.equal(ctx.charSlots.outfit, 'yellow coat');
  assert.equal(ctx.charSlots.details, '');
  assert.equal(ctx.charFmt, 'structured');
  assert.equal(el('prompt-format-undo').hidden, false);
  ctx.undoPromptFormat();
  assert.equal(el('char-output').value, previous);
  assert.equal(ctx.charSlots.outfit, 'green coat');
  assert.equal(ctx.charFmt, 'flat');
});
test('copy refreshes the current preview, and blank conversion cannot overwrite current output', async () => {
  const { ctx, el, previous } = uiContext();
  el('prompt-format-input').value = 'adult traveler, blue coat';
  await ctx.copyPromptFormat();
  assert.match(ctx.copied, /Outfit\nblue coat/);
  el('prompt-format-input').value = '';
  ctx.applyPromptFormat();
  assert.equal(el('char-output').value, previous);
  assert.equal(el('prompt-format-apply').disabled, true);
});
