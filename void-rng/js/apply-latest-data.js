/* VOID.RNG V3 — 將 data/ JSON 辭庫套用到 rng-engine 常數 */
(function (global) {
  'use strict';

  function replaceArray(target, source) {
    if (!Array.isArray(target) || !Array.isArray(source)) return;
    target.splice(0, target.length, ...source);
  }

  function replaceObject(target, source) {
    if (!target || !source || typeof target !== 'object') return;
    Object.keys(target).forEach((k) => { delete target[k]; });
    Object.assign(target, source);
  }

  global.voidRngApplyLatestData = function voidRngApplyLatestData(payload) {
    if (!payload) return;

    if (payload['char-sections']) replaceArray(global.CHAR_SECTIONS, payload['char-sections']);

    if (payload['char-banks']) {
      const banks = payload['char-banks'];
      Object.keys(banks).forEach((k) => {
        if (global.DEFAULT_CHAR_BANKS) global.DEFAULT_CHAR_BANKS[k] = banks[k];
      });
      if (typeof global.loadCharBanks === 'function') {
        global.charBanks = global.loadCharBanks();
      }
    }

    const arrayMap = {
      'body-frame-types': 'BODY_FRAME_TYPES',
      'body-breast-types': 'BODY_BREAST_TYPES',
      'body-figure-types': 'BODY_FIGURE_TYPES',
      'body-frame-groups': 'BODY_FRAME_GROUPS',
      'body-breast-groups': 'BODY_BREAST_GROUPS',
      'body-figure-groups': 'BODY_FIGURE_GROUPS',
      'job-types': 'JOB_TYPES',
      'pose-presets': 'POSE_PRESETS',
      'spicy-outfit-types': 'SPICY_OUTFIT_TYPES',
      'spicy-action-types': 'SPICY_ACTION_TYPES',
      'style-codes': 'STYLE_CODES',
      'pools': 'POOLS',
      'slot-keys': 'SLOT_KEYS',
      'jewel-categories': 'JEWEL_CATEGORIES',
      'jewel-sections': 'JEWEL_SECTIONS',
      'space-categories': 'SPACE_CATEGORIES',
      'space-sections': 'SPACE_SECTIONS',
    };
    Object.entries(arrayMap).forEach(([fileKey, varName]) => {
      if (payload[fileKey] && global[varName]) replaceArray(global[varName], payload[fileKey]);
    });

    const objectMap = {
      'body-combos': 'BODY_COMBOS',
      'preset-body-map': 'PRESET_BODY_MAP',
      'tone-markers': 'TONE_MARKERS',
      'style-banks': 'BANKS',
      'jewel-banks': 'JEWEL_BANKS',
      'jewel-mode-presets': 'JEWEL_MODE_PRESETS',
      'space-banks': 'SPACE_BANKS',
      'space-mode-presets': 'SPACE_MODE_PRESETS',
      'pix-formula-templates': 'PIX_FORMULA_TEMPLATES',
    };
    Object.entries(objectMap).forEach(([fileKey, varName]) => {
      if (payload[fileKey] && global[varName]) replaceObject(global[varName], payload[fileKey]);
    });

    if (payload['slot-labels'] && global.SLOT_LABELS) {
      replaceObject(global.SLOT_LABELS, payload['slot-labels']);
    }
  };
})(window);