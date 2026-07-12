/* VOID.RNG — 學習偏好模型：從入庫紀錄預測表情·動作·服裝組合並疊代生成 */
(function (global) {
  'use strict';

  const SAMPLES_KEY = 'void-char-pref-samples';
  const ORGANIC_STATE_KEY = 'void-char-organic-state';
  const MODEL_VERSION = 1;
  const MAX_SAMPLES = 240;
  const COMBO_CORE = ['face', 'outfit', 'pose'];
  const COLLISION_DIMS = ['face', 'outfit', 'pose', 'env', 'styleRef', 'details'];
  const SECTION_ZH = { face: '表情', outfit: '服裝', pose: '姿勢', env: '氛圍', styleRef: '氣質', details: '細節' };
  const LIKED_WEIGHT = 5;
  const STORED_WEIGHT = 2.5;
  const PAIR_SECTIONS = [
    ['face', 'outfit'],
    ['face', 'pose'],
    ['outfit', 'pose'],
  ];

  let modelCache = null;
  let organicState = loadOrganicState();

  function loadOrganicState() {
    try {
      const raw = JSON.parse(localStorage.getItem(ORGANIC_STATE_KEY) || 'null');
      return raw && typeof raw === 'object'
        ? { generation: raw.generation || 0, seed: raw.seed || null, lastMutations: raw.lastMutations || null }
        : { generation: 0, seed: null, lastMutations: null };
    } catch {
      return { generation: 0, seed: null, lastMutations: null };
    }
  }

  function saveOrganicState() {
    try {
      localStorage.setItem(ORGANIC_STATE_KEY, JSON.stringify(organicState));
    } catch (_) {}
  }

  function sampleWeight(meta, fallback) {
    if (!meta) return fallback;
    if (meta.weight > 0) return meta.weight;
    if (meta.liked) return LIKED_WEIGHT;
    return fallback;
  }

  function normalizeTag(tag) {
    return String(tag || '').toLowerCase().trim().slice(0, 96);
  }

  function pairSectionKey(a, b) {
    return [a, b].sort().join('|');
  }

  function pairTagKey(t1, t2) {
    return [normalizeTag(t1), normalizeTag(t2)].sort().join('||');
  }

  function tripleKey(t1, t2, t3) {
    return [normalizeTag(t1), normalizeTag(t2), normalizeTag(t3)].sort().join('|||');
  }

  function loadStoredSamples() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAMPLES_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveStoredSamples(samples) {
    try {
      localStorage.setItem(SAMPLES_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)));
    } catch (_) {}
  }

  function extractTagsFromSlots(slots) {
    const out = {};
    const sections = global.CHAR_SECTIONS || [];
    sections.forEach(s => {
      out[s.key] = slots[s.key] ? global.splitPromptTags(slots[s.key]) : [];
    });
    return out;
  }

  function captureMeta() {
    if (typeof global.captureLearnMeta === 'function') return global.captureLearnMeta('sample');
    return { source: 'sample' };
  }

  function recordSample(slots, tags, meta) {
    if (!slots || !Object.values(slots).some(Boolean)) return;
    const samples = loadStoredSamples();
    samples.push({
      v: MODEL_VERSION,
      ts: Date.now(),
      slots: { ...slots },
      tags: tags || extractTagsFromSlots(slots),
      meta: meta || captureMeta(),
    });
    saveStoredSamples(samples);
    invalidateModel();
  }

  function recordFromText(text, meta) {
    const t = String(text || '').trim();
    if (!t || typeof global.autoClassifyPrompt !== 'function') return;
    const buckets = global.autoClassifyPrompt(t);
    const slots = typeof global.bucketsToPromptData === 'function'
      ? global.bucketsToPromptData(buckets)
      : null;
    if (!slots || !Object.values(slots).some(Boolean)) return;
    recordSample(slots, buckets, meta || { source: 'history' });
  }

  function bump(map, key, weight) {
    if (!key) return;
    map[key] = (map[key] || 0) + weight;
  }

  function ingestTagMap(model, tagMap, weight, sourceLabel) {
    if (!tagMap) return;
    model.sampleCount += weight;
    model.sources[sourceLabel] = (model.sources[sourceLabel] || 0) + weight;

    Object.entries(tagMap).forEach(([section, tags]) => {
      if (!Array.isArray(tags)) return;
      if (!model.tagFreq[section]) model.tagFreq[section] = {};
      tags.forEach(tag => bump(model.tagFreq[section], normalizeTag(tag), weight));

      if (COMBO_CORE.includes(section)) {
        tags.forEach(tag => {
          const nt = normalizeTag(tag);
          if (!model.topBySection[section]) model.topBySection[section] = {};
          bump(model.topBySection[section], nt, weight);
        });
      }
    });

    PAIR_SECTIONS.forEach(([a, b]) => {
      const ta = tagMap[a] || [];
      const tb = tagMap[b] || [];
      if (!ta.length || !tb.length) return;
      const pk = pairSectionKey(a, b);
      if (!model.pairFreq[pk]) model.pairFreq[pk] = {};
      ta.forEach(t1 => tb.forEach(t2 => bump(model.pairFreq[pk], pairTagKey(t1, t2), weight)));
    });

    const ff = tagMap.face || [];
    const oo = tagMap.outfit || [];
    const pp = tagMap.pose || [];
    if (ff.length && oo.length && pp.length) {
      ff.forEach(f => oo.forEach(o => pp.forEach(p => {
        bump(model.tripleFreq, tripleKey(f, o, p), weight);
      })));
    }
  }

  function rebuildModel() {
    const model = {
      version: MODEL_VERSION,
      sampleCount: 0,
      sources: {},
      tagFreq: {},
      pairFreq: {},
      tripleFreq: {},
      topBySection: {},
      templateWeights: [],
    };

    const addTpl = (tpl, weight, label) => {
      if (!tpl) return;
      ingestTagMap(model, extractTagsFromSlots(tpl), weight, label);
      model.templateWeights.push({ tpl, weight });
    };

    loadStoredSamples().forEach(s => {
      const w = sampleWeight(s.meta, STORED_WEIGHT);
      const label = s.meta?.liked ? 'liked' : 'stored';
      ingestTagMap(model, s.tags || extractTagsFromSlots(s.slots || {}), w, label);
    });

    if (typeof global.getUserLearnedTemplates === 'function') {
      global.getUserLearnedTemplates().forEach(t => addTpl(t, 4, 'learned'));
    }

    (global.charTemplates || global.getCharTemplates?.() || []).forEach(t => {
      if (!t?.subject) return;
      const isDefault = typeof global.isDefaultTemplate === 'function' && global.isDefaultTemplate(t);
      addTpl(t, isDefault ? 1 : 2, isDefault ? 'default' : 'template');
    });

    (global.getCharHistory?.() || global.charHistory || []).forEach(h => {
      if (!h?.text) return;
      if (typeof global.autoClassifyPrompt === 'function') {
        ingestTagMap(model, global.autoClassifyPrompt(h.text), 2, 'history');
      }
    });

    model.topCombos = Object.entries(model.tripleFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([key, score]) => ({ key, score }));

    return model;
  }

  function getModel() {
    if (!modelCache) modelCache = rebuildModel();
    return modelCache;
  }

  function invalidateModel() {
    modelCache = null;
  }

  function scoreTag(section, tag, contextTags, model) {
    const nt = normalizeTag(tag);
    let score = (model.tagFreq[section]?.[nt] || 0) * 2.2;

    COMBO_CORE.filter(s => s !== section).forEach(other => {
      const ctx = contextTags[other] || [];
      const pk = pairSectionKey(section, other);
      const pairs = model.pairFreq[pk] || {};
      ctx.forEach(ct => {
        score += (pairs[pairTagKey(tag, ct)] || 0) * 3.5;
      });
    });

    if (section === 'pose' && contextTags.face?.length && contextTags.outfit?.length) {
      contextTags.face.forEach(f => contextTags.outfit.forEach(o => {
        score += (model.tripleFreq[tripleKey(f, o, tag)] || 0) * 5;
      }));
    }

    return score;
  }

  function weightedPick(scored, count) {
    const pool = [...scored];
    const out = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const total = pool.reduce((s, x) => s + Math.max(0.01, x.score), 0);
      let r = Math.random() * total;
      for (let j = 0; j < pool.length; j++) {
        r -= Math.max(0.01, pool[j].score);
        if (r <= 0) {
          out.push(pool[j].tag ?? pool[j].entry);
          pool.splice(j, 1);
          break;
        }
      }
    }
    return out;
  }

  function pickPreferredTags(section, contextTags, min, max) {
    if (typeof global.getSectionTagPool !== 'function') return '';
    const model = getModel();
    const pool = global.getSectionTagPool(section);
    if (!pool.length) return '';

    const scored = pool.map(tag => ({
      tag,
      score: scoreTag(section, tag, contextTags, model) + Math.random() * 0.6,
    })).filter(x => x.score > 0.15);

    if (!scored.length) return global.rollCharTags?.(section, min, max) || '';

    scored.sort((a, b) => b.score - a.score);
    const cap = Math.max(min + 1, Math.ceil(scored.length * 0.35));
    const n = Math.min(scored.length, min + Math.floor(Math.random() * (max - min + 1)));
    const picked = weightedPick(scored.slice(0, cap), n);
    return picked.join(', ');
  }

  function filterBankForSection(key, bank) {
    let result = bank;
    if (key === 'pose' && typeof global.filterPoseBankByPreset === 'function') {
      result = global.filterPoseBankByPreset(result);
      if (typeof global.filterPoseBankBySpicyAction === 'function') {
        result = global.filterPoseBankBySpicyAction(result);
      }
      if (typeof global.filterPoseByOutfitContext === 'function') {
        result = global.filterPoseByOutfitContext(result);
      }
      if (typeof global.hasActiveJob === 'function' && global.hasActiveJob()
        && typeof global.filterPoseForActiveJob === 'function') {
        result = global.filterPoseForActiveJob(result);
      }
    }
    if (key === 'outfit') {
      if (typeof global.filterOutfitBankByPosePreset === 'function') {
        result = global.filterOutfitBankByPosePreset(result);
      }
      if (typeof global.filterOutfitBankBySpicy === 'function') {
        result = global.filterOutfitBankBySpicy(result);
      }
      if (typeof global.filterOutfitExcludePoseConflict === 'function') {
        result = global.filterOutfitExcludePoseConflict(result);
      }
    }
    if (key === 'face' && typeof global.filterFaceBankBySpicyAction === 'function') {
      result = global.filterFaceBankBySpicyAction(result);
    }
    return result.length ? result : bank;
  }

  function pickPreferredBankEntry(section, contextTags) {
    if (typeof global.getCharBankFiltered !== 'function') return '';
    const model = getModel();
    let bank = global.getCharBankFiltered(section);
    bank = filterBankForSection(section, bank);
    if (!bank.length) return '';

    const scored = bank.map(entry => {
      const tags = global.splitPromptTags(entry);
      let score = 0;
      tags.forEach(tag => { score += scoreTag(section, tag, contextTags, model); });
      score += Math.random() * 0.9;
      return { entry, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    if (!scored.length) return typeof global.pick === 'function' ? global.pick(bank) : bank[0];

    const top = scored.slice(0, Math.max(4, Math.ceil(scored.length * 0.25)));
    const picked = weightedPick(top.map(x => ({ tag: x.entry, score: x.score })), 1);
    return picked[0] || top[0].entry;
  }

  function pickWeightedBase(templates) {
    const model = getModel();
    if (!templates?.length) return null;
    const weighted = templates.map(tpl => {
      let w = 1;
      COMBO_CORE.forEach(sec => {
        global.splitPromptTags(tpl[sec] || '').forEach(tag => {
          w += (model.tagFreq[sec]?.[normalizeTag(tag)] || 0) * 0.5;
        });
      });
      return { tpl, w: w + Math.random() * 0.4 };
    });
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const item of weighted) {
      r -= item.w;
      if (r <= 0) return item.tpl;
    }
    return weighted[0].tpl;
  }

  function hasActiveOutfitFilter() {
    return typeof global.getActiveSpicyOutfitIds === 'function'
      && global.getActiveSpicyOutfitIds().length > 0;
  }

  function pickPreferredForSection(key, contextTags, base) {
    if (key === 'face') {
      const tags = pickPreferredTags(key, contextTags, 2, 5);
      if (tags) return tags;
    }
    if (key === 'outfit') {
      // 使用者有服裝篩選時，走專用 rollOutfitSection，避免偏好標籤亂拼稀釋準確度
      if (hasActiveOutfitFilter() && typeof global.rollOutfitSection === 'function') {
        return global.rollOutfitSection();
      }
      if (Math.random() < 0.35) {
        const entry = pickPreferredBankEntry(key, contextTags);
        if (entry) return entry;
      }
      if (Math.random() < 0.4) {
        const tags = pickPreferredTags(key, contextTags, 3, 7);
        if (tags) return tags;
      }
      const entry = pickPreferredBankEntry(key, contextTags);
      if (entry) return entry;
      if (typeof global.rollOutfitSection === 'function') return global.rollOutfitSection();
    }
    if (key === 'pose') {
      const entry = pickPreferredBankEntry(key, contextTags);
      if (entry) return entry;
      if (typeof global.rollPoseSection === 'function') return global.rollPoseSection();
    }
    if (base?.[key] && Math.random() < 0.45) {
      if (key === 'outfit' && hasActiveOutfitFilter() && typeof global.ensureOutfitSelectionAnchors === 'function') {
        return global.ensureOutfitSelectionAnchors(base[key], global.getActiveSpicyOutfitIds());
      }
      return base[key];
    }
    if (key !== 'outfit' && typeof global.rollCharTags === 'function') {
      const rolled = global.rollCharTags(key);
      if (rolled) return rolled;
    }
    return pickPreferredBankEntry(key, contextTags);
  }

  function autoClassifySlots(contextTags) {
    if (typeof global.classifyTag !== 'function') return;
    const allTags = COMBO_CORE.flatMap(k => contextTags[k] || []);
    if (!allTags.length) return;
    const buckets = {};
    COMBO_CORE.forEach(k => { buckets[k] = []; });
    allTags.forEach(tag => {
      const sec = global.classifyTag(tag);
      if (COMBO_CORE.includes(sec)) buckets[sec].push(tag);
    });
    COMBO_CORE.forEach(k => {
      if (buckets[k]?.length) {
        const text = [...new Set(buckets[k])].join(', ');
        setSlot(k, text);
        contextTags[k] = global.splitPromptTags(text);
      }
    });
  }

  function getSlots() {
    return typeof global.getCharSlots === 'function' ? global.getCharSlots() : {};
  }

  function setSlot(key, val) {
    if (typeof global.setCharSlot === 'function') global.setCharSlot(key, val);
  }

  function isLocked(key) {
    return typeof global.isCharLocked === 'function' ? global.isCharLocked(key) : false;
  }

  function hasTrainingData() {
    const m = getModel();
    return m.sampleCount > 0
      || (typeof global.getUserLearnedTemplates === 'function' && global.getUserLearnedTemplates().length > 0);
  }

  function parseTripleKey(key) {
    const parts = String(key || '').split('|||').map(normalizeTag).filter(Boolean);
    if (parts.length < 3) return null;
    return { face: [parts[0]], outfit: [parts[1]], pose: [parts[2]] };
  }

  function comboFromSlots(slots) {
    const tags = slots?.tags || extractTagsFromSlots(slots || getSlots());
    const combo = {};
    COMBO_CORE.forEach(k => {
      combo[k] = (tags[k] || []).map(normalizeTag).filter(Boolean);
    });
    return combo;
  }

  function comboHasCore(combo) {
    return combo && COMBO_CORE.some(k => combo[k]?.length);
  }

  function mergeComboTags(combo) {
    const out = {};
    COMBO_CORE.forEach(k => {
      out[k] = [...new Set((combo[k] || []).map(normalizeTag).filter(Boolean))];
    });
    return out;
  }

  function pickSeedCombo() {
    const slots = getSlots();
    const current = comboFromSlots(slots);
    if (comboHasCore(current)) return mergeComboTags(current);

    const model = getModel();
    const top = model.topCombos || [];
    if (top.length) {
      const pick = top[Math.floor(Math.random() * Math.min(4, top.length))];
      const parsed = parseTripleKey(pick.key);
      if (parsed) return mergeComboTags(parsed);
    }

    const samples = loadStoredSamples().slice().reverse();
    for (const s of samples) {
      const c = comboFromSlots(s.slots || {});
      if (comboHasCore(c)) return mergeComboTags(c);
    }

    const learned = typeof global.getUserLearnedTemplates === 'function'
      ? global.getUserLearnedTemplates() : [];
    if (learned.length) {
      const tpl = pickWeightedBase(learned);
      if (tpl) {
        const c = {};
        COMBO_CORE.forEach(k => {
          c[k] = global.splitPromptTags(tpl[k] || '').map(normalizeTag).filter(Boolean);
        });
        if (comboHasCore(c)) return mergeComboTags(c);
      }
    }

    return null;
  }

  function retainTags(tags, ratio) {
    const keep = Math.max(1, Math.ceil(tags.length * ratio));
    if (tags.length <= keep) return [...tags];
    const pool = [...tags];
    const out = [];
    for (let i = 0; i < keep && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function medianScore(scored) {
    if (!scored.length) return 0;
    const vals = scored.map(x => x.score).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] || 0;
  }

  function pickNearbyTags(section, seedTags, contextTags, model) {
    if (typeof global.getSectionTagPool !== 'function') return [];
    const pool = global.getSectionTagPool(section);
    const seedSet = new Set((seedTags || []).map(normalizeTag));
    const scored = pool
      .map(tag => ({ tag: normalizeTag(tag), score: scoreTag(section, tag, contextTags, model) }))
      .filter(x => x.score > 0.2 && !seedSet.has(x.tag))
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return [];
    const cap = Math.max(3, Math.ceil(scored.length * 0.2));
    const n = 1 + Math.floor(Math.random() * 2);
    return weightedPick(scored.slice(0, cap).map(x => ({ tag: x.tag, score: x.score })), n)
      .map(t => normalizeTag(t));
  }

  function pickExploreTags(section, seedTags, contextTags, model) {
    if (typeof global.getSectionTagPool !== 'function') return [];
    const pool = global.getSectionTagPool(section);
    const seedSet = new Set((seedTags || []).map(normalizeTag));
    const scored = pool
      .map(tag => ({ tag: normalizeTag(tag), score: scoreTag(section, tag, contextTags, model) }))
      .filter(x => x.score > 0.12 && !seedSet.has(x.tag));
    if (!scored.length) return pickNearbyTags(section, seedTags, contextTags, model);

    const med = medianScore(scored);
    const explorers = scored.filter(x => x.score <= med * 1.35 || x.score < 1.2);
    const pickPool = (explorers.length ? explorers : scored).sort((a, b) => a.score - b.score);
    const cap = Math.max(4, Math.ceil(pickPool.length * 0.35));
    const n = 1 + Math.floor(Math.random() * 2);
    return weightedPick(
      pickPool.slice(0, cap).map(x => ({ tag: x.tag, score: Math.max(0.2, 1.8 - x.score * 0.15) })),
      n,
    ).map(t => normalizeTag(t));
  }

  function pickBankMutation(section, contextTags, mode) {
    if (typeof global.getCharBankFiltered !== 'function') return '';
    const model = getModel();
    let bank = global.getCharBankFiltered(section);
    bank = filterBankForSection(section, bank);
    if (!bank.length) return '';

    const scored = bank.map(entry => {
      const tags = global.splitPromptTags(entry);
      let score = 0;
      tags.forEach(tag => { score += scoreTag(section, tag, contextTags, model); });
      if (mode === 'explore') score = Math.max(0.15, 2.2 - score * 0.12) + Math.random() * 0.5;
      else score += Math.random() * 0.8;
      return { entry, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    if (!scored.length) return '';
    const cap = mode === 'explore'
      ? Math.max(5, Math.ceil(scored.length * 0.4))
      : Math.max(4, Math.ceil(scored.length * 0.22));
    const picked = weightedPick(scored.slice(0, cap).map(x => ({ tag: x.entry, score: x.score })), 1);
    return picked[0] || scored[0].entry;
  }

  function mutateCombo(seed, nearbySec, exploreSec) {
    const model = getModel();
    const keepRatio = 0.6 + Math.random() * 0.2;
    const combo = {};
    const mutations = { nearby: nearbySec, explore: exploreSec, keepRatio };

    COMBO_CORE.forEach(section => {
      const seedTags = seed[section] || [];
      let context = {};
      COMBO_CORE.forEach(k => {
        if (k !== section) context[k] = combo[k]?.length ? combo[k] : (seed[k] || []);
      });

      if (section === nearbySec) {
        const tags = pickNearbyTags(section, seedTags, context, model);
        if (tags.length) combo[section] = tags;
        else combo[section] = retainTags(seedTags, keepRatio);
      } else if (section === exploreSec) {
        const tags = pickExploreTags(section, seedTags, context, model);
        if (tags.length) combo[section] = tags;
        else combo[section] = retainTags(seedTags, Math.max(0.45, keepRatio - 0.15));
      } else {
        combo[section] = retainTags(seedTags, keepRatio);
      }
    });

    return { combo: mergeComboTags(combo), mutations };
  }

  function comboToSlotText(section, tags, contextTags) {
    const arr = [...new Set((tags || []).map(normalizeTag).filter(Boolean))];
    if (!arr.length) return '';
    if ((section === 'outfit' || section === 'pose') && Math.random() < 0.38) {
      const bankEntry = pickBankMutation(section, contextTags || {}, 'nearby');
      if (bankEntry) {
        const bankTags = global.splitPromptTags(bankEntry).map(normalizeTag);
        return [...new Set([...bankTags, ...arr])].join(', ');
      }
    }
    return arr.join(', ');
  }

  function fillNonCoreSlots(base, contextTags) {
    const order = ['subject', 'details', 'job', 'env', 'styleRef', 'quality'];
    order.forEach(key => {
      if (typeof global.charIsIncluded === 'function' && !global.charIsIncluded(key)) {
        setSlot(key, '');
        return;
      }
      if (key === 'job' && typeof global.isJobDisabled === 'function' && global.isJobDisabled()) {
        setSlot(key, '');
        return;
      }
      if (isLocked(key)) return;

      let text = '';
      if (key === 'job') {
        text = typeof global.rollJobSection === 'function' ? global.rollJobSection() : '';
      } else if (base?.[key] && Math.random() < 0.5) {
        text = base[key];
      } else if (typeof global.rollCharSection === 'function') {
        text = global.rollCharSection(key) || global.rollCharTags?.(key) || '';
      }

      if (!text) return;
      if (typeof global.applyBodyHintsToSlot === 'function') text = global.applyBodyHintsToSlot(key, text);
      if (typeof global.applyToneBoost === 'function') text = global.applyToneBoost(key, text);
      if (typeof global.finalizeSlotText === 'function') text = global.finalizeSlotText(key, text);
      setSlot(key, text);
    });

    autoClassifySlots(contextTags);
    if (typeof global.coerceSlotsForActiveJob === 'function') global.coerceSlotsForActiveJob();
  }

  function applyComboToSlots(combo, base) {
    const contextTags = {};
    COMBO_CORE.forEach(key => {
      if (isLocked(key)) {
        const locked = global.splitPromptTags(getSlots()[key] || '');
        contextTags[key] = locked;
        return;
      }
      let text = comboToSlotText(key, combo[key], contextTags);
      if (!text && base?.[key]) text = base[key];
      if (!text) {
        text = pickPreferredForSection(key, contextTags, base) || '';
      }
      if (!text) return;
      if (typeof global.applyBodyHintsToSlot === 'function') text = global.applyBodyHintsToSlot(key, text);
      if (typeof global.applyToneBoost === 'function') text = global.applyToneBoost(key, text);
      if (typeof global.finalizeSlotText === 'function') text = global.finalizeSlotText(key, text);
      setSlot(key, text);
      contextTags[key] = global.splitPromptTags(text);
    });
    fillNonCoreSlots(base, contextTags);
    return contextTags;
  }

  function chooseMutationSections() {
    const shuffled = [...COMBO_CORE].sort(() => Math.random() - 0.5);
    return { nearby: shuffled[0], explore: shuffled[1] };
  }

  function setSeedFromCombo(combo) {
    organicState.seed = mergeComboTags(combo);
    saveOrganicState();
  }

  function exploreOrganicCombo(opts) {
    if (!hasTrainingData()) {
      global.toast?.('請先透過「學習入庫」累積偏好樣本');
      if (typeof global.generateCharLearnLegacy === 'function') global.generateCharLearnLegacy();
      return false;
    }

    const model = getModel();
    const useSeed = opts?.continueSeed !== false && organicState.seed && comboHasCore(organicState.seed);
    const seed = useSeed ? mergeComboTags(organicState.seed) : (pickSeedCombo() || {});
    if (!comboHasCore(seed)) {
      return generateCharPreference();
    }

    const { nearby, explore } = chooseMutationSections();
    const { combo, mutations } = mutateCombo(seed, nearby, explore);

    const learned = typeof global.getUserLearnedTemplates === 'function'
      ? global.getUserLearnedTemplates() : [];
    const bases = learned.length ? learned : (global.charTemplates || []).filter(t => t?.subject);
    const base = pickWeightedBase(bases);

    applyComboToSlots(combo, base);

    organicState.generation = useSeed ? (organicState.generation + 1) : 1;
    organicState.seed = mergeComboTags(combo);
    organicState.lastMutations = mutations;
    saveOrganicState();

    renderPreferenceStats(model);
    renderOrganicStatus();
    return true;
  }

  function exploreOrganicBatch(count) {
    const n = Math.min(8, Math.max(1, +count || 3));
    if (typeof global.setCharMode === 'function') global.setCharMode('learn');
    const made = [];
    for (let i = 0; i < n; i++) {
      if (!exploreOrganicCombo({ continueSeed: i > 0 })) break;
      const text = typeof global.buildCharPrompt === 'function' ? global.buildCharPrompt() : '';
      if (!text) continue;
      made.push(text);
      const hist = global.getCharHistory?.() || [];
      hist.unshift({ text, ts: Date.now(), organic: true, gen: organicState.generation });
      if (typeof global.setCharHistory === 'function') {
        global.setCharHistory(hist.slice(0, 30));
      }
    }
    if (typeof global.renderChar === 'function') global.renderChar();
    if (typeof global.renderCharHistory === 'function') global.renderCharHistory();
    if (typeof global.saveActiveSession === 'function') global.saveActiveSession();
    global.toast?.(`有機探索完成 · ${made.length} 代（沿偏好方向延伸並探索新組合）`);
    return made;
  }

  function collideOrganicCombo() {
    if (typeof global.setCharTone === 'function') global.setCharTone('contrast');
    if (typeof global.setCharMode === 'function') global.setCharMode('mix');

    const model = getModel();
    const contextTags = {};
    const learned = typeof global.getUserLearnedTemplates === 'function'
      ? global.getUserLearnedTemplates() : [];
    const bases = learned.length ? learned : (global.charTemplates || []).filter(t => t?.subject);
    const base = pickWeightedBase(bases);
    const mutations = { collide: true, dims: [] };

    COLLISION_DIMS.forEach(key => {
      if (typeof global.charIsIncluded === 'function' && !global.charIsIncluded(key)) return;
      if (isLocked(key)) {
        contextTags[key] = global.splitPromptTags(getSlots()[key] || '');
        return;
      }
      let text = '';
      if (hasTrainingData()) {
        text = COMBO_CORE.includes(key)
          ? pickPreferredForSection(key, contextTags, base)
          : (pickPreferredBankEntry(key, contextTags) || pickPreferredTags(key, contextTags, 1, 3));
      }
      if (!text && typeof global.rollCharSection === 'function') {
        text = global.rollCharSection(key) || global.rollCharTags?.(key) || '';
      }
      if (!text) return;
      if (typeof global.applyBodyHintsToSlot === 'function') text = global.applyBodyHintsToSlot(key, text);
      if (typeof global.applyToneBoost === 'function') text = global.applyToneBoost(key, text);
      if (typeof global.finalizeSlotText === 'function') text = global.finalizeSlotText(key, text);
      setSlot(key, text);
      contextTags[key] = global.splitPromptTags(text);
      mutations.dims.push(key);
    });

    ['subject', 'job', 'quality'].forEach(key => {
      if (typeof global.charIsIncluded === 'function' && !global.charIsIncluded(key)) {
        setSlot(key, '');
        return;
      }
      if (key === 'job' && typeof global.isJobDisabled === 'function' && global.isJobDisabled()) {
        setSlot(key, '');
        return;
      }
      if (isLocked(key) || getSlots()[key]) return;
      let text = '';
      if (key === 'job') {
        text = typeof global.rollJobSection === 'function' ? global.rollJobSection() : '';
      } else if (base?.[key] && Math.random() < 0.45) {
        text = base[key];
      } else if (typeof global.rollCharSection === 'function') {
        text = global.rollCharSection(key) || '';
      }
      if (!text) return;
      if (typeof global.applyBodyHintsToSlot === 'function') text = global.applyBodyHintsToSlot(key, text);
      if (typeof global.applyToneBoost === 'function') text = global.applyToneBoost(key, text);
      if (typeof global.finalizeSlotText === 'function') text = global.finalizeSlotText(key, text);
      setSlot(key, text);
    });

    autoClassifySlots(contextTags);
    if (typeof global.coerceSlotsForActiveJob === 'function') global.coerceSlotsForActiveJob();
    if (typeof global.syncPoseJobCoherence === 'function') global.syncPoseJobCoherence();
    if (typeof global.syncOutfitPoseCoherence === 'function') global.syncOutfitPoseCoherence();

    organicState.generation = (organicState.generation || 0) + 1;
    organicState.seed = comboFromSlots(getSlots());
    organicState.lastMutations = mutations;
    saveOrganicState();
    renderPreferenceStats(model);
    renderOrganicStatus();
    global.toast?.('反差碰撞 · 可愛表情 × 色氣服裝構圖');
    return true;
  }

  function reinforceLiked() {
    const slots = { ...getSlots() };
    if (!Object.values(slots).some(Boolean)) {
      global.toast?.('尚無可強化的組合');
      return false;
    }
    const tags = extractTagsFromSlots(slots);
    const meta = {
      ...(typeof global.captureLearnMeta === 'function' ? global.captureLearnMeta('liked') : { source: 'liked' }),
      liked: true,
      weight: LIKED_WEIGHT,
    };
    recordSample(slots, tags, meta);
    setSeedFromCombo(comboFromSlots(slots));
    organicState.generation = 0;
    organicState.lastMutations = { nearby: null, explore: null, liked: true };
    saveOrganicState();
    invalidateModel();
    renderPreferenceStats();
    renderOrganicStatus();
    global.toast?.('已標記喜歡 · 下次有機延伸將以此為種子');
    return true;
  }

  function formatComboShort(combo) {
    if (!combo) return '—';
    return COMBO_CORE.map(k => {
      const tags = combo[k] || [];
      if (!tags.length) return '';
      const label = tags.slice(0, 2).map(t => t.length > 14 ? t.slice(0, 12) + '…' : t).join('/');
      return `${SECTION_ZH[k]}:${label}`;
    }).filter(Boolean).join(' · ');
  }

  function renderOrganicStatus() {
    const el = document.getElementById('organic-explore-stats');
    if (!el) return;
    const seedLabel = formatComboShort(organicState.seed);
    const mut = organicState.lastMutations || {};
    const mutText = mut.liked
      ? '種子已鎖定（喜歡回饋）'
      : mut.collide
        ? `碰撞 ${(mut.dims || []).map(k => SECTION_ZH[k] || k).join('·')}`
        : (mut.nearby && mut.explore
          ? `變異 ${SECTION_ZH[mut.nearby]}鄰近 · ${SECTION_ZH[mut.explore]}探索`
          : '待延伸');
    el.innerHTML = `有機第 ${organicState.generation} 代 · ${global.escHtml?.(mutText) || mutText}`
      + `<br>種子：${global.escHtml?.(seedLabel) || seedLabel}`;
  }

  function generateCharPreference() {
    if (!hasTrainingData()) {
      global.toast?.('請先透過「學習入庫」累積偏好樣本');
      if (typeof global.generateCharLearnLegacy === 'function') global.generateCharLearnLegacy();
      return false;
    }

    const model = getModel();
    const learned = typeof global.getUserLearnedTemplates === 'function'
      ? global.getUserLearnedTemplates() : [];
    const bases = learned.length ? learned : (global.charTemplates || []).filter(t => t?.subject);
    const base = pickWeightedBase(bases);
    const contextTags = {};

    const order = ['subject', 'face', 'details', 'outfit', 'pose', 'job', 'env', 'styleRef', 'quality'];

    order.forEach(key => {
      if (typeof global.charIsIncluded === 'function' && !global.charIsIncluded(key)) {
        setSlot(key, '');
        return;
      }
      if (key === 'job' && typeof global.isJobDisabled === 'function' && global.isJobDisabled()) {
        setSlot(key, '');
        return;
      }
      if (isLocked(key)) return;

      let text = '';
      if (COMBO_CORE.includes(key)) {
        text = pickPreferredForSection(key, contextTags, base);
      } else if (key === 'job') {
        text = typeof global.rollJobSection === 'function' ? global.rollJobSection() : '';
      } else if (base?.[key] && Math.random() < 0.48) {
        text = base[key];
      } else if (typeof global.rollCharSection === 'function') {
        text = global.rollCharSection(key) || global.rollCharTags?.(key) || '';
      }

      if (!text) return;

      if (typeof global.applyBodyHintsToSlot === 'function') {
        text = global.applyBodyHintsToSlot(key, text);
      }
      if (typeof global.applyToneBoost === 'function') {
        text = global.applyToneBoost(key, text);
      }
      if (typeof global.finalizeSlotText === 'function') {
        text = global.finalizeSlotText(key, text);
      }
      setSlot(key, text);
      if (COMBO_CORE.includes(key)) {
        contextTags[key] = global.splitPromptTags(text);
      }
    });

    autoClassifySlots(contextTags);
    if (typeof global.coerceSlotsForActiveJob === 'function') global.coerceSlotsForActiveJob();
    renderPreferenceStats(model);
    return true;
  }

  function generateCharBatch(count) {
    const n = Math.min(12, Math.max(1, +count || 5));
    if (typeof global.setCharMode === 'function') global.setCharMode('learn');
    const made = [];
    for (let i = 0; i < n; i++) {
      if (!generateCharPreference()) break;
      const text = typeof global.buildCharPrompt === 'function' ? global.buildCharPrompt() : '';
      if (!text) continue;
      made.push(text);
      const hist = global.getCharHistory?.() || [];
      hist.unshift({ text, ts: Date.now(), pref: true });
      if (typeof global.setCharHistory === 'function') {
        global.setCharHistory(hist.slice(0, 30));
      }
    }
    if (typeof global.renderChar === 'function') global.renderChar();
    if (typeof global.renderCharHistory === 'function') global.renderCharHistory();
    if (typeof global.saveActiveSession === 'function') global.saveActiveSession();
    global.toast?.(`偏好疊代完成 · ${made.length} 組（表情·動作·服裝已自動分類組合）`);
    return made;
  }

  function getTopCombos(limit = 5) {
    return getModel().topCombos.slice(0, limit);
  }

  function formatComboLabel(combo) {
    if (!combo?.key) return '';
    return combo.key.split('|||').map(t => t.length > 18 ? t.slice(0, 16) + '…' : t).join(' + ');
  }

  function renderPreferenceStats(modelIn) {
    const el = document.getElementById('preference-stats');
    if (!el) return;
    const model = modelIn || getModel();
    const stored = loadStoredSamples().length;
    const learned = typeof global.getUserLearnedTemplates === 'function'
      ? global.getUserLearnedTemplates().length : 0;
    const top = model.topCombos[0];
    const topLabel = top ? formatComboLabel(top) : '—';
    el.innerHTML = `偏好樣本 ${stored} · 學習範本 ${learned} · 訓練權重 ${Math.round(model.sampleCount)}`
      + (top ? `<br>熱門組合：${global.escHtml?.(topLabel) || topLabel}` : '');
  }

  function init() {
    organicState = loadOrganicState();
    invalidateModel();
    renderPreferenceStats();
    renderOrganicStatus();
  }

  global.VoidPreference = {
    init,
    invalidateModel,
    rebuildModel,
    getModel,
    recordSample,
    recordFromText,
    generateCharPreference,
    generateCharBatch,
    exploreOrganicCombo,
    exploreOrganicBatch,
    collideOrganicCombo,
    reinforceLiked,
    getOrganicState: () => ({ ...organicState }),
    getTopCombos,
    renderPreferenceStats,
    renderOrganicStatus,
    hasTrainingData,
  };
})(window);