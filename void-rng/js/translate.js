/* VOID.RNG — 中文 → 英文 Prompt 翻譯（辭庫詞典 + 可選 Grok） */
(function (global) {
  'use strict';

  const STORAGE_API_KEY = 'void-grok-api-key';
  const CHAT_URL = '/chat';

  let dictEntries = [];
  let ready = false;

  function hasCjk(text) {
    return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text || '');
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addEntry(zh, en, section, source) {
    const phrase = String(zh || '').trim();
    const tags = Array.isArray(en) ? en.filter(Boolean) : [String(en || '').trim()].filter(Boolean);
    if (!phrase || !tags.length) return;
    dictEntries.push({
      zh: phrase,
      en: tags[0],
      enAll: tags,
      section: section || 'subject',
      source: source || 'dict',
      len: phrase.length,
    });
  }

  function ingestThemeKw(themeKw) {
    if (!themeKw) return;
    Object.entries(themeKw).forEach(([section, map]) => {
      Object.entries(map || {}).forEach(([label, hints]) => {
        const textHints = (hints || []).filter(h => h && !String(h).startsWith('mode:') && !String(h).startsWith('cat:'));
        if (textHints.length) addEntry(label, textHints, section, 'theme');
      });
    });
  }

  function ingestAliases(aliases) {
    Object.entries(aliases || {}).forEach(([en, zh]) => {
      if (zh && en) addEntry(zh, en, 'subject', 'alias');
    });
  }

  const BODY_EN = {
    petite: 'petite body', slim: 'slim figure', average: 'average build', tall: 'tall slender',
    curvy: 'curvy figure', athletic: 'athletic build',
    flat: 'flat chest', small: 'small breasts', medium: 'medium breasts, natural bust',
    large: 'large breasts', huge: 'huge breasts',
    slim_waist: 'slim waist', wide_hips: 'wide hips', long_legs: 'long legs',
    thick_thighs: 'thick thighs', hourglass: 'hourglass figure', girlish: 'girlish charm',
  };

  function ingestSearchRules(rules) {
    (rules || []).forEach(rule => {
      const fx = rule.effects || {};
      const hints = fx.hints || {};
      const zhKeys = (rule.keys || []).filter(k => hasCjk(k) && !k.startsWith('^'));
      const hintTags = Object.values(hints).flat().filter(Boolean);
      const bodyTags = [
        ...(fx.bodyFrame || []).map(id => BODY_EN[id]).filter(Boolean),
        ...(fx.bodyBreast || []).map(id => BODY_EN[id]).filter(Boolean),
        ...(fx.bodyFigure || []).map(id => BODY_EN[id]).filter(Boolean),
      ];
      const enTags = [...new Set([...hintTags, ...bodyTags])];
      zhKeys.forEach(key => {
        if (enTags.length) addEntry(key, enTags, Object.keys(hints)[0] || 'subject', 'rule');
      });
      const labelZh = String(rule.label || '').replace(/^[^·]*·\s*/, '').trim();
      if (labelZh && hasCjk(labelZh) && enTags.length) {
        addEntry(labelZh, enTags, Object.keys(hints)[0] || 'subject', 'rule-label');
      }
    });
  }

  function dedupeDict() {
    const seen = new Set();
    dictEntries = dictEntries
      .filter(e => {
        const k = `${e.zh}::${e.en}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.len - a.len || a.zh.localeCompare(b.zh, 'zh-Hant'));
  }

  async function loadDict() {
    dictEntries = [];
    try {
      const [themeRes, rulesRes] = await Promise.all([
        fetch('data/theme-kw.json').then(r => r.ok ? r.json() : null),
        fetch('data/prompt-search-rules.json').then(r => r.ok ? r.json() : null),
      ]);
      ingestThemeKw(themeRes);
      ingestAliases(rulesRes?.aliases);
      ingestSearchRules(rulesRes?.rules);
    } catch (e) {
      console.warn('VoidTranslate: dict load failed', e);
    }
    dedupeDict();
    ready = true;
  }

  function normalizeZhInput(text) {
    return String(text || '')
      .replace(/[，、；;|｜/／]+/g, ' ')
      .replace(/[。！？!?.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function translateLocal(text) {
    const raw = normalizeZhInput(text);
    if (!raw) return { english: '', segments: [], unmatched: [], tags: [] };

    const segments = [];
    const tags = [];
    const unmatched = [];

    const parts = raw.split(/[\s+]+/).filter(Boolean);
    parts.forEach(part => {
      if (!hasCjk(part)) {
        part.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.push(t));
        segments.push({ zh: part, en: part, section: 'raw', source: 'latin' });
        return;
      }

      let i = 0;
      const compact = part.replace(/\s/g, '');
      while (i < compact.length) {
        let hit = null;
        for (const entry of dictEntries) {
          if (compact.startsWith(entry.zh, i)) {
            hit = entry;
            break;
          }
        }
        if (hit) {
          segments.push(hit);
          tags.push(hit.en);
          i += hit.zh.length;
        } else {
          let unknown = compact[i];
          i += 1;
          while (i < compact.length) {
            let subHit = null;
            for (const entry of dictEntries) {
              if (compact.startsWith(entry.zh, i)) { subHit = entry; break; }
            }
            if (subHit) break;
            unknown += compact[i];
            i += 1;
          }
          if (unknown) unmatched.push(unknown);
        }
      }
    });

    const uniqueTags = [...new Set(tags.map(t => t.trim()).filter(Boolean))];
    return {
      english: uniqueTags.join(', '),
      segments,
      unmatched: [...new Set(unmatched)],
      tags: uniqueTags,
    };
  }

  function getApiKey() {
    return (localStorage.getItem(STORAGE_API_KEY) || '').trim();
  }

  function setApiKey(key) {
    const k = String(key || '').trim();
    if (k) localStorage.setItem(STORAGE_API_KEY, k);
    else localStorage.removeItem(STORAGE_API_KEY);
  }

  async function translateWithGrok(text, apiKey) {
    const key = (apiKey || getApiKey()).trim();
    if (!key) return null;
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        model: 'grok-3-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You translate Chinese image-generation descriptions into English Danbooru/Stable Diffusion prompt tags. Output ONLY comma-separated English tags. No Chinese, no explanation, no quotes.',
          },
          { role: 'user', content: text },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const content = data?.choices?.[0]?.message?.content?.trim() || '';
    const tags = content
      .replace(/^["'`]+|["'`]+$/g, '')
      .split(/[,，\n]/)
      .map(t => t.trim())
      .filter(Boolean);
    return { english: tags.join(', '), segments: [], unmatched: [], tags, source: 'grok' };
  }

  async function translate(text, opts = {}) {
    if (!ready) await loadDict();
    const local = translateLocal(text);
    const needGrok = opts.forceGrok
      || (opts.preferGrok && getApiKey())
      || (local.unmatched.length > 0 && getApiKey() && !opts.localOnly);

    if (!needGrok) return { ...local, method: 'local' };

    try {
      const grok = await translateWithGrok(text, opts.apiKey);
      if (grok?.tags?.length) {
        return {
          ...grok,
          method: 'grok',
          localFallback: local.english,
          unmatched: local.unmatched,
        };
      }
    } catch (e) {
      if (opts.forceGrok) throw e;
      console.warn('VoidTranslate: Grok failed, using local', e);
    }
    return { ...local, method: 'local' };
  }

  function renderPreview(el, result) {
    if (!el) return;
    if (!result?.english) {
      el.classList.add('empty');
      el.innerHTML = '輸入中文後顯示英文標籤預覽…';
      return;
    }
    el.classList.remove('empty');
    const methodLabel = result.method === 'grok' ? 'Grok 翻譯' : '辭庫對照';
    const segHtml = (result.segments || []).slice(0, 12).map(s =>
      `<span class="search-translate-seg" title="${escHtml(s.source || '')}">${escHtml(s.zh)}→${escHtml(s.en)}</span>`
    ).join('');
    const unmatched = result.unmatched?.length
      ? `<div class="search-translate-warn">未收錄：${escHtml(result.unmatched.join('、'))}${getApiKey() ? '' : ' · 可設定 Grok API 加強'}</div>`
      : '';
    el.innerHTML =
      `<div class="search-translate-head"><span>${methodLabel}</span><span class="search-translate-en">${escHtml(result.english)}</span></div>` +
      (segHtml ? `<div class="search-translate-segs">${segHtml}</div>` : '') +
      unmatched;
  }

  function addDictEntry(zh, en, section) {
    const tags = Array.isArray(en) ? en : [String(en || '').trim()];
    const phrase = String(zh || '').trim();
    if (!phrase || !tags.length) return false;
    addEntry(phrase, tags, section || 'subject', 'user');
    dedupeDict();
    return true;
  }

  function init() {
    return loadDict();
  }

  global.VoidTranslate = {
    init,
    loadDict,
    translate,
    translateLocal,
    addDictEntry,
    hasCjk,
    getApiKey,
    setApiKey,
    renderPreview,
    ready: () => ready,
  };
})(window);