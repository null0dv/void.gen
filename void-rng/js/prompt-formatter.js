/* Source-preserving Prompt format conversion; no generation or network requests. */
(function (root) {
  'use strict';
  const aliases = {
    quality: ['quality', 'quality tags', 'quality technical tags', 'technical tags', '品質', '品質標籤', '畫質'],
    subject: ['subject', 'character', 'subject character', 'subject and character', '角色', '主體', '主體與角色'],
    face: ['face', 'facial features', 'expression', 'expressions', '表情', '臉部', '臉部特徵', '面部特徵'],
    details: ['details', 'character details', 'appearance', '角色細節', '外觀', '細節'],
    outfit: ['outfit', 'clothes', 'clothing', 'costume', '服裝', '衣著', '穿著'],
    pose: ['pose', 'composition', 'pose composition', 'pose composition act', 'pose composition and act', 'camera', 'action', '姿勢', '構圖', '姿勢構圖', '姿勢／構圖', '鏡頭', '動作'],
    job: ['job', 'job act', 'job and act'],
    env: ['environment', 'lighting', 'environment lighting', 'environment and lighting', 'background', 'scene', '環境', '背景', '場景', '光線', '環境與光線'],
    styleRef: ['style', 'style reference', 'style references', 'art style', '風格', '畫風', '風格參考'],
    negative: ['negative', 'negative prompt', 'negative prompts', 'negativeprompt', '負向', '負向提示詞', '負面提示詞', '反向提示詞'],
    positive: ['positive', 'positive prompt', 'positiveprompt', 'prompt', '正向', '正向提示詞', '提示詞'],
    metadata: ['parameters', 'generation parameters', '參數', '生成參數'],
  };
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[&／/·・_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  function headings(sections) {
    const map = new Map();
    Object.entries(aliases).forEach(([section, names]) => names.forEach(name => map.set(normalize(name), section)));
    sections.forEach(section => [section.key, section.label, section.zh].filter(Boolean).forEach(name => map.set(normalize(name), section.key)));
    return map;
  }
  function readHeading(line, map) {
    const stripped = line.trim().replace(/^\/\/\s*(?:❖\s*)?/, '').replace(/^#{1,6}\s*/, '')
      .replace(/^(?:[-*]\s+)?\d+[.)、]\s*/, '').replace(/^❖\s*/, '').replace(/^\*\*([^*]+)\*\*/, '$1');
    const inline = stripped.match(/^(.{1,90}?)[:：]\s*(.*)$/);
    if (inline) {
      const section = map.get(normalize(inline[1].replace(/^\[|\]$|^【|】$/g, '')));
      if (section) return { section, content: inline[2] };
    }
    const section = map.get(normalize(stripped.replace(/^\[|\]$|^【|】$/g, '').replace(/[:：]$/, '')));
    return section ? { section, content: '' } : null;
  }
  function inferSection(tag, classify) {
    // Neutral import vocabulary supplements the generator's narrower bank rules.
    const value = normalize(tag);
    const rules = [
      ['quality', /\b(?:masterpiece|best quality|high quality|high resolution|ultra detailed|sharp focus|8k|4k)\b|高畫質|高解析|最佳品質/],
      ['styleRef', /\b(?:watercolor|oil painting|pencil sketch|charcoal drawing|pixel art|art nouveau|impressionism|photorealistic|cel shading)\b|水彩|油畫|像素風|鉛筆素描/],
      ['outfit', /\b(?:coat|jacket|shirt|blouse|sweater|hoodie|dress|skirt|trousers|pants|jeans|uniform|suit|vest|scarf|boots|shoes|sneakers|gloves|hat|cape|armor|kimono)\b|外套|襯衫|毛衣|長褲|裙子|洋裝|圍巾|靴子|帽子|盔甲/],
      ['pose', /\b(?:walking|standing|sitting|running|jumping|reading|holding|leaning|kneeling|crouching|dancing|looking at viewer|looking away|full body|upper body|close up|low angle|high angle|front view|side view|back view|camera angle)\b|站立|坐著|步行|走路|奔跑|跳躍|閱讀|手持|全身|半身|特寫|俯視|仰視/],
      ['face', /\b(?:smile|smiling|grin|grinning|frown|frowning|laughing|serious expression|calm expression|eyes|eyebrows|eyelashes|freckles|dimples)\b|微笑|笑容|眼睛|眉毛|睫毛|雀斑/],
      ['details', /\b(?:hair|hairstyle|ponytail|braids|beard|mustache|earrings|necklace|bracelet|tattoo|skin|wings|tail|horns)\b|頭髮|髮型|馬尾|辮子|鬍鬚|項鍊|耳環|手鍊|翅膀/],
      ['env', /\b(?:background|city|forest|mountains|ocean|beach|street|room|library|garden|rainy|snowy|sunlight|moonlight|daylight|lighting|sunset|sunrise|soft light|rim light|ambient light|fog|mist)\b|背景|城市|森林|山脈|海邊|街道|房間|圖書館|花園|雨天|雪景|陽光|月光|光線|夕陽|晨光/],
    ];
    return rules.find(([, pattern]) => pattern.test(value))?.[0] || classify(tag);
  }
  function convert(input, options) {
    const sections = options.sections;
    const split = value => {
      let depth = 0, normalized = '';
      for (const char of String(value)) {
        if ('([{'.includes(char)) depth++;
        if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
        normalized += depth === 0 && '，、；;'.includes(char) ? ',' : char;
      }
      return options.split(normalized).flatMap(tag => options.transform ? options.transform(tag) : [tag]);
    };
    const classify = options.classify;
    const key = options.key || normalize;
    const map = headings(sections);
    const buckets = Object.fromEntries(sections.map(section => [section.key, []]));
    const negative = [], metadata = [], warnings = [];
    let source = String(input || '').replace(/\r\n?/g, '\n').trim();
    if (!source) return { text: '', negative: '', metadata: '', slots: {}, count: 0, duplicates: 0, warnings: [] };
    if (source.startsWith('{')) {
      try {
        const json = JSON.parse(source);
        const positive = json.prompt ?? json.positive_prompt ?? json.positive;
        const excluded = json.negative_prompt ?? json.negative;
        if (typeof positive === 'string' || typeof excluded === 'string') {
          source = (typeof positive === 'string' ? positive : '') + (typeof excluded === 'string' ? '\nNegative prompt: ' + excluded : '');
          warnings.push('已讀取 JSON 的 prompt／negative_prompt；其他欄位不併入提示詞。');
        }
      } catch (_) { /* Non-JSON text stays intact. */ }
    }
    let current = null;
    function add(text) {
      if (current === 'metadata') { metadata.push(text); return; }
      if (current === 'negative') { negative.push(...split(text)); return; }
      for (const tag of split(text)) {
        const inferred = current || (options.infer ? options.infer(tag) : inferSection(tag, classify));
        const section = Object.hasOwn(buckets, inferred) ? inferred : 'details';
        if (!buckets[section]) continue;
        buckets[section].push(tag);
      }
    }
    for (const raw of source.split('\n')) {
      const line = raw.trim();
      if (!line || /^```(?:\w+)?\s*$/.test(line)) continue;
      if (/^(?:Steps|Sampler|Schedule type|CFG scale|Seed|Size|Model hash|Model|Clip skip|VAE|Denoising strength)\s*:/i.test(line)) {
        metadata.push(line);
        continue;
      }
      const heading = readHeading(line, map);
      if (heading) {
        current = heading.section === 'positive' ? null : heading.section;
        if (heading.content) add(heading.content);
        continue;
      }
      if (/^(?:\/\/|#{1,6}\s|❖\s|\*\*.+\*\*\s*[:：]?$|\[[^\]]+\]\s*$|【[^】]+】\s*$)/.test(line)) {
        current = 'details';
        // Unknown headings remain visible so their following text is never silently dropped.
        warnings.push('未辨識的標題已保留於角色細節：' + line.replace(/^\/\/\s*❖?\s*|^#+\s*|^❖\s*/, ''));
        buckets.details.push(line.replace(/^\/\/\s*❖?\s*|^#+\s*|^❖\s*/, ''));
        continue;
      }
      add(line);
    }
    let duplicates = 0;
    function dedupe(values) {
      const seen = new Set();
      return values.filter(tag => {
        if (/^(?:BREAK|AND)$/.test(tag)) return true;
        const id = key(tag);
        if (seen.has(id)) { duplicates++; return false; }
        seen.add(id);
        return true;
      });
    }
    const slots = {};
    let count = 0;
    for (const section of sections) {
      const tags = dedupe(buckets[section.key]);
      count += tags.length;
      if (tags.length) slots[section.key] = tags.join(', ');
    }
    const excluded = dedupe(negative).join(', ');
    if (/\b(?:BREAK|AND)\b/.test(source)) warnings.push('BREAK／AND 已保留；分段整理會改變原始排列，請檢查結果。');
    return { text: sections.filter(section => slots[section.key]).map(section => `// ❖ ${section.label}\n${slots[section.key]}`).join('\n\n'),
      negative: excluded, metadata: metadata.join('\n'), slots, count, duplicates, warnings };
  }
  const api = { convert };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoidPromptFormatter = api;
})(typeof window === 'undefined' ? globalThis : window);
