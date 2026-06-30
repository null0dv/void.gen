/* VOID.RNG — 關鍵字搜尋引擎（外置規則 JSON + 三頁共用） */
(function (global) {
  'use strict';

  const BODY_LABEL_MAP = {
    none: '不篩選',
    petite: '嬌小', slim: '纖細', average: '標準', tall: '高挑', curvy: '豐滿', athletic: '運動', chubby: '微胖',
    flat: '貧乳', small: '小胸', medium: '中胸', large: '大胸', huge: '巨乳',
    slim_waist: '細腰', wide_hips: '寬臀', long_legs: '長腿', thick_thighs: '肉腿', hourglass: '沙漏', girlish: '少女感',
    petite_cute: '嬌小可愛', model_slim: '纖細長腿', curvy_sexy: '豐滿色氣', athletic_fit: '運動健美',
    plush_soft: '肉感豐腴', petite_flat: '清純貧乳', busty_nsfw: '巨乳色氣', mature_onee: '御姐高挑',
  };

  function bodyIdsToLabels(ids) {
    return [...ids].map(id => BODY_LABEL_MAP[id] || id).join('+');
  }

  const THEME_BODY_MAP = {
    subject: {
      '嬌小': { bodyFrame: ['petite'] },
      '纖細': { bodyFrame: ['slim'] },
      '高挑': { bodyFrame: ['tall'], bodyFigure: ['long_legs'] },
      '豐滿': { bodyFrame: ['curvy'], bodyFigure: ['wide_hips'] },
      '運動': { bodyFrame: ['athletic'], bodyFigure: ['slim_waist'] },
      '微胖': { bodyFrame: ['chubby'], bodyFigure: ['thick_thighs'] },
      '小胸': { bodyBreast: ['small'] },
      '貧乳': { bodyBreast: ['flat'] },
      '中胸': { bodyBreast: ['medium'] },
      '大胸': { bodyBreast: ['large'] },
      '巨乳': { bodyBreast: ['huge'] },
    },
    details: {
      '細腰': { bodyFigure: ['slim_waist'] },
      '寬臀': { bodyFigure: ['wide_hips'] },
      '長腿': { bodyFigure: ['long_legs'] },
      '肉腿': { bodyFigure: ['thick_thighs'] },
      '沙漏': { bodyFigure: ['hourglass', 'slim_waist', 'wide_hips'] },
      '少女感': { bodyFigure: ['girlish'] },
    },
  };

  const STORAGE_CUSTOM = 'void-search-custom-rules';
  const STORAGE_PINNED = 'void-search-pinned';
  const STORAGE_FILL_MODE = 'void-search-fill-mode';

  let config = { aliases: {}, quick: [], hotGroups: [], rules: [] };
  let themeKw = {};
  let learnedThemeRules = [];
  let handlers = {};
  let state = {
    page: 'char',
    recent: [],
    lastQuery: '',
    hitIndex: 0,
    lastMatches: [],
    lastPlan: null,
    lastTranslate: null,
    fillMode: localStorage.getItem(STORAGE_FILL_MODE) || 'smart',
    debounceTimer: null,
    translateDebounce: null,
    collapsed: false,
  };

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createEffects() {
    return {
      preset: null,
      tone: null,
      intensity: null,
      mode: null,
      posePresets: new Set(),
      jobTypes: null,
      bodyCombo: null,
      bodyReset: false,
      bodyFrame: null,
      bodyBreast: null,
      bodyFigure: null,
      spicyOutfits: null,
      spicyActions: null,
      sectionHints: {},
      reroll: new Set(),
      regenerate: false,
      unlockAll: false,
      fillMode: null,
      action: null,
      styleMode: null,
      styleLang: null,
      jewelCats: new Set(),
      negativeHints: [],
      actions: [],
      matchedRuleIds: [],
    };
  }

  function mergeRuleEffects(e, rule) {
    const fx = rule.effects || {};
    if (fx.preset) e.preset = fx.preset;
    if (fx.tone) e.tone = fx.tone;
    if (fx.intensity) e.intensity = fx.intensity;
    if (fx.mode) e.mode = fx.mode;
    if (fx.fillMode) e.fillMode = fx.fillMode;
    if (fx.action) e.action = fx.action;
    if (fx.unlockAll) e.unlockAll = true;
    if (fx.regenerate) e.regenerate = true;
    if (fx.styleMode) e.styleMode = fx.styleMode;
    if (fx.styleLang) e.styleLang = fx.styleLang;
    if (fx.posePresets) fx.posePresets.forEach(id => e.posePresets.add(id));
    if (fx.jobTypes) e.jobTypes = new Set(fx.jobTypes);
    if (fx.bodyCombo) e.bodyCombo = fx.bodyCombo;
    if (fx.bodyReset) e.bodyReset = true;
    if (fx.bodyFrame) {
      if (!e.bodyFrame) e.bodyFrame = new Set();
      fx.bodyFrame.forEach(id => e.bodyFrame.add(id));
    }
    if (fx.bodyBreast) {
      if (!e.bodyBreast) e.bodyBreast = new Set();
      fx.bodyBreast.forEach(id => e.bodyBreast.add(id));
    }
    if (fx.bodyFigure) {
      if (!e.bodyFigure) e.bodyFigure = new Set();
      fx.bodyFigure.forEach(id => e.bodyFigure.add(id));
    }
    if (fx.spicyOutfits) {
      if (!e.spicyOutfits) e.spicyOutfits = new Set();
      fx.spicyOutfits.forEach(id => e.spicyOutfits.add(id));
    }
    if (fx.spicyActions) {
      if (!e.spicyActions) e.spicyActions = new Set();
      fx.spicyActions.forEach(id => e.spicyActions.add(id));
    }
    if (fx.jewelCats) fx.jewelCats.forEach(id => e.jewelCats.add(id));
    if (fx.reroll) fx.reroll.forEach(k => e.reroll.add(k));
    if (fx.hints) {
      Object.entries(fx.hints).forEach(([sec, hints]) => pushHints(e, sec, hints));
    }
    if (fx.negative) pushHints(e, 'negative', fx.negative);
    e.actions.push(rule.label);
    e.matchedRuleIds.push(rule.id);
  }

  function pushHints(e, section, hints) {
    if (!hints?.length) return;
    if (!e.sectionHints[section]) e.sectionHints[section] = [];
    hints.forEach(h => {
      if (!e.sectionHints[section].includes(h)) e.sectionHints[section].push(h);
    });
  }

  function normalizeQuery(raw) {
    let q = String(raw || '').trim();
    const aliases = config.aliases || {};
    Object.entries(aliases).forEach(([en, zh]) => {
      const re = new RegExp(`\\b${en}\\b`, 'gi');
      q = q.replace(re, zh);
    });
    return q;
  }

  function getAllRules(page) {
    const base = [...(config.rules || []), ...loadCustomRules()];
    const themeRules = buildThemeRules(page);
    return [...base, ...themeRules, ...learnedThemeRules];
  }

  function buildThemeRules(page) {
    const rules = [];
    const map = themeKw || {};
    const pageMap = {
      char: ['outfit', 'subject', 'details', 'pose', 'env', 'styleRef', 'quality', 'negative'],
      style: ['style', 'quality', 'negative'],
      jewel: ['jewel', 'quality', 'negative'],
    };
    const sections = pageMap[page] || pageMap.char;
    const secZh = {
      outfit: '服裝', subject: '角色', details: '細節', pose: '姿勢', env: '場景',
      styleRef: '畫風', quality: '品質', negative: '負向', style: '風格', jewel: '飾品',
    };
    sections.forEach(section => {
      const theme = map[section];
      if (!theme) return;
      Object.entries(theme).forEach(([label, hints]) => {
        const effects = { hints: {} };
        if (section === 'style' && hints[0]?.startsWith('mode:')) {
          effects.styleMode = hints[0].slice(5);
        } else if (section === 'jewel' && hints.some(h => h.startsWith('cat:'))) {
          effects.jewelCats = hints.filter(h => h.startsWith('cat:')).map(h => h.slice(4));
          const textHints = hints.filter(h => !h.startsWith('cat:'));
          if (textHints.length) effects.hints = { [section]: textHints };
        } else if (section === 'negative') {
          effects.negative = hints;
        } else {
          effects.hints[section === 'jewel' ? 'jewel' : section] = hints.filter(h => !h.startsWith('cat:'));
          const bodyFx = THEME_BODY_MAP[section]?.[label];
          if (bodyFx) {
            if (bodyFx.bodyFrame) effects.bodyFrame = bodyFx.bodyFrame;
            if (bodyFx.bodyBreast) effects.bodyBreast = bodyFx.bodyBreast;
            if (bodyFx.bodyFigure) effects.bodyFigure = bodyFx.bodyFigure;
          }
        }
        rules.push({
          id: `theme_${section}_${label}`,
          group: '主題',
          label: `${secZh[section] || section} · ${label}`,
          desc: (Array.isArray(hints) ? hints : []).slice(0, 3).join(', '),
          keys: [label],
          weight: section === 'negative' ? 3 : 4,
          effects,
        });
      });
    });
    return rules;
  }

  function keyMatchesQuery(key, qLower, tokens) {
    const isExact = key.startsWith('^') && key.endsWith('$');
    const pat = isExact ? key.slice(1, -1).toLowerCase() : key.toLowerCase();
    if (isExact) {
      return tokens.some(t => t.toLowerCase() === pat) || qLower === pat;
    }
    if (qLower.includes(pat)) return true;
    return tokens.some(t => {
      const tl = t.toLowerCase();
      if (tl === pat || tl.includes(pat)) return true;
      if (pat.includes(tl)) {
        if (/[\u4e00-\u9fff]/.test(pat)) return tl.length >= 1;
        return pat.split(/\s+/).includes(tl);
      }
      return false;
    });
  }

  function ruleMatchesQuery(rule, qLower, tokens) {
    if (rule.requires?.length) {
      const ok = rule.requires.some(req =>
        qLower.includes(req.toLowerCase()) || tokens.some(t => t.toLowerCase().includes(req.toLowerCase()))
      );
      if (!ok) return null;
    }
    if (rule.pattern) {
      const m = qLower.match(new RegExp(rule.pattern, 'i'));
      if (m) return { rule, score: rule.weight || 5, hitKeys: [m[0]], intensity: +(m[1] || 0) || null };
    }
    let score = 0;
    const hitKeys = [];
    for (const key of rule.keys || []) {
      if (keyMatchesQuery(key, qLower, tokens)) {
        score += rule.weight || 1;
        hitKeys.push(key);
      }
    }
    return score > 0 ? { rule, score, hitKeys } : null;
  }

  const SAFE_SELFIE_POSE_IDS = new Set([
    'cute_outfit_normal', 'cute_outfit_underwear', 'cute_outfit_sleepwear',
    'tempt_high_collar', 'tempt_low_upskirt', 'tempt_sit_legs', 'tempt_jump_skirt',
  ]);
  const POSE_PRESET_LABELS = {
    cute_outfit_normal: '正常服裝', cute_outfit_underwear: '內衣', cute_outfit_sleepwear: '性感睡衣',
    tempt_high_collar: '高角度', tempt_low_upskirt: '低角度', tempt_sit_legs: '坐姿露腿', tempt_jump_skirt: '跳躍',
  };

  function resolvePoseJobMutex(effects) {
    if (!effects.jobTypes?.size || effects.jobTypes.has('none')) return;
    if (!effects.posePresets?.size) return;
    const cleared = [...effects.posePresets].filter(id => SAFE_SELFIE_POSE_IDS.has(id));
    if (!cleared.length) return;
    cleared.forEach(id => effects.posePresets.delete(id));
    if (!effects.posePresets.size) effects.posePresets.add('all');
    effects._poseClearedForJob = cleared.map(id => POSE_PRESET_LABELS[id] || id);
  }

  function detectConflicts(matches, effects) {
    const conflicts = [];
    const tones = matches.filter(m => m.rule.effects?.tone).map(m => m.rule.effects.tone);
    if (new Set(tones).size > 1) conflicts.push(`調性衝突：${tones.join(' vs ')}（採用最高權重）`);
    const presets = matches.filter(m => m.rule.isPreset).map(m => m.rule.label);
    if (presets.length > 1) conflicts.push(`預設衝突：${presets.join(' vs ')}（僅套用最高分）`);
    if (effects.jobTypes?.has('none') && matches.some(m => m.rule.effects?.jobTypes?.some(j => j !== 'none'))) {
      conflicts.push('JOB 衝突：無 vs 有（採用有 JOB 的規則）');
    }
    if (effects._poseClearedForJob?.length) {
      const jobs = effects.jobTypes ? [...effects.jobTypes].filter(j => j !== 'none').join('+') : '';
      conflicts.push(`POSE·自拍（${effects._poseClearedForJob.join('+')}）與 JOB（${jobs || '有'}）衝突（已清除自拍預設，保留 JOB）`);
    }
    const cute = effects.posePresets && [...effects.posePresets].some(id => id.startsWith('cute_'));
    if (cute && effects.tone === 'sex') conflicts.push('調性衝突：可愛自拍 vs SEX（建議降低調性）');
    return conflicts;
  }

  function applyMutexRules(matches, effects) {
    const byMutex = {};
    matches.forEach(m => {
      const mx = m.rule.mutex;
      if (!mx) return;
      if (!byMutex[mx] || m.score > byMutex[mx].score) byMutex[mx] = m;
    });
    const keepIds = new Set(matches.filter(m => !m.rule.mutex).map(m => m.rule.id));
    Object.values(byMutex).forEach(m => keepIds.add(m.rule.id));
    return matches.filter(m => keepIds.has(m.rule.id));
  }

  function parseIntensityFromQuery(q) {
    const m = q.match(/(?:可愛|色氣|誘惑|sex|強度|lv|level)\s*([1-5])/i);
    return m ? +m[1] : null;
  }

  function parseSearchQuery(query, page) {
    const qRaw = normalizeQuery(query);
    const qLower = qRaw.toLowerCase();
    const tokens = qRaw.split(/[\s,，、+]+/).filter(Boolean);
    const effects = createEffects();
    let matches = [];

    getAllRules(page).forEach(rule => {
      const m = ruleMatchesQuery(rule, qLower, tokens);
      if (m) {
        if (m.intensity) effects.intensity = m.intensity;
        matches.push(m);
      }
    });

    const intensity = parseIntensityFromQuery(qRaw);
    if (intensity) effects.intensity = intensity;

    matches.sort((a, b) => b.score - a.score);
    matches = applyMutexRules(matches, effects);

    let presetApplied = false;
    matches.forEach(m => {
      if (m.rule.isPreset) {
        if (!presetApplied) {
          mergeRuleEffects(effects, m.rule);
          presetApplied = true;
        }
      } else {
        mergeRuleEffects(effects, m.rule);
      }
    });

    if (effects.jobTypes?.size && !effects.jobTypes.has('none')) {
      const noneRule = matches.find(m => m.rule.effects?.jobTypes?.includes('none'));
      if (noneRule && matches.some(m => m.rule.effects?.jobTypes?.some(j => j !== 'none'))) {
        effects.jobTypes.delete('none');
      }
    }

    if (!matches.length && qRaw.length >= 2) {
      if (page === 'char') pushHints(effects, 'subject', [qRaw]);
      else if (page === 'style') pushHints(effects, 'subject', [qRaw]);
      else pushHints(effects, 'jewel', [qRaw]);
      effects.actions.push('自由描述');
    }

    if (page === 'char') resolvePoseJobMutex(effects);
    const conflicts = detectConflicts(matches, effects);
    return { effects, matches, query: qRaw, conflicts };
  }

  function buildPlanSummary(parsed, page) {
    const { effects, conflicts } = parsed;
    const parts = [];
    if (effects.preset) parts.push(`預設·${effects.preset}`);
    if (effects.tone) parts.push(`調性·${effects.tone}`);
    if (effects.intensity) parts.push(`強度·Lv${effects.intensity}`);
    if (effects.posePresets.size) parts.push(`姿勢·${[...effects.posePresets].join('+')}`);
    if (effects.jobTypes) parts.push(`JOB·${[...effects.jobTypes].join('+')}`);
    if (effects.bodyCombo) parts.push(`身材·${BODY_LABEL_MAP[effects.bodyCombo] || effects.bodyCombo}`);
    if (effects.bodyFrame?.size) parts.push(`體型·${bodyIdsToLabels(effects.bodyFrame)}`);
    if (effects.bodyBreast?.size) parts.push(`胸部·${bodyIdsToLabels(effects.bodyBreast)}`);
    if (effects.bodyFigure?.size) parts.push(`身材·${bodyIdsToLabels(effects.bodyFigure)}`);
    if (effects.bodyReset) parts.push('身材·清除');
    if (effects.spicyOutfits?.size) parts.push(`色氣裝·${[...effects.spicyOutfits].join('+')}`);
    if (effects.spicyActions?.size) parts.push(`瑟瑟·${[...effects.spicyActions].join('+')}`);
    if (effects.styleMode) parts.push(`風格模式·${effects.styleMode}`);
    if (effects.jewelCats.size) parts.push(`飾品類·${[...effects.jewelCats].join('+')}`);
    Object.entries(effects.sectionHints).forEach(([k, v]) => {
      if (v.length) parts.push(`${k}（${v.slice(0, 2).join(', ')}）`);
    });
    if (effects.negativeHints?.length || effects.sectionHints.negative?.length) {
      parts.push('負向標籤');
    }
    if (effects.regenerate) parts.push('重抽全部');
    effects.reroll.forEach(r => parts.push(`重抽·${r}`));
    const fill = effects.fillMode || state.fillMode;
    parts.push(`補齊·${fill === 'hit' ? '僅命中' : fill === 'full' ? '全部重抽' : '智慧補齊'}`);
    return { parts, conflicts, page };
  }

  function loadCustomRules() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_CUSTOM) || '[]');
    } catch { return []; }
  }

  function saveCustomRule(rule) {
    const rules = loadCustomRules();
    rules.push({
      id: 'custom_' + Date.now(),
      group: '自訂',
      label: rule.label || rule.keys?.[0] || '自訂規則',
      keys: rule.keys || [],
      weight: 6,
      effects: rule.effects || { hints: rule.hints || {} },
    });
    localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(rules.slice(-50)));
    toast('已新增自訂規則');
  }

  function loadPinned() {
    try { return JSON.parse(localStorage.getItem(STORAGE_PINNED) || '[]'); }
    catch { return []; }
  }

  function savePinned(list) {
    localStorage.setItem(STORAGE_PINNED, JSON.stringify(list.slice(0, 20)));
  }

  function togglePin(query) {
    const pinned = loadPinned();
    const i = pinned.indexOf(query);
    if (i >= 0) pinned.splice(i, 1);
    else pinned.unshift(query);
    savePinned(pinned);
    renderUI();
  }

  function rebuildLearnedRules(getLearnedTags) {
    if (typeof getLearnedTags !== 'function') return;
    const tags = getLearnedTags();
    learnedThemeRules = tags.slice(0, 30).map((t, i) => ({
      id: `learned_${i}`,
      group: '學習辭庫',
      label: `學習 · ${t.label}`,
      keys: [t.label],
      weight: 3,
      effects: { hints: { [t.section]: t.hints } },
    }));
  }

  async function loadConfig() {
    try {
      const [rulesRes, themeRes] = await Promise.all([
        fetch('data/prompt-search-rules.json').then(r => r.ok ? r.json() : null),
        fetch('data/theme-kw.json').then(r => r.ok ? r.json() : null),
      ]);
      if (rulesRes) config = { ...config, ...rulesRes };
      if (themeRes) themeKw = themeRes;
    } catch (e) {
      console.warn('VoidSearch: JSON load failed, using inline fallback', e);
    }
  }

  function getEl(id) { return document.getElementById(id); }

  function renderHits(matches, query) {
    const box = getEl('prompt-search-hits');
    if (!box) return;
    if (!query) {
      box.innerHTML = '';
      return;
    }
    if (!matches.length) {
      box.innerHTML = '<div class="search-plan empty">無完全符合的規則，Enter 將以描述填入</div>';
      return;
    }
    const seen = new Set();
    const unique = matches.filter(m => {
      if (seen.has(m.rule.id)) return false;
      seen.add(m.rule.id);
      return true;
    }).slice(0, 8);
    const pinned = loadPinned();
    box.innerHTML = unique.map((m, i) =>
      `<div class="search-hit${i === state.hitIndex ? ' on' : ''}" data-idx="${i}" onclick="VoidSearch.pickHit(${i})">
        <div class="search-hit-title">${escHtml(m.rule.label)}</div>
        <div class="search-hit-meta">
          <span>${escHtml(m.rule.group)}</span>
          ${m.hitKeys.slice(0, 3).map(k => `<span class="search-hit-kw">${escHtml(k.replace(/^\^|\$$/g, ''))}</span>`).join('')}
          <span class="search-hit-pin${pinned.includes(query) ? ' on' : ''}" onclick="event.stopPropagation();VoidSearch.togglePin(${JSON.stringify(query)})" title="釘選快捷詞">★</span>
        </div>
      </div>`
    ).join('');
  }

  function renderHotGroups() {
    const box = getEl('prompt-search-hits');
    if (!box) return;
    const groups = config.hotGroups || [];
    box.innerHTML = groups.map(g =>
      `<div class="search-hot-groups">
        <div class="search-hot-group-lbl">${escHtml(g.label)}</div>
        <div class="search-quick">${(g.items || []).map(item =>
          `<span class="search-qchip" onclick="VoidSearch.quickSearch(${JSON.stringify(item)})">${escHtml(item)}</span>`
        ).join('')}</div>
      </div>`
    ).join('');
  }

  function renderQuick() {
    const el = getEl('prompt-search-quick');
    if (!el) return;
    const pinned = loadPinned();
    const chips = [...new Set([...pinned, ...state.recent.slice(0, 4), ...(config.quick || [])])].slice(0, 12);
    el.innerHTML = chips.map(q => {
      const isPinned = pinned.includes(q);
      return `<span class="search-qchip${isPinned ? ' pinned' : ''}" onclick="VoidSearch.quickSearch(${JSON.stringify(q)})">${escHtml(q)}${isPinned ? `<span class="unpin" onclick="event.stopPropagation();VoidSearch.togglePin(${JSON.stringify(q)})">×</span>` : ''}</span>`;
    }).join('');
  }

  function renderPlan(parsed) {
    const planEl = getEl('prompt-search-plan');
    const statusEl = getEl('prompt-search-status');
    if (!planEl) return;
    if (!parsed) {
      planEl.textContent = '輸入關鍵字後顯示將更新的區塊…';
      planEl.classList.add('empty');
      if (statusEl) statusEl.textContent = '輸入關鍵字，自動比對並補齊完整 Prompt';
      return;
    }
    const { parts, conflicts } = buildPlanSummary(parsed, state.page);
    planEl.classList.remove('empty');
    planEl.innerHTML = parts.length
      ? `將更新：${escHtml(parts.join(' · '))}${conflicts.length ? `<div class="search-conflicts">⚠ ${escHtml(conflicts.join(' · '))}</div>` : ''}`
      : '（無明確匹配）';
    if (statusEl) {
      statusEl.textContent = parsed.matches.length
        ? `找到 ${parsed.matches.length} 條規則 · 預覽後按「套用」`
        : '無規則匹配，套用將以描述填入';
      statusEl.classList.toggle('warn', conflicts.length > 0);
    }
    state.lastPlan = parsed;
  }

  function renderTranslatePreview(result) {
    const el = getEl('prompt-search-translate');
    if (!el || typeof global.VoidTranslate === 'undefined') return;
    global.VoidTranslate.renderPreview(el, result);
    state.lastTranslate = result;
  }

  function clearTranslatePreview() {
    state.lastTranslate = null;
    const el = getEl('prompt-search-translate');
    if (!el) return;
    el.classList.add('empty');
    el.textContent = '輸入中文後顯示英文標籤預覽…';
  }

  function scheduleTranslatePreview(query) {
    clearTimeout(state.translateDebounce);
    if (!query || typeof global.VoidTranslate === 'undefined' || !global.VoidTranslate.hasCjk(query)) {
      clearTranslatePreview();
      return;
    }
    state.translateDebounce = setTimeout(async () => {
      try {
        const result = await global.VoidTranslate.translate(query, { localOnly: true });
        renderTranslatePreview(result);
      } catch (e) {
        console.warn('VoidSearch: translate preview failed', e);
      }
    }, 280);
  }

  function onInput() {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      const query = getEl('prompt-search-input')?.value?.trim() || '';
      if (!query) {
        renderHotGroups();
        renderPlan(null);
        clearTranslatePreview();
        getEl('prompt-search-status').textContent = '點選下方熱門組合，或輸入關鍵字';
        state.lastMatches = [];
        return;
      }
      const parsed = parseSearchQuery(query, state.page);
      state.lastMatches = parsed.matches;
      state.hitIndex = 0;
      renderHits(parsed.matches, query);
      renderPlan(parsed);
      scheduleTranslatePreview(query);
      const statusEl = getEl('prompt-search-status');
      if (statusEl && typeof global.VoidTranslate !== 'undefined' && global.VoidTranslate.hasCjk(query)) {
        statusEl.textContent = parsed.matches.length
          ? `中文輸入 · 找到 ${parsed.matches.length} 條規則 · Ctrl+Enter 翻譯入庫`
          : '中文輸入 · Ctrl+Enter 翻譯英文並加入辭庫 · Enter 套用規則';
      }
    }, 150);
  }

  function previewSearch() {
    const query = getEl('prompt-search-input')?.value?.trim();
    if (!query) return toast('請輸入關鍵字');
    const parsed = parseSearchQuery(query, state.page);
    state.lastPlan = parsed;
    renderPlan(parsed);
    toast('已更新預覽（尚未套用）');
  }

  function applySearch(forcedQuery, opts = {}) {
    const query = (forcedQuery ?? getEl('prompt-search-input')?.value ?? '').trim();
    if (!query) return toast('請輸入關鍵字');
    const parsed = opts.plan || parseSearchQuery(query, state.page);
    if (!parsed.matches.length && query.length < 2) return toast('找不到符合的關鍵字');

    const fillMode = parsed.effects.fillMode || state.fillMode;
    const handler = handlers[state.page];
    if (!handler?.apply) return toast('此頁面尚未註冊搜尋處理');

    handler.apply(parsed.effects, { fillMode, query, conflicts: parsed.conflicts });
    state.lastQuery = query;
    if (!state.recent.includes(query)) state.recent.unshift(query);
    state.recent = state.recent.slice(0, 12);

    const preview = getEl('prompt-search-preview');
    const text = handler.buildPrompt?.() || '';
    if (preview) {
      preview.textContent = text || '（尚無內容）';
      preview.classList.toggle('empty', !text);
    }
    const applied = parsed.effects.actions.filter(a => !a.startsWith('__'));
    toast(applied.length ? `已補齊：${applied.slice(0, 3).join(' · ')}` : '已更新 Prompt');
    handlers.onSessionSave?.();
    renderUI();
  }

  function pickHit(idx) {
    state.hitIndex = idx;
    const query = getEl('prompt-search-input')?.value?.trim();
    renderHits(state.lastMatches, query);
    applySearch();
  }

  function onKeydown(e) {
    const hits = state.lastMatches.length;
    if (e.key === 'ArrowDown' && hits) {
      e.preventDefault();
      state.hitIndex = (state.hitIndex + 1) % Math.min(hits, 8);
      renderHits(state.lastMatches, e.target.value.trim());
    } else if (e.key === 'ArrowUp' && hits) {
      e.preventDefault();
      state.hitIndex = (state.hitIndex - 1 + Math.min(hits, 8)) % Math.min(hits, 8);
      renderHits(state.lastMatches, e.target.value.trim());
    } else if (e.key === 'Tab' && hits) {
      e.preventDefault();
      const m = state.lastMatches[state.hitIndex];
      if (m?.rule?.label) {
        const inp = getEl('prompt-search-input');
        const parts = inp.value.trim().split(/[\s,，、+]+/).filter(Boolean);
        if (parts.length) parts[parts.length - 1] = m.rule.keys[0];
        else parts.push(m.rule.keys[0]);
        inp.value = parts.join(' ');
        onInput();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) translateToBank();
      else if (e.shiftKey) previewSearch();
      else applySearch();
    }
  }

  async function translateToBank(opts = {}) {
    const query = (opts.query ?? getEl('prompt-search-input')?.value ?? '').trim();
    if (!query) return toast('請輸入中文描述');
    if (typeof global.VoidTranslate === 'undefined') return toast('翻譯模組未載入');
    if (!global.VoidTranslate.hasCjk(query) && !opts.force) {
      return toast('請輸入中文（含漢字）後再翻譯入庫');
    }
    const statusEl = getEl('prompt-search-status');
    if (statusEl) statusEl.textContent = '翻譯中…';
    try {
      const result = await global.VoidTranslate.translate(query, {
        forceGrok: !!opts.forceGrok,
        preferGrok: !!opts.preferGrok,
      });
      renderTranslatePreview(result);
      if (!result.english) return toast('翻譯結果為空，請換個描述或設定 API Key');
      if (handlers.onTranslateToBank) {
        const n = await handlers.onTranslateToBank(result, { query, page: state.page });
        if (!state.recent.includes(query)) state.recent.unshift(query);
        state.recent = state.recent.slice(0, 12);
        handlers.onSessionSave?.();
        renderUI();
        if (statusEl) {
          statusEl.textContent = `已翻譯入庫（${result.method === 'grok' ? 'Grok' : '辭庫'}）· ${n || 0} 詞`;
        }
        return;
      }
      toast('此頁面尚未註冊翻譯入庫');
    } catch (e) {
      if (statusEl) statusEl.textContent = '翻譯失敗';
      toast('翻譯失敗：' + (e.message || e));
    }
  }

  function setFillMode(mode) {
    state.fillMode = mode;
    localStorage.setItem(STORAGE_FILL_MODE, mode);
    document.querySelectorAll('[data-fill-mode]').forEach(el =>
      el.classList.toggle('on', el.dataset.fillMode === mode)
    );
  }

  function setPage(page) {
    state.page = page;
    const badge = getEl('search-page-badge');
    const names = { char: '角色', style: '風格', jewel: '飾品' };
    if (badge) badge.textContent = names[page] || page;
    const inp = getEl('prompt-search-input');
    if (inp) {
      inp.placeholder = page === 'jewel'
        ? '輸入：銀飾 戒指 北歐 8k…（中文可 Ctrl+Enter 翻譯入庫）'
        : page === 'style'
          ? '輸入：混沌 賽博 海邊 不要文字…（中文可 Ctrl+Enter 翻譯入庫）'
          : '輸入：女僕 泳裝 高角度 嬌小蕾絲內衣…（Ctrl+Enter 翻譯入庫）';
    }
    onInput();
  }

  function renderUI() {
    renderQuick();
    const q = getEl('prompt-search-input')?.value?.trim();
    if (!q) renderHotGroups();
    else renderHits(state.lastMatches, q);
    document.querySelectorAll('[data-fill-mode]').forEach(el =>
      el.classList.toggle('on', el.dataset.fillMode === state.fillMode)
    );
  }

  function focusSearch() {
    const wrap = getEl('global-search-wrap');
    if (wrap?.classList.contains('collapsed')) {
      wrap.classList.remove('collapsed');
    }
    setTimeout(() => {
      const inp = getEl('prompt-search-input');
      inp?.focus();
      inp?.select();
    }, 60);
  }

  function toggleCollapse() {
    const wrap = getEl('global-search-wrap');
    if (wrap) wrap.classList.toggle('collapsed');
  }

  function addCustomFromForm() {
    const keys = getEl('custom-rule-keys')?.value?.trim();
    const section = getEl('custom-rule-section')?.value || 'outfit';
    const hintsRaw = getEl('custom-rule-hints')?.value?.trim();
    if (!keys) return toast('請輸入關鍵字');
    const hintList = hintsRaw ? hintsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
    saveCustomRule({
      label: keys.split(/[,，]/)[0],
      keys: keys.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      effects: { hints: { [section]: hintList } },
    });
    getEl('custom-rule-keys').value = '';
    getEl('custom-rule-hints').value = '';
    onInput();
  }

  function restoreSession(data) {
    if (data?.recent) state.recent = data.recent;
    if (data?.lastQuery) state.lastQuery = data.lastQuery;
    if (data?.fillMode) setFillMode(data.fillMode);
    const inp = getEl('prompt-search-input');
    if (inp && state.lastQuery) inp.value = state.lastQuery;
  }

  function exportSession() {
    return { recent: state.recent, lastQuery: state.lastQuery, fillMode: state.fillMode };
  }

  function registerHandlers(page, h) {
    handlers[page] = h;
  }

  function setSessionSave(fn) { handlers.onSessionSave = fn; }

  function saveApiKeyFromInput() {
    const el = getEl('search-grok-api-key');
    if (!el || typeof global.VoidTranslate === 'undefined') return;
    global.VoidTranslate.setApiKey(el.value);
    toast(el.value ? '已儲存 Grok API Key' : '已清除 API Key');
  }

  function init(opts = {}) {
    handlers = { onSessionSave: opts.onSessionSave, onTranslateToBank: opts.onTranslateToBank };
    if (opts.handlers) Object.entries(opts.handlers).forEach(([p, h]) => registerHandlers(p, h));
    if (typeof global.VoidTranslate !== 'undefined') {
      global.VoidTranslate.init().catch(e => console.warn('VoidTranslate init', e));
      const keyEl = getEl('search-grok-api-key');
      if (keyEl) keyEl.value = global.VoidTranslate.getApiKey();
    }
    loadConfig().then(() => {
      if (opts.getLearnedTags) rebuildLearnedRules(opts.getLearnedTags);
      if (typeof global.VoidTranslate !== 'undefined') global.VoidTranslate.loadDict();
      renderUI();
      renderHotGroups();
      if (opts.initialPage) setPage(opts.initialPage);
    });
    const inp = getEl('prompt-search-input');
    if (inp) {
      inp.addEventListener('input', onInput);
      inp.addEventListener('keydown', onKeydown);
    }
  }

  function toast(msg) {
    if (typeof global.toast === 'function') global.toast(msg);
  }

  global.VoidSearch = {
    init,
    registerHandlers,
    setSessionSave,
    setPage,
    setFillMode,
    focusSearch,
    toggleCollapse,
    previewSearch,
    applySearch,
    translateToBank,
    saveApiKeyFromInput,
    quickSearch(q) {
      const inp = getEl('prompt-search-input');
      if (inp) inp.value = q;
      onInput();
      applySearch(q);
    },
    pickHit,
    togglePin,
    addCustomFromForm,
    rebuildLearnedRules,
    restoreSession,
    exportSession,
    parseSearchQuery,
    renderUI,
  };
})(window);