/* Offline, deterministic prompt classification. No model, credentials or network. */
(function (root) {
  'use strict';
  const sections = [
    { key: 'subject', label: 'Subject & Character', zh: '主體與角色' },
    { key: 'face', label: 'Facial Features', zh: '臉部特徵' },
    { key: 'details', label: 'Character Details', zh: '角色細節' },
    { key: 'outfit', label: 'Outfit', zh: '服裝' },
    { key: 'pose', label: 'Pose / Composition', zh: '姿勢／構圖' },
    { key: 'env', label: 'Environment & Lighting', zh: '環境與光線' },
    { key: 'styleRef', label: 'STYLE REFERENCES', zh: '風格參考' },
    { key: 'quality', label: 'QUALITY / TECHNICAL TAGS', zh: '品質標籤' },
  ];
  const rules = [
    ['quality', /\b(?:masterpiece|best quality|high quality|low quality|worst quality|normal quality|amazing quality|absurdres|highres|lowres|high resolution|ultra detailed|highly detailed|intricate details|sharp focus|8k|4k|hdr|render|rendering|ray tracing|anti aliasing|anatomy|score \d|source anime)\b|^<(?:lora|lyco|hypernet|embedding):/i],
    ['pose', /\b(?:holding|carrying|reaching|touching|walking|standing|sitting|running|jumping|reading|leaning|kneeling|crouching|dancing|lying|sleeping|flying|floating|arms?|hands?|legs?|feet|crossed|looking at viewer|looking away|looking back|looking up|looking down|full body|upper body|cowboy shot|portrait|close up|closeup|low angle|high angle|eye level|from above|from below|from behind|front view|side view|back view|profile|dutch angle|camera|composition|centered|symmetrical|rule of thirds|foreshortening|perspective)\b/i],
    ['face', /\b(?:eyes?|eyebrows?|eyelashes?|eyeliner|eyeshadow|pupils?|iris|irises|heterochromia|expression|smile|smiling|grin|grinning|frown|frowning|laughing|blush|blushing|freckles|dimples|tears?|crying|lips?|mouth|teeth|nose|fangs|makeup|gaze|serious|calm|angry|happy|sad|surprised|embarrassed)\b/i],
    ['details', /\b(?:hair|hairstyle|ponytail|twintails|braids?|bob cut|bangs|ahoge|beard|mustache|earrings?|necklace|bracelet|brooch|jewelry|jewellery|ribbon|hairpin|hairclip|glasses|goggles|headband|headphones|accessories|tattoo|scar|skin|wings?|tails?|horns?|cat ears|fox ears|animal ears|pointy ears|elf ears|kemonomimi|antennae)\b/i],
    ['outfit', /\b(?:coat|jacket|shirt|t shirt|blouse|sweater|hoodie|dress|skirt|trousers|pants|shorts|jeans|uniform|suit|vest|scarf|boots|shoes|sneakers|sandals|gloves|hat|cap|cape|cloak|armor|armour|kimono|yukata|robe|apron|belt|socks|stockings|tights|sleeves?|collar|hood|clothes|clothing|outfit|costume|fabric|leather|denim|silk|satin|velvet|lace|cotton|linen|wool|unbuttoned|unzipped)\b/i],
    ['env', /\b(?:background|city|forest|trees?|mountains?|ocean|sea|beach|street|road|alley|room|library|garden|flowers?|rain|rainy|snow|snowy|sunlight|moonlight|daylight|lighting|sunset|sunrise|dawn|dusk|night|daytime|golden hour|blue hour|soft light|hard light|rim light|backlight|backlit|ambient light|volumetric|shadows?|bokeh|depth of field|fog|mist|indoors|outdoors|interior|exterior|studio|window|bench|clouds?|sky|water|river|lake|castle|ruins?|cafe|café|neon|spotlight|light rays|light from|light source|sunbeam)\b/i],
    ['styleRef', /\b(?:watercolor|watercolour|oil painting|pencil sketch|charcoal|drawing|illustration|anime|manga|comic|cartoon|pixel art|art nouveau|impressionism|photorealistic|realistic|realism|semi realistic|cel shading|cell shading|flat color|lineart|line art|concept art|digital art|3d|2d|monochrome|grayscale|greyscale|palette|pastel|muted colors|vibrant colors|saturated|desaturated|warm tones|cool tones|cinematic|film grain|vintage|retro|gothic|surrealism|fantasy art|by [a-z])\b/i],
    ['subject', /\b(?:solo|duo|group|adult|adults|woman|women|man|men|girl|boy|person|people|character|traveler|traveller|warrior|mage|elf|human|robot|android|cyborg|knight|witch|young|middle aged|elderly|tall|short|slender|slim|muscular|athletic|petite|body|build|chibi|animal|cat|dog|dragon|creature)\b|\b\d+(?:girl|boy|woman|man|person)s?\b/i],
  ];
  const dictionary = {
    '成年女性': 'adult woman', '成年男性': 'adult man', '成年旅行者': 'adult traveler', '年輕女性': 'young woman', '年輕男性': 'young man',
    '成年人': 'adult', '成人': 'adult', '成年': 'adult', '女性': 'woman', '男性': 'man', '女人': 'woman', '男人': 'man', '旅行者': 'traveler', '旅人': 'traveler', '單人': 'solo', '獨自': 'solo', '兩人': 'duo', '高挑': 'tall', '纖細': 'slender', '健壯': 'muscular', '機器人': 'robot', '精靈': 'elf', '騎士': 'knight',
    '藍色眼睛': 'blue eyes', '紅色眼睛': 'red eyes', '綠色眼睛': 'green eyes', '金色眼睛': 'golden eyes', '棕色眼睛': 'brown eyes', '紫色眼睛': 'purple eyes', '藍眼': 'blue eyes', '紅眼': 'red eyes', '異色瞳': 'heterochromia', '微笑': 'smiling', '笑容': 'smile', '雀斑': 'freckles', '臉紅': 'blushing', '平靜表情': 'calm expression', '嚴肅表情': 'serious expression', '眼鏡': 'glasses',
    '銀色長髮': 'long silver hair', '黑色長髮': 'long black hair', '金色長髮': 'long blonde hair', '白色長髮': 'long white hair', '銀色短髮': 'short silver hair', '黑色短髮': 'short black hair', '長髮': 'long hair', '短髮': 'short hair', '銀髮': 'silver hair', '黑髮': 'black hair', '金髮': 'blonde hair', '白髮': 'white hair', '紅髮': 'red hair', '藍髮': 'blue hair', '雙馬尾': 'twintails', '馬尾': 'ponytail', '辮子': 'braid', '貓耳': 'cat ears', '狐耳': 'fox ears', '精靈耳': 'elf ears', '獸耳': 'animal ears', '尾巴': 'tail', '翅膀': 'wings', '耳環': 'earrings', '項鍊': 'necklace', '手鍊': 'bracelet', '胸針': 'brooch', '髮夾': 'hairclip', '蝴蝶結': 'ribbon',
    '藍色外套': 'blue coat', '黑色外套': 'black coat', '紅色洋裝': 'red dress', '白色洋裝': 'white dress', '白色襯衫': 'white shirt', '黑色長褲': 'black pants', '皮革外套': 'leather jacket', '牛仔外套': 'denim jacket', '長外套': 'long coat', '外套': 'coat', '襯衫': 'shirt', '毛衣': 'sweater', '長褲': 'pants', '短褲': 'shorts', '洋裝': 'dress', '裙子': 'skirt', '圍巾': 'scarf', '長靴': 'boots', '靴子': 'boots', '球鞋': 'sneakers', '帽子': 'hat', '手套': 'gloves', '盔甲': 'armor', '和服': 'kimono', '制服': 'uniform', '皮革': 'leather', '絲綢': 'silk', '棉質': 'cotton', '蕾絲': 'lace',
    '看向鏡頭': 'looking at viewer', '看著觀眾': 'looking at viewer', '站立': 'standing', '站著': 'standing', '坐著': 'sitting', '坐姿': 'sitting', '走路': 'walking', '行走': 'walking', '步行': 'walking', '奔跑': 'running', '跳躍': 'jumping', '閱讀': 'reading', '跳舞': 'dancing', '全身': 'full body', '半身': 'upper body', '特寫': 'close-up', '低角度': 'low angle', '高角度': 'high angle', '俯視': 'from above', '仰視': 'from below', '正面': 'front view', '側面': 'side view', '背面': 'back view', '居中構圖': 'centered composition', '對稱構圖': 'symmetrical composition',
    '雨天城市': 'rainy city', '城市街道': 'city street', '森林背景': 'forest background', '白色背景': 'white background', '簡單背景': 'simple background', '森林': 'forest', '城市': 'city', '街道': 'street', '房間': 'room', '圖書館': 'library', '花園': 'garden', '海邊': 'beach', '山脈': 'mountains', '室內': 'indoors', '室外': 'outdoors', '雨天': 'rainy', '下雨': 'rain', '雪景': 'snowy', '夜晚': 'night', '白天': 'daytime', '黃昏': 'dusk', '清晨': 'dawn', '夕陽': 'sunset', '日落': 'sunset', '日出': 'sunrise', '陽光': 'sunlight', '月光': 'moonlight', '柔和光線': 'soft lighting', '柔光': 'soft light', '逆光': 'backlighting', '輪廓光': 'rim light', '體積光': 'volumetric lighting', '電影光影': 'cinematic lighting', '淺景深': 'shallow depth of field', '景深': 'depth of field', '散景': 'bokeh', '薄霧': 'mist',
    '半寫實': 'semi-realistic', '寫實': 'realistic', '水彩': 'watercolor', '油畫': 'oil painting', '鉛筆素描': 'pencil sketch', '像素風': 'pixel art', '像素畫': 'pixel art', '動漫風格': 'anime style', '動漫': 'anime', '漫畫': 'manga', '插畫': 'illustration', '賽璐璐': 'cel shading', '低飽和色調': 'muted colors', '粉彩色調': 'pastel palette', '黑白': 'monochrome', '暖色調': 'warm tones', '冷色調': 'cool tones',
    '最佳品質': 'best quality', '高品質': 'high quality', '高畫質': 'high quality', '高解析度': 'high resolution', '高解析': 'high resolution', '超精細': 'ultra detailed', '精細細節': 'intricate details', '傑作': 'masterpiece',
    '模糊': 'blurry', '低畫質': 'low quality', '低解析度': 'low resolution', '浮水印': 'watermark',
  };
  const entries = Object.entries(dictionary).sort((a, b) => b[0].length - a[0].length);
  const englishOnly = text => !/[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\s]|\p{Extended_Pictographic}/u.test(text);
  const normalized = text => text.normalize('NFKC').toLowerCase().replace(/[_-]/g, ' ');
  function classify(tag) { return rules.find(([, pattern]) => pattern.test(normalized(tag)))?.[0] || null; }
  function englishPhrases(text) {
    if (/[()[\]{}<>]/.test(text) || !/\s/.test(text)) return [text];
    // Only unwrap plain prose; preserve weighted groups, model tokens and tag spelling.
    return text.replace(/[.!?]+$/, '').replace(/^[-*•]\s+/, '')
      .replace(/\s+\b(stands|sits|walks|runs|jumps|reads|dances)\b/gi, (_, verb) => ', ' + ({stands: 'standing', sits: 'sitting', walks: 'walking', runs: 'running', jumps: 'jumping', reads: 'reading', dances: 'dancing'})[verb.toLowerCase()])
      .replace(/\b(?:is|are)\s+(?=standing|sitting|walking|running|holding|wearing|reading|dancing)/gi, ', ')
      .replace(/\b(?:wearing|dressed in|featuring|with|while|has|have)\s+/gi, ', ')
      .replace(/\s+and\s+(?=[^,]*\b(?:hair|eyes|coat|dress|shirt|earrings|standing|sitting|lighting|smiling)\b)/gi, ', ')
      .replace(/\s+(?=(?:in|through|under|against|at|on)\s+(?:an?\s+|the\s+)?(?:rainy\s+|snowy\s+)?(?:forest|city|street|room|garden|beach|library|bench|night|sunset)\b)/gi, ', ')
      .split(',').map(part => part.trim().replace(/^(?:an?|the)\s+/i, '').replace(/^(?:is|are)\s+/i, '')).filter(Boolean);
  }
  function translate(fragment, unresolved) {
    if (englishOnly(fragment)) return englishPhrases(fragment);
    if (/[()[\]{}<>]/.test(fragment)) {
      const group = fragment.match(/^([([])([^()[\]{}<>:]+?)(:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))?([)\]])$/);
      if (group && ((group[1] === '(' && group[4] === ')') || (group[1] === '[' && group[4] === ']'))) {
        const pending = [];
        const tags = group[2].split(/[,，、;；]/).flatMap(part => translate(part.trim(), pending));
        if (!pending.length && tags.length) return [group[1] + tags.join(', ') + (group[3] || '') + group[4]];
      }
      unresolved.push(fragment);
      return [];
    }
    let rest = fragment.trim(), translated = [];
    while (rest) {
      const pair = entries.find(([zh]) => rest.startsWith(zh));
      if (pair) { translated.push(pair[1]); rest = rest.slice(pair[0].length); continue; }
      const filler = rest.match(/^(?:一位|一名|一個|一位|穿著|穿着|配戴|佩戴|帶著|留著|有著|以及|並且|正在|在|的|和|與|且|以|中|裡|\s+|[。！？]+)/);
      if (filler) { rest = rest.slice(filler[0].length); continue; }
      const english = rest.match(/^[\x20-\x7e]+/);
      if (english && english[0].trim()) { translated.push(...englishPhrases(english[0].trim())); rest = rest.slice(english[0].length); continue; }
      unresolved.push(fragment);
      return [];
    }
    return translated;
  }
  function render(fields) { return sections.map(s => `// ❖ ${s.label}\n${(fields[s.key] || []).join(', ')}`).join('\n\n'); }
  function local(text, deps) {
    const unresolved = [], uncertain = [];
    const parsed = deps.formatter.convert(text, {
      sections: [...sections, {key: 'job', label: 'JOB / Act', zh: 'JOB'}],
      split: deps.lexicon.split, key: deps.lexicon.key, transform: value => translate(value, unresolved),
      classify: tag => classify(tag) || 'subject',
      infer: tag => { const key = classify(tag); if (!key) uncertain.push(tag); return key || 'subject'; },
    });
    const fields = {};
    for (const section of sections) {
      const value = [parsed.slots[section.key], section.key === 'pose' ? parsed.slots.job : ''].filter(Boolean).join(', ');
      const seen = new Set();
      fields[section.key] = deps.lexicon.split(value).filter(tag => {
        if (!englishOnly(tag)) { unresolved.push(tag); return false; }
        if (/^(?:BREAK|AND)$/.test(tag)) return true;
        const id = deps.lexicon.key(tag);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
    return {fields, text: render(fields), negative: parsed.negative, count: Object.values(fields).flat().length,
      warnings: parsed.warnings, unresolved: [...new Set(unresolved)], uncertain: [...new Set(uncertain)], method: 'local'};
  }
  const api = {sections, englishOnly, classify, render, local};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoidPFormat = api;
})(typeof window === 'undefined' ? globalThis : window);
