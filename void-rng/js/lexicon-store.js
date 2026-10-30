/* Shared vocabulary accounting. No browser or model dependencies. */
(function (root) {
  'use strict';
  function key(text) {
    return String(text || '').normalize('NFKC').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function split(text) {
    const out = [];
    let value = '', depth = 0;
    const source = String(text || '').split(/\r?\n/).filter(line => !line.trim().startsWith('//')).join('\n');
    for (const ch of source) {
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      if ((ch === ',' || ch === '\n') && depth === 0) {
        if (value.trim()) out.push(value.trim());
        value = '';
      } else value += ch;
    }
    if (value.trim()) out.push(value.trim());
    return out.filter(tag => tag !== '❖');
  }
  function unique(tags) {
    const seen = new Set();
    return tags.filter(tag => {
      const id = key(tag);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  function signature(slots) {
    return JSON.stringify(Object.keys(slots).filter(k => !k.startsWith('_') && typeof slots[k] === 'string' && slots[k].trim()).sort()
      .map(k => [k, unique(split(slots[k]).map(key)).sort()]));
  }
  function metrics(banks) {
    const tags = new Set();
    let entries = 0, segments = 0;
    const sections = {};
    for (const [section, values] of Object.entries(banks)) {
      const sectionTags = new Set();
      for (const value of values) {
        entries++;
        const parts = unique(split(value));
        if (parts.length > 1) segments++;
        parts.forEach(tag => { tags.add(key(tag)); sectionTags.add(key(tag)); });
      }
      sections[section] = { entries: values.length, tags: sectionTags.size };
    }
    return { entries, segments, tags: tags.size, sections };
  }
  function prepare(banks, templates, slots) {
    const next = Object.fromEntries(Object.entries(banks).map(([k, v]) => [k, [...v]]));
    const before = metrics(banks);
    let addedEntries = 0, addedSegments = 0;
    for (const [section, value] of Object.entries(slots)) {
      if (!next[section]) continue;
      const parts = unique(split(value));
      const seen = new Set(next[section].map(key));
      const additions = parts.length > 1 ? [parts.join(', '), ...parts] : parts;
      for (const item of additions) {
        if (seen.has(key(item))) continue;
        next[section].push(item);
        seen.add(key(item));
        addedEntries++;
        if (split(item).length > 1) addedSegments++;
      }
    }
    const nextTemplates = [...templates];
    const id = signature(slots);
    const addedTemplates = slots.subject && !templates.some(t => signature(t) === id) ? 1 : 0;
    if (addedTemplates) nextTemplates.push({ ...slots });
    return { banks: next, templates: nextTemplates, addedEntries, addedSegments,
      addedTags: metrics(next).tags - before.tags, addedTemplates, signature: id };
  }
  // Restore every written key if quota/security errors interrupt a multi-key save.
  function transaction(storage, updates) {
    const before = Object.fromEntries(Object.keys(updates).map(k => [k, storage.getItem(k)]));
    const written = [];
    try {
      for (const [k, value] of Object.entries(updates)) { storage.setItem(k, value); written.push(k); }
    } catch (error) {
      for (const k of written.reverse()) {
        if (before[k] === null) storage.removeItem(k); else storage.setItem(k, before[k]);
      }
      throw error;
    }
  }
  const api = { key, split, unique, signature, metrics, prepare, transaction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoidLexicon = api;
})(typeof window === 'undefined' ? globalThis : window);
