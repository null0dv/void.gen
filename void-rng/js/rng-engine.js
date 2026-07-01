/* VOID.RNG engine — ported from legacy monolith */

/* standalone only — embed 已移除 */
const EMBED_CHAR = false;
const EMBED_VOID_GEN = false;

// ═══════════════════════════════════════════════════════════════════
// 共用工具
// ═══════════════════════════════════════════════════════════════════
const pick = arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : '';
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escTextarea(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
function splitPromptList(text) {
  return String(text || '').split(/[,，]\s*/).map(s => s.trim()).filter(Boolean);
}
function parseStructuredSections(text, sections) {
  const result = {};
  String(text || '').split(/\n\n+/).forEach(block => {
    const m = block.match(/^\/\/\s*❖\s*(.+?)\s*\n([\s\S]*)$/);
    if (!m) return;
    const header = m[1].trim();
    const content = m[2].trim();
    const sec = sections.find(s =>
      s.label === header || s.zh === header ||
      s.label.toUpperCase() === header.toUpperCase() ||
      (s.key === 'pose' && header === 'Pose / Composition & Act')
    );
    if (sec && content) result[sec.key] = content;
  });
  return result;
}
function assignListToSlots(text, sections, slotsObj, isIncluded) {
  const keys = sections.filter(s => isIncluded(s.key)).map(s => s.key);
  if (!keys.length) return;
  const parts = splitPromptList(text);
  if (parts.length === keys.length) {
    keys.forEach((k, i) => { slotsObj[k] = parts[i]; });
  } else if (parts.length === 1) {
    slotsObj[keys[0]] = parts[0];
  } else {
    keys.forEach((k, i) => { if (parts[i]) slotsObj[k] = parts[i]; });
  }
}
function setOutputText(id, text, emptyMsg) {
  const out = document.getElementById(id);
  if (!out || out === document.activeElement) return;
  if (!text) {
    out.value = '';
    out.placeholder = emptyMsg || '尚無內容…';
    out.classList.add('empty');
  } else {
    out.value = text;
    out.classList.remove('empty');
  }
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
const PAGE_STORAGE_KEY = 'void-rng-page';
let currentPage = 'style';

function switchPage(page, el) {
  if (!['style', 'char', 'jewel', 'space'].includes(page)) return;
  if (EMBED_CHAR && page !== 'char') return;
  currentPage = page;
  document.querySelectorAll('.page-tab').forEach(t => t.classList.toggle('on', t.dataset.page === page));
  const views = { style: 'view-style', char: 'view-char', jewel: 'view-jewel', space: 'view-space' };
  Object.entries(views).forEach(([p, id]) => {
    const node = document.getElementById(id);
    if (node) node.classList.toggle('active', p === page);
  });
  const bars = { style: 'topbar-style', char: 'topbar-char', jewel: 'topbar-jewel', space: 'topbar-space' };
  Object.entries(bars).forEach(([p, id]) => {
    const node = document.getElementById(id);
    if (node) node.style.display = p === page ? 'flex' : 'none';
  });
  if (page === 'char') {
    try { renderChar(); } catch (e) { console.warn('switchPage renderChar', e); }
  }
  try {
    if (typeof VoidSearch !== 'undefined' && VoidSearch.setPage) VoidSearch.setPage(page);
  } catch (e) { console.warn('switchPage VoidSearch.setPage', e); }
  if (!EMBED_CHAR) {
    try { localStorage.setItem(PAGE_STORAGE_KEY, page); } catch (_) {}
  }
}
window.switchPage = switchPage;

function restoreSavedPage() {
  if (EMBED_CHAR) return;
  let saved = 'style';
  try { saved = localStorage.getItem(PAGE_STORAGE_KEY) || 'style'; } catch (_) {}
  if (!['style', 'char', 'jewel', 'space'].includes(saved) || saved === currentPage) return;
  const tab = document.querySelector(`.page-tab[data-page="${saved}"]`);
  if (tab) switchPage(saved, tab);
}

function bindPageTabs() {
  const wrap = document.getElementById('page-tabs');
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';
  wrap.addEventListener('click', e => {
    const tab = e.target.closest('.page-tab[data-page]');
    if (!tab) return;
    e.preventDefault();
    switchPage(tab.dataset.page, tab);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 風格 PROMPT 頁
// ═══════════════════════════════════════════════════════════════════
const STYLE_CODES = [
  { code:'n', pool:'null', zh:'Null Craft 幾何對稱深灰仿生', en:'Null Craft geometric symmetry deep gray bionic' },
  { code:'Ns', pool:'null', zh:'Null 飾品 鈦金屬原石', en:'Null jewelry titanium metal raw crystal' },
  { code:'fractanull', pool:'null', zh:'Fractal Null 骨質裂解晶體', en:'fractal null bone crystal fracture structure' },
  { code:'fw', pool:'null', zh:'Floating Wood 木質流動線條', en:'floating wood organic carved lines' },
  { code:'bone', pool:'null', zh:'類骨盆中空器官感骨質', en:'pelvis-like hollow asymmetric bone organ' },
  { code:'mb', pool:'null', zh:'Moss Bolt 黑底綠苔電能量', en:'moss bolt black green lightning energy' },
  { code:'Xg', pool:'psy', zh:'X-glitch 數位錯亂病毒視覺', en:'X-glitch digital corruption virus stripes' },
  { code:'lsd1', pool:'psy', zh:'LSD 擴張型幻彩錯位', en:'LSD expansion psychedelic color shift' },
  { code:'fp', pool:'psy', zh:'Fractal Psy 高對比分形螺旋', en:'fractal psychedelic high contrast spiral' },
  { code:'psy', pool:'psy', zh:'Tropical Mirage 多重月亮虹彩', en:'tropical mirage multiple moons iridescent sky' },
  { code:'fx', pool:'glitch', zh:'Fractal Grid Collapse 幾何崩解', en:'fractal grid collapse pixel geometry breakdown' },
  { code:'lw', pool:'light', zh:'Lumenwave 光子流液態虹膜', en:'lumenwave photon flow liquid iris' },
  { code:'cbd', pool:'char', zh:'Cyber-Doll 粉色排線電子人偶', en:'cyber-doll pink wiring electronic doll' },
  { code:'cat', pool:'char', zh:'油畫貓耳少女古典筆觸', en:'oil painting cat-ear girl classical brushwork' },
];
const POOLS = [
  { id:'all', label:'全部' }, { id:'null', label:'Null' }, { id:'psy', label:'迷幻' },
  { id:'geo', label:'幾何' }, { id:'glitch', label:'錯層' }, { id:'light', label:'光波' }, { id:'char', label:'角色' },
];
const BANKS = {
  quality: { zh:['傑作','最高品質','超精細','8K'], en:['masterpiece','best quality','ultra-detailed','8k'] },
  subject: { zh:['孤獨少女','機械天使','貓耳插畫少女'], en:['lone girl','mechanical angel','cat-ear illustration girl'] },
  scene: { zh:['深夜空房','霓虹都市屋頂'], en:['midnight empty room','neon city rooftop'] },
  comp: { zh:['極低角度仰拍','特寫半身'], en:['extreme low angle','close-up bust'] },
  light: { zh:['黃金時刻柔光','霓虹邊緣光'], en:['golden hour soft light','neon rim light'] },
  mood: { zh:['空靈夢幻','神秘壓抑'], en:['ethereal dreamlike','mysterious oppressive'] },
  detail: { zh:['晶體裂紋細節','油畫筆觸質感'], en:['crystal fracture details','oil painting brush texture'] },
};
const SLOT_KEYS = ['quality','style','subject','scene','comp','light','mood','detail'];
const SLOT_LABELS = { quality:'品質', style:'風格代號', subject:'主題', scene:'場景', comp:'構圖', light:'光線', mood:'情緒', detail:'細節' };

let mode='full', lang='zh', activePools=new Set(['all']), slots={}, locked=new Set();
let styleHistory = [];

// ── Session 管理 ────────────────────────────────────────────────────
const SESSIONS_KEY = 'void-sessions';
const ACTIVE_SESSION_KEY = 'void-session-active';
let sessions = [];
let activeSessionId = null;

function newSessionId() { return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function captureSessionSnapshot() {
  try {
    return {
      char: {
        slots: { ...(charSlots || {}) },
        locked: [...(charLocked || [])],
        tone: charTone || 'cute',
        toneIntensity: charToneIntensity ?? 2,
        mode: charMode || 'mix',
        fmt: charFmt || 'structured',
        history: (charHistory || []).slice(0, 30),
        jobTypes: [...(charJobTypes || ['none'])],
        posePresets: [...(charPosePresets || ['all'])],
        spicyOutfits: [...(charSpicyOutfits || ['none'])],
        spicyActions: [...(charSpicyActions || ['none'])],
        bodyFrame: [...(charBodyFrame || ['none'])],
        bodyBreast: [...(charBodyBreast || ['none'])],
        bodyFigure: [...(charBodyFigure || ['none'])],
        envPresets: [...(charEnvPresets || ['none'])],
      },
      style: {
        slots: { ...(slots || {}) },
        locked: [...(locked || [])],
        mode: mode || 'full', lang: lang || 'zh',
        history: (styleHistory || []).slice(0, 30),
      },
      ui: { page: currentPage },
      search: (typeof VoidSearch !== 'undefined' ? VoidSearch.exportSession() : { recent: [], lastQuery: '' }),
      jewel: {
        slots: { ...(jewelSlots || {}) },
        locked: [...(jewelLocked || [])],
        mode: jewelMode || 'full',
        lang: jewelLang || 'zh',
        fmt: jewelFmt || 'structured',
        categories: [...(jewelActiveCats || ['all'])],
        history: (jewelHistory || []).slice(0, 30),
      },
      space: {
        slots: { ...(spaceSlots || {}) },
        locked: [...(spaceLocked || [])],
        mode: spaceMode || 'full',
        lang: spaceLang || 'zh',
        fmt: spaceFmt || 'structured',
        categories: [...(spaceActiveCats || ['all'])],
        stylePools: [...(spaceStylePools || ['all'])],
        styleCount: +(document.getElementById('space-style-count')?.value || 2),
        cards: (spaceCards || []).map(c => ({ ...(c || {}) })),
        activeCard: spaceActiveCard ?? 0,
        history: (spaceHistory || []).slice(0, 30),
      },
    };
  } catch (e) {
    console.error('captureSessionSnapshot', e);
    return null;
  }
}

function applySessionSnapshot(data) {
  if (!data) return;
  if (data.ui?.page && !EMBED_CHAR) {
    const tab = document.querySelector(`.page-tab[data-page="${data.ui.page}"]`);
    if (tab) switchPage(data.ui.page, tab);
  }
  if (data.char) {
    charSlots = { ...(data.char.slots || {}) };
    charLocked = new Set(data.char.locked || []);
    charTone = normalizeCharTone(data.char.tone || 'cute');
    charToneIntensity = Math.min(5, Math.max(1, data.char.toneIntensity ?? 3));
    charMode = data.char.mode || 'mix';
    charFmt = data.char.fmt || 'structured';
    charHistory = data.char.history || [];
    charJobTypes = migrateJobTypes(data.char.jobTypes);
    charPosePresets = migratePosePresets(data.char.posePresets);
    charSpicyOutfits = migrateSpicySet(data.char.spicyOutfits, SPICY_OUTFIT_TYPES, 'none');
    charSpicyActions = migrateSpicySet(data.char.spicyActions, SPICY_ACTION_TYPES, 'none');
    charBodyFrame = migrateBodySet(data.char.bodyFrame, BODY_FRAME_TYPES);
    charBodyBreast = migrateBodySet(data.char.bodyBreast, BODY_BREAST_TYPES);
    charBodyFigure = migrateBodySet(data.char.bodyFigure, BODY_FIGURE_TYPES);
    charEnvPresets = migrateSpicySet(data.char.envPresets, ENV_PRESET_TYPES, 'none');
    setCharTone(charTone);
    setCharMode(charMode);
    setCharFmt(charFmt);
    renderCharJobChips();
    renderCharActionChips();
    renderCharSpicyOutfitChips();
    renderCharBodyChips();
    renderCharEnvChips();
    const intEl = document.getElementById('char-tone-intensity');
    if (intEl) { intEl.value = charToneIntensity; syncCharIntensity(); }
  }
  if (data.style) {
    slots = { ...(data.style.slots || {}) };
    locked = new Set(data.style.locked || []);
    mode = data.style.mode || 'full';
    lang = data.style.lang || 'zh';
    styleHistory = data.style.history || [];
  }
  if (data.search && typeof VoidSearch !== 'undefined') {
    VoidSearch.restoreSession(data.search);
  }
  if (data.jewel) {
    jewelSlots = { ...(data.jewel.slots || {}) };
    jewelLocked = new Set(data.jewel.locked || []);
    jewelMode = data.jewel.mode || 'full';
    jewelLang = data.jewel.lang || 'zh';
    jewelFmt = data.jewel.fmt || 'structured';
    jewelActiveCats = new Set(data.jewel.categories || ['all']);
    jewelHistory = data.jewel.history || [];
    document.querySelectorAll('#jewel-mode-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.jmode === jewelMode));
    document.querySelectorAll('#view-jewel [data-jlang]').forEach(c => c.classList.toggle('on', c.dataset.jlang === jewelLang));
    setJewelFmt(jewelFmt);
    renderJewelCatChips();
  } else {
    jewelSlots = {};
    jewelLocked = new Set();
    jewelMode = 'full';
    jewelLang = 'zh';
    jewelFmt = 'structured';
    jewelActiveCats = new Set(['all']);
    jewelHistory = [];
    document.querySelectorAll('#jewel-mode-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.jmode === 'full'));
    document.querySelectorAll('#view-jewel [data-jlang]').forEach(c => c.classList.toggle('on', c.dataset.jlang === 'zh'));
    setJewelFmt('structured');
    renderJewelCatChips();
    generateJewel();
  }
  if (data.space) {
    spaceSlots = { ...(data.space.slots || {}) };
    spaceLocked = new Set(data.space.locked || []);
    spaceMode = data.space.mode || 'full';
    spaceLang = data.space.lang || 'zh';
    spaceFmt = data.space.fmt || 'structured';
    spaceActiveCats = new Set(data.space.categories || ['all']);
    spaceStylePools = new Set(data.space.stylePools || ['all']);
    spaceCards = (data.space.cards || []).map(c => ({ ...(c || {}) }));
    spaceActiveCard = data.space.activeCard ?? 0;
    spaceHistory = data.space.history || [];
    document.querySelectorAll('#space-mode-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.smode === spaceMode));
    document.querySelectorAll('#view-space [data-slang]').forEach(c => c.classList.toggle('on', c.dataset.slang === spaceLang));
    const scEl = document.getElementById('space-style-count');
    if (scEl && data.space.styleCount) { scEl.value = data.space.styleCount; syncSlider('space-style-count'); }
    setSpaceFmt(spaceFmt);
    renderSpaceCatChips();
    renderSpaceStylePoolChips();
    renderSpaceStyleCodeHint();
  } else {
    spaceSlots = {};
    spaceLocked = new Set();
    spaceMode = 'full';
    spaceLang = 'zh';
    spaceFmt = 'structured';
    spaceActiveCats = new Set(['all']);
    spaceStylePools = new Set(['all']);
    spaceCards = [];
    spaceActiveCard = 0;
    spaceHistory = [];
    document.querySelectorAll('#space-mode-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.smode === 'full'));
    document.querySelectorAll('#view-space [data-slang]').forEach(c => c.classList.toggle('on', c.dataset.slang === 'zh'));
    setSpaceFmt('structured');
    renderSpaceCatChips();
    renderSpaceStylePoolChips();
    renderSpaceStyleCodeHint();
    generateSpaceCards();
  }
  renderChar();
  renderStyle();
  renderJewel();
  renderSpace();
  renderCharHistory();
  renderStyleHistory();
  renderJewelHistory();
  renderSpaceHistory();
  if (typeof VoidSearch !== 'undefined') VoidSearch.renderUI();
}

function saveActiveSession() {
  try {
    if (!activeSessionId || !sessions?.length) return;
    const idx = sessions.findIndex(s => s.id === activeSessionId);
    if (idx < 0) return;
    const snap = captureSessionSnapshot();
    if (!snap) return;
    sessions[idx].data = snap;
    sessions[idx].updatedAt = Date.now();
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (e) { console.error('saveActiveSession', e); }
}

function loadSessionsFromStorage() {
  try {
    sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch { sessions = []; }
  activeSessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
  if (!sessions.length) {
    const id = newSessionId();
    sessions = [{ id, name: 'Session 1', createdAt: Date.now(), updatedAt: Date.now(), data: null }];
    activeSessionId = id;
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  }
  if (!activeSessionId || !sessions.find(s => s.id === activeSessionId)) {
    activeSessionId = sessions[0].id;
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
  }
}

function updateSessionPill() {
  const s = sessions.find(x => x.id === activeSessionId);
  const el = document.getElementById('session-pill');
  if (el) el.textContent = s ? s.name : 'SESSION';
}

function renderSessionList() {
  const list = document.getElementById('session-list');
  if (!list) return;
  list.innerHTML = sessions.map(s => {
    const preview = s.data?.char?.slots?.outfit?.slice(0, 28) || '（空白）';
    const time = new Date(s.updatedAt || s.createdAt).toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
    return `<div class="session-item${s.id === activeSessionId ? ' on' : ''}" onclick="switchSession('${s.id}')">
      <div style="flex:1;min-width:0">
        <div class="session-item-name">${escHtml(s.name)}</div>
        <div class="session-item-meta">${time} · ${escHtml(preview)}…</div>
      </div>
      <div class="session-item-actions" onclick="event.stopPropagation()">
        <span class="session-act" onclick="renameSession('${s.id}')" title="重新命名">✎</span>
        <span class="session-act del" onclick="deleteSession('${s.id}')" title="刪除">×</span>
      </div>
    </div>`;
  }).join('');
}

function openSessionPanel() {
  saveActiveSession();
  renderSessionList();
  document.getElementById('session-overlay').classList.add('open');
}
function closeSessionPanel() { document.getElementById('session-overlay').classList.remove('open'); }

function switchSession(id) {
  if (id === activeSessionId) { closeSessionPanel(); return; }
  saveActiveSession();
  activeSessionId = id;
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
  const s = sessions.find(x => x.id === id);
  applySessionSnapshot(s?.data);
  if (!s?.data) generateChar();
  updateSessionPill();
  renderSessionList();
  closeSessionPanel();
  toast('已切換：' + (s?.name || id));
}

function createNewSession() {
  saveActiveSession();
  const n = sessions.length + 1;
  const id = newSessionId();
  sessions.push({ id, name: 'Session ' + n, createdAt: Date.now(), updatedAt: Date.now(), data: null });
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  switchSession(id);
  charLocked.clear();
  generateChar();
  toast('已建立新 Session');
}

function duplicateCurrentSession() {
  saveActiveSession();
  const cur = sessions.find(s => s.id === activeSessionId);
  const id = newSessionId();
  sessions.push({
    id, name: (cur?.name || 'Session') + ' 複本',
    createdAt: Date.now(), updatedAt: Date.now(),
    data: captureSessionSnapshot(),
  });
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  renderSessionList();
  toast('已複製 Session');
}

function renameSession(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  const name = prompt('Session 名稱：', s.name);
  if (!name || !name.trim()) return;
  s.name = name.trim();
  s.updatedAt = Date.now();
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  if (id === activeSessionId) updateSessionPill();
  renderSessionList();
}

function renameCurrentSession() { renameSession(activeSessionId); }

function deleteSession(id) {
  if (sessions.length <= 1) { toast('至少保留一個 Session'); return; }
  const s = sessions.find(x => x.id === id);
  if (!confirm('刪除「' + (s?.name || id) + '」？')) return;
  sessions = sessions.filter(x => x.id !== id);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  if (activeSessionId === id) {
    activeSessionId = sessions[0].id;
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    applySessionSnapshot(sessions[0].data);
    if (!sessions[0].data) generateChar();
  }
  updateSessionPill();
  renderSessionList();
  toast('已刪除 Session');
}

const pickN = (arr,n)=>{const a=[...arr];const r=[];n=Math.min(n,a.length);for(let i=0;i<n;i++){const j=Math.floor(Math.random()*a.length);r.push(a.splice(j,1)[0]);}return r;};
function syncSlider(id){document.getElementById(id+'-val').textContent=document.getElementById(id).value;}
function setMode(m,el){mode=m;document.querySelectorAll('#mode-chips .chip').forEach(c=>c.classList.remove('on'));el.classList.add('on');applyModeDefaults();}
function setLang(l,el){lang=l;document.querySelectorAll('[data-lang]').forEach(c=>c.classList.remove('on'));el.classList.add('on');}
function applyModeDefaults(){
  const checks={quality:'inc-quality',style:'inc-style',subject:'inc-subject',scene:'inc-scene',comp:'inc-comp',light:'inc-light',mood:'inc-mood',detail:'inc-detail'};
  const presets={full:{quality:1,style:1,subject:1,scene:1,comp:1,light:1,mood:1,detail:1},style:{quality:0,style:1,subject:0,scene:0,comp:0,light:0,mood:0,detail:0},scene:{quality:1,style:0,subject:1,scene:1,comp:1,light:1,mood:1,detail:1},chaos:{quality:1,style:1,subject:1,scene:1,comp:1,light:1,mood:1,detail:1}};
  Object.entries(checks).forEach(([k,id])=>{document.getElementById(id).checked=!!presets[mode][k];});
  if(mode==='chaos')document.getElementById('style-count').value=3;else if(mode==='style')document.getElementById('style-count').value=2;
  syncSlider('style-count');
}
function getFilteredStyles(){return activePools.has('all')?STYLE_CODES:STYLE_CODES.filter(s=>activePools.has(s.pool));}
function textFromBank(key){const b=BANKS[key];if(!b)return'';if(lang==='zh')return pick(b.zh);if(lang==='en')return pick(b.en);return Math.random()<.5?pick(b.zh):pick(b.en);}
function rollStyle(){
  const pool=getFilteredStyles();if(!pool.length)return{display:'（無）',prompt:''};
  const chosen=pickN(pool,+document.getElementById('style-count').value);
  const display=chosen.map(s=>`${s.code} · ${lang==='en'?s.en:s.zh}`).join('\n');
  const codes=chosen.map(s=>s.code).join(' + ');
  const desc=chosen.map(s=>lang==='en'?s.en:s.zh).join(', ');
  return{display,prompt:lang==='en'?`style ${codes}: ${desc}`:`風格 ${codes}：${desc}`};
}
function rollSlot(key){return key==='style'?rollStyle():{display:textFromBank(key),prompt:textFromBank(key)};}
function isIncluded(key){const m={quality:'inc-quality',style:'inc-style',subject:'inc-subject',scene:'inc-scene',comp:'inc-comp',light:'inc-light',mood:'inc-mood',detail:'inc-detail'};return document.getElementById(m[key])?.checked;}
function generateAll(){SLOT_KEYS.forEach(k=>{if(!isIncluded(k)){slots[k]=null;return;}if(!locked.has(k))slots[k]=rollSlot(k);});renderStyle();}
function rerollSlot(key){if(!isIncluded(key))return;slots[key]=rollSlot(key);renderStyle();}
function toggleLock(key){locked.has(key)?locked.delete(key):locked.add(key);renderStyleSlots();}
function buildStylePrompt(){
  const parts=[];SLOT_KEYS.forEach(k=>{if(slots[k]?.prompt)parts.push(slots[k].prompt);});
  if(!parts.length)return'';
  if(mode==='chaos'&&Math.random()<.4)for(let i=parts.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[parts[i],parts[j]]=[parts[j],parts[i]];}
  return parts.join(lang==='en'?', ':'，');
}
function renderStyle(){
  const text=buildStylePrompt();
  setOutputText('output', text, '請至少勾選一個區塊…');
  document.getElementById('gen-meta').textContent=text?`${text.length} 字`:'—';
  renderStyleSlots();
}
function renderStyleSlots(){
  const active=document.activeElement;
  const activeKey=active?.dataset?.slotKey;
  document.getElementById('slots').innerHTML=SLOT_KEYS.filter(isIncluded).map(key=>{
    const s=slots[key],lc=locked.has(key)?' locked':'';
    const val=(activeKey===key&&active?.classList?.contains('slot-edit'))?active.value:(s?.display||s?.prompt||'');
    return`<div class="slot${lc}" ondblclick="toggleLock('${key}')"><div class="slot-label">${SLOT_LABELS[key]}<span class="slot-reroll" onclick="event.stopPropagation();rerollSlot('${key}')">↻</span></div><textarea class="slot-edit" data-slot-key="${key}" rows="2" oninput="onStyleSlotEdit('${key}',this)" onblur="commitStyleSlotEdit('${key}')" ondblclick="event.stopPropagation()">${escTextarea(val)}</textarea></div>`;
  }).join('');
}
function onStyleSlotEdit(key,el){
  const v=el.value.trim();
  slots[key]={display:v,prompt:v};
  setOutputText('output', buildStylePrompt(), '請至少勾選一個區塊…');
  document.getElementById('gen-meta').textContent=v?`${buildStylePrompt().length} 字`:'—';
}
function commitStyleSlotEdit(){ saveActiveSession(); }
function commitStyleOutputEdit(){
  const text=document.getElementById('output')?.value?.trim();
  if(!text) return;
  const keys=SLOT_KEYS.filter(isIncluded);
  const parts=splitPromptList(text);
  if(parts.length===keys.length){
    keys.forEach((k,i)=>{slots[k]={display:parts[i],prompt:parts[i]};});
  } else if(parts.length===1&&keys[0]){
    slots[keys[0]]={display:text,prompt:text};
  } else {
    keys.forEach((k,i)=>{if(parts[i])slots[k]={display:parts[i],prompt:parts[i]};});
  }
  renderStyleSlots();
  saveActiveSession();
}
function getStylePromptText(){
  const out=document.getElementById('output');
  return (out?.value?.trim()) || buildStylePrompt();
}
function copyStyleOutput(){const t=getStylePromptText();if(!t)return toast('尚無內容');navigator.clipboard.writeText(t).then(()=>toast('已複製'));}
function addStyleHistory(){const t=getStylePromptText();if(!t)return;styleHistory.unshift({text:t,ts:Date.now()});styleHistory=styleHistory.slice(0,30);saveActiveSession();renderStyleHistory();toast('已加入歷史');}
function clearStyleHistory(){styleHistory=[];saveActiveSession();renderStyleHistory();}
function renderStyleHistory(){
  const list=document.getElementById('hist-list');
  if(!styleHistory.length){list.innerHTML='<div class="meta">尚無紀錄</div>';return;}
  list.innerHTML=styleHistory.map((h,i)=>`<div class="hist-item" onclick="loadStyleHistory(${i})">${escHtml(h.text.slice(0,80))}…</div>`).join('');
}
function loadStyleHistory(i){
  const h=styleHistory[i];
  if(!h) return;
  const out=document.getElementById('output');
  if(out){ out.value=h.text; out.classList.remove('empty'); }
  commitStyleOutputEdit();
  toast('已載入');
}
function exportStyleConfig(){
  const blob=new Blob([JSON.stringify({mode,lang,activePools:[...activePools]},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='void-rng-config.json';a.click();
}
function importStyleConfig(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const c=JSON.parse(r.result);if(c.mode)mode=c.mode;if(c.lang)lang=c.lang;if(c.activePools){activePools=new Set(c.activePools);renderPoolChips();}toast('已匯入');}catch{toast('匯入失敗');}};r.readAsText(f);};inp.click();
}
function renderPoolChips(){
  document.getElementById('pool-chips').innerHTML=POOLS.map(p=>`<span class="chip${activePools.has(p.id)?' on':''}" onclick="togglePool('${p.id}')">${p.label}</span>`).join('');
}
function togglePool(id){
  if(id==='all')activePools=new Set(['all']);
  else{activePools.delete('all');activePools.has(id)?activePools.delete(id):activePools.add(id);if(!activePools.size)activePools.add('all');}
  renderPoolChips();
}

// ═══════════════════════════════════════════════════════════════════
// 飾品 PROMPT 生成器
// ═══════════════════════════════════════════════════════════════════
const JEWEL_CATEGORIES = [
  { id:'all', label:'全部' },
  { id:'silver', label:'銀飾' },
  { id:'wood_pendant', label:'木質墜子' },
  { id:'ring', label:'戒指' },
  { id:'necklace', label:'項鍊' },
  { id:'home_acc', label:'家飾品' },
  { id:'decor', label:'擺設' },
  { id:'furniture', label:'家具' },
  { id:'designer_furniture', label:'設計師家具' },
];

const JEWEL_SECTIONS = [
  { key:'quality',  label:'QUALITY / TECHNICAL',  zh:'品質標籤' },
  { key:'product',  label:'Product Type',         zh:'產品類型' },
  { key:'material', label:'Material & Craft',     zh:'材質工藝' },
  { key:'form',     label:'Form & Design',         zh:'造型設計' },
  { key:'craft',    label:'Craftsmanship',        zh:'工藝細節' },
  { key:'surface',  label:'Surface & Texture',    zh:'表面質感' },
  { key:'scene',    label:'Scene & Staging',      zh:'場景佈置' },
  { key:'light',    label:'Lighting',             zh:'光線氛圍' },
  { key:'style',    label:'Style Reference',      zh:'風格調性' },
  { key:'detail',   label:'Detail Tags',          zh:'細節修飾' },
];

const JEWEL_BANKS = {
  quality: [
    { zh:'傑作，最高品質，超精細，8K 產品攝影', en:'masterpiece, best quality, ultra detailed, 8k product photography', cats:['*'] },
    { zh:'商業級產品照，銳利對焦，無浮水印', en:'commercial product shot, sharp focus, no watermark, clean background', cats:['*'] },
    { zh:'微距特寫，材質紋理清晰，專業棚拍', en:'macro close-up, material texture visible, professional studio shot', cats:['silver','ring','necklace','wood_pendant'] },
    { zh:'室內設計攝影，高動態範圍，真實比例', en:'interior design photography, high dynamic range, accurate scale', cats:['home_acc','decor','furniture','designer_furniture'] },
    { zh:'設計師目錄級影像，完美構圖，雜誌質感', en:'designer catalog imagery, perfect composition, editorial quality', cats:['designer_furniture','furniture','decor'] },
  ],
  product: [
    { zh:'925 純銀手作飾品，單品展示', en:'925 sterling silver handmade jewelry, single piece display', cats:['silver'] },
    { zh:'手工銀飾，氧化做舊質感，藝匠風格', en:'handcrafted silver jewelry, oxidized patina, artisan style', cats:['silver'] },
    { zh:'手工雕刻木質墜子，吊飾單品', en:'hand-carved wooden pendant charm, single pendant piece', cats:['wood_pendant'] },
    { zh:'胡桃木／楓木墜飾，繩鍊搭配', en:'walnut or maple wood pendant with cord necklace', cats:['wood_pendant'] },
    { zh:'極簡銀戒指，單枚戒台特寫', en:'minimalist silver ring, single band close-up', cats:['ring'] },
    { zh:'寬版手工銀戒，鑲石或無鑲設計', en:'wide handcrafted silver ring, with or without stone setting', cats:['ring'] },
    { zh:'純銀項鍊，吊墜居中構圖', en:'sterling silver necklace, centered pendant composition', cats:['necklace'] },
    { zh:'層疊式銀鍊＋木質墜子項鍊', en:'layered silver chain necklace with wooden pendant', cats:['necklace','wood_pendant'] },
    { zh:'家飾擺件，桌面陳列小物', en:'home accessory decor object, tabletop display piece', cats:['home_acc'] },
    { zh:'陶瓷／金屬家飾，玄關或邊桌擺飾', en:'ceramic or metal home accent, entryway or side table decor', cats:['home_acc','decor'] },
    { zh:'雕塑感擺設，靜物陳列', en:'sculptural decor object, still life arrangement', cats:['decor'] },
    { zh:'北歐風擺件，幾何或有機造型', en:'Scandinavian decor piece, geometric or organic form', cats:['decor','home_acc'] },
    { zh:'單件家具，椅／邊桌／層架', en:'single furniture piece, chair side table or shelving unit', cats:['furniture'] },
    { zh:'實木＋金屬結構家具，功能單品', en:'wood and metal structure furniture, functional single piece', cats:['furniture'] },
    { zh:'設計師家具，限量概念單椅', en:'designer furniture, limited edition concept chair', cats:['designer_furniture'] },
    { zh:'建築感設計師邊桌，雕塑線條', en:'architectural designer side table, sculptural lines', cats:['designer_furniture','furniture'] },
    { zh:'當代設計師沙發單元，模組家具', en:'contemporary designer sofa module, modular furniture', cats:['designer_furniture'] },
  ],
  material: [
    { zh:'925 純銀，亮面拋光', en:'925 sterling silver, polished mirror finish', cats:['silver','ring','necklace'] },
    { zh:'霧面銀，手工捶紋', en:'matte silver, hand-hammered texture', cats:['silver','ring'] },
    { zh:'氧化黑銀，復古銀飾質感', en:'oxidized blackened silver, vintage silver jewelry look', cats:['silver','necklace'] },
    { zh:'實木：胡桃木紋理，天然木節', en:'solid walnut wood grain, natural burl and knots', cats:['wood_pendant','home_acc'] },
    { zh:'楓木／梣木，淺色木質墜子', en:'maple or ash wood, light tone wooden pendant', cats:['wood_pendant'] },
    { zh:'銀＋木複合：銀框包鑲木墜', en:'silver and wood composite, silver bezel holding wood insert', cats:['wood_pendant','necklace','silver'] },
    { zh:'鍍銀＋天然石（月光石／拉長石）', en:'silver plated with natural stone, moonstone or labradorite', cats:['ring','necklace','silver'] },
    { zh:'黃銅點綴銀飾，雙色金屬', en:'brass accent on silver jewelry, two-tone metal', cats:['silver','ring'] },
    { zh:'陶瓷釉面家飾，粗陶質感', en:'glazed ceramic home decor, stoneware texture', cats:['home_acc','decor'] },
    { zh:'吹製玻璃擺設，透明折射', en:'blown glass decor object, transparent refraction', cats:['decor','home_acc'] },
    { zh:'橡木實木家具，開放漆面', en:'oak solid wood furniture, open pore finish', cats:['furniture','designer_furniture'] },
    { zh:'胡桃木＋不鏽鋼腳架，設計師材質', en:'walnut and stainless steel legs, designer material combo', cats:['designer_furniture','furniture'] },
    { zh:'皮革軟包＋金屬骨架', en:'leather upholstery with metal frame', cats:['designer_furniture','furniture'] },
  ],
  form: [
    { zh:'極簡幾何圓環，細線條銀飾', en:'minimal geometric circle ring, fine line silver jewelry', cats:['silver','ring'] },
    { zh:'流動有機曲線，手工鍛造造型', en:'flowing organic curves, hand-forged sculptural form', cats:['silver','necklace'] },
    { zh:'圓形木墜，雷射雕刻圖騰', en:'round wood pendant, laser engraved motif', cats:['wood_pendant'] },
    { zh:'水滴形木質吊墜，手工削磨', en:'teardrop wooden pendant, hand-carved and sanded', cats:['wood_pendant'] },
    { zh:'開口戒，可調式銀戒', en:'open band ring, adjustable silver ring', cats:['ring'] },
    { zh:'印章戒面，平面刻字區', en:'signet ring face, flat engraved surface', cats:['ring'] },
    { zh:'Y 字鍊＋單墜，鎖骨鍊構圖', en:'Y-chain necklace with single pendant, collarbone length', cats:['necklace'] },
    { zh:'多層次鍊條，長短混搭項鍊', en:'multi-layer chain necklace, mixed length strands', cats:['necklace'] },
    { zh:'不對稱耳環式墜飾（項鍊墜）', en:'asymmetric drop pendant design for necklace', cats:['necklace','wood_pendant'] },
    { zh:'圓形托盤擺飾，淺皿家飾', en:'round tray decor, shallow dish home accent', cats:['home_acc','decor'] },
    { zh:'拱門造型擺件，建築隱喻', en:'arch-shaped decor object, architectural metaphor', cats:['decor'] },
    { zh:'細腳邊桌，懸浮感桌面', en:'slim leg side table, floating tabletop feel', cats:['furniture','designer_furniture'] },
    { zh:'曲線單椅，包覆式椅背', en:'curved lounge chair, enveloping backrest', cats:['designer_furniture','furniture'] },
    { zh:'模組層架，格柵結構', en:'modular shelving unit, grid structure', cats:['furniture'] },
    { zh:'雕塑底座＋台面，展示型家具', en:'sculptural base with top surface, display furniture', cats:['designer_furniture','decor'] },
  ],
  craft: [
    { zh:'手工鍛造銀飾，捶痕可見', en:'hand-forged silver, visible hammer marks', cats:['silver','ring'] },
    { zh:'失蠟鑄造，精緻銀飾細節', en:'lost-wax casting, refined silver jewelry detail', cats:['silver','necklace'] },
    { zh:'手工鋸切木墜，邊緣圓角打磨', en:'hand-sawn wood pendant, rounded edge sanding', cats:['wood_pendant'] },
    { zh:'木墜燙金／烙刻圖案', en:'wood pendant with gold foil or brand engraving', cats:['wood_pendant'] },
    { zh:'銀戒手工鑲石，爪鑲工藝', en:'hand-set stone on silver ring, prong setting', cats:['ring'] },
    { zh:'鍊條手工焊接，一環一環編織', en:'hand-linked chain, link by link soldering', cats:['necklace','silver'] },
    { zh:'手工編織皮繩搭配銀墜', en:'hand-braided leather cord with silver charm', cats:['necklace','wood_pendant'] },
    { zh:'陶藝手捏家飾，不規則手作感', en:'hand-pinched ceramic home decor, irregular handmade feel', cats:['home_acc'] },
    { zh:'吹玻璃手工擺設，氣泡紋理', en:'hand-blown glass decor, bubble texture', cats:['decor'] },
    { zh:'榫接木工家具，無釘結構', en:'mortise tenon wood furniture, no-nail joinery', cats:['furniture'] },
    { zh:'設計師限量打樣，原型家具', en:'designer limited prototype furniture piece', cats:['designer_furniture'] },
    { zh:'CNC 精密切割＋手工組裝', en:'CNC precision cut with hand assembly', cats:['designer_furniture','furniture'] },
  ],
  surface: [
    { zh:'鏡面拋光銀，高光反射', en:'mirror polished silver, high specular reflection', cats:['silver','ring'] },
    { zh:'拉絲霧銀，方向性紋理', en:'brushed matte silver, directional grain texture', cats:['silver','necklace'] },
    { zh:'氧化層保護，深灰銀色', en:'oxidized protective layer, dark grey silver tone', cats:['silver'] },
    { zh:'木質上油保護，溫潤光澤', en:'oiled wood protection, warm satin sheen', cats:['wood_pendant','furniture'] },
    { zh:'原木粗磨木墜，觸感木紋', en:'raw sanded wood pendant, tactile grain', cats:['wood_pendant'] },
    { zh:'霧面噴砂銀飾，柔光漫射', en:'sandblasted matte silver, soft diffuse light', cats:['ring','silver'] },
    { zh:'釉面光滑陶瓷，細膩反光', en:'smooth glazed ceramic, subtle glossy reflection', cats:['home_acc','decor'] },
    { zh:'皮革自然褶皺，使用痕跡', en:'natural leather creases, lived-in patina', cats:['designer_furniture','furniture'] },
    { zh:'木蜡油塗裝，開放毛孔質感', en:'hardwax oil finish, open pore wood texture', cats:['furniture','designer_furniture'] },
  ],
  scene: [
    { zh:'白色無縫棚拍背景，電商產品照', en:'white seamless studio backdrop, e-commerce product photo', cats:['silver','ring','necklace','wood_pendant'] },
    { zh:'亚麻布＋石材台面，自然質感靜物', en:'linen and stone surface, natural still life staging', cats:['silver','home_acc','decor'] },
    { zh:'深色絲絨襯底，珠寶攝影氛圍', en:'dark velvet backdrop, jewelry photography mood', cats:['silver','ring','necklace'] },
    { zh:'木質桌面＋綠植點綴，生活風家飾', en:'wooden table with green plant accent, lifestyle home decor', cats:['home_acc','decor','wood_pendant'] },
    { zh:'北歐客廳一角，淺色木地板', en:'Scandinavian living room corner, light wood floor', cats:['furniture','designer_furniture','home_acc'] },
    { zh:'設計師工作室空間，水泥牆背景', en:'designer studio space, concrete wall background', cats:['designer_furniture','furniture'] },
    { zh:'藝廊白牆陳列，博物館式擺設', en:'gallery white wall display, museum-like staging', cats:['decor','designer_furniture'] },
    { zh:'窗邊自然光場景，居家生活感', en:'window-side natural light scene, domestic lifestyle', cats:['home_acc','furniture','necklace'] },
    { zh:'玄關置物台，入口陳列', en:'entryway console staging, entrance vignette', cats:['home_acc','decor'] },
  ],
  light: [
    { zh:'柔光箱均勻照明，無硬影', en:'softbox even lighting, no harsh shadows', cats:['*'] },
    { zh:'側光強調金屬高光，立體輪廓', en:'side light emphasizing metal highlights, dimensional contour', cats:['silver','ring','necklace'] },
    { zh:'頂光微距，材質紋理清晰', en:'top light macro setup, clear material texture', cats:['wood_pendant','silver'] },
    { zh:'窗光漫射，溫暖午後色溫', en:'diffused window light, warm afternoon color temperature', cats:['home_acc','furniture','decor'] },
    { zh:'低角度氛圍光，室內設計攝影', en:'low angle ambient light, interior design photography', cats:['furniture','designer_furniture'] },
    { zh:'冷調設計師光，高對比陰影', en:'cool designer lighting, high contrast shadows', cats:['designer_furniture','decor'] },
    { zh:'金色輪廓光，飾品邊緣高光', en:'golden rim light, jewelry edge highlight', cats:['silver','necklace','ring'] },
  ],
  style: [
    { zh:'北歐極簡，克制線條', en:'Scandinavian minimalism, restrained lines', cats:['*'] },
    { zh:'日式侘寂，不完美之美', en:'Japanese wabi-sabi, imperfect beauty', cats:['wood_pendant','home_acc','decor'] },
    { zh:'手工藝匠風，獨一無二', en:'artisan craft style, one-of-a-kind', cats:['silver','wood_pendant','ring'] },
    { zh:'當代珠寶設計，雕塑感', en:'contemporary jewelry design, sculptural', cats:['silver','necklace','ring'] },
    { zh:'波希米亞自然風，編織與木質', en:'bohemian natural style, woven and wooden elements', cats:['wood_pendant','necklace','home_acc'] },
    { zh:'現代主義家具，功能主義', en:'modernist furniture, functionalism', cats:['furniture','designer_furniture'] },
    { zh:'中古世紀現代 MCM，復古設計師風', en:'mid-century modern MCM, retro designer aesthetic', cats:['designer_furniture','furniture'] },
    { zh:'工業風家飾，金屬與粗獷', en:'industrial home decor, metal and raw aesthetic', cats:['home_acc','decor','furniture'] },
    { zh:'精品珠寶目錄風，奢雅克制', en:'fine jewelry catalog style, refined luxury restraint', cats:['silver','ring','necklace'] },
    { zh:'設計週展場風，概念家具展示', en:'design week exhibition style, concept furniture showcase', cats:['designer_furniture'] },
  ],
  detail: [
    { zh:'細節對焦銀飾扣頭與鍊節', en:'detail focus on silver clasp and chain links', cats:['necklace','silver'] },
    { zh:'木墜繩結特寫，手工編織', en:'close-up wood pendant cord knot, hand braided', cats:['wood_pendant','necklace'] },
    { zh:'戒台內側刻字細節', en:'inner band engraving detail on ring', cats:['ring'] },
    { zh:'木紋年輪特寫，自然紋理', en:'wood grain growth ring close-up, natural pattern', cats:['wood_pendant','furniture'] },
    { zh:'家具接合處特寫，工藝節點', en:'furniture joint close-up, craftsmanship node', cats:['furniture','designer_furniture'] },
    { zh:'擺設與書本／花器搭配，生活場景', en:'decor styled with books and vase, lifestyle scene', cats:['home_acc','decor'] },
    { zh:'銀飾與肌膚對比，佩戴示意', en:'silver jewelry against skin contrast, wear reference', cats:['ring','necklace','silver'] },
    { zh:'設計師標籤與比例尺，目錄細節', en:'designer label and scale reference, catalog detail', cats:['designer_furniture','furniture'] },
    { zh:'陰影層次豐富，靜物深度感', en:'rich shadow layers, still life depth', cats:['*'] },
  ],
};

const JEWEL_MODE_PRESETS = {
  full:     { quality:1, product:1, material:1, form:1, craft:1, surface:1, scene:1, light:1, style:1, detail:1 },
  product:  { quality:1, product:1, material:1, form:1, craft:1, surface:1, scene:0, light:1, style:1, detail:1 },
  interior: { quality:1, product:1, material:1, form:1, craft:0, surface:1, scene:1, light:1, style:1, detail:1 },
  studio:   { quality:1, product:1, material:1, form:1, craft:1, surface:1, scene:1, light:1, style:0, detail:0 },
};

let jewelActiveCats = new Set(['all']);
let jewelMode = 'full';
let jewelLang = 'zh';
let jewelFmt = 'structured';
let jewelSlots = {};
let jewelLocked = new Set();
let jewelHistory = [];

function jewelText(item) {
  if (!item) return '';
  if (jewelLang === 'zh') return item.zh;
  if (jewelLang === 'en') return item.en;
  return Math.random() < 0.5 ? item.zh : item.en;
}

function getJewelBankFiltered(key) {
  const bank = JEWEL_BANKS[key] || [];
  if (jewelActiveCats.has('all')) return bank;
  return bank.filter(item =>
    !item.cats || item.cats.includes('*') || item.cats.some(c => jewelActiveCats.has(c))
  );
}

function rollJewelSection(key) {
  const bank = getJewelBankFiltered(key);
  if (!bank.length) {
    const fallback = JEWEL_BANKS[key] || [];
    return jewelText(pick(fallback) || { zh:'', en:'' });
  }
  return jewelText(pick(bank));
}

function jewelIsIncluded(key) {
  return document.getElementById('jewel-inc-' + key)?.checked !== false;
}

function setJewelMode(m, el) {
  jewelMode = m;
  document.querySelectorAll('#jewel-mode-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.jmode === m));
  const preset = JEWEL_MODE_PRESETS[m] || JEWEL_MODE_PRESETS.full;
  JEWEL_SECTIONS.forEach(s => {
    const el2 = document.getElementById('jewel-inc-' + s.key);
    if (el2) el2.checked = !!preset[s.key];
  });
  renderJewel();
}

function setJewelLang(l) {
  jewelLang = l;
  document.querySelectorAll('#view-jewel [data-jlang]').forEach(c => c.classList.toggle('on', c.dataset.jlang === l));
  renderJewel();
}

function setJewelFmt(f) {
  jewelFmt = f;
  document.getElementById('jewel-fmt-structured')?.classList.toggle('on', f === 'structured');
  document.getElementById('jewel-fmt-flat')?.classList.toggle('on', f === 'flat');
  renderJewel();
}

function toggleJewelCat(id) {
  if (id === 'all') {
    jewelActiveCats = new Set(['all']);
  } else {
    jewelActiveCats.delete('all');
    jewelActiveCats.has(id) ? jewelActiveCats.delete(id) : jewelActiveCats.add(id);
    if (!jewelActiveCats.size) jewelActiveCats.add('all');
  }
  renderJewelCatChips();
  if (!jewelLocked.size) generateJewel();
}

function renderJewelCatChips() {
  const el = document.getElementById('jewel-cat-chips');
  if (!el) return;
  el.innerHTML = JEWEL_CATEGORIES.map(c =>
    `<span class="chip${jewelActiveCats.has(c.id) ? ' on' : ''}" onclick="toggleJewelCat('${c.id}')">${c.label}</span>`
  ).join('');
}

function renderJewelIncChecks() {
  const el = document.getElementById('jewel-inc-checks');
  if (!el) return;
  el.innerHTML = JEWEL_SECTIONS.map(s =>
    `<label class="chk-row"><input type="checkbox" id="jewel-inc-${s.key}" checked onchange="renderJewel()"> ${s.zh}</label>`
  ).join('');
}

function generateJewel() {
  JEWEL_SECTIONS.forEach(s => {
    if (!jewelIsIncluded(s.key)) { jewelSlots[s.key] = ''; return; }
    if (!jewelLocked.has(s.key)) jewelSlots[s.key] = rollJewelSection(s.key);
  });
  renderJewel();
}

function rerollJewelSlot(key) {
  if (!jewelIsIncluded(key) || jewelLocked.has(key)) return;
  jewelSlots[key] = rollJewelSection(key);
  renderJewel();
}

function toggleJewelLock(key) {
  jewelLocked.has(key) ? jewelLocked.delete(key) : jewelLocked.add(key);
  renderJewelSlots();
}

function buildJewelPrompt() {
  const parts = [];
  JEWEL_SECTIONS.forEach(s => {
    if (!jewelIsIncluded(s.key) || !jewelSlots[s.key]) return;
    if (jewelFmt === 'structured') {
      parts.push(`// ❖ ${s.label}\n${jewelSlots[s.key]}`);
    } else {
      parts.push(jewelSlots[s.key]);
    }
  });
  return jewelFmt === 'structured' ? parts.join('\n\n') : parts.join(', ');
}

function buildJewelTagsOnly() {
  return JEWEL_SECTIONS.filter(s => jewelIsIncluded(s.key) && jewelSlots[s.key]).map(s => jewelSlots[s.key]).join(', ');
}

function renderJewel() {
  const text = buildJewelPrompt();
  setOutputText('jewel-output', text, '請至少勾選一個區塊…');
  const cats = [...jewelActiveCats].filter(c => c !== 'all').map(c => JEWEL_CATEGORIES.find(x => x.id === c)?.label || c).join('·') || '全部';
  const meta = document.getElementById('jewel-meta');
  if (meta) meta.textContent = `${buildJewelTagsOnly().length} 字 · ${cats} · ${jewelMode}`;
  renderJewelSlots();
}

function renderJewelSlots() {
  const el = document.getElementById('jewel-slots');
  if (!el) return;
  const active = document.activeElement;
  const activeKey = active?.dataset?.slotKey;
  el.innerHTML = JEWEL_SECTIONS.filter(s => jewelIsIncluded(s.key)).map(s => {
    const val = (activeKey === s.key && active?.classList?.contains('slot-edit')) ? active.value : (jewelSlots[s.key] || '');
    const lc = jewelLocked.has(s.key) ? ' locked' : '';
    return `<div class="slot${lc}" ondblclick="toggleJewelLock('${s.key}')">
      <div class="slot-label">${s.zh}<span class="slot-reroll" onclick="event.stopPropagation();rerollJewelSlot('${s.key}')">↻</span></div>
      <textarea class="slot-edit" data-slot-key="${s.key}" rows="2" oninput="onJewelSlotEdit('${s.key}', this)" onblur="commitJewelSlotEdit()" ondblclick="event.stopPropagation()">${escTextarea(val)}</textarea>
    </div>`;
  }).join('');
}

function onJewelSlotEdit(key, el) {
  jewelSlots[key] = el.value;
  setOutputText('jewel-output', buildJewelPrompt(), '請至少勾選一個區塊…');
  const meta = document.getElementById('jewel-meta');
  if (meta) {
    const cats = [...jewelActiveCats].filter(c => c !== 'all').map(c => JEWEL_CATEGORIES.find(x => x.id === c)?.label || c).join('·') || '全部';
    meta.textContent = `${buildJewelTagsOnly().length} 字 · ${cats} · ${jewelMode}`;
  }
}

function commitJewelSlotEdit() { saveActiveSession(); }

function commitJewelOutputEdit() {
  const text = document.getElementById('jewel-output')?.value?.trim();
  if (!text) return;
  if (jewelFmt === 'structured' || text.includes('// ❖')) {
    const parsed = parseStructuredSections(text, JEWEL_SECTIONS);
    JEWEL_SECTIONS.forEach(s => {
      if (!jewelIsIncluded(s.key)) return;
      if (parsed[s.key] !== undefined) jewelSlots[s.key] = parsed[s.key];
    });
  } else {
    assignListToSlots(text, JEWEL_SECTIONS, jewelSlots, jewelIsIncluded);
  }
  renderJewelSlots();
  saveActiveSession();
}

function getJewelPromptText() {
  const out = document.getElementById('jewel-output');
  return (out?.value?.trim()) || buildJewelPrompt();
}

function copyJewelOutput() {
  const t = getJewelPromptText();
  if (!t) return toast('尚無內容');
  navigator.clipboard.writeText(t).then(() => toast('已複製'));
}

function copyJewelTagsOnly() {
  const t = buildJewelTagsOnly();
  if (!t) return toast('尚無內容');
  navigator.clipboard.writeText(t).then(() => toast('已複製標籤'));
}

function addJewelHistory() {
  const t = getJewelPromptText();
  if (!t) return;
  jewelHistory.unshift({ text: t, ts: Date.now() });
  jewelHistory = jewelHistory.slice(0, 30);
  saveActiveSession();
  renderJewelHistory();
  toast('已加入歷史');
}

function renderJewelHistory() {
  const list = document.getElementById('jewel-hist-list');
  if (!list) return;
  if (!jewelHistory.length) { list.innerHTML = '<div class="meta">尚無紀錄</div>'; return; }
  list.innerHTML = jewelHistory.map((h, i) =>
    `<div class="hist-item" onclick="loadJewelHistory(${i})">${escHtml(h.text.slice(0, 72).replace(/\n/g, ' '))}…</div>`
  ).join('');
}

function loadJewelHistory(i) {
  const out = document.getElementById('jewel-output');
  if (!out || !jewelHistory[i]) return;
  out.value = jewelHistory[i].text;
  out.classList.remove('empty');
  commitJewelOutputEdit();
  toast('已載入');
}

function exportJewelConfig() {
  const blob = new Blob([JSON.stringify({
    mode: jewelMode, lang: jewelLang, fmt: jewelFmt,
    categories: [...jewelActiveCats], slots: jewelSlots, history: jewelHistory,
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'void-jewel-config.json';
  a.click();
}

function importJewelConfig() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const c = JSON.parse(r.result);
        if (c.mode) { jewelMode = c.mode; document.querySelector(`#jewel-mode-chips [data-jmode="${c.mode}"]`)?.click(); }
        if (c.lang) { jewelLang = c.lang; document.querySelector(`[data-jlang="${c.lang}"]`)?.click(); }
        if (c.fmt) setJewelFmt(c.fmt);
        if (c.categories) { jewelActiveCats = new Set(c.categories); renderJewelCatChips(); }
        if (c.slots) jewelSlots = c.slots;
        if (c.history) jewelHistory = c.history;
        renderJewel();
        renderJewelHistory();
        toast('飾品設定已匯入');
      } catch { toast('匯入失敗'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ═══════════════════════════════════════════════════════════════════
// 場景·空間 PROMPT 生成器（六卡）
// ═══════════════════════════════════════════════════════════════════
const SPACE_CARD_COUNT = 6;
const SPACE_BANKS_KEY = 'void-space-banks';

const SPACE_CATEGORIES = [
  { id:'all', label:'全部' },
  { id:'fractal', label:'碎形' },
  { id:'structure', label:'結構' },
  { id:'pattern', label:'花紋' },
  { id:'decon', label:'解構' },
  { id:'minimal', label:'極簡' },
  { id:'inorganic', label:'無機' },
  { id:'void', label:'虛空' },
  { id:'arch', label:'建築感' },
];

const SPACE_SECTIONS = [
  { key:'quality', label:'QUALITY / TECHNICAL', zh:'品質標籤' },
  { key:'styleCode', label:'Style Codes', zh:'風格代號' },
  { key:'scene', label:'Scene', zh:'場景' },
  { key:'space', label:'Spatial Environment', zh:'空間' },
  { key:'fractal', label:'Fractal Form', zh:'碎形體' },
  { key:'structure', label:'Structure', zh:'結構' },
  { key:'pattern', label:'Pattern & Ornament', zh:'花紋' },
  { key:'deconstruct', label:'Deconstructivism', zh:'解構主義' },
  { key:'minimal', label:'Minimalism', zh:'極簡主義' },
  { key:'inorganic', label:'Inorganic Matter', zh:'無機物' },
  { key:'light', label:'Lighting', zh:'光線' },
  { key:'comp', label:'Composition', zh:'構圖' },
  { key:'mood', label:'Mood & Atmosphere', zh:'氛圍' },
  { key:'negative', label:'Negative', zh:'負向' },
];

const DEFAULT_SPACE_BANKS = {
  quality: [
    { zh:'傑作，最高品質，超精細，8K', en:'masterpiece, best quality, ultra-detailed, 8k', cats:['*'] },
  ],
  styleCode: [
    { zh:'風格 n：Null Craft 幾何對稱深灰仿生', en:'style n: Null Craft geometric symmetry deep gray bionic', cats:['void','inorganic','structure'], pool:'null', code:'n' },
    { zh:'風格 fractanull：Fractal Null 骨質裂解晶體', en:'style fractanull: fractal null bone crystal fracture structure', cats:['fractal','inorganic','void'], pool:'null', code:'fractanull' },
    { zh:'風格 fp：Fractal Psy 高對比分形螺旋', en:'style fp: fractal psychedelic high contrast spiral', cats:['fractal'], pool:'psy', code:'fp' },
    { zh:'風格 fx：Fractal Grid Collapse 幾何崩解', en:'style fx: fractal grid collapse pixel geometry breakdown', cats:['decon','fractal'], pool:'glitch', code:'fx' },
    { zh:'風格 lw：Lumenwave 光子流液態虹膜', en:'style lw: lumenwave photon flow liquid iris', cats:['void','minimal'], pool:'light', code:'lw' },
  ],
  scene: [
    { zh:'純黑虛空空間，無地平線', en:'pure black void space, no horizon', cats:['void'] },
  ],
  space: [
    { zh:'巨大尺度虛空，深遠負空間', en:'monumental void scale, deep negative space', cats:['void'] },
  ],
  fractal: [
    { zh:'曼德博碎形邊界，遞迴細節', en:'mandelbrot fractal boundary, recursive detail', cats:['fractal'] },
  ],
  structure: [
    { zh:'桁架網格結構，三角穩定', en:'truss grid structure, triangular stability', cats:['structure'] },
  ],
  pattern: [
    { zh:'蜂巢六邊密鋪花紋', en:'hexagonal honeycomb tessellation pattern', cats:['pattern'] },
  ],
  deconstruct: [
    { zh:'解構主義碎片，軸線錯位', en:'deconstructivist fragments, displaced axis', cats:['decon'] },
  ],
  minimal: [
    { zh:'極簡主義，單一幾何體塊', en:'minimalism, single geometric monolith', cats:['minimal'] },
  ],
  inorganic: [
    { zh:'石英晶簇，無機礦物，無人物', en:'quartz crystal cluster, inorganic mineral, no humans', cats:['inorganic'] },
  ],
  light: [
    { zh:'冷白側光，結構邊緣高光', en:'cool white side light, structural edge highlight', cats:['*'] },
  ],
  comp: [
    { zh:'正中軸對稱構圖', en:'centered axial symmetry composition', cats:['minimal'] },
  ],
  mood: [
    { zh:'空靈寂靜，冥想氛圍', en:'ethereal silence, meditative atmosphere', cats:['void'] },
  ],
  negative: [
    { zh:'無人物，無生物，低品質，模糊', en:'no humans, no creature, low quality, blurry', cats:['*'] },
  ],
};

const SPACE_MODE_PRESETS = {
  full:     { quality:1, styleCode:1, scene:1, space:1, fractal:1, structure:1, pattern:1, deconstruct:1, minimal:1, inorganic:1, light:1, comp:1, mood:1, negative:1 },
  fractal:  { quality:1, styleCode:1, scene:0, space:1, fractal:1, structure:1, pattern:1, deconstruct:0, minimal:0, inorganic:1, light:1, comp:1, mood:1, negative:1 },
  minimal:  { quality:1, styleCode:1, scene:1, space:1, fractal:0, structure:1, pattern:0, deconstruct:0, minimal:1, inorganic:1, light:1, comp:1, mood:1, negative:1 },
  decon:    { quality:1, styleCode:1, scene:1, space:1, fractal:1, structure:1, pattern:0, deconstruct:1, minimal:0, inorganic:1, light:1, comp:1, mood:1, negative:1 },
  void:     { quality:1, styleCode:1, scene:0, space:1, fractal:1, structure:1, pattern:1, deconstruct:1, minimal:1, inorganic:1, light:1, comp:1, mood:1, negative:1 },
};

let SPACE_BANKS = JSON.parse(JSON.stringify(DEFAULT_SPACE_BANKS));
let spaceActiveCats = new Set(['all']);
let spaceStylePools = new Set(['all']);
let spaceMode = 'full';
let spaceLang = 'zh';
let spaceFmt = 'structured';
let spaceSlots = {};
let spaceLocked = new Set();
let spaceCards = [];
let spaceActiveCard = 0;
let spaceHistory = [];

function mergeUserSpaceBanks() {
  try {
    const saved = JSON.parse(localStorage.getItem(SPACE_BANKS_KEY) || '{}');
    Object.keys(saved).forEach(k => {
      if (!Array.isArray(saved[k])) return;
      if (!SPACE_BANKS[k]) SPACE_BANKS[k] = [];
      const seen = new Set(SPACE_BANKS[k].map(i => i.zh + '|' + i.en));
      saved[k].forEach(item => {
        const norm = typeof item === 'string' ? { zh: item, en: item, cats: ['*'] } : item;
        const sig = (norm.zh || '') + '|' + (norm.en || '');
        if (!seen.has(sig)) { SPACE_BANKS[k].push(norm); seen.add(sig); }
      });
    });
  } catch (_) {}
}

function saveSpaceBanks() {
  try {
    const extra = {};
    SPACE_SECTIONS.forEach(s => {
      const defaults = new Set((DEFAULT_SPACE_BANKS[s.key] || []).map(i => i.zh + '|' + i.en));
      const user = (SPACE_BANKS[s.key] || []).filter(i => !defaults.has(i.zh + '|' + i.en));
      if (user.length) extra[s.key] = user;
    });
    localStorage.setItem(SPACE_BANKS_KEY, JSON.stringify(extra));
  } catch (_) {}
}

function spaceText(item) {
  if (!item) return '';
  if (spaceLang === 'zh') return item.zh || item.en || '';
  if (spaceLang === 'en') return item.en || item.zh || '';
  return Math.random() < 0.5 ? (item.zh || item.en || '') : (item.en || item.zh || '');
}

function getSpaceBankFiltered(key) {
  const bank = SPACE_BANKS[key] || [];
  let filtered = bank;
  if (!spaceActiveCats.has('all')) {
    filtered = filtered.filter(item =>
      !item.cats || item.cats.includes('*') || item.cats.some(c => spaceActiveCats.has(c))
    );
  }
  if (key === 'styleCode' && !spaceStylePools.has('all')) {
    filtered = filtered.filter(item => !item.pool || spaceStylePools.has(item.pool));
  }
  return filtered;
}

function getFilteredSpaceStyleCodes() {
  let pool = STYLE_CODES;
  if (!spaceStylePools.has('all')) pool = pool.filter(s => spaceStylePools.has(s.pool));
  if (!spaceActiveCats.has('all')) {
    const bankCodes = new Set(
      (SPACE_BANKS.styleCode || [])
        .filter(item => !item.cats || item.cats.includes('*') || item.cats.some(c => spaceActiveCats.has(c)))
        .map(item => item.code)
        .filter(Boolean)
    );
    if (bankCodes.size) pool = pool.filter(s => bankCodes.has(s.code));
  }
  return pool;
}

function formatSpaceStyleCodes(chosen) {
  if (!chosen.length) return '';
  const codes = chosen.map(s => s.code).join(' + ');
  const desc = chosen.map(s => spaceLang === 'en' ? s.en : s.zh).join(', ');
  if (spaceLang === 'en') return `style ${codes}: ${desc}`;
  if (spaceLang === 'mix') {
    const zhDesc = chosen.map(s => s.zh).join('，');
    return `風格 ${codes}：${zhDesc}`;
  }
  return `風格 ${codes}：${desc}`;
}

function rollSpaceStyleCode() {
  const pool = getFilteredSpaceStyleCodes();
  if (!pool.length) {
    const bank = getSpaceBankFiltered('styleCode');
    if (bank.length) return spaceText(pick(bank));
    return '';
  }
  const n = Math.min(pool.length, +(document.getElementById('space-style-count')?.value || 2));
  const chosen = pickN(pool, n);
  return formatSpaceStyleCodes(chosen);
}

function rollSpaceSection(key) {
  if (key === 'styleCode') return rollSpaceStyleCode();
  const bank = getSpaceBankFiltered(key);
  if (!bank.length) {
    const fallback = SPACE_BANKS[key] || [];
    return spaceText(pick(fallback) || { zh:'', en:'' });
  }
  return spaceText(pick(bank));
}

function spaceIsIncluded(key) {
  return document.getElementById('space-inc-' + key)?.checked !== false;
}

function rollSpaceSlotsFromLocks() {
  const out = {};
  SPACE_SECTIONS.forEach(s => {
    if (!spaceIsIncluded(s.key)) { out[s.key] = ''; return; }
    if (spaceLocked.has(s.key) && spaceSlots[s.key]) out[s.key] = spaceSlots[s.key];
    else out[s.key] = rollSpaceSection(s.key);
  });
  return out;
}

function buildSpacePromptFromSlots(slotsObj) {
  const pos = [];
  const neg = [];
  SPACE_SECTIONS.forEach(s => {
    if (!spaceIsIncluded(s.key) || !slotsObj[s.key]) return;
    if (s.key === 'negative') neg.push(slotsObj[s.key]);
    else if (spaceFmt === 'structured') pos.push(`// ❖ ${s.label}\n${slotsObj[s.key]}`);
    else pos.push(slotsObj[s.key]);
  });
  let text = spaceFmt === 'structured' ? pos.join('\n\n') : pos.join(', ');
  if (neg.length) {
    const negLine = neg.join(', ');
    text += (text ? '\n\n' : '') + `// ❖ Negative\n${negLine}`;
  }
  return text;
}

function buildSpaceTagsOnlyFromSlots(slotsObj) {
  return SPACE_SECTIONS
    .filter(s => spaceIsIncluded(s.key) && s.key !== 'negative' && slotsObj[s.key])
    .map(s => slotsObj[s.key])
    .join(', ');
}

function setSpaceMode(m, el) {
  spaceMode = m;
  document.querySelectorAll('#space-mode-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.smode === m));
  const preset = SPACE_MODE_PRESETS[m] || SPACE_MODE_PRESETS.full;
  SPACE_SECTIONS.forEach(s => {
    const el2 = document.getElementById('space-inc-' + s.key);
    if (el2) el2.checked = !!preset[s.key];
  });
  renderSpace();
}

function setSpaceLang(l, el) {
  spaceLang = l;
  document.querySelectorAll('#view-space [data-slang]').forEach(c => c.classList.toggle('on', c.dataset.slang === l));
  renderSpace();
}

function setSpaceFmt(f) {
  spaceFmt = f;
  document.getElementById('space-fmt-structured')?.classList.toggle('on', f === 'structured');
  document.getElementById('space-fmt-flat')?.classList.toggle('on', f === 'flat');
  renderSpace();
}

function toggleSpaceCat(id) {
  if (id === 'all') spaceActiveCats = new Set(['all']);
  else {
    spaceActiveCats.delete('all');
    spaceActiveCats.has(id) ? spaceActiveCats.delete(id) : spaceActiveCats.add(id);
    if (!spaceActiveCats.size) spaceActiveCats.add('all');
  }
  renderSpaceCatChips();
  renderSpaceStyleCodeHint();
  if (!spaceLocked.size) generateSpaceCards();
}

function toggleSpaceStylePool(id) {
  if (id === 'all') spaceStylePools = new Set(['all']);
  else {
    spaceStylePools.delete('all');
    spaceStylePools.has(id) ? spaceStylePools.delete(id) : spaceStylePools.add(id);
    if (!spaceStylePools.size) spaceStylePools.add('all');
  }
  renderSpaceStylePoolChips();
  renderSpaceStyleCodeHint();
  if (!spaceLocked.has('styleCode')) rerollSpaceSlot('styleCode');
}

function renderSpaceStylePoolChips() {
  const el = document.getElementById('space-style-pool-chips');
  if (!el) return;
  el.innerHTML = POOLS.map(p =>
    `<span class="chip${spaceStylePools.has(p.id) ? ' on' : ''}" onclick="toggleSpaceStylePool('${p.id}')">${p.label}</span>`
  ).join('');
}

function renderSpaceStyleCodeHint() {
  const el = document.getElementById('space-style-code-hint');
  if (!el) return;
  const codes = getFilteredSpaceStyleCodes();
  if (!codes.length) { el.textContent = '（目前篩選無可用代號）'; return; }
  el.textContent = codes.map(s => `${s.code} · ${s.zh}`).join('\n');
}

function renderSpaceCatChips() {
  const el = document.getElementById('space-cat-chips');
  if (!el) return;
  el.innerHTML = SPACE_CATEGORIES.map(c =>
    `<span class="chip${spaceActiveCats.has(c.id) ? ' on' : ''}" onclick="toggleSpaceCat('${c.id}')">${c.label}</span>`
  ).join('');
}

function renderSpaceIncChecks() {
  const el = document.getElementById('space-inc-checks');
  if (!el) return;
  el.innerHTML = SPACE_SECTIONS.map(s =>
    `<label class="chk-row"><input type="checkbox" id="space-inc-${s.key}" checked onchange="renderSpace()"> ${s.zh}</label>`
  ).join('');
}

function generateSpaceCards() {
  spaceCards = [];
  for (let i = 0; i < SPACE_CARD_COUNT; i++) {
    const slots = rollSpaceSlotsFromLocks();
    spaceCards.push({ slots, prompt: buildSpacePromptFromSlots(slots) });
  }
  if (spaceActiveCard >= spaceCards.length) spaceActiveCard = 0;
  loadSpaceActiveCardToSlots();
  renderSpace();
  saveActiveSession();
}

function generateSpaceSingle() {
  if (!spaceCards.length) { generateSpaceCards(); return; }
  const slots = rollSpaceSlotsFromLocks();
  spaceCards[spaceActiveCard] = { slots, prompt: buildSpacePromptFromSlots(slots) };
  spaceSlots = { ...slots };
  renderSpace();
  saveActiveSession();
}

function selectSpaceCard(i) {
  if (!spaceCards[i]) return;
  spaceActiveCard = i;
  loadSpaceActiveCardToSlots();
  renderSpace();
}

function loadSpaceActiveCardToSlots() {
  const card = spaceCards[spaceActiveCard];
  if (!card?.slots) return;
  spaceSlots = { ...card.slots };
}

function rerollSpaceSlot(key) {
  if (!spaceIsIncluded(key) || spaceLocked.has(key)) return;
  spaceSlots[key] = rollSpaceSection(key);
  if (spaceCards[spaceActiveCard]) {
    spaceCards[spaceActiveCard].slots = { ...spaceSlots };
    spaceCards[spaceActiveCard].prompt = buildSpacePromptFromSlots(spaceSlots);
  }
  renderSpace();
}

function toggleSpaceLock(key) {
  spaceLocked.has(key) ? spaceLocked.delete(key) : spaceLocked.add(key);
  renderSpaceSlots();
}

function renderSpace() {
  renderSpaceCardGrid();
  renderSpaceSlots();
  const card = spaceCards[spaceActiveCard];
  const text = card?.prompt || buildSpacePromptFromSlots(spaceSlots);
  setOutputText('space-output', text, '生成後顯示目前選取卡片…');
  const cats = [...spaceActiveCats].filter(c => c !== 'all')
    .map(c => SPACE_CATEGORIES.find(x => x.id === c)?.label || c).join('·') || '全部';
  const meta = document.getElementById('space-meta');
  if (meta) {
    const len = card ? buildSpaceTagsOnlyFromSlots(card.slots || spaceSlots).length : 0;
    meta.textContent = `${len} 字 · 卡 ${spaceActiveCard + 1}/${SPACE_CARD_COUNT} · ${cats}`;
  }
}

function renderSpaceCardGrid() {
  const el = document.getElementById('space-card-grid');
  if (!el) return;
  if (!spaceCards.length) {
    el.innerHTML = `<div class="meta" style="grid-column:1/-1;padding:20px 0">點「隨機生成 6 張卡片」或按空白鍵開始…</div>`;
    return;
  }
  el.innerHTML = spaceCards.map((card, i) => {
    const preview = (card.prompt || '').replace(/\n/g, ' ').slice(0, 120);
    const tags = buildSpaceTagsOnlyFromSlots(card.slots || {});
    return `<div class="space-card${i === spaceActiveCard ? ' on' : ''}" onclick="selectSpaceCard(${i})" ondblclick="event.preventDefault();copySpaceCard(${i})">
      <div class="space-card-head">
        <span class="space-card-idx">CARD ${i + 1}</span>
        <span class="space-card-copy" onclick="event.stopPropagation();copySpaceCard(${i})">複製</span>
      </div>
      <div class="space-card-body">${escHtml(preview || '（空）')}</div>
      <div class="space-card-meta">${tags.length} 字 · ${spaceLocked.size ? spaceLocked.size + ' 鎖' : '全隨機'}</div>
    </div>`;
  }).join('');
}

function renderSpaceSlots() {
  const el = document.getElementById('space-slots');
  if (!el) return;
  const active = document.activeElement;
  const activeKey = active?.dataset?.slotKey;
  el.innerHTML = SPACE_SECTIONS.filter(s => spaceIsIncluded(s.key)).map(s => {
    const val = (activeKey === s.key && active?.classList?.contains('slot-edit')) ? active.value : (spaceSlots[s.key] || '');
    const lc = spaceLocked.has(s.key) ? ' locked' : '';
    return `<div class="slot${lc}" ondblclick="toggleSpaceLock('${s.key}')">
      <div class="slot-label">${s.zh}<span class="slot-reroll" onclick="event.stopPropagation();rerollSpaceSlot('${s.key}')">↻</span></div>
      <textarea class="slot-edit" data-slot-key="${s.key}" rows="2" oninput="onSpaceSlotEdit('${s.key}', this)" onblur="commitSpaceSlotEdit()" ondblclick="event.stopPropagation()">${escTextarea(val)}</textarea>
    </div>`;
  }).join('');
}

function onSpaceSlotEdit(key, el) {
  spaceSlots[key] = el.value;
  if (spaceCards[spaceActiveCard]) {
    spaceCards[spaceActiveCard].slots = { ...spaceSlots };
    spaceCards[spaceActiveCard].prompt = buildSpacePromptFromSlots(spaceSlots);
  }
  setOutputText('space-output', buildSpacePromptFromSlots(spaceSlots), '生成後顯示目前選取卡片…');
  const meta = document.getElementById('space-meta');
  if (meta) {
    const cats = [...spaceActiveCats].filter(c => c !== 'all')
      .map(c => SPACE_CATEGORIES.find(x => x.id === c)?.label || c).join('·') || '全部';
    meta.textContent = `${buildSpaceTagsOnlyFromSlots(spaceSlots).length} 字 · 卡 ${spaceActiveCard + 1}/${SPACE_CARD_COUNT} · ${cats}`;
  }
  renderSpaceCardGrid();
}

function commitSpaceSlotEdit() { saveActiveSession(); }

function commitSpaceOutputEdit() {
  const text = document.getElementById('space-output')?.value?.trim();
  if (!text) return;
  if (spaceFmt === 'structured' || text.includes('// ❖')) {
    const parsed = parseStructuredSections(text, SPACE_SECTIONS);
    SPACE_SECTIONS.forEach(s => {
      if (!spaceIsIncluded(s.key)) return;
      if (parsed[s.key] !== undefined) spaceSlots[s.key] = parsed[s.key];
    });
    const negBlock = text.match(/\/\/\s*❖\s*Negative\s*\n([\s\S]*)$/i);
    if (negBlock && spaceIsIncluded('negative')) spaceSlots.negative = negBlock[1].trim();
  } else {
    assignListToSlots(text, SPACE_SECTIONS, spaceSlots, spaceIsIncluded);
  }
  if (spaceCards[spaceActiveCard]) {
    spaceCards[spaceActiveCard].slots = { ...spaceSlots };
    spaceCards[spaceActiveCard].prompt = buildSpacePromptFromSlots(spaceSlots);
  }
  renderSpaceSlots();
  renderSpaceCardGrid();
  saveActiveSession();
}

function getSpaceActivePrompt() {
  const card = spaceCards[spaceActiveCard];
  if (card?.prompt) return card.prompt;
  const out = document.getElementById('space-output');
  return (out?.value?.trim()) || buildSpacePromptFromSlots(spaceSlots);
}

function copySpaceCard(i) {
  const t = spaceCards[i]?.prompt;
  if (!t) return toast('尚無內容');
  navigator.clipboard.writeText(t).then(() => toast(`已複製 CARD ${i + 1}`));
}

function copySpaceActiveCard() {
  const t = getSpaceActivePrompt();
  if (!t) return toast('尚無內容');
  navigator.clipboard.writeText(t).then(() => toast('已複製目前卡'));
}

function copySpaceAllCards() {
  if (!spaceCards.length) return toast('尚無內容');
  const t = spaceCards.map((c, i) => `--- CARD ${i + 1} ---\n${c.prompt}`).join('\n\n');
  navigator.clipboard.writeText(t).then(() => toast('已複製全部 6 張'));
}

function copySpaceTagsOnly() {
  const t = buildSpaceTagsOnlyFromSlots(spaceSlots);
  if (!t) return toast('尚無內容');
  navigator.clipboard.writeText(t).then(() => toast('已複製標籤'));
}

function addSpaceEntryToBank(key, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !SPACE_BANKS[key]) return false;
  const exists = SPACE_BANKS[key].some(i => i.zh === trimmed || i.en === trimmed);
  if (exists) return false;
  SPACE_BANKS[key].push({ zh: trimmed, en: trimmed, cats: ['*'] });
  return true;
}

function feedSpaceSlotsToBank() {
  let n = 0;
  SPACE_SECTIONS.forEach(s => {
    if (!spaceIsIncluded(s.key) || !spaceSlots[s.key]?.trim()) return;
    if (addSpaceEntryToBank(s.key, spaceSlots[s.key])) n++;
  });
  if (!n) return toast('無新內容可入庫');
  saveSpaceBanks();
  toast(`已餵回辭庫：${n} 段`);
}

function feedSpaceActiveCardToBank() {
  const card = spaceCards[spaceActiveCard];
  if (!card?.slots) return toast('請先選取卡片');
  let n = 0;
  SPACE_SECTIONS.forEach(s => {
    const v = card.slots[s.key];
    if (!spaceIsIncluded(s.key) || !v?.trim()) return;
    if (addSpaceEntryToBank(s.key, v)) n++;
  });
  if (!n) return toast('無新內容可入庫');
  saveSpaceBanks();
  toast(`CARD ${spaceActiveCard + 1} 入庫：${n} 段`);
}

function addSpaceHistory() {
  const t = getSpaceActivePrompt();
  if (!t) return;
  spaceHistory.unshift({ text: t, ts: Date.now(), card: spaceActiveCard + 1 });
  spaceHistory = spaceHistory.slice(0, 30);
  saveActiveSession();
  renderSpaceHistory();
  toast('已加入歷史');
}

function renderSpaceHistory() {
  const list = document.getElementById('space-hist-list');
  if (!list) return;
  if (!spaceHistory.length) { list.innerHTML = '<div class="meta">尚無紀錄</div>'; return; }
  list.innerHTML = spaceHistory.map((h, i) =>
    `<div class="hist-item" onclick="loadSpaceHistory(${i})">${escHtml(`#${h.card || '?'} ` + h.text.slice(0, 72).replace(/\n/g, ' '))}…</div>`
  ).join('');
}

function loadSpaceHistory(i) {
  const out = document.getElementById('space-output');
  if (!out || !spaceHistory[i]) return;
  out.value = spaceHistory[i].text;
  out.classList.remove('empty');
  commitSpaceOutputEdit();
  toast('已載入');
}

function exportSpaceConfig() {
  const blob = new Blob([JSON.stringify({
    mode: spaceMode, lang: spaceLang, fmt: spaceFmt,
    categories: [...spaceActiveCats], stylePools: [...spaceStylePools],
    styleCount: +(document.getElementById('space-style-count')?.value || 2),
    slots: spaceSlots, locked: [...spaceLocked],
    cards: spaceCards, activeCard: spaceActiveCard, history: spaceHistory,
    banks: SPACE_BANKS,
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'void-space-config.json';
  a.click();
}

function importSpaceConfig() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const c = JSON.parse(r.result);
        if (c.mode) { spaceMode = c.mode; document.querySelector(`#space-mode-chips [data-smode="${c.mode}"]`)?.click(); }
        if (c.lang) { spaceLang = c.lang; document.querySelector(`#view-space [data-slang="${c.lang}"]`)?.click(); }
        if (c.fmt) setSpaceFmt(c.fmt);
        if (c.categories) { spaceActiveCats = new Set(c.categories); renderSpaceCatChips(); }
        if (c.stylePools) { spaceStylePools = new Set(c.stylePools); renderSpaceStylePoolChips(); renderSpaceStyleCodeHint(); }
        if (c.styleCount != null) {
          const scEl = document.getElementById('space-style-count');
          if (scEl) { scEl.value = c.styleCount; syncSlider('space-style-count'); }
        }
        if (c.slots) spaceSlots = c.slots;
        if (c.locked) spaceLocked = new Set(c.locked);
        if (c.cards) spaceCards = c.cards;
        if (c.activeCard != null) spaceActiveCard = c.activeCard;
        if (c.history) spaceHistory = c.history;
        if (c.banks) {
          Object.keys(c.banks).forEach(k => { if (Array.isArray(c.banks[k])) SPACE_BANKS[k] = c.banks[k]; });
          saveSpaceBanks();
        }
        renderSpace();
        renderSpaceHistory();
        toast('場景·空間設定已匯入');
      } catch { toast('匯入失敗'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

function applySpaceSearchEffects(effects, opts) {
  const fillMode = effects.fillMode || opts.fillMode || 'smart';
  const hinted = new Set();
  for (const [section, hints] of Object.entries(effects.sectionHints || {})) {
    if (section === 'negative') continue;
    const key = section;
    if (!spaceIsIncluded(key) || spaceLocked.has(key)) continue;
    if (hints?.length) {
      spaceSlots[key] = hints.join(', ');
      hinted.add(key);
    }
  }
  if (effects.regenerate || fillMode === 'full') {
    spaceLocked.clear();
    generateSpaceCards();
  } else if (fillMode === 'smart') {
    SPACE_SECTIONS.forEach(s => {
      if (!spaceIsIncluded(s.key) || spaceLocked.has(s.key) || hinted.has(s.key)) return;
      if (!spaceSlots[s.key]) spaceSlots[s.key] = rollSpaceSection(s.key);
    });
    generateSpaceSingle();
  } else {
    renderSpace();
  }
  saveActiveSession();
}

// ═══════════════════════════════════════════════════════════════════
// 角色生成表
// ═══════════════════════════════════════════════════════════════════
// PIX AI 公式：Subject + Action + Environment + Style + Detail + Quality
// https://blog.pixai.art/en/how-to-write-pixai-prompts-formula/
const QUALITY_NEGATIVE_TAGS = new Set([
  'no text', 'no watermark', 'no logo', 'no signature', 'no mosaic',
  'lowres', 'bad anatomy', 'bad hands', 'bad feet', 'worst quality', 'low quality', 'normal quality',
  'jpeg artifacts', 'blurry', 'watermark', 'signature', 'username', 'text', 'error',
  'missing fingers', 'extra digit', 'fewer digits', 'cropped', 'deformed', 'mutated',
  'bad proportions', 'duplicate', 'out of frame', 'extra limbs', 'long neck',
]);
const PIX_FORMULA_TEMPLATES = {
  cute: {
    subject: '1girl, solo, looking at viewer, cute girl, fair skin, youthful charm',
    face: 'gentle smile, slight blush, sparkling eyes, looking at viewer',
    details: 'long hair, soft hair strands, delicate collarbone, clean feminine silhouette',
    outfit: 'casual dress, pastel colors, modest cute outfit, daily wear',
    pose: 'standing, upper body, slight smile, looking at viewer, soft natural posture',
    env: 'outdoors, soft lighting, depth of field, bokeh background, gentle atmosphere',
    styleRef: 'anime style, soft illustration, delicate linework',
    quality: 'masterpiece, best quality, high detail',
  },
  tempt: {
    subject: '1girl, solo, looking at viewer, seductive woman, alluring feminine presence',
    face: 'bedroom eyes, parted lips, faint blush, looking at viewer',
    details: 'messy hair strands, exposed collarbone, glossy skin highlight, heated flush',
    outfit: 'lingerie, lace trim, garter belt, thigh-high stockings',
    pose: 'high angle selfie, from above, leaning toward viewer, teasing smile, intimate framing',
    env: 'bedroom, dim ambient light, rim light, soft bokeh, intimate mood',
    styleRef: 'game CG, glossy highlights, polished anime render, fan-service composition',
    quality: 'masterpiece, best quality, ultra-detailed',
  },
  cinematic: {
    subject: '1girl, solo, looking at viewer, elegant woman, cinematic portrait subject',
    face: 'soft expression, detailed eyes, subtle smile, looking at viewer',
    details: 'wind-swept hair, fine fabric texture, subtle sweat sheen, refined skin detail',
    outfit: 'evening dress, silk fabric, elegant silhouette, refined fashion',
    pose: 'cowboy shot, standing, hand on hip, looking at viewer, confident composed stance',
    env: 'city night, neon bokeh, cinematic lighting, depth of field, backlit atmosphere',
    styleRef: 'semi-realistic, cinematic color grading, soft skin rendering, film still aesthetic',
    quality: 'masterpiece, best quality, sharp focus',
  },
};

const CHAR_SECTIONS = [
  { key:'quality',  label:'QUALITY / TECHNICAL TAGS',  zh:'品質標籤' },
  { key:'subject',  label:'Subject & Character',       zh:'主體與角色' },
  { key:'face',     label:'Facial Features',           zh:'臉部特徵' },
  { key:'details',  label:'Character Details',         zh:'角色細節' },
  { key:'outfit',   label:'Outfit',                    zh:'服裝' },
  { key:'pose',     label:'Pose / Composition',        zh:'姿勢／構圖' },
  { key:'job',      label:'JOB / Act',                 zh:'JOB' },
  { key:'env',      label:'Environment & Lighting',    zh:'環境與光線' },
  { key:'styleRef', label:'STYLE REFERENCES',          zh:'風格參考' },
];

const DEFAULT_CHAR_BANKS = {
  subject: [
    '1girl, solo, cute catgirl with long white hair, pink eyes, playful expression',
    '1girl, solo, young East Asian woman, short bob haircut with straight bangs, fair smooth skin, slim figure, no bra',
    '1girl, solo, silver-haired angel, ethereal beauty, delicate features',
    '1girl, solo, purple twin-tail magical girl, energetic cheerful vibe',
    '1girl, solo, mature woman, elegant posture, confident gaze',
    '1girl, solo, adorable bunny girl, fluffy ears, round innocent face, petite figure',
    '1girl, solo, shy kawaii girl, soft features, youthful charm, blushing temperament',
    '1girl, solo, seductive office lady, slim curves, confident allure, mature charm',
    '1girl, solo, cute idol cosplayer, sparkling eyes, playful energy, fan-service appeal',
    '1girl, solo, white-haired nekomimi maid, delicate beauty, submissive cute aura',
    '1girl, solo, petite body, slim figure, small breasts, fair smooth skin, delicate proportions, youthful charm',
    '1girl, solo, tall slender woman, long legs, model proportions, elegant posture, confident gaze',
    '1girl, solo, curvy figure, voluptuous body, wide hips, hourglass silhouette, alluring mature charm',
    '1girl, solo, athletic build, toned body, fit figure, sporty energy, healthy glow',
    '1girl, solo, average build, balanced proportions, natural feminine figure, approachable beauty',
    '1girl, solo, chubby soft body, plump curves, thick thighs, warm inviting presence',
    '1girl, solo, slim youthful girl, girlish charm, flat chest, soft feminine cute appeal',
    '1girl, solo, mature woman, large breasts, slim waist, wide hips, seductive hourglass curves',
    '1girl, solo, black hair, long hair, blue eyes, fair skin, looking at viewer',
    '1girl, solo, blonde hair, medium hair, green eyes, gentle expression, soft features',
    '1girl, solo, silver hair, very long hair, purple eyes, ethereal beauty, delicate face',
    '1girl, solo, brown hair, ponytail, amber eyes, cheerful energetic girl, bright smile',
    '1girl, solo, red hair, wavy hair, heterochromia, striking gaze, vivid personality',
    '1girl, solo, short hair, bob cut, dark eyes, androgynous cute charm, minimalist beauty',
  ],
  face: [
    'pink eyes, cute playful smile, slightly blushing cheeks, looking at viewer',
    'beautiful face, dark eyes, gentle neutral expression, looking at viewer',
    'heterochromia eyes, soft smile, parted lips, looking at viewer',
    'teary eyes, shy blush, averted gaze, delicate eyelashes',
    'sharp eyes, confident smirk, looking at viewer, detailed iris',
    'big sparkling eyes, open mouth smile, rosy cheeks, adorable kawaii expression',
    'half-lidded bedroom eyes, glossy lips, faint blush, seductive gaze at viewer',
    'pouty lips, teary upturned eyes, embarrassed blush, cute pleading expression',
    'tongue slightly out, winking, mischievous cute face, looking at viewer',
    'sultry half-smile, dewy skin highlight on cheeks, alluring eye contact',
    'biting lower lip, flushed cheeks, heated gaze at viewer, seductive tension',
    'half-lidded eyes, glossy parted lips, faint sweat on face, inviting bedroom expression',
    'finger on lips shush pose, teasing smile, playful seductive eye contact',
    'closed eyes, peaceful smile, serene expression, soft portrait mood',
    'surprised expression, wide eyes, open mouth, lively reaction face',
    'looking away, sidelong glance, mysterious expression, subtle allure',
  ],
  details: [
    'long white hair in single braid, black cat ears hoodie with white bow, black cat tail',
    'short bob hair with straight bangs',
    'long flowing silver hair, small halo, feathered wings',
    'grey-purple twin tails, hair ribbons, star hair clips',
    'wavy chestnut hair, loose strands framing face',
    'twin drills, pastel ribbons, frilly hair accessories, bouncy cute hairstyle',
    'messy bed hair, loose strands on collarbone, after-shower damp look',
    'hime cut black hair, red ribbon, silky straight bangs',
    'wet hair clinging to neck and shoulders, water droplets on skin',
    'sweat glistening on collarbone and cleavage, heated skin sheen, post-tease flush',
    'lipstick smudge on corner of lips, messy seductive makeup detail',
    'fluffy animal ears, swishing tail, soft fur texture details',
    'petite frame, slim waist, small breasts, delicate collarbone, soft feminine silhouette',
    'tall frame, long legs, slender limbs, elongated silhouette, graceful proportions',
    'curvy hips, wide hips, thick thighs, soft plush curves, sensual body lines',
    'toned waist, athletic legs, firm thighs, sporty fit physique, defined abs hint',
    'hourglass figure, slim waist, wide hips, balanced bust and hips, classic feminine curves',
    'flat chest, girlish figure, slim waist, delicate youthful proportions, innocent girl aesthetic',
    'large breasts, deep cleavage line, soft chest emphasis, voluptuous upper body',
    'huge breasts, heavy bust, dramatic cleavage, exaggerated fan-service proportions',
    'medium breasts, natural bust, moderate chest, balanced upper body proportions',
    'plump thighs, meaty legs, soft leg curves, thick thigh emphasis, cozy sensual legs',
  ],
  outfit: [
    'black cropped hoodie with cat ears, white sailor bow, black ruffled micro skirt with side strings, black lace thigh-high stockings, black panties visible',
    'pink sheer floral maxi dress, semi-transparent fabric, delicate pink floral pattern, long voluminous puff sleeves, gathered round neckline, slightly visible panty outline through the dress, no bra, modest yet subtly revealing silhouette',
    'white angel dress, gold trim, bare shoulders, flowing hem',
    'school uniform, unbuttoned blouse, pleated skirt, knee socks',
    'bikini, sheer cover-up, wet fabric clinging to skin',
    'oversized pastel hoodie, bare thighs, frilly pink panties peeking, thigh gap, cute loungewear',
    'white lace lingerie set, garter belt, sheer stockings, delicate ribbon choker',
    'black lace lingerie set, delicate lace bra and panties, sheer lace trim, slim fit on petite frame, elegant feminine underwear',
    '蕾絲內衣套裝, lace lingerie, floral lace bra, matching lace panties, soft pastel lace, cute underwear selfie outfit',
    'bunny leotard, fishnet pantyhose, bow tie collar, high-cut hips, playboy bunny aesthetic',
    'virgin killer sweater, sideboob peek, no bra, tight knit fabric, suggestive silhouette',
    'maid outfit, short frilled apron, cleavage window, black thigh-highs, garter straps visible',
    'competitive swimsuit, wet shine on skin, cameltoe hint, high leg cut, poolside appeal',
    'off-shoulder crop top, micro denim shorts, unbuttoned, midriff and navel exposed',
    'loose collar open blouse, collarbone visible, slightly unbuttoned top, innocent seductive neckline',
    'off-shoulder knit sweater, slipping neckline, shy blush, cute collarbone peek, modest tease',
    'sailor collar loosened, open chest line hint, playful uniform neckline, kawaii seductive detail',
    'sheer negligee, lace bodysuit, garter straps, teasing undress, inviting silhouette',
    'unbuttoned white shirt, black lace bra visible, skirt hiked up, panties peek, tempting disheveled look',
    'topless, hands covering breasts, flushed skin, post-intimate disheveled state, nsfw',
    'completely nude, explicit nsfw, sweat on skin, love fluids hint, no censorship',
    'micro bikini, string bikini top, side-tie bottom, minimal coverage, beach-ready seductive swimwear',
    'wet white shirt clinging to skin, no bra underneath, transparent fabric, hardened nipple outline hint',
    'keyhole sweater, open chest cutout, sideboob peek, tight knit, provocative knitwear',
    'garter belt, sheer black stockings, lace panties only, bedroom boudoir styling',
    'bodycon mini dress, deep V neckline, hip-hugging fabric, side slit up thigh, clubwear seduction',
    'latex tight dress, glossy black material, curve-hugging silhouette, high-cut hem, dominatrix-lite appeal',
    'oversized boyfriend shirt only, bare thighs, unbuttoned front, lazy morning after tease',
    'halter neck backless dress, exposed shoulder blades, side cutouts, elegant yet revealing evening wear',
    'fishnet bodystocking under cropped jacket, layered erotic street style, thigh-high fishnets visible',
    'cheongsam qipao, high side slit, mandarin collar, silk fabric hugging hips, traditional seductive elegance',
    'tube top and hot pants, bare midriff, navel exposed, summer festival sexy casual',
    'camisole straps slipping off shoulders, thin fabric, visible bra strap tease, disheveled cute seduction',
    'leather micro skirt, cropped bustier, garter peek, edgy nightlife outfit',
    'see-through raincoat over lingerie, wet fabric layers, urban rainy night fan-service look',
    'petite-friendly lace bralette set, delicate straps, soft pastel lace, slim fit on petite frame, cute underwear selfie',
    'tall model off-shoulder gown, high slit, elongated silhouette, elegant long legs emphasis, evening wear',
    'curve-hugging bodycon dress on voluptuous figure, deep cleavage, wide hips accent, club seduction outfit',
    'athletic crop top and yoga shorts, toned midriff, sporty fit physique, minimal coverage activewear tease',
    'oversized knit on flat chest girl, modest silhouette, girlish cute loungewear, shy collarbone peek',
    'plunge neckline dress for large breasts, heavy bust support, hourglass waist emphasis, glamorous fan-service dress',
    'micro bikini on huge breasts, string top struggling to contain bust, side-tie bottom, beach nsfw swimwear',
    'gothic lolita dress, black lace trim, frilled petticoat, bonnet, dark romantic fashion',
    'idol stage outfit, sparkly mini skirt, crop top, ribbon accents, colorful performance wear',
    'yukata, floral pattern, obi sash, summer festival wear, bare shoulders hint',
    'witch hat and dress, purple and black palette, striped thigh-highs, Halloween cosplay',
    'nurse dress uniform, white stockings, red cross cap, fitted clinical sexy appeal',
    'office blazer and pencil skirt, unbuttoned blouse, professional OL seduction look',
    'tennis skirt and polo crop top, sporty pleated mini, athletic cute fan-service',
    'cheerleader uniform, pleated skirt, crop vest, spirited performance outfit',
    'gym bloomers and buruma, tight athletic shorts, school sports wear, thigh emphasis',
    'santa bikini, fur trim, holiday cosplay, festive minimal coverage',
    'devil costume, horns, tail, leather bikini, Halloween seductive cosplay',
    'angel costume, white wings, sheer white dress, halo accessory, ethereal cosplay',
    'naked apron only, bare back, side boob hint, domestic kitchen tease',
    'parka and thigh-highs, oversized jacket, bare thighs underneath, winter casual tease',
    'corset dress, boned waist, lace-up front, Victorian gothic seduction',
    'race queen suit, glossy bodysuit, sponsor decals, tight curves, motorsport appeal',
    'cow print bikini, holstein pattern, farm girl cosplay, playful minimal swimwear',
    'striped thigh-highs and oversized sweater, bare thighs, cozy home loungewear tease',
    'open cardigan over lace bralette, loose knit layers, soft bedroom casual seduction',
  ],
  pose: [
    'standing pose, both hands holding and pulling cat-ear hood, body slightly tilted, seductive cute pose',
    'standing pose, making heart shape with both hands in front of chest, full body visible',
    'sitting on edge, legs crossed, leaning forward, inviting angle',
    'lying on side, one hand under chin, relaxed sensual pose',
    'selfie angle, arm extended, from above, playful expression',
    'peace sign near face, head tilt, cute idol pose, looking at viewer',
    'bent forward slightly, hands on knees, shy downward glance, skirt emphasis',
    'lying on bed, arched back, one leg raised, sensual stretch pose',
    'lifting skirt hem with two fingers, embarrassed blush pose, teasing reveal',
    'on all fours, looking back at viewer, provocative low angle composition',
    'straddling chair backwards, arms on backrest, confident seductive pose',
    'hugging pillow, legs curled, cozy cute pose, bare shoulders visible',
    'pulling down strap, leaning toward viewer, teasing undress pose, inviting gaze',
    'lying on rumpled bed sheets, legs spread slightly, pulling panties aside, explicit temptation',
    'mating press position, legs wrapped, explicit sexual pose, heavy blush',
    'cowgirl position, riding pose, explicit intercourse angle, ahegao expression',
    'high angle selfie, arm extended above head, camera looking down, seductive smile, bedroom eyes, teasing POV',
    'selfie from above, dutch tilt, leaning toward camera, glossy lips, inviting gaze, intimate close framing',
    'mirror selfie, smartphone in hand, high angle shot, coy expression, slightly open mouth',
    'selfie pose, one arm covering breasts, fingers slightly spread, shy blush, teasing concealment, looking at viewer',
    'both hands covering chest, embarrassed expression, peeking through fingers, flustered seductive tease',
    'arm across breasts, turned shoulder, sidelong sultry glance, concealing yet inviting',
    'high angle selfie, lifting skirt hem with two fingers, panty peek, thigh flash, embarrassed teasing smile',
    'selfie from above, one hand pulling skirt up, white panties visible, blushing cheeks, playful reveal',
    'fingers hooked on skirt waistband, slight pull downward, high angle POV, tempting hesitation pose',
    'full body shot, standing straight, head to toe in frame, slim legs, confident seductive posture',
    'full body selfie, stepping back from camera, entire figure visible, hip tilt, alluring stance',
    'full body mirror selfie, phone in frame, complete outfit visible, playful body language',
    'full body composition, arms raised fixing hair, elongated silhouette, elegant tempting curve',
    'low angle shot, from below, thighs dominant in foreground, upskirt tease, powerful seductive gaze down',
    'extreme low angle, worm eye view, thick thighs framing shot, panties visible under short skirt',
    'low angle selfie POV, legs apart slightly, inner thighs emphasized, pantyshot, tempting perspective',
    'from below, crotch seam visible through panties, thigh gap, cameltoe hint, alluring low composition',
    'low angle full body, towering perspective, long legs leading to hips, underwear peek, seductive dominance',
    'kneeling low angle, skirt draped between thighs, panty line visible, gap tease, looking down at viewer',
    'squatting low angle, thighs spread modestly, fabric tension at crotch, heated inviting expression',
    'dutch angle selfie, cute kawaii pout, seductive side glance, playful teasing mood, blush, no explicit',
    'angled mirror selfie, hip pop pose, innocent yet alluring expression, dynamic sexy camera angle',
    'selfie pulling collar open slightly, collarbone peek, shy cute blush, neckline tease, looking at viewer',
    'off-shoulder sweater slip, open neckline selfie, embarrassed smile, seductive cute collarbone hint',
    'unbuttoned blouse selfie, top button open, modest cleavage hint, flustered kawaii expression',
    'looking back over shoulder selfie, short skirt, butt curve hint, cute embarrassed smile, playful back view',
    'from behind selfie angle, skirt hem flutter, hip sway, teasing back pose, no explicit nudity',
    'over shoulder mirror selfie, skirt lifted slightly at hip, butt silhouette, shy seductive glance back',
    'extreme dutch angle selfie, foreshortening, cute face close to camera, dynamic tempting composition',
    'extreme high angle bird eye selfie, full cute figure, teasing upward gaze, kawaii seductive charm',
    'extreme low angle cute selfie, long legs perspective, modest skirt, alluring look down, no intercourse',
    'sitting selfie, thighs pressed together, skirt riding up slightly, shy seductive blush, kawaii tease',
    'cross-legged sit selfie, phone at lap height, thick thighs in frame, cute tempting expression',
    'sitting on bed edge selfie, knees together, leaning forward, thigh focus, playful innocent allure',
    'chair sit selfie, legs angled to camera, skirt draped over thighs, seductive cute sitting pose',
    'low angle sitting selfie, thighs dominant, panty line hint only, embarrassed teasing smile, no sex',
    'jumping pose, both feet off ground, skirt flying upward, embarrassed blush, panty peek, dynamic mid-air selfie angle',
    'playful jump selfie, skirt flutter in wind, surprised cute expression, thigh flash, energetic bouncing motion',
    'cute jump pose, hopping mid-air, pleated skirt flipping up, flustered smile, innocent yet teasing wardrobe malfunction hint',
    'leaning against wall, one leg raised, hand on hip, confident seductive stance, looking at viewer',
    'hands behind head, arched back, chest forward, elongated sensual silhouette, heated posture',
    'biting lip selfie, close-up face, flushed cheeks, teasing eye contact, intimate framing',
    'pulling hair aside, exposed neck and collarbone, sidelong sultry glance, elegant tease',
    'kneeling on bed, looking up at camera, submissive inviting angle, soft bedroom lighting POV',
    'lying on stomach, feet up behind, looking back over shoulder, playful back-focused tease',
    'stretching arms overhead, exposed midriff and underboob hint, yawning sleepy seductive stretch',
    'collar tug tease, pulling neckline open slightly, embarrassed blush, high angle selfie',
    'shirt lift tease, fingers lifting hem slightly, belly and underboob peek, shy heated expression',
    'hip cocked pose, hand on waist, weight on one leg, S-curve silhouette, confident fan-service stance',
    'lying on back, knees bent up, skirt fallen between thighs, inviting upward gaze, bedroom tease',
    'against window silhouette, backlit curves, pressing palms on glass, moody seductive atmosphere',
    'towel barely wrapped after shower, clutching towel at chest, wet skin, steamy bathroom tease',
    'straddling pillow, sitting upright, shy downward glance, heated imagination pose, no explicit',
    'bent over table edge slightly, looking back, skirt riding up, provocative office fantasy tease',
    'one knee on chair, leaning forward, deep neckline emphasis, low angle invitation pose',
    'twirling skirt hem playfully, dynamic motion blur, flirty spin, thigh flash mid-turn',
    'adjusting stocking garter, seated pose, focused hands on thigh, boudoir preparation tease',
    'wet hair flip mid-motion, water droplets flying, sensual shower exit pose, steamy atmosphere',
    'standing, looking at viewer, slight smile, upper body, hands at sides, clean portrait pose',
    'sitting, crossed legs, looking at viewer, relaxed posture, casual composed framing',
    'walking, mid-step, wind in hair, dynamic motion, natural candid energy',
    'close-up, portrait, looking at viewer, face focus, shallow depth of field composition',
    'cowboy shot, standing, hand on hip, looking at viewer, confident balanced framing',
    'from below, low angle, standing, looking down at viewer, powerful perspective',
    'from above, high angle, sitting, looking up at viewer, inviting upward gaze',
    'from side, profile angle, elegant silhouette, refined side portrait composition',
    'dutch angle, dynamic tilt, playful energy, stylized anime composition',
    'full body, standing straight, head to toe in frame, balanced full-length shot',
    'upper body, arms behind back, shy posture, soft feminine presentation',
    'wink and peace sign, close-up selfie, playful idol charm, looking at viewer',
    'finger heart gesture, both hands near face, cute fan-service pose, soft blush',
    'hair flip mid-motion, wind effect, dynamic glamour pose, elegant movement',
    'hand on cheek, elbow on table, cafe sitting pose, thoughtful cute expression',
    'holding coffee cup with both hands, warm drink, cozy cafe atmosphere pose',
    'twirling in dress, skirt flare motion, spinning playful energy, dynamic fan-service',
    'reaching toward camera, foreshortening hand, POV invitation, intimate close framing',
    'lying on stomach, feet kicked up, chin on hands, playful back-focused tease',
    'seiza kneeling, formal polite posture, traditional composed sitting pose',
    'yoga stretch, flexible pose, reaching toes, athletic sensual stretch line',
    'parasol held overhead, summer shade, elegant standing pose, wind in hair',
    'balcony railing lean, wind lifting hair, city backdrop, cinematic silhouette',
    'stage performance pose, one hand on mic, idol spotlight energy, dynamic concert stance',
    'mirror fitting room selfie, trying on clothes, retail tease, candid changing vibe',
    'locker room shy pose, clutching clothes, embarrassed glance, sporty changing moment',
    'car passenger seat selfie, seatbelt across chest, road trip casual charm',
    'pool edge sitting, legs in water, swimsuit adjustment, summer wet skin tease',
    'onsen towel wrap clutch, steamy atmosphere, wet skin glow, bathing shy pose',
    'cosplay peace sign, character pose, fan event energy, playful convention selfie',
    'salute pose, crisp uniform gesture, disciplined cute appeal',
    'curtsy bow, polite princess gesture, elegant refined presentation',
    'hands in back pockets, hip cocked, casual confident street style pose',
    'reading book seated, library quiet pose, intellectual cute atmosphere',
    'overhead arms stretch yawn, morning wake pose, sleepy cute bedroom stretch',
    'adjusting hair clip, both hands up, exposed armpit line, candid grooming moment',
  ],
  job: [
    'handjob, stroking penis with hand, precum on fingers, looking at viewer',
    'fingering, fingers inside panties, wet pussy, trembling thighs, embarrassed blush',
    'mutual hand stimulation, hand guiding partner, intimate hand contact on crotch',
    'slow handjob, two-handed stroke, saliva lubricant, teasing pace',
    'hand inside panties, fingering through fabric, panties pushed to the side',
    'fellatio, blowjob, oral sex, licking penis tip, saliva trail',
    'deepthroat, penis in mouth, tears in eyes, messy oral, drool dripping',
    'cunnilingus, face between legs, licking pussy, tongue on clit, wet chin',
    'licking nipple, sucking finger suggestively, oral teasing, glossy lips',
    'paizuri, titjob, penis between breasts, breasts pressed together, breast squeeze',
    'breasts covering penis, soft chest focus, nipple stimulation, paizuri motion',
    'grabbing own breasts, presenting chest, nipple pinch, breast play',
    'large breasts paizuri, tight squeeze, glossy skin between cleavage',
    'footjob, feet on penis, toes stroking shaft, soles rubbing, looking at viewer',
    'stocking footjob, nylon feet, toe tease on crotch, barefoot footjob, precum on soles',
    'feet pressed together, double footjob, oily soles, toe curl, heated foot play',
    'pussyjob, labia gripping penis shaft, vulva squeezing cock, external genital stimulation, no penetration',
    'grinding pussy on penis through panties, wet fabric friction, clothed pussyjob, outercourse',
    'labia pressed around penis, pussy lips clamping shaft, straddling lap rub, embarrassed blush',
    'standing pussyjob, pressing vulva against erect penis, panties on, heated crotch friction, looking at viewer',
    'panties aside pussyjob, labia sandwiching penis, external pussy stimulation, precum on panties',
    'cowgirl outercourse pussyjob, rubbing labia on penis, no insertion, wet panties cling',
  ],
  env: [
    'indoor setting with soft lighting, glowing abstract background elements, clean white and black color scheme',
    'bright indoor room with large window showing green trees and balcony outside, natural daylight, soft even lighting',
    'neon-lit bedroom, purple and blue ambient glow, bokeh lights',
    'sunlit beach, ocean background, golden hour warm tones',
    'minimal studio backdrop, gradient background, soft box lighting',
    'pastel pink bedroom, plush toys, fairy lights, soft dreamy atmosphere',
    'steamy bathroom, fogged mirror, warm rim light, intimate mood lighting',
    'love hotel aesthetic room, dim red ambient light, silk sheets, moody shadows',
    'sakura petals falling, soft spring breeze, romantic outdoor bokeh',
    'dark love hotel room, red neon glow, rumpled silk sheets, steamy intimate atmosphere',
    'onsen steam, wet naked skin, wooden bath interior, explicit nsfw setting',
    'classroom, afternoon, soft sunlight through window, depth of field, calm slice-of-life mood',
    'outdoors, autumn, ginkgo leaves, golden hour, soft lighting, cinematic natural background',
    'indoors, cafe, warm ambient light, bokeh background, cozy relaxed atmosphere',
    'rooftop, sunset, city skyline, rim light, wind, dramatic cinematic sky',
    'forest path, dappled sunlight, floating particles, soft mist, dreamy nature scene',
    'rainy street, wet pavement reflections, neon signs, moody atmospheric night',
    'studio backdrop, gradient background, soft box lighting, clean minimal composition',
    'library, quiet interior, warm lamp light, dust motes, scholarly calm mood',
    'beach sunset, ocean waves, golden hour backlight, lens flare, summer atmosphere',
  ],
  styleRef: [
    'high quality anime illustration, detailed hair and fabric texture, glossy highlights, cute yet seductive aesthetic',
    'photorealistic, high detail, natural colors, clean composition',
    'digital painting, soft brush strokes, painterly anime style',
    'cel-shaded anime, bold outlines, vibrant color palette',
    'semi-realistic illustration, soft skin rendering, cinematic color grading',
    'moe anime style, soft shading, pastel palette, kawaii character design, glossy eyes',
    'pixiv trending illustration, delicate linework, fan-service composition, alluring charm',
    'eroge CG quality, glossy skin shader, fabric tension detail, sensual atmosphere',
    'cute chibi-influenced proportions, round soft features, sparkle highlights, adorable appeal',
    'hentai anime style, explicit nsfw illustration, detailed erotic anatomy',
    'hardcore doujin aesthetic, graphic sexual detail, uncensored nsfw tags',
    'anime style, illustration, clean composition, polished linework',
    'game CG, cinematic anime render, glossy fabric and skin highlights',
    'digital art, soft brush texture, painterly anime illustration',
    'semi-realistic, 2.5D, soft skin rendering, volumetric depth',
    'comic style, bold outlines, vibrant color blocking, graphic appeal',
  ],
  quality: [
    'masterpiece, best quality, high detail',
    'masterpiece, best quality, ultra-detailed',
    'best quality, high detail, sharp focus',
    'masterpiece, best quality, ultra detailed, sharp focus, high resolution, perfect anatomy, glossy skin and clothing',
    'masterpiece, best quality, ultra detailed, sharp focus, high resolution, subtle see-through effect',
    'masterpiece, best quality, absurdres, highly detailed eyes, detailed clothing folds',
    'best quality, ultra detailed, 8k, perfect hands, perfect face, vibrant colors',
    'masterpiece, best quality, ultra detailed, beautiful detailed eyes, shiny skin, soft lighting on curves',
    'masterpiece, best quality, ultra detailed, perfect anatomy, delicate blush rendering, alluring composition',
    'masterpiece, best quality, nsfw, explicit, detailed genitalia, uncensored',
    'masterpiece, best quality, ultra detailed, explicit sexual content, perfect anatomy, nsfw, no mosaic',
  ],
};

const TONE_MARKERS = {
  cute: ['cute','kawaii','playful','blush','heart','cheerful','adorable','innocent','ribbon','smile','soft','pastel','peace','idol','bunny','petite','fluffy','cozy','moe','chibi','sparkl','shy','pout','wink','maid','twin','magical','sakura','fairy','plush','gentle','sweet'],
  spicy: ['seductive','revealing','sheer','bikini','panties','no bra','see-through','sensual','sexy','micro','lace','thigh','cleavage','wet','sultry','allur','sideboob','suggestive','bare shoulder','midriff','crop top','fan-service','eroge','bedroom eyes','form-fitting','bodycon','latex','fishnet','garter','stockings','keyhole','wet shirt','halter','backless','tube top','hot pants','bodystocking','side slit','qipao','cheongsam'],
  tempt: ['tempting','provocative','teasing','inviting','alluring','bedroom','lingerie','garter','leotard','lift','pulling','straddl','arched','looking back','virgin killer','love hotel','intimate','steamy','glossy lips','parted lips','embarrassed','undressing','unbuttoned','pulled down','skirt lift','lifting skirt','pulling skirt','pantyshot','upskirt','panty peek','between legs','on bed','selfie','high angle','low angle','covering breasts','thigh gap','cameltoe','crotch seam','full body','biting lip','wall lean','kneeling','towel','wet hair','shirt lift','hip cocked','silhouette','boudoir','collar tug','adjusting stocking'],
  sex: ['lewd','erotic','explicit','nsfw','nude','naked','topless','bottomless','exposed','spread legs','all fours','cowgirl','missionary','intercourse','orgasm','ahegao','heavy breathing','sweat','wet skin','nipple','areola','pussy','penetration','bondage','bdsm','slave','collar','leash','groping','grabbing breasts','fingering','oral','fellatio','paizuri','rape','mating press'],
};

const JOB_TYPES = [
  { id:'none', label:'無' },
  { id:'all', label:'全部' },
  { id:'breasts', label:'乳交' },
  { id:'hand', label:'手交' },
  { id:'oral', label:'口交' },
  { id:'feet', label:'足交' },
  { id:'cameltoe', label:'外陰夾' },
  { id:'cowgirl', label:'騎乘' },
  { id:'doggy', label:'後入' },
  { id:'missionary', label:'傳教式' },
];

const JOB_PRESET_GROUPS = [
  { label:'模式', ids:['none','all'] },
  { label:'非插入', ids:['breasts','hand','oral','feet','cameltoe'] },
  { label:'性交体位', ids:['cowgirl','doggy','missionary'] },
];

/** 体位類互斥；選定時自動取消衝突項 */
const JOB_TYPE_CONFLICTS = {
  cowgirl:    ['doggy','missionary'],
  doggy:      ['cowgirl','missionary'],
  missionary: ['cowgirl','doggy'],
};

const POSE_PRESET_GROUPS = [
  { label:'模式', ids:['all'] },
  { label:'清純自拍', ids:['cute_outfit_normal','cute_outfit_underwear','cute_outfit_sleepwear','mirror_selfie','overhead_selfie'] },
  { label:'誘惑自拍', ids:['tempt_high_collar','tempt_low_upskirt','tempt_sit_legs','tempt_jump_skirt','wall_lean_selfie'] },
  { label:'拍照構圖', ids:['portrait_clean','full_body_stand','dutch_angle','dynamic_motion','lying_relaxed','from_behind','sitting_casual','kneeling_pose','squat_cute','back_arch'] },
  { label:'角色舞台', ids:['cosplay_stage'] },
];

const POSE_PRESETS = [
  { id:'all', label:'全部' },
  { id:'cute_outfit_normal', label:'清純日常' },
  { id:'cute_outfit_underwear', label:'內衣自拍' },
  { id:'cute_outfit_sleepwear', label:'睡衣慵懶' },
  { id:'mirror_selfie', label:'鏡子自拍' },
  { id:'overhead_selfie', label:'高角度俯拍' },
  { id:'tempt_high_collar', label:'俯拍·開領' },
  { id:'tempt_low_upskirt', label:'仰拍·裙底' },
  { id:'tempt_sit_legs', label:'坐姿露腿' },
  { id:'tempt_jump_skirt', label:'跳躍裙飛' },
  { id:'wall_lean_selfie', label:'靠牆自拍' },
  { id:'portrait_clean', label:'肖像特寫' },
  { id:'full_body_stand', label:'全身站立' },
  { id:'dutch_angle', label:'荷蘭角' },
  { id:'dynamic_motion', label:'動態抓拍' },
  { id:'lying_relaxed', label:'躺姿放鬆' },
  { id:'from_behind', label:'回眸背影' },
  { id:'sitting_casual', label:'坐姿生活' },
  { id:'kneeling_pose', label:'跪姿' },
  { id:'squat_cute', label:'深蹲可愛' },
  { id:'back_arch', label:'拱背曲線' },
  { id:'cosplay_stage', label:'cos舞台' },
];

const CUTE_SELFIE_OUTFIT_IDS = ['cute_outfit_normal','cute_outfit_underwear','cute_outfit_sleepwear','mirror_selfie','overhead_selfie'];
const TEMPT_SELFIE_IDS = ['tempt_high_collar','tempt_low_upskirt','tempt_sit_legs','tempt_jump_skirt','wall_lean_selfie'];
const SAFE_SELFIE_IDS = [...CUTE_SELFIE_OUTFIT_IDS, ...TEMPT_SELFIE_IDS];

const SPICY_OUTFIT_TYPES = [
  { id:'all', label:'全部' },
  { id:'none', label:'不篩選' },
  { id:'wet', label:'濕身' },
  { id:'sheer', label:'透明' },
  { id:'lingerie', label:'內衣' },
  { id:'garter', label:'吊帶襪' },
  { id:'stockings', label:'絲襪' },
  { id:'miniskirt', label:'迷你裙' },
  { id:'dress', label:'連身裙' },
  { id:'bodycon', label:'包臀' },
  { id:'keyhole', label:'開胸' },
  { id:'crop_top', label:'短上衣' },
  { id:'off_shoulder', label:'露肩' },
  { id:'fishnet', label:'網襪' },
  { id:'latex', label:'膠衣' },
  { id:'leather', label:'皮革' },
  { id:'school', label:'校服' },
  { id:'maid', label:'女僕' },
  { id:'nurse', label:'護士' },
  { id:'bunny', label:'兔女郎' },
  { id:'bikini', label:'比基尼' },
  { id:'one_piece_swim', label:'連身泳裝' },
  { id:'qipao', label:'旗袍' },
  { id:'ol', label:'OL' },
  { id:'gothic', label:'哥德' },
  { id:'idol', label:'偶像' },
  { id:'yukata', label:'浴衣' },
  { id:'kimono', label:'和服' },
  { id:'witch', label:'魔女' },
  { id:'gym', label:'運動' },
  { id:'sweater', label:'毛衣' },
  { id:'hoodie', label:'帽T' },
  { id:'pajama', label:'睡衣' },
  { id:'apron', label:'圍裙' },
  { id:'nun', label:'修女' },
  { id:'police', label:'警察' },
  { id:'teacher', label:'教師' },
  { id:'cosplay', label:'cos' },
];

const SPICY_OUTFIT_GROUPS = [
  { label:'模式', ids:['all','none'] },
  { label:'色氣剪裁', ids:['wet','sheer','lingerie','garter','stockings','miniskirt','dress','bodycon','keyhole','crop_top','off_shoulder','fishnet','latex','leather'] },
  { label:'制服角色', ids:['school','maid','nurse','bunny','nun','police','teacher','ol','idol','witch','cosplay'] },
  { label:'日常・節慶', ids:['sweater','hoodie','pajama','gym','apron','gothic','yukata','kimono','bikini','one_piece_swim','qipao'] },
];

const SPICY_OUTFIT_MARKERS = {
  wet:      ['wet clothes','wet shirt','wet fabric','clinging','soaked','transparent when wet'],
  sheer:    ['sheer','transparent','see-through','semi-transparent'],
  lingerie: ['lingerie','lace lingerie','lace bra','bra and panties','underwear set','negligee','bodysuit','bralette'],
  garter:   ['garter belt','garter straps','thigh-high stockings','over-knee socks'],
  miniskirt:['miniskirt','micro skirt','short hemline','pleated skirt','tennis skirt'],
  bodycon:  ['bodycon','tight dress','hip-hugging','race queen suit','glossy bodysuit'],
  keyhole:  ['keyhole sweater','open chest','sideboob','deep v'],
  fishnet:  ['fishnet','fishnets','mesh legwear'],
  school:   ['school uniform','pleated skirt','sailor','serafuku','buruma','gym bloomers'],
  maid:     ['maid outfit','maid dress','frilled apron'],
  nurse:    ['nurse uniform','nurse cap','nurse dress'],
  bunny:    ['bunny girl','bunny leotard','playboy bunny'],
  bikini:   ['bikini','string bikini','swimsuit','cow print bikini','santa bikini'],
  qipao:    ['qipao','cheongsam','side slit'],
  ol:       ['office lady','pencil skirt','blazer','office blazer'],
  gothic:   ['gothic lolita','gothic','corset dress','bonnet','victorian','black lace trim'],
  idol:     ['idol stage','idol outfit','cheerleader','sparkly mini','stage outfit','performance wear'],
  yukata:   ['yukata','obi sash','kimono','festival wear'],
  witch:    ['witch hat','witch dress','halloween','striped thigh-highs'],
  gym:      ['gym bloomers','buruma','tennis skirt','yoga shorts','athletic crop','track suit','sporty'],
  apron:    ['apron','naked apron','frilled apron'],
  cosplay:  ['cosplay','devil costume','angel costume','santa bikini','cow print','horns','halo accessory','Halloween'],
  stockings:['thigh-high stockings','pantyhose','sheer stockings','black stockings','garter stockings'],
  dress:    ['dress','one-piece dress','sundress','flared dress','cocktail dress','evening dress'],
  crop_top: ['crop top','midriff','bare midriff','short top','navel'],
  off_shoulder:['off-shoulder','off shoulder','bare shoulders','one shoulder'],
  latex:    ['latex','latex suit','shiny latex','rubber suit'],
  leather:  ['leather','leather jacket','leather skirt','biker'],
  one_piece_swim:['one-piece swimsuit','competition swimsuit','school swimsuit'],
  sweater:  ['sweater','knit sweater','oversized sweater','turtleneck'],
  hoodie:   ['hoodie','hooded','sweatshirt'],
  pajama:   ['pajamas','pajama','sleepwear','nightwear'],
  kimono:   ['kimono','furisode','traditional japanese'],
  nun:      ['nun','nun habit','sister outfit'],
  police:   ['police','police uniform','officer'],
  teacher:  ['teacher','glasses teacher','blazer teacher'],
};

const SPICY_OUTFIT_CONFLICTS = {
  school: ['bunny', 'bikini', 'lingerie', 'nurse', 'maid', 'cosplay', 'ol'],
  maid:   ['school', 'bunny', 'ol', 'nurse', 'bikini', 'yukata'],
  nurse:  ['school', 'maid', 'bunny', 'qipao', 'yukata', 'gym'],
  bunny:  ['school', 'nurse', 'maid', 'qipao', 'ol', 'yukata', 'witch'],
  bikini: ['school', 'maid', 'nurse', 'ol', 'gothic', 'yukata', 'witch', 'gym'],
  qipao:  ['school', 'bunny', 'maid', 'nurse', 'gym', 'apron'],
  ol:     ['school', 'bunny', 'maid', 'bikini', 'gym', 'yukata', 'witch'],
  yukata: ['bunny', 'nurse', 'ol', 'bikini', 'lingerie', 'maid'],
  gym:    ['qipao', 'ol', 'maid', 'gothic', 'yukata'],
  gothic: ['bikini', 'gym', 'yukata', 'school'],
  witch:  ['school', 'nurse', 'yukata', 'ol'],
  apron:  ['qipao', 'bodycon', 'bikini'],
  cosplay:['school', 'ol', 'nurse'],
  nun:    ['bunny','bikini','gym','maid'],
  police: ['maid','nurse','bunny','witch'],
  teacher:['bunny','bikini','nurse','maid'],
  dress:  ['apron','gym'],
};

const POSE_PRESET_CONFLICTS = {
  cute_outfit_normal:    ['tempt_low_upskirt', 'tempt_jump_skirt'],
  cute_outfit_underwear: ['tempt_jump_skirt', 'cosplay_stage'],
  cute_outfit_sleepwear: ['tempt_jump_skirt', 'dynamic_motion'],
  mirror_selfie:         ['tempt_low_upskirt'],
  overhead_selfie:       ['tempt_low_upskirt','from_behind'],
  portrait_clean:        ['tempt_low_upskirt', 'tempt_jump_skirt'],
  tempt_low_upskirt:     ['cute_outfit_normal', 'portrait_clean','mirror_selfie','overhead_selfie'],
  tempt_jump_skirt:      ['cute_outfit_normal', 'cute_outfit_underwear', 'portrait_clean'],
  wall_lean_selfie:      ['cute_outfit_normal'],
  kneeling_pose:         ['tempt_jump_skirt'],
  squat_cute:            ['tempt_jump_skirt','cosplay_stage'],
};

/** 自拍姿勢與 NSFW 体位併選時提示 */
const JOB_POSE_SELFIE_BLOCK = ['cowgirl','doggy','missionary'];

const OUTFIT_EXPLICIT_MARKERS = [
  'nude', 'topless', 'completely nude', 'fully nude', 'no coverage', 'explicit nsfw',
  'graphic sexual', 'bottomless',
];

const OUTFIT_SKIRT_MARKERS = [
  'skirt', 'pleated', 'miniskirt', 'micro skirt', 'sailor', 'dress hem', 'cheerleader',
  'tennis skirt', 'uniform', 'yukata', 'qipao', 'cheongsam',
];

const OUTFIT_NO_SKIRT_MARKERS = [
  'bikini only', 'hot pants only', 'leotard only', 'bodysuit only', 'swimsuit only',
  'completely nude', 'topless', 'naked apron only', 'cow print bikini', 'santa bikini',
];

const POSE_NEEDS_SKIRT_MARKERS = [
  'upskirt', 'skirt lift', 'lifting skirt', 'skirt flying', 'skirt flutter', 'skirt hem',
  'pleated skirt flipping', 'skirt up', 'jumping pose, both feet', 'playful jump selfie',
  'cute jump pose', 'twirling in dress',
];

const SPICY_ACTION_TYPES = [
  { id:'all', label:'全部' },
  { id:'none', label:'不篩選' },
  { id:'seductive_smile', label:'誘惑微笑' },
  { id:'blush', label:'臉紅' },
  { id:'bedroom_eyes', label:'媚眼' },
  { id:'bite_lip', label:'咬唇' },
  { id:'embarrassed', label:'害羞' },
  { id:'peace_sign', label:'比耶' },
  { id:'finger_heart', label:'手指愛心' },
  { id:'skirt_lift', label:'撩裙' },
  { id:'shirt_lift', label:'撩衣' },
  { id:'on_bed', label:'床上' },
  { id:'shower', label:'淋浴' },
  { id:'all_fours', label:'四肢著地' },
  { id:'cover_chest', label:'遮胸' },
  { id:'straddle', label:'跨坐' },
  { id:'wet_hair', label:'濕髮' },
  { id:'cleavage', label:'乳溝' },
  { id:'thigh_focus', label:'大腿' },
  { id:'looking_back', label:'回眸' },
  { id:'panty_peek', label:'裙底暗示' },
  { id:'mirror_gaze', label:'鏡中眼神' },
  { id:'kneeling_cute', label:'跪姿可愛' },
];

const SPICY_ACTION_GROUPS = [
  { label:'模式', ids:['all','none'] },
  { label:'表情', ids:['seductive_smile','blush','bedroom_eyes','bite_lip','embarrassed','peace_sign','finger_heart'] },
  { label:'肢體動作', ids:['skirt_lift','shirt_lift','on_bed','shower','all_fours','cover_chest','straddle','wet_hair','kneeling_cute'] },
  { label:'構圖焦點', ids:['cleavage','thigh_focus','looking_back','panty_peek','mirror_gaze'] },
];

const SPICY_ACTION_CONFLICTS = {
  peace_sign:   ['all_fours','straddle'],
  finger_heart: ['all_fours'],
  all_fours:    ['peace_sign','finger_heart'],
  straddle:     ['peace_sign'],
};

const SPICY_ACTION_FACE_MARKERS = {
  seductive_smile: ['seductive smile','teasing smile','sultry smile','inviting smirk'],
  blush:           ['blush','flushed cheeks','flushed face','rosy cheeks'],
  bedroom_eyes:    ['bedroom eyes','half-lidded','seductive gaze','sultry gaze'],
  bite_lip:        ['biting lip','lip bite'],
  embarrassed:     ['embarrassed','shy blush','flustered'],
  peace_sign:      ['peace sign','v sign','cheerful smile'],
  finger_heart:    ['finger heart','heart hands','cute gesture'],
};

const SPICY_ACTION_POSE_MARKERS = {
  skirt_lift:   ['skirt lift','lifting skirt','skirt hem','panty peek','upskirt'],
  shirt_lift:   ['shirt lift','lifting shirt','lifting hem','exposed midriff'],
  on_bed:       ['on bed','lying on bed','bed sheets','pillow'],
  shower:       ['shower','wet skin','steamy bathroom'],
  all_fours:    ['all fours','on all fours'],
  cover_chest:  ['covering breasts','arm across chest','hands covering'],
  straddle:     ['straddling','straddle chair'],
  wet_hair:     ['wet hair','dripping wet hair'],
  cleavage:     ['cleavage','neckline','deep v','collarbone'],
  thigh_focus:  ['thigh focus','thighs','thick thighs','inner thighs'],
  looking_back: ['looking back','over shoulder','back glance'],
  panty_peek:   ['pantyshot','panty peek','upskirt tease'],
  mirror_gaze:  ['mirror gaze','looking at reflection','mirror eye contact'],
  kneeling_cute:['kneeling','cute kneeling','on knees'],
};

const ENV_PRESET_TYPES = [
  { id:'all', label:'全部' },
  { id:'none', label:'不篩選' },
  { id:'indoor', label:'室內' },
  { id:'bedroom', label:'臥室' },
  { id:'outdoor', label:'戶外' },
  { id:'beach', label:'海邊' },
  { id:'city', label:'都市' },
  { id:'studio', label:'棚拍' },
  { id:'nature', label:'自然' },
  { id:'night', label:'夜景' },
  { id:'nsfw_room', label:'親密' },
];

const ENV_PRESET_GROUPS = [
  { label:'模式', ids:['all','none'] },
  { label:'日常', ids:['indoor','outdoor','nature','city'] },
  { label:'場景', ids:['bedroom','beach','studio','night'] },
  { label:'親密', ids:['nsfw_room'] },
];

const ENV_PRESET_MARKERS = {
  indoor:    ['indoor', 'indoors', 'room', 'classroom', 'cafe', 'library', 'window', '室內'],
  bedroom:   ['bedroom', 'pastel pink bedroom', 'plush toys', 'fairy lights', 'rumpled sheets', 'bed sheets', '臥室'],
  outdoor:   ['outdoor', 'outdoors', 'rooftop', 'sakura', 'spring breeze', '戶外'],
  beach:     ['beach', 'ocean', 'sunlit beach', 'waves', 'summer atmosphere', '海邊'],
  city:      ['city', 'street', 'neon', 'skyline', 'urban', 'rainy street', '都市'],
  studio:    ['studio', 'backdrop', 'gradient background', 'soft box', 'minimal studio', '棚拍'],
  nature:    ['forest', 'ginkgo', 'nature', 'dappled sunlight', 'mist', 'dreamy nature', '自然'],
  night:     ['night', 'neon-lit', 'evening', 'sunset', 'golden hour', 'moody atmospheric night', '夜景'],
  nsfw_room: ['love hotel', 'steamy bathroom', 'onsen', 'dim red', 'intimate mood', 'explicit nsfw setting', '親密'],
};

const BODY_FRAME_TYPES = [
  { id:'none', label:'不篩選' },
  { id:'petite', label:'嬌小' },
  { id:'slim', label:'纖細' },
  { id:'average', label:'標準' },
  { id:'tall', label:'高挑' },
  { id:'curvy', label:'豐滿' },
  { id:'athletic', label:'運動' },
  { id:'chubby', label:'微胖' },
];

const BODY_BREAST_TYPES = [
  { id:'none', label:'不篩選' },
  { id:'flat', label:'貧乳' },
  { id:'small', label:'小胸' },
  { id:'medium', label:'中胸' },
  { id:'large', label:'大胸' },
  { id:'huge', label:'巨乳' },
];

const BODY_FIGURE_TYPES = [
  { id:'none', label:'不篩選' },
  { id:'slim_waist', label:'細腰' },
  { id:'wide_hips', label:'寬臀' },
  { id:'long_legs', label:'長腿' },
  { id:'thick_thighs', label:'肉腿' },
  { id:'hourglass', label:'沙漏' },
  { id:'girlish', label:'少女感' },
];

const BODY_FRAME_GROUPS = [
  { label:'體型', ids:['none','petite','slim','average','tall','curvy','athletic','chubby'] },
];

const BODY_BREAST_GROUPS = [
  { label:'胸部', ids:['none','flat','small','medium','large','huge'] },
];

const BODY_FIGURE_GROUPS = [
  { label:'身材', ids:['none','slim_waist','wide_hips','long_legs','thick_thighs','hourglass','girlish'] },
];
/** 嵌入分頁：身形（腰線等） */
const BODY_FIGURE_SHAPE_GROUPS = [
  { label:'腰線・曲線', ids:['none','slim_waist','hourglass','girlish'] },
];
/** 嵌入分頁：腿・臀 */
const BODY_FIGURE_LEG_GROUPS = [
  { label:'腿・臀', ids:['none','long_legs','thick_thighs','wide_hips'] },
];

const BODY_FRAME_MARKERS = {
  petite:   ['petite', 'petite body', 'petite figure', 'small frame', 'delicate proportions', '嬌小'],
  slim:     ['slim figure', 'slim body', 'slender', 'slim build', '纖細', '苗條'],
  average:  ['average build', 'balanced proportions', 'natural feminine', 'approachable beauty', '標準'],
  tall:     ['tall', 'tall frame', 'tall slender', 'model proportions', 'long-legged', '高挑'],
  curvy:    ['curvy', 'curvy figure', 'voluptuous', 'full figure', '豐滿'],
  athletic: ['athletic', 'athletic build', 'toned body', 'fit figure', 'sporty', '運動'],
  chubby:   ['chubby', 'plump', 'soft body', 'plump curves', '微胖'],
};

const BODY_BREAST_MARKERS = {
  flat:   ['flat chest', 'flat breasts', '貧乳'],
  small:  ['small breasts', 'small breast', 'modest chest', '小胸'],
  medium: ['medium breasts', 'natural bust', 'moderate chest', 'balanced upper body', '中胸'],
  large:  ['large breasts', 'big breasts', 'ample bust', 'voluptuous upper', '大胸'],
  huge:   ['huge breasts', 'gigantic breasts', 'massive breasts', 'heavy bust', '巨乳'],
};

const BODY_FIGURE_MARKERS = {
  slim_waist:   ['slim waist', 'narrow waist', 'cinched waist', 'toned waist', '細腰'],
  wide_hips:    ['wide hips', 'curvy hips', 'hip sway', 'thick hips', '寬臀'],
  long_legs:    ['long legs', 'elongated legs', 'leggy', 'slender limbs', '長腿'],
  thick_thighs: ['thick thighs', 'meaty thighs', 'plump thighs', 'soft leg curves', '肉腿'],
  hourglass:    ['hourglass', 's-curve', 's curve silhouette', 'classic feminine curves', '沙漏'],
  girlish:      ['girlish', 'girlish charm', 'youthful feminine', 'innocent girl', 'young girl vibe', '少女感', 'youthful beauty', 'soft youthful aura'],
};

const BODY_COMBOS = {
  petite_cute:  { label:'嬌小可愛', frame:['petite','slim'], breast:['small'], figure:['slim_waist','girlish'] },
  model_slim:   { label:'纖細長腿', frame:['slim','tall'], breast:['medium'], figure:['long_legs','slim_waist'] },
  curvy_sexy:   { label:'豐滿色氣', frame:['curvy'], breast:['large'], figure:['wide_hips','hourglass'] },
  athletic_fit: { label:'運動健美', frame:['athletic','slim'], breast:['medium'], figure:['slim_waist','long_legs'] },
  plush_soft:   { label:'肉感豐腴', frame:['chubby','curvy'], breast:['large'], figure:['thick_thighs','wide_hips'] },
  petite_flat:  { label:'清純貧乳', frame:['petite','slim'], breast:['flat','small'], figure:['girlish','slim_waist'] },
  busty_nsfw:   { label:'巨乳色氣', frame:['curvy'], breast:['huge','large'], figure:['hourglass','wide_hips','slim_waist'] },
  mature_onee:  { label:'御姐高挑', frame:['tall','curvy'], breast:['large'], figure:['long_legs','hourglass','slim_waist'] },
};

const PRESET_BODY_MAP = {
  pure_selfie: 'petite_cute',
  spicy_selfie: 'model_slim',
  super_spicy: 'curvy_sexy',
  full_nsfw: 'busty_nsfw',
  sex_lover: 'busty_nsfw',
};

const BODY_SOFT_CONFLICTS = [
  { frame:['petite','slim'], breast:['huge'], msg:'嬌小/纖細體型與巨乳較難同時成立，建議改用「巨乳色氣」搭配' },
  { frame:['petite'], breast:['large','huge'], msg:'嬌小體型配大胸較少見，可試「豐滿色氣」或「巨乳色氣」' },
  { breast:['flat','small'], breast2:['huge'], msg:'貧乳/小胸與巨乳請擇一' },
  { figure:['girlish'], breast:['huge','large'], msg:'少女感身材通常不搭巨乳/大胸' },
];

const BODY_FRAME_CONFLICTS = {
  petite: ['curvy', 'chubby'],
  slim: ['chubby'],
  curvy: ['petite'],
  chubby: ['petite', 'slim'],
};

const BODY_FRAME_CLEAR_FIGURE = {
  petite: ['wide_hips', 'thick_thighs', 'hourglass'],
  slim: ['wide_hips', 'thick_thighs'],
  curvy: ['girlish'],
};

const BODY_BREAST_MUTEX = ['flat', 'small', 'medium', 'large', 'huge'];

const BODY_FRAME_ANTI_MARKERS = {
  petite: ['wide hips', 'curvy hips', 'thick hips', 'hip sway', 'thick thighs', 'hourglass', 's-curve', '寬臀', '肉腿', '沙漏'],
  slim: ['wide hips', 'curvy hips', 'thick hips', 'thick thighs', '寬臀', '肉腿'],
};

const POSE_PRESET_LEGACY_MAP = {
  cute_tempt_selfie:'cute_outfit_normal', sexy_angle:'cute_outfit_normal', collar_peek:'tempt_high_collar',
  skirt_butt:'tempt_low_upskirt', extreme_angle:'tempt_low_upskirt', sit_thigh:'tempt_sit_legs',
  selfie_hot:'tempt_high_collar', high_selfie:'tempt_high_collar', low_tempt:'tempt_low_upskirt',
  cover_chest:'tempt_high_collar', skirt_pull:'tempt_jump_skirt', full_body:'cute_outfit_normal',
};
const JOB_TYPE_LEGACY_MAP = { panties:'cameltoe', panty:'cameltoe', grind:'hand' };

function migratePosePresets(ids) {
  const valid = new Set(POSE_PRESETS.map(p => p.id));
  const out = new Set();
  (ids || ['all']).forEach(id => {
    if (valid.has(id)) out.add(id);
    else if (POSE_PRESET_LEGACY_MAP[id]) out.add(POSE_PRESET_LEGACY_MAP[id]);
  });
  return out.size ? out : new Set(['all']);
}

function migrateJobTypes(ids) {
  const valid = new Set(JOB_TYPES.map(j => j.id));
  const out = new Set();
  (ids || ['none']).forEach(id => {
    if (valid.has(id)) out.add(id);
    else if (JOB_TYPE_LEGACY_MAP[id]) out.add(JOB_TYPE_LEGACY_MAP[id]);
  });
  return out.size ? out : new Set(['none']);
}

function migrateSpicySet(ids, types, fallback) {
  const valid = new Set(types.map(t => t.id));
  const out = new Set();
  (ids || [fallback]).forEach(id => { if (valid.has(id)) out.add(id); });
  return out.size ? out : new Set([fallback]);
}

const BODY_FIGURE_LEGACY_MAP = { boyish: 'girlish' };

function migrateBodySet(ids, types) {
  const valid = new Set(types.map(t => t.id));
  const out = new Set();
  (ids || ['none']).forEach(id => {
    const mapped = BODY_FIGURE_LEGACY_MAP[id] || id;
    if (valid.has(mapped)) out.add(mapped);
  });
  return out.size ? out : new Set(['none']);
}

const OUTFIT_PRESET_MARKERS = {
  cute_outfit_normal:    ['school uniform','casual','hoodie','dress','sweater','sailor','blouse','skirt','crop top','denim','cardigan','jacket','oversized','daily wear','normal clothes','frilly dress','sailor collar','yukata','tennis skirt','cheerleader','parka','cardigan','library','cafe','reading'],
  cute_outfit_underwear: ['lingerie','bra','panties','underwear','lace lingerie','white lace','black lace','蕾絲內衣','lace bra','lace panties','garter','thigh-high','stockings','bra and panties','underwear set','lace bodysuit','bra visible','panties visible','lingerie set','delicate lace','floral lace','bralette','boyfriend shirt only'],
  cute_outfit_sleepwear: ['negligee','pajama','nightgown','sleepwear','robe','babydoll','sheer negligee','silk nightwear','camisole','loungewear','sleep','nightwear','satin robe','silky pajama','oversized sweater','loungewear tease','morning wake'],
};

const POSE_EXPLICIT_BLOCK = [
  'intercourse','mating press','cowgirl position','explicit sexual','penetration','handjob','fellatio',
  'fingering','deepthroat','ahegao','orgasm','fully nude','pulling panties aside','penis in','on penis',
  'between legs explicit','spread legs slightly, pulling','vagina','pussy,','nsfw state','graphic sexual',
];

const POSE_SELFIE_CONFLICT_MARKERS = [
  'peace sign', 'heart shape', 'cute idol pose', 'kawaii pout', 'playful jump selfie',
  'mirror selfie', 'arm extended above head', 'dutch tilt selfie', 'bird eye selfie',
  'playful expression', 'making heart shape',
];

const POSE_JOB_AFFINITY = {
  oral:     ['kneeling', 'looking up', 'close-up face', 'on bed', 'submissive', 'inviting angle', 'face between', 'lying on', 'portrait', 'upward gaze', 'bedroom pov'],
  breasts:  ['leaning forward', 'presenting chest', 'chest forward', 'arched back', 'deep neckline', 'cleavage', 'bent forward', 'pressing', 'leaning toward', 'upper body'],
  hand:     ['close-up', 'hands in frame', 'sitting', 'lying on bed', 'intimate', 'lap', 'hands visible', 'hand on'],
  feet:     ['sitting', 'legs angled', 'soles', 'foot', 'lying on back', 'kneeling', 'thighs', 'legs extended', 'feet up'],
  cameltoe: ['low angle', 'thighs', 'sitting', 'squatting', 'crotch', 'from below', 'panty', 'inner thighs', 'worm eye', 'legs apart'],
  cowgirl:  ['riding', 'straddling', 'on top', 'cowgirl', 'hips', 'bouncing', 'lap'],
  doggy:    ['all fours', 'from behind', 'doggy', 'rear', 'arched back', 'on hands and knees'],
  missionary:['lying on back', 'on back', 'missionary', 'legs spread', 'bed', 'face up'],
};

const POSE_PRESET_MARKERS = {
  cute_outfit_normal:    ['selfie','kawaii','cute','blush','peace sign','head tilt','playful','shy','looking at viewer','mirror selfie','arm extended','selfie angle','cute idol pose','standing','upper body','slight smile','portrait','cowboy shot','wink','finger heart','salute','curtsy','reading book','cafe sitting','hand on cheek'],
  cute_outfit_underwear: ['selfie','kawaii','cute','blush','shy','teasing smile','looking at viewer','innocent','seductive smile','embarrassed','close-up','upper body','covering breasts','concealing','bedroom'],
  cute_outfit_sleepwear: ['selfie','cozy','cute','blush','bedroom','lazy morning','soft smile','hugging pillow','bare shoulders','sitting','relaxed','towel wrap','onsen','overhead arms stretch','yawn'],
  tempt_high_collar:     ['high angle','from above','selfie','collarbone','neckline','unbuttoned','open collar','cleavage hint','open shirt','pulling collar','off-shoulder','slightly open','camera looking down','leaning toward','intimate framing','shirt lift','collar tug'],
  tempt_low_upskirt:     ['low angle','from below','upskirt','pantyshot','panties','butt','from behind','looking back','buttocks','hip','inner thighs','cameltoe','crotch seam','worm eye','thigh gap','back view','worm eye view','skirt lift','lifting skirt'],
  tempt_sit_legs:        ['sitting selfie','sitting pose','thighs','crossed legs','on chair','on bed edge','knees together','lap sit','thick thighs sitting','legs visible','legs angled','sitting','crossed legs','pool edge','car passenger','locker room'],
  tempt_jump_skirt:      ['jumping','jump','mid-air','skirt flying','skirt flutter','skirt lift','bouncing','dynamic pose','skirt up','embarrassed','playful jump','walking','mid-step','twirling in dress','wardrobe malfunction'],
  portrait_clean:        ['portrait','close-up','cowboy shot','upper body','looking at viewer','slight smile','clean portrait','face focus','shallow depth','profile angle','standing straight'],
  dynamic_motion:        ['walking','mid-step','twirling','hair flip','jumping','dynamic motion','spinning','wind effect','stage performance','reaching toward','foreshortening'],
  lying_relaxed:           ['lying on side','lying on stomach','lying on back','on bed','relaxed sensual','feet kicked up','chin on hands','on stomach','pillow','bed sheets'],
  from_behind:             ['from behind','looking back','over shoulder','back view','back glance','butt curve','hip sway','shoulder glance'],
  sitting_casual:          ['sitting','crossed legs','cafe','chair sit','seiza','reading book','hand on cheek','coffee cup','library','passenger seat'],
  cosplay_stage:           ['cosplay','stage performance','convention','character pose','idol spotlight','mic','salute','curtsy','peace sign','fan event'],
  mirror_selfie:           ['mirror selfie','reflection','mirror shot','phone in mirror','bathroom mirror','full mirror'],
  overhead_selfie:         ['overhead shot','from above selfie','high angle selfie','arm extended above','looking up at camera'],
  wall_lean_selfie:        ['leaning on wall','wall lean','against wall','casual wall pose','sideways lean'],
  full_body_stand:         ['full body','standing full','head to toe','full length','standing straight full'],
  dutch_angle:             ['dutch angle','tilted frame','canted angle','dynamic diagonal'],
  kneeling_pose:           ['kneeling','on knees','seiza','kneeling pose','kneeling on floor'],
  squat_cute:              ['squatting','squat pose','crouching','low squat'],
  back_arch:               ['arched back','back arch','spine curve','arching spine','emphasized curve'],
};

const JOB_TYPE_MARKERS = {
  breasts:  ['paizuri','titjob','breast squeeze','breasts pressed','breasts covering','breast play','nipple stimulation','between breasts','grabbing own breasts','presenting chest','penis between breasts'],
  hand:     ['handjob','stroking penis','fingering','fingers inside','two-handed','mutual hand','hand guiding','hand inside','hand stimulation','hand on penis'],
  oral:     ['fellatio','blowjob','oral sex','deepthroat','cunnilingus','licking penis','licking pussy','licking nipple','sucking finger','saliva trail','drool','tongue on','penis in mouth','face between legs'],
  feet:     ['footjob','foot job','stocking footjob','feet on penis','foot pressing','double footjob','soles rubbing','toes stroking','barefoot footjob','oily soles'],
  cameltoe: ['pussyjob','pussy job','labia','labia grip','labia clamp','vulva','vulva squeeze','pussy lips','penis between labia','cock between labia','genital rub','external stimulation','outercourse','grinding on penis','rubbing on penis','crotch job','through panties','panties on','wet panties','panties aside','no penetration','labia sandwich'],
  cowgirl:  ['cowgirl','girl on top','riding','straddling sex','bouncing on','riding penis','woman on top'],
  doggy:    ['doggy style','doggystyle','from behind sex','all fours sex','rear entry','on all fours penetration'],
  missionary:['missionary','missionary position','lying on back sex','legs spread sex','face to face sex'],
};

const JOB_TYPE_FALLBACK = {
  breasts:  'paizuri, titjob, penis between breasts, breasts pressed together, breast squeeze, looking at viewer',
  hand:     'handjob, stroking penis with hand, precum on fingers, two-handed stroke, looking at viewer',
  oral:     'fellatio, blowjob, oral sex, licking penis tip, saliva trail, looking at viewer',
  feet:     'footjob, feet on penis, soles rubbing shaft, toes stroking, looking at viewer',
  cameltoe: 'pussyjob, labia gripping penis shaft, grinding through panties, outercourse, no penetration, looking at viewer',
  cowgirl:  'cowgirl position, girl on top, riding, straddling, bouncing, looking at viewer',
  doggy:    'doggy style, from behind, on all fours, rear entry, arched back, looking back at viewer',
  missionary:'missionary position, lying on back, legs spread, face to face, intimate POV, looking at viewer',
};

const JOB_POSE_FALLBACK = {
  oral:     'kneeling on bed, looking up at viewer, close-up face, submissive inviting angle, on bed POV',
  hand:     'sitting, hands in frame, close-up, intimate lap pose, hands visible, looking at viewer',
  breasts:  'leaning forward, presenting chest, cleavage focus, arched back, bent forward emphasis',
  feet:     'sitting, legs extended, soles visible, feet in frame, lying on back, thighs angled to camera',
  cameltoe: 'low angle, thighs visible, sitting, squatting, crotch emphasis, from below, inner thighs',
  cowgirl:  'cowgirl on bed, riding pose, straddling, hips emphasis, looking at viewer',
  doggy:    'on all fours, doggy style pose, from behind, arched back, looking back',
  missionary:'lying on back, missionary pose, legs apart, intimate angle, looking at viewer',
};

const JOB_POSE_EXCLUDE = {
  oral:     ['handjob', 'footjob', 'paizuri', 'titjob', 'pussyjob', 'labia grip'],
  hand:     ['fellatio', 'blowjob', 'deepthroat', 'footjob', 'paizuri', 'titjob', 'cunnilingus'],
  feet:     ['handjob', 'fellatio', 'blowjob', 'paizuri', 'titjob', 'pussyjob', 'fingering'],
  breasts:  ['handjob', 'footjob', 'fellatio', 'blowjob', 'pussyjob', 'deepthroat'],
  cameltoe: ['handjob', 'footjob', 'fellatio', 'blowjob', 'paizuri', 'titjob'],
  cowgirl:  ['doggy style', 'doggystyle', 'missionary', 'fellatio', 'footjob', 'handjob only'],
  doggy:    ['cowgirl', 'missionary position', 'fellatio', 'paizuri', 'footjob'],
  missionary:['cowgirl', 'doggy style', 'from behind sex', 'footjob', 'oral only'],
};

const JOB_TONE_BOOST = {
  tempt: {
    oral:     'glossy lips, teasing oral implication, inviting upward gaze',
    hand:     'finger in mouth tease, hand on thigh, intimate hand focus',
    breasts:  'breast press tease, inviting paizuri hint, leaning forward',
    feet:     'foot tease on lap, legs angled, sole peek',
    cameltoe: 'panties on, labia rub tease hint, thigh squeeze',
    cowgirl:  'riding tease, straddling hint, girl on top implication',
    doggy:    'from behind tease, arched back, rear view hint',
    missionary:'lying on bed tease, intimate face to face hint',
  },
  sex: {
    oral:     'messy oral sex, saliva trail, drool, intense fellatio',
    hand:     'two-handed handjob, precum drip, stroking penis',
    breasts:  'paizuri, titjob, penis between breasts, breast squeeze',
    feet:     'footjob, soles on penis, oily soles, toe curl',
    cameltoe: 'pussyjob through panties, labia gripping penis, outercourse friction',
    cowgirl:  'riding rhythm, cowgirl, girl on top, intense eye contact',
    doggy:    'doggy style, rear entry, arched back emphasis',
    missionary:'missionary, deep penetration, legs wrapped, intimate face to face',
  },
};

const TONE_LABELS = {
  balance: '均衡', cute: '可愛', spicy: '色氣', tempt: '誘惑', sex: 'SEX',
  cute_spicy: '誘惑',
};

const INTENSITY_LABELS = {
  cute:  ['', '淡可愛', '輕可愛', '中可愛', '強可愛', '極可愛'],
  spicy: ['', '微色氣', '輕色氣', '中色氣', '強色氣', '極色氣'],
  tempt: ['', '微誘惑', '輕誘惑', '中誘惑', '強誘惑', '極誘惑'],
  sex:   ['', '暗示', '輕度', '中度', '強烈', '極限'],
  balance: ['', 'Lv1', 'Lv2', 'Lv3', 'Lv4', 'Lv5'],
};

const TONE_BOOST_LEVELS = {
  cute: {
    face:    ['soft gentle smile', 'kawaii expression, light blush', 'kawaii expression, sparkling eyes, adorable smile', 'kawaii expression, sparkling eyes, blushing cheeks, head tilt', 'maximum cute, kawaii, innocent charm, sparkling eyes, adorable smile, shy blush'],
    outfit:  ['pastel casual outfit', 'cute frilly dress, ribbon accents', 'cute idol outfit, fluffy textures', 'bunny maid cute outfit, playful design', 'hyper cute costume, ribbons, frills, pastel colors, moe aesthetic'],
    pose:    ['standing politely', 'peace sign, head tilt', 'cute pose, playful gesture, peace sign', 'bouncing cute pose, cheerful energy', 'maximum cute pose, heart hands, wink, playful idol gesture'],
    styleRef:['soft illustration', 'moe aesthetic, pastel palette', 'cute character design, soft shading', 'kawaii anime style, sparkle highlights', 'ultimate moe aesthetic, pastel, chibi-influenced cuteness'],
    details: ['small hair ribbon', 'ribbon hair clip, soft hair', 'twin ribbons, fluffy texture, hair ornaments', 'cat ears cute accessory, plush details', 'maximum cute accessories, ribbons, bows, fluffy plush aesthetic'],
    env:     ['soft daylight', 'pastel room, cozy atmosphere', 'cute bedroom, fairy lights', 'idol stage cute lighting, sparkles', 'dreamy pastel wonderland, magical cute atmosphere'],
  },
  spicy: {
    face:    ['gentle smile, soft gaze', 'slight blush, attractive eyes', 'bedroom eyes, glossy lips, light blush', 'sultry gaze, parted lips, flushed cheeks', 'heavy bedroom eyes, sensual expression, glossy parted lips, teasing look'],
    outfit:  ['fitted silhouette, subtle skin', 'crop top, bare midriff, short skirt', 'sheer fabric hint, thigh-highs, form-fitting', 'revealing outfit, lace trim, see-through elements', 'maximum fanservice outfit, sheer fabric, micro skirt, visible lingerie hints'],
    pose:    ['natural standing pose', 'hip tilt, confident stance', 'teasing pose, low angle emphasis', 'seductive pose, arched back, suggestive angle', 'provocative pose, emphasis on curves, suggestive low angle composition'],
    styleRef:['clean anime illustration', 'soft sensual shading', 'glossy skin highlights, alluring composition', 'fan-service aesthetic, glossy highlights', 'maximum sensual anime style, glossy skin, alluring fan-service composition'],
    details: ['subtle jewelry', 'choker, garter hints', 'lace details, garter belt visible', 'lingerie visible edges, wet hair strands', 'maximum sensual details, wet skin sheen, lingerie accents'],
    env:     ['soft studio light', 'warm indoor lighting', 'golden hour, soft rim light on curves', 'intimate mood lighting, bokeh', 'steamy atmosphere, dim sensual lighting, love hotel aesthetic hints'],
  },
  tempt: {
    face:    ['inviting gaze, soft lips', 'teasing smile, bedroom eyes', 'sultry gaze, parted glossy lips, heavy blush', 'tempting expression, tongue out slightly, bedroom eyes', 'maximum temptation, ahegao-lite, tongue out, teary sultry eyes, begging gaze'],
    outfit:  ['unbuttoned top hint', 'off-shoulder, short hemline, lace', 'lingerie visible, garter straps, pulled fabric', 'barely covered, virgin killer sweater, panties visible', 'maximum temptation outfit, lingerie, see-through, clothes pulled aside, undressing'],
    pose:    ['leaning forward slightly', 'high angle selfie, teasing smile at camera', 'selfie covering breasts, skirt lift tease, embarrassed blush', 'low angle thigh focus, panty peek, upskirt composition', 'maximum temptation pose, full body low angle, skirt lifted, thigh gap, pantyshot, seductive POV'],
    styleRef:['alluring illustration', 'eroge CG quality hints', 'sensual atmosphere, glossy fabric tension', 'fan-service eroge style, wet fabric clinging', 'maximum eroge aesthetic, glossy skin shader, heavy fan-service composition'],
    details: ['loose ribbon, disheveled hair', 'messy hair, sweat drops, flushed skin', 'wet hair, visible collarbone, undone buttons', 'sweaty skin, love bites hint, disheveled clothes', 'maximum temptation details, sweat, flushed body, undone outfit'],
    env:     ['private room, soft light', 'bedroom setting, rumpled sheets', 'love hotel lighting, red ambient glow', 'steamy bathroom, fogged mirror, intimate', 'maximum intimate setting, love hotel, dim red light, rumpled bed sheets'],
    job:     ['teasing hand on thigh', 'finger in mouth, oral implication', 'breast press tease, inviting paizuri hint', 'panties on, labia rub tease hint', 'foot tease on lap, sultry friction hint'],
  },
  sex: {
    face:    ['flushed face, heavy blush', 'lustful gaze, open mouth, sweat on face', 'ahegao expression, rolled eyes, tongue out, drool', 'intense ahegao, tears, tongue out, orgasm face', 'maximum explicit expression, extreme ahegao, tears, drool, fucked silly face'],
    outfit:  ['clothes disheveled, partial undress', 'topless, panties only, clothes pulled aside', 'nearly nude, lingerie pushed aside, exposed chest', 'mostly nude, minimal coverage, explicit exposure', 'fully nude, no coverage, explicit nsfw state'],
    pose:    ['suggestive reclining pose', 'spread legs pose, explicit angle', 'mating press position, explicit intercourse pose', 'cowgirl position, explicit sexual pose', 'maximum explicit pose, graphic sexual position, spread legs, penetration implied'],
    styleRef:['nsfw anime illustration', 'explicit hentai art style', 'erotic detailed anatomy emphasis', 'hardcore hentai aesthetic, explicit detail', 'maximum explicit hentai style, graphic nsfw, detailed erotic anatomy'],
    details: ['visible sweat, heated skin', 'exposed nipples, flushed body', 'explicit body exposure, wet skin, fluids hint', 'graphic anatomical detail, explicit nsfw tags', 'maximum explicit details, full nsfw anatomy tags, fluids, penetration detail'],
    env:     ['private bedroom', 'messy bed, afterglow atmosphere', 'love hotel room, explicit setting', 'onsen or bathroom explicit scene', 'maximum explicit environment, love hotel, messy sheets, steamy nsfw scene'],
    job:     ['handjob, stroking penis, precum drip', 'deepthroat, blowjob, messy oral sex', 'paizuri, titjob, penis between breasts', 'pussyjob through panties, labia gripping penis', 'footjob, soles on penis, outercourse pussyjob'],
  },
};

const DEFAULT_TEMPLATES = [
  {
    subject: DEFAULT_CHAR_BANKS.subject[0], face: DEFAULT_CHAR_BANKS.face[0], details: DEFAULT_CHAR_BANKS.details[0],
    outfit: DEFAULT_CHAR_BANKS.outfit[0], pose: DEFAULT_CHAR_BANKS.pose[0], job: '', env: DEFAULT_CHAR_BANKS.env[0],
    styleRef: DEFAULT_CHAR_BANKS.styleRef[0], quality: DEFAULT_CHAR_BANKS.quality[0],
  },
  {
    subject: DEFAULT_CHAR_BANKS.subject[1], face: DEFAULT_CHAR_BANKS.face[1], details: DEFAULT_CHAR_BANKS.details[1],
    outfit: DEFAULT_CHAR_BANKS.outfit[1], pose: DEFAULT_CHAR_BANKS.pose[1], job: '', env: DEFAULT_CHAR_BANKS.env[1],
    styleRef: DEFAULT_CHAR_BANKS.styleRef[1], quality: DEFAULT_CHAR_BANKS.quality[1],
  },
];

let charBanks = loadCharBanks();
let charTemplates = loadCharTemplates();
let charSlots = {};
let charLocked = new Set();
let charMode = 'mix';
let charFmt = 'structured';
let charTone = (() => {
  const t = localStorage.getItem('void-char-tone') || 'cute';
  return t === 'cute_spicy' ? 'tempt' : t;
})();
let charToneIntensity = Math.min(5, Math.max(1, +(localStorage.getItem('void-char-tone-intensity') || 3)));
let charJobTypes = new Set(['none']);
let charPosePresets = new Set(['all']);
let charSpicyOutfits = new Set(['none']);
let charSpicyActions = new Set(['none']);
let charBodyFrame = new Set(['none']);
let charBodyBreast = new Set(['none']);
let charBodyFigure = new Set(['none']);
let charEnvPresets = new Set(['none']);
let charHistory = [];
let learnPreviewData = null;

function scoreToneEntry(text) {
  const t = text.toLowerCase();
  const scores = { cute: 0, spicy: 0, tempt: 0, sex: 0 };
  Object.entries(TONE_MARKERS).forEach(([tone, keys]) => {
    keys.forEach(k => { if (t.includes(k)) scores[tone]++; });
  });
  return scores;
}

function toneDominantScore(s) {
  return Math.max(s.cute, s.spicy, s.tempt, s.sex);
}

function filterBankByTone(bank, tone) {
  if (!bank.length || tone === 'balance') return bank;
  const filtered = bank.filter(entry => {
    const s = scoreToneEntry(entry);
    const dom = toneDominantScore(s);
    if (!dom) return tone === 'cute' || tone === 'spicy';
    const top = Object.entries(s).filter(([, v]) => v === dom).map(([k]) => k);
    if (tone === 'cute') return top.includes('cute') || (s.cute > 0 && !s.sex && !s.tempt);
    if (tone === 'spicy') return top.includes('spicy') || (s.spicy > 0 && !s.sex && s.tempt <= s.spicy);
    if (tone === 'tempt') return top.includes('tempt') || s.tempt > 0 || (s.spicy > 1 && s.sex === 0);
    if (tone === 'sex') return top.includes('sex') || s.sex > 0 || s.tempt >= 2;
    return true;
  });
  return filtered.length ? filtered : bank;
}

function normalizeCharTone(tone) {
  return tone === 'cute_spicy' ? 'tempt' : tone;
}

function getToneBoostTags(tone, key, intensity) {
  const t = normalizeCharTone(tone);
  const tiers = TONE_BOOST_LEVELS[t]?.[key];
  if (!tiers?.length) return [];
  const lvl = Math.min(5, Math.max(1, intensity));
  const tags = [];
  for (let i = 0; i < lvl; i++) {
    if (tiers[i]) tags.push(tiers[i]);
  }
  return tags.length > 2 ? tags.slice(-2) : tags;
}

function applyToneBoost(key, value) {
  if (!value || charTone === 'balance') return value;
  const tags = getToneBoostTags(charTone, key, charToneIntensity);
  return tags.length ? value + ', ' + tags.join(', ') : value;
}

function setCharTone(tone) {
  charTone = normalizeCharTone(tone);
  localStorage.setItem('void-char-tone', charTone);
  ['balance', 'cute', 'spicy', 'tempt', 'sex'].forEach(id => {
    document.getElementById('char-tone-' + id)?.classList.toggle('on', id === charTone);
    document.getElementById('char-tone-' + id + '-v2')?.classList.toggle('on', id === charTone);
  });
  if (charTone === 'sex') {
    SAFE_SELFIE_IDS.forEach(id => charPosePresets.delete(id));
    if (!charPosePresets.size) charPosePresets.add('all');
    renderCharPoseChips();
  }
  if (charTone === 'cute' && charJobTypes.has('all')) {
    charJobTypes = new Set(['none']);
    renderCharJobChips();
    const jobInc = document.getElementById('char-inc-job');
    if (jobInc) jobInc.checked = false;
    charSlots.job = '';
  }
  syncCharIntensity();
  saveActiveSession();
}

function syncCharIntensity() {
  const el = document.getElementById('char-tone-intensity') || document.getElementById('char-tone-intensity-v2');
  if (!el) return;
  charToneIntensity = Math.min(5, Math.max(1, +el.value));
  const intMain = document.getElementById('char-tone-intensity');
  const intV2 = document.getElementById('char-tone-intensity-v2');
  if (intMain) intMain.value = charToneIntensity;
  if (intV2) intV2.value = charToneIntensity;
  const toneVal = document.getElementById('char-tone-intensity-val');
  const toneValV2 = document.getElementById('char-tone-intensity-val-v2');
  if (toneVal) toneVal.textContent = charToneIntensity;
  if (toneValV2) toneValV2.textContent = charToneIntensity;
  localStorage.setItem('void-char-tone-intensity', charToneIntensity);
  const nameEl = document.getElementById('char-tone-intensity-name');
  const hintEl = document.getElementById('char-tone-level-hint');
  const labels = INTENSITY_LABELS[charTone] || INTENSITY_LABELS.balance;
  const label = labels[charToneIntensity] || ('Lv' + charToneIntensity);
  if (nameEl) {
    nameEl.textContent = charTone === 'cute' ? '可愛程度' : (charTone === 'balance' ? '調性強度' : '色氣程度');
  }
  if (hintEl) hintEl.textContent = `Lv${charToneIntensity} · ${label}`;
}

const JOB_BANK_BANNED = [/leaking feet/i, /licking feet/i, /licking soles/i, /sucking toes/i, /foot worship/i];

function sanitizeJobBankEntry(entry) {
  const t = String(entry || '');
  return !JOB_BANK_BANNED.some(re => re.test(t));
}

function loadCharBanks() {
  try {
    const saved = JSON.parse(localStorage.getItem('void-char-banks')||'{}');
    const merged = {};
    CHAR_SECTIONS.forEach(s => {
      const def = DEFAULT_CHAR_BANKS[s.key] || [];
      const extra = saved[s.key] || [];
      let list = [...new Set([...def, ...extra])];
      if (s.key === 'job') list = list.filter(sanitizeJobBankEntry);
      if (s.key === 'quality') list = list.map(sanitizeQualityText).filter(Boolean);
      merged[s.key] = list;
    });
    return merged;
  } catch { return {...DEFAULT_CHAR_BANKS}; }
}
function loadCharTemplates() {
  try {
    const saved = JSON.parse(localStorage.getItem('void-char-templates')||'[]');
    return [...DEFAULT_TEMPLATES, ...saved.filter(t => t && t.subject)];
  } catch { return [...DEFAULT_TEMPLATES]; }
}
function saveCharBanks() {
  if (typeof VoidSearch !== 'undefined') VoidSearch.rebuildLearnedRules(getLearnedSearchTags);
  const extra = {};
  CHAR_SECTIONS.forEach(s => {
    const def = new Set(DEFAULT_CHAR_BANKS[s.key]||[]);
    let list = (charBanks[s.key]||[]).filter(v => !def.has(v));
    if (s.key === 'job') list = list.filter(sanitizeJobBankEntry);
    if (s.key === 'quality') list = list.map(sanitizeQualityText).filter(Boolean);
    extra[s.key] = list;
  });
  localStorage.setItem('void-char-banks', JSON.stringify(extra));
  const savedTpl = charTemplates.filter(t => !DEFAULT_TEMPLATES.some(d => d.subject===t.subject && d.outfit===t.outfit));
  localStorage.setItem('void-char-templates', JSON.stringify(savedTpl));
}

function setCharMode(m) {
  charMode = m;
  document.getElementById('char-mode-mix')?.classList.toggle('on', m === 'mix');
  document.getElementById('char-mode-learn')?.classList.toggle('on', m === 'learn');
  document.getElementById('char-mode-template')?.classList.toggle('on', m === 'template');
}

function isDefaultTemplate(tpl) {
  return DEFAULT_TEMPLATES.some(d => d.subject === tpl.subject && d.outfit === tpl.outfit);
}

function getUserLearnedTemplates() {
  return charTemplates.filter(t => t && t.subject && !isDefaultTemplate(t));
}

function getSectionTagPool(key) {
  const bank = getCharBankFiltered(key);
  const tags = new Set();
  bank.forEach(entry => splitPromptTags(entry).forEach(t => tags.add(t)));
  return [...tags];
}

function pickManyTags(arr, count) {
  if (!arr.length || count <= 0) return [];
  const copy = [...arr];
  const n = Math.min(count, copy.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
}

function rollCharTags(key, min = 2, max = 5) {
  const pool = getSectionTagPool(key);
  if (!pool.length) return '';
  const n = Math.min(pool.length, min + Math.floor(Math.random() * (max - min + 1)));
  return applyToneBoost(key, pickManyTags(pool, n).join(', '));
}

function addTagsToBank(key, tags) {
  if (!tags?.length) return 0;
  let n = 0;
  tags.forEach(tag => {
    let t = tag.trim();
    if (!t) return;
    if (key === 'quality') t = sanitizeQualityText(t);
    if (!t || charBanks[key].includes(t)) return;
    if (key === 'job' && !sanitizeJobBankEntry(t)) return;
    charBanks[key].push(t);
    n++;
  });
  return n;
}

function generateCharLearn() {
  const learned = getUserLearnedTemplates();
  const base = learned.length ? pick(learned) : (charTemplates.length ? pick(charTemplates) : null);
  if (!learned.length && !getSectionTagPool('subject').length) {
    toast('請先學習至少一則 Prompt');
  }

  CHAR_SECTIONS.forEach(s => {
    if (!charIsIncluded(s.key)) { charSlots[s.key] = ''; return; }
    if (s.key === 'job' && isJobDisabled()) { charSlots[s.key] = ''; return; }
    if (charLocked.has(s.key)) return;

    const pool = getSectionTagPool(s.key);
    const hasBase = !!(base && base[s.key]);
    if (!pool.length && !hasBase) { charSlots[s.key] = ''; return; }

    if (hasBase && Math.random() < 0.42) {
      charSlots[s.key] = applyToneBoost(s.key, base[s.key]);
    } else if (pool.length) {
      charSlots[s.key] = s.key === 'job' ? rollJobSection()
        : s.key === 'pose' ? rollPoseSection()
        : s.key === 'outfit' && isCuteSelfieOutfitMode() ? rollCharSection('outfit')
        : rollCharTags(s.key);
    } else {
      charSlots[s.key] = applyToneBoost(s.key, base[s.key]);
    }
  });
  coerceSlotsForActiveJob();
}
function setCharFmt(f) {
  charFmt = f;
  document.getElementById('char-fmt-structured')?.classList.toggle('on', f==='structured');
  document.getElementById('char-fmt-flat')?.classList.toggle('on', f==='flat');
  renderChar();
}

function charIsIncluded(key) {
  return document.getElementById('char-inc-'+key)?.checked !== false;
}

function scoreJobEntry(text) {
  const t = text.toLowerCase();
  const scores = {};
  Object.entries(JOB_TYPE_MARKERS).forEach(([type, keys]) => {
    scores[type] = keys.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
  });
  return scores;
}

function isJobDisabled() {
  return charJobTypes.has('none');
}

function stripNegativeFromText(text) {
  if (!text) return text;
  return text
    .replace(/,?\s*negative prompt:\s*.+$/is, '')
    .replace(/,?\s*avoid:\s*.+$/is, '')
    .replace(/,\s*,+/g, ',')
    .replace(/^,\s*|\s*,$/g, '')
    .trim();
}

function isNegativeQualityTag(tag) {
  const pl = String(tag || '').toLowerCase().trim();
  if (!pl) return true;
  if (/^negative prompt:/i.test(pl) || /^avoid:/i.test(pl)) return true;
  return QUALITY_NEGATIVE_TAGS.has(pl);
}

function sanitizeQualityText(text) {
  if (!text) return text;
  const parts = stripNegativeFromText(text).split(',').map(s => s.trim()).filter(Boolean);
  return parts.filter(p => !isNegativeQualityTag(p)).join(', ');
}

function finalizeSlotText(key, text) {
  if (!text) return text;
  return key === 'quality' ? sanitizeQualityText(text) : stripNegativeFromText(text);
}

function sanitizeNegativeFromSlots() {
  CHAR_SECTIONS.forEach(s => {
    if (charSlots[s.key]) charSlots[s.key] = finalizeSlotText(s.key, charSlots[s.key]);
  });
}

function appendPixDefaultNegative() {
  /* 負向標籤不寫入輸出 */
}

function applyPixFormulaTemplate(key) {
  const tpl = PIX_FORMULA_TEMPLATES[key];
  if (!tpl) return;
  CHAR_SECTIONS.forEach(s => {
    if (!charIsIncluded(s.key) || charLocked.has(s.key)) return;
    if (s.key === 'job') { charSlots.job = ''; return; }
    if (tpl[s.key]) charSlots[s.key] = tpl[s.key];
  });
  appendPixDefaultNegative();
}

function filterJobBankByType(bank) {
  if (!bank.length || isJobDisabled()) return [];
  if (charJobTypes.has('all')) return bank;
  const active = [...charJobTypes].filter(t => t !== 'none' && t !== 'all');
  if (!active.length) return bank;
  return bank.filter(entry => {
    const s = scoreJobEntry(entry);
    return active.some(type => s[type] > 0);
  });
}

function getActiveJobTypes() {
  return [...charJobTypes].filter(t => t !== 'none' && t !== 'all');
}

function getJobFallbackBank() {
  if (isJobDisabled() || charJobTypes.has('all')) return [];
  return getActiveJobTypes().map(t => JOB_TYPE_FALLBACK[t]).filter(Boolean);
}

function getJobPoseFallbackBank() {
  if (isJobDisabled()) return [];
  return getActiveJobTypes().map(t => JOB_POSE_FALLBACK[t]).filter(Boolean);
}

function hasSpecificJobTypes() {
  return getActiveJobTypes().length > 0;
}

function jobEntryMatchesActiveTypes(text) {
  if (!text) return false;
  if (charJobTypes.has('all')) return true;
  const active = getActiveJobTypes();
  if (!active.length) return true;
  const s = scoreJobEntry(text);
  if (active.length === 1) {
    const type = active[0];
    const typeScore = s[type] || 0;
    if (!typeScore) return false;
    const otherMax = Object.entries(s)
      .filter(([k]) => k !== type)
      .reduce((m, [, v]) => Math.max(m, v), 0);
    return typeScore >= otherMax;
  }
  return active.some(t => (s[t] || 0) > 0);
}

function pickJobEntry(bank) {
  if (!bank.length) return '';
  const active = getActiveJobTypes();
  if (!active.length || charJobTypes.has('all')) return pick(bank);
  const scored = bank.map(entry => {
    const s = scoreJobEntry(entry);
    const activeScore = active.reduce((n, t) => n + (s[t] || 0), 0);
    return { entry, s, activeScore };
  }).filter(x => x.activeScore > 0);
  if (!scored.length) return '';
  if (active.length === 1) {
    const type = active[0];
    const strict = scored.filter(x => {
      const typeScore = x.s[type] || 0;
      if (!typeScore) return false;
      const otherMax = Object.entries(x.s)
        .filter(([k]) => k !== type)
        .reduce((m, [, v]) => Math.max(m, v), 0);
      return typeScore >= otherMax;
    });
    const pool = (strict.length ? strict : scored).map(x => x.entry);
    return pick(pool);
  }
  const max = Math.max(...scored.map(x => x.activeScore));
  return pick(scored.filter(x => x.activeScore === max).map(x => x.entry));
}

function applyJobToneBoost(value) {
  if (!value || charTone === 'balance') return value;
  const active = getActiveJobTypes();
  if (active.length === 1) {
    const boost = JOB_TONE_BOOST[charTone]?.[active[0]];
    if (boost) return value + ', ' + boost;
    return value;
  }
  if (hasSpecificJobTypes()) return value;
  return applyToneBoost('job', value);
}

function rollJobSection() {
  if (isJobDisabled()) return '';
  let bank = filterJobBankByType(charBanks.job || []);
  if (!bank.length) bank = getJobFallbackBank();
  if (!bank.length) return '';
  if (!hasSpecificJobTypes()) {
    const toned = filterBankByTone(bank, charTone);
    if (toned.length) bank = toned;
  } else {
    const toned = filterBankByTone(bank, charTone);
    bank = toned.length ? toned : bank;
  }
  let picked = pickJobEntry(bank);
  if (!picked && hasSpecificJobTypes()) picked = pick(getJobFallbackBank());
  return picked ? applyJobToneBoost(picked) : '';
}

function poseHasConflictingJobMarkers(text) {
  if (!text || !hasSpecificJobTypes()) return false;
  const t = text.toLowerCase();
  const active = getActiveJobTypes();
  const excludes = new Set(active.flatMap(id => JOB_POSE_EXCLUDE[id] || []));
  return [...excludes].some(m => t.includes(m));
}

function poseMatchesActiveJob(text) {
  if (!text || isJobDisabled() || charJobTypes.has('all')) return true;
  if (poseHasConflictingJobMarkers(text)) return false;
  const active = getActiveJobTypes();
  if (!active.length) return true;
  const t = text.toLowerCase();
  const affinity = active.flatMap(id => POSE_JOB_AFFINITY[id] || []);
  if (!affinity.length) return true;
  return affinity.some(m => t.includes(m));
}

function shouldMergeJobPose() {
  return hasActiveJob() && charIsIncluded('job') && charIsIncluded('pose');
}

function isJobActionTag(tag) {
  if (!tag) return false;
  const s = scoreJobEntry(tag);
  return Object.values(s).some(v => v > 0);
}

function mergePoseAndJob(pose, job) {
  const tags = [];
  const seen = new Set();
  [...splitPromptTags(pose || ''), ...splitPromptTags(job || '')].forEach(t => {
    const k = t.toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    tags.push(t);
  });
  return tags.join(', ');
}

function splitMergedPoseJob(merged) {
  const tags = splitPromptTags(merged);
  const poseTags = [];
  const jobTags = [];
  tags.forEach(t => {
    if (isJobActionTag(t)) jobTags.push(t);
    else poseTags.push(t);
  });
  return { pose: poseTags.join(', '), job: jobTags.join(', ') };
}

function getSlotOutputValue(key) {
  const raw = finalizeSlotText(key, charSlots[key]);
  if (!raw) return '';
  if (shouldMergeJobPose() && key === 'pose') {
    return mergePoseAndJob(charSlots.pose, charSlots.job);
  }
  if (shouldMergeJobPose() && key === 'job') return '';
  return raw;
}

function syncPoseJobCoherence() {
  if (isJobDisabled()) return;
  if (charIsIncluded('job') && !charLocked.has('job')) {
    if (!charSlots.job || !jobEntryMatchesActiveTypes(charSlots.job)) {
      charSlots.job = rollJobSection();
    }
  }
  if (!charIsIncluded('pose') || charLocked.has('pose')) return;
  const poseBad = !charSlots.pose
    || entryHasJobOrExplicitMarkers(charSlots.pose)
    || POSE_SELFIE_CONFLICT_MARKERS.some(m => charSlots.pose.toLowerCase().includes(m))
    || poseHasConflictingJobMarkers(charSlots.pose)
    || !poseMatchesActiveJob(charSlots.pose);
  if (poseBad) charSlots.pose = rollPoseSection();
  if (!poseMatchesActiveJob(charSlots.pose)) {
    const fb = getJobPoseFallbackBank();
    if (fb.length) charSlots.pose = pick(fb);
  }
}

function coerceSlotsForActiveJob() {
  syncPoseJobCoherence();
}

function scorePosePresetEntry(text) {
  const t = text.toLowerCase();
  const scores = {};
  Object.entries(POSE_PRESET_MARKERS).forEach(([id, keys]) => {
    scores[id] = keys.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
  });
  return scores;
}

function isCuteSelfieOutfitMode() {
  return [...charPosePresets].some(id => CUTE_SELFIE_OUTFIT_IDS.includes(id));
}

function isSafeSelfieMode() {
  if (!isJobDisabled()) return false;
  return [...charPosePresets].some(id => SAFE_SELFIE_IDS.includes(id));
}

function hasActiveJob() {
  return !isJobDisabled();
}

function getActiveJobMarkerLists() {
  if (isJobDisabled()) return [];
  const types = charJobTypes.has('all')
    ? Object.keys(JOB_TYPE_MARKERS)
    : [...charJobTypes].filter(t => t !== 'none' && t !== 'all');
  return types.flatMap(t => JOB_TYPE_MARKERS[t] || []);
}

function entryHasJobOrExplicitMarkers(text) {
  const t = text.toLowerCase();
  const markers = [...POSE_EXPLICIT_BLOCK, ...getActiveJobMarkerLists()];
  return markers.some(k => t.includes(k.toLowerCase()));
}

function filterPoseExcludeJobMarkers(bank) {
  if (isJobDisabled() || !bank.length) return bank;
  const filtered = bank.filter(e => !entryHasJobOrExplicitMarkers(e));
  return filtered.length ? filtered : bank.filter(e => {
    const t = e.toLowerCase();
    return !POSE_EXPLICIT_BLOCK.some(k => t.includes(k));
  });
}

function filterPoseExcludeSelfieConflict(bank) {
  if (isJobDisabled() || !bank.length) return bank;
  const filtered = bank.filter(e => {
    const t = e.toLowerCase();
    return !POSE_SELFIE_CONFLICT_MARKERS.some(m => t.includes(m));
  });
  return filtered.length ? filtered : bank;
}

function filterPoseExcludeWrongJobType(bank) {
  if (!bank.length || !hasSpecificJobTypes()) return bank;
  const filtered = bank.filter(e => !poseHasConflictingJobMarkers(e));
  return filtered.length ? filtered : bank;
}

function filterPoseByJobAffinity(bank) {
  if (isJobDisabled() || !bank.length || charJobTypes.has('all')) return bank;
  const markers = getActiveJobTypes().flatMap(t => POSE_JOB_AFFINITY[t] || []);
  if (!markers.length) return bank;
  const scored = bank.map(entry => {
    const t = entry.toLowerCase();
    const score = markers.reduce((n, m) => n + (t.includes(m) ? 1 : 0), 0);
    return { entry, score };
  }).filter(x => x.score > 0);
  if (!scored.length) return [];
  const max = Math.max(...scored.map(x => x.score));
  return scored.filter(x => x.score === max).map(x => x.entry);
}

function filterPoseForActiveJob(bank) {
  let result = filterPoseExcludeJobMarkers(bank);
  result = filterPoseExcludeSelfieConflict(result);
  result = filterPoseExcludeWrongJobType(result);
  const affinity = filterPoseByJobAffinity(result);
  if (affinity.length) return affinity;
  if (hasSpecificJobTypes()) return getJobPoseFallbackBank();
  return result.length ? result : bank;
}

function applySafeSelfieDefaults() {
  charJobTypes = new Set(['none']);
  renderCharJobChips();
  const jobInc = document.getElementById('char-inc-job');
  if (jobInc) jobInc.checked = false;
  charSlots.job = '';
  if (charTone === 'sex') {
    setCharTone('tempt');
    const intEl = document.getElementById('char-tone-intensity');
    if (intEl && charToneIntensity > 3) { intEl.value = 3; syncCharIntensity(); }
  }
}

function syncJobPoseMutex(opts = {}) {
  const penJobs = getActiveJobTypes().filter(id => JOB_POSE_SELFIE_BLOCK.includes(id));
  if (!penJobs.length) return;
  const hadSafe = [...charPosePresets].filter(id => SAFE_SELFIE_IDS.includes(id));
  if (!hadSafe.length) return;
  hadSafe.forEach(id => charPosePresets.delete(id));
  if (!charPosePresets.size) charPosePresets.add('all');
  renderCharPoseChips();
  if (!opts.silent) toast('已清除自拍姿勢（性交体位 NSFW 優先）');
}

function filterPoseNoExplicit(bank) {
  if (!bank.length) return bank;
  const safe = bank.filter(entry => {
    const t = entry.toLowerCase();
    return !POSE_EXPLICIT_BLOCK.some(k => t.includes(k));
  });
  return safe.length ? safe : bank;
}

function filterPoseBankByPreset(bank) {
  if (!bank.length) return bank;
  let result = bank;
  if (!charPosePresets.has('all')) {
    const active = [...charPosePresets];
    const filtered = bank.filter(entry => {
      const s = scorePosePresetEntry(entry);
      return active.some(id => s[id] > 0);
    });
    result = filtered.length ? filtered : bank;
  }
  if (isSafeSelfieMode()) result = filterPoseNoExplicit(result);
  return result;
}

function scoreOutfitPresetEntry(text) {
  const t = text.toLowerCase();
  const scores = {};
  Object.entries(OUTFIT_PRESET_MARKERS).forEach(([id, keys]) => {
    scores[id] = keys.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
  });
  return scores;
}

function filterOutfitBankByPosePreset(bank) {
  if (!bank.length || !isCuteSelfieOutfitMode()) return bank;
  const active = [...charPosePresets].filter(id => CUTE_SELFIE_OUTFIT_IDS.includes(id));
  if (!active.length) return bank;
  const filtered = bank.filter(entry => {
    const s = scoreOutfitPresetEntry(entry);
    return active.some(id => s[id] > 0);
  });
  return filtered.length ? filtered : bank;
}

function scoreSpicyOutfitEntry(text) {
  const t = text.toLowerCase();
  const scores = {};
  Object.entries(SPICY_OUTFIT_MARKERS).forEach(([id, keys]) => {
    scores[id] = keys.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
  });
  return scores;
}

function textHasAnyMarker(text, markers) {
  const t = (text || '').toLowerCase();
  return (markers || []).some(m => t.includes(String(m).toLowerCase()));
}

function outfitSupportsSkirtPose(outfitText) {
  return textHasAnyMarker(outfitText, OUTFIT_SKIRT_MARKERS)
    && !textHasAnyMarker(outfitText, OUTFIT_NO_SKIRT_MARKERS);
}

function resolveSpicyOutfitConflicts(id) {
  (SPICY_OUTFIT_CONFLICTS[id] || []).forEach(c => charSpicyOutfits.delete(c));
  Object.entries(SPICY_OUTFIT_CONFLICTS).forEach(([other, list]) => {
    if (list.includes(id)) charSpicyOutfits.delete(other);
  });
}

function resolvePosePresetConflicts(id) {
  (POSE_PRESET_CONFLICTS[id] || []).forEach(c => charPosePresets.delete(c));
  Object.entries(POSE_PRESET_CONFLICTS).forEach(([other, list]) => {
    if (list.includes(id)) charPosePresets.delete(other);
  });
}

function resolveJobTypeConflicts(id) {
  (JOB_TYPE_CONFLICTS[id] || []).forEach(c => charJobTypes.delete(c));
  Object.entries(JOB_TYPE_CONFLICTS).forEach(([other, list]) => {
    if (list.includes(id)) charJobTypes.delete(other);
  });
}

function resolveSpicyActionConflicts(id) {
  (SPICY_ACTION_CONFLICTS[id] || []).forEach(c => charSpicyActions.delete(c));
  Object.entries(SPICY_ACTION_CONFLICTS).forEach(([other, list]) => {
    if (list.includes(id)) charSpicyActions.delete(other);
  });
  if (isCuteSelfieOutfitMode() && charSpicyActions.has(id)) {
    ['all_fours', 'straddle', 'panty_peek'].forEach(c => {
      if (id === c || (SPICY_ACTION_CONFLICTS.peace_sign || []).includes(id)) charSpicyActions.delete(c);
    });
    if (['all_fours', 'straddle', 'panty_peek'].includes(id)) charSpicyActions.delete(id);
  }
}

function collectPresetConflictWarnings() {
  const warnings = [];
  const spicyActive = [...charSpicyOutfits].filter(id => id !== 'all' && id !== 'none');
  const spicyLabel = id => SPICY_OUTFIT_TYPES.find(x => x.id === id)?.label || id;
  spicyActive.forEach(id => {
    (SPICY_OUTFIT_CONFLICTS[id] || []).filter(c => spicyActive.includes(c)).forEach(c => {
      warnings.push(`服裝「${spicyLabel(id)}」與「${spicyLabel(c)}」衝突`);
    });
  });
  const poseActive = [...charPosePresets].filter(id => id !== 'all');
  const poseLabel = id => POSE_PRESETS.find(p => p.id === id)?.label || id;
  poseActive.forEach(id => {
    (POSE_PRESET_CONFLICTS[id] || []).filter(c => poseActive.includes(c)).forEach(c => {
      warnings.push(`拍照「${poseLabel(id)}」與「${poseLabel(c)}」衝突`);
    });
  });
  const jobActive = getActiveJobTypes();
  const jobLabel = id => JOB_TYPES.find(j => j.id === id)?.label || id;
  jobActive.forEach(id => {
    (JOB_TYPE_CONFLICTS[id] || []).filter(c => jobActive.includes(c)).forEach(c => {
      warnings.push(`NSFW「${jobLabel(id)}」與「${jobLabel(c)}」請擇一`);
    });
  });
  const selfiePoseOn = poseActive.some(id => SAFE_SELFIE_IDS.includes(id));
  if (selfiePoseOn && jobActive.some(id => JOB_POSE_SELFIE_BLOCK.includes(id))) {
    warnings.push('自拍姿勢與性交体位 NSFW 不宜併選');
  }
  const spicySchool = spicyActive.includes('school') || spicyActive.includes('teacher');
  if (spicySchool && jobActive.length && !charJobTypes.has('all')) {
    warnings.push('制服系服裝與 NSFW 併選時將偏向成人向重抽');
  }
  const actionActive = [...charSpicyActions].filter(id => id !== 'all' && id !== 'none');
  if (isCuteSelfieOutfitMode() && actionActive.some(id => ['all_fours', 'straddle', 'panty_peek'].includes(id))) {
    warnings.push('清純自拍與露骨肢體動作可能不符');
  }
  if (charSlots.outfit && charSlots.pose) {
    if (textHasAnyMarker(charSlots.pose, POSE_NEEDS_SKIRT_MARKERS) && !outfitSupportsSkirtPose(charSlots.outfit)) {
      warnings.push('裙擺姿勢需裙子／連身裙類服裝');
    }
    if (isSafeSelfieMode() && textHasAnyMarker(charSlots.outfit, OUTFIT_EXPLICIT_MARKERS)) {
      warnings.push('自拍模式不建議裸露服裝');
    }
    if (isCuteSelfieOutfitMode() && charPosePresets.has('cute_outfit_normal')
        && textHasAnyMarker(charSlots.outfit, OUTFIT_PRESET_MARKERS.cute_outfit_underwear)) {
      warnings.push('清純服裝預設與內衣類服裝不符');
    }
  }
  return [...new Set(warnings)];
}

function checkPresetConflicts(silent = false) {
  const warnings = collectPresetConflictWarnings();
  if (warnings.length && !silent) toast(warnings[0] + (warnings.length > 1 ? ` 等${warnings.length}項` : ''));
  updateEmbedCharConflictHint(warnings);
  return warnings;
}

function updateEmbedCharConflictHint(warnings) {
  const el = document.getElementById('embed-char-conflict-hint');
  if (!el) return;
  const list = warnings || collectPresetConflictWarnings();
  if (!list.length) {
    el.innerHTML = '';
    el.classList.remove('has-warn');
    return;
  }
  el.classList.add('has-warn');
  el.innerHTML = `<span class="embed-conflict-title">PROMPT 衝突提示</span>${list.slice(0, 4).map(w => `<div class="embed-conflict-line">⚠ ${escHtml(w)}</div>`).join('')}`;
}

function filterOutfitExcludePoseConflict(bank) {
  if (!bank.length || !charSlots.pose) return bank;
  const pose = charSlots.pose;
  let result = bank;
  if (isSafeSelfieMode()) {
    const safe = result.filter(e => !textHasAnyMarker(e, OUTFIT_EXPLICIT_MARKERS));
    if (safe.length) result = safe;
  }
  if (textHasAnyMarker(pose, POSE_NEEDS_SKIRT_MARKERS)) {
    const skirtOk = result.filter(e => outfitSupportsSkirtPose(e));
    if (skirtOk.length) result = skirtOk;
  }
  if (isCuteSelfieOutfitMode() && [...charPosePresets].includes('cute_outfit_normal')) {
    const cute = result.filter(e => {
      if (textHasAnyMarker(e, OUTFIT_EXPLICIT_MARKERS)) return false;
      if (textHasAnyMarker(e, OUTFIT_PRESET_MARKERS.cute_outfit_underwear)) return false;
      return true;
    });
    if (cute.length) result = cute;
  }
  return result;
}

function filterPoseByOutfitContext(bank) {
  if (!bank.length || !charSlots.outfit) return bank;
  const outfit = charSlots.outfit;
  let result = bank;
  if (isSafeSelfieMode() || (isCuteSelfieOutfitMode() && !charSpicyOutfits.has('all'))) {
    const safe = result.filter(e => !textHasAnyMarker(e, POSE_EXPLICIT_BLOCK));
    if (safe.length) result = safe;
  }
  if (!outfitSupportsSkirtPose(outfit)) {
    const noSkirt = result.filter(e => !textHasAnyMarker(e, POSE_NEEDS_SKIRT_MARKERS));
    if (noSkirt.length) result = noSkirt;
  }
  if (textHasAnyMarker(outfit, OUTFIT_PRESET_MARKERS.cute_outfit_sleepwear)) {
    const cozy = result.filter(e => {
      const t = e.toLowerCase();
      return t.includes('bed') || t.includes('lying') || t.includes('pillow') || t.includes('cozy')
        || t.includes('selfie') || t.includes('sitting') || t.includes('relaxed');
    });
    if (cozy.length) result = cozy;
  }
  return result;
}

function syncOutfitPoseCoherence() {
  if (!charIsIncluded('outfit') && !charIsIncluded('pose')) return;
  if (charIsIncluded('outfit') && charIsIncluded('pose')) {
    if (!charLocked.has('outfit') && charSlots.pose
        && textHasAnyMarker(charSlots.pose, POSE_NEEDS_SKIRT_MARKERS)
        && !outfitSupportsSkirtPose(charSlots.outfit)) {
      let bank = getCharBankFiltered('outfit');
      bank = bank.filter(e => outfitSupportsSkirtPose(e));
      if (bank.length) charSlots.outfit = finalizeSlotText('outfit', applyToneBoost('outfit', pick(bank)));
    }
    if (!charLocked.has('pose') && charSlots.outfit
        && textHasAnyMarker(charSlots.outfit, OUTFIT_EXPLICIT_MARKERS)
        && isSafeSelfieMode()) {
      charSlots.pose = rollPoseSection();
    }
    if (!charLocked.has('outfit') && isCuteSelfieOutfitMode() && charPosePresets.has('cute_outfit_normal')
        && (textHasAnyMarker(charSlots.outfit, OUTFIT_EXPLICIT_MARKERS)
          || textHasAnyMarker(charSlots.outfit, OUTFIT_PRESET_MARKERS.cute_outfit_underwear))) {
      let bank = filterOutfitBankByPosePreset(getCharBankFiltered('outfit'));
      if (bank.length) charSlots.outfit = finalizeSlotText('outfit', applyToneBoost('outfit', pick(bank)));
    }
    if (!charLocked.has('pose') && charSlots.outfit && !outfitSupportsSkirtPose(charSlots.outfit)
        && textHasAnyMarker(charSlots.pose, POSE_NEEDS_SKIRT_MARKERS)) {
      charSlots.pose = rollPoseSection();
    }
  }
}

function filterOutfitBankBySpicy(bank) {
  if (!bank.length || charSpicyOutfits.has('none')) return bank;
  const typeIds = Object.keys(SPICY_OUTFIT_MARKERS);
  if (charSpicyOutfits.has('all')) {
    const filtered = bank.filter(entry => {
      const s = scoreSpicyOutfitEntry(entry);
      return typeIds.some(id => s[id] > 0);
    });
    return filtered.length ? filtered : bank;
  }
  const active = [...charSpicyOutfits].filter(id => id !== 'all' && id !== 'none');
  if (!active.length) return bank;
  const filtered = bank.filter(entry => {
    const s = scoreSpicyOutfitEntry(entry);
    return active.some(id => s[id] > 0);
  });
  return filtered.length ? filtered : bank;
}

function scoreSpicyActionEntry(text, markerMap) {
  const t = text.toLowerCase();
  const scores = {};
  Object.entries(markerMap).forEach(([id, keys]) => {
    scores[id] = keys.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
  });
  return scores;
}

function filterBankBySpicyAction(bank, markerMap, activeSet) {
  if (!bank.length || activeSet.has('none')) return bank;
  const typeIds = Object.keys(markerMap);
  if (activeSet.has('all')) {
    const filtered = bank.filter(entry => {
      const s = scoreSpicyActionEntry(entry, markerMap);
      return typeIds.some(id => s[id] > 0);
    });
    return filtered.length ? filtered : bank;
  }
  const active = [...activeSet].filter(id => id !== 'all' && id !== 'none');
  if (!active.length) return bank;
  const filtered = bank.filter(entry => {
    const s = scoreSpicyActionEntry(entry, markerMap);
    return active.some(id => s[id] > 0);
  });
  return filtered.length ? filtered : bank;
}

function filterFaceBankBySpicyAction(bank) {
  return filterBankBySpicyAction(bank, SPICY_ACTION_FACE_MARKERS, charSpicyActions);
}

function filterPoseBankBySpicyAction(bank) {
  const poseIds = { ...SPICY_ACTION_POSE_MARKERS };
  return filterBankBySpicyAction(bank, poseIds, charSpicyActions);
}

function scoreBodyMarkers(text, markerMap, activeIds) {
  const t = text.toLowerCase();
  return activeIds.reduce((n, id) => {
    const keys = markerMap[id];
    if (!keys) return n;
    return n + keys.reduce((m, k) => m + (t.includes(k) ? 1 : 0), 0);
  }, 0);
}

function isBodyFilterActive() {
  return !charBodyFrame.has('none') || !charBodyBreast.has('none') || !charBodyFigure.has('none');
}

function getActiveBodyIds(set) {
  return [...set].filter(id => id !== 'none');
}

function scoreBodyEntry(entry) {
  return scoreBodyMarkers(entry, BODY_FRAME_MARKERS, getActiveBodyIds(charBodyFrame))
    + scoreBodyMarkers(entry, BODY_BREAST_MARKERS, getActiveBodyIds(charBodyBreast))
    + scoreBodyMarkers(entry, BODY_FIGURE_MARKERS, getActiveBodyIds(charBodyFigure));
}

function entryHasAntiBodyMarkers(entry, antiList) {
  if (!antiList?.length) return false;
  const t = entry.toLowerCase();
  return antiList.some(m => t.includes(m.toLowerCase()));
}

function getFrameAntiMarkers(frameActive, figureActive) {
  if (!frameActive.length || figureActive.some(id => ['wide_hips', 'thick_thighs', 'hourglass'].includes(id))) return [];
  const anti = new Set();
  frameActive.forEach(id => (BODY_FRAME_ANTI_MARKERS[id] || []).forEach(m => anti.add(m)));
  return [...anti];
}

function clearConflictingBodyFigures(frameIds) {
  const toClear = new Set();
  frameIds.forEach(id => (BODY_FRAME_CLEAR_FIGURE[id] || []).forEach(fig => toClear.add(fig)));
  if (!toClear.size) return false;
  toClear.forEach(id => charBodyFigure.delete(id));
  if (!getActiveBodyIds(charBodyFigure).length) charBodyFigure = new Set(['none']);
  return true;
}

function filterBankByBody(bank) {
  if (!bank.length || !isBodyFilterActive()) return bank;
  const frameActive = getActiveBodyIds(charBodyFrame);
  const breastActive = getActiveBodyIds(charBodyBreast);
  const figureActive = getActiveBodyIds(charBodyFigure);
  const antiMarkers = getFrameAntiMarkers(frameActive, figureActive);
  const filtered = bank.filter(entry => {
    if (antiMarkers.length && entryHasAntiBodyMarkers(entry, antiMarkers)) return false;
    const frameOk = !frameActive.length || scoreBodyMarkers(entry, BODY_FRAME_MARKERS, frameActive) > 0;
    const breastOk = !breastActive.length || scoreBodyMarkers(entry, BODY_BREAST_MARKERS, breastActive) > 0;
    const figureOk = !figureActive.length || scoreBodyMarkers(entry, BODY_FIGURE_MARKERS, figureActive) > 0;
    return frameOk && breastOk && figureOk;
  });
  return filtered.length ? filtered : bank;
}

function pickBodyScoredFromBank(bank) {
  if (!bank.length) return '';
  if (!isBodyFilterActive()) return pick(bank);
  const scored = bank.map(entry => ({ entry, score: scoreBodyEntry(entry) })).filter(x => x.score > 0);
  if (!scored.length) return pick(bank);
  const max = Math.max(...scored.map(x => x.score));
  const top = scored.filter(x => x.score === max).map(x => x.entry);
  return pick(top);
}

function checkBodySoftConflicts() {
  if (!isBodyFilterActive()) return;
  const frame = getActiveBodyIds(charBodyFrame);
  const breast = getActiveBodyIds(charBodyBreast);
  const figure = getActiveBodyIds(charBodyFigure);
  for (const c of BODY_SOFT_CONFLICTS) {
    const frameHit = c.frame?.some(id => frame.includes(id));
    const breastHit = c.breast?.some(id => breast.includes(id));
    const breast2Hit = c.breast2?.some(id => breast.includes(id));
    const figureHit = c.figure?.some(id => figure.includes(id));
    if ((frameHit && breastHit) || (breastHit && breast2Hit) || (figureHit && breastHit)) {
      toast(c.msg);
      return;
    }
  }
}

function scoreEnvPresetEntry(text) {
  const t = text.toLowerCase();
  const scores = {};
  Object.entries(ENV_PRESET_MARKERS).forEach(([id, keys]) => {
    scores[id] = keys.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
  });
  return scores;
}

function filterEnvBankByPreset(bank) {
  if (!bank.length || charEnvPresets.has('none')) return bank;
  const typeIds = Object.keys(ENV_PRESET_MARKERS);
  if (charEnvPresets.has('all')) {
    const filtered = bank.filter(entry => {
      const s = scoreEnvPresetEntry(entry);
      return typeIds.some(id => s[id] > 0);
    });
    return filtered.length ? filtered : bank;
  }
  const active = [...charEnvPresets].filter(id => id !== 'all' && id !== 'none');
  if (!active.length) return bank;
  const filtered = bank.filter(entry => {
    const s = scoreEnvPresetEntry(entry);
    return active.some(id => (s[id] || 0) > 0);
  });
  return filtered.length ? filtered : bank;
}

function getCharBankFiltered(key) {
  let bank = filterBankByTone(charBanks[key] || [], charTone);
  if (key === 'subject' || key === 'details' || key === 'outfit') bank = filterBankByBody(bank);
  if (key === 'outfit') {
    bank = filterOutfitExcludePoseConflict(filterOutfitBankBySpicy(filterOutfitBankByPosePreset(bank)));
  }
  if (key === 'face') bank = filterFaceBankBySpicyAction(bank);
  if (key === 'env') bank = filterEnvBankByPreset(bank);
  return bank;
}

function pickFromBankFiltered(key, hints) {
  const bank = getCharBankFiltered(key);
  if (!hints?.length) return pick(bank) || '';
  const lower = hints.map(h => h.toLowerCase());
  const scored = bank.map(entry => {
    const e = entry.toLowerCase();
    const score = lower.reduce((n, h) => n + (e.includes(h) ? 1 : 0), 0);
    return { entry, score };
  }).filter(x => x.score > 0);
  if (scored.length) {
    const max = Math.max(...scored.map(x => x.score));
    const top = scored.filter(x => x.score === max).map(x => x.entry);
    return pick(top);
  }
  return pick(bank) || hints.join(', ');
}

function pickPoseFromBank(bank) {
  if (!bank.length) return '';
  if (!charPosePresets.has('all') && charPosePresets.size) {
    const scored = bank.map(entry => {
      const s = scorePosePresetEntry(entry);
      const score = [...charPosePresets].reduce((n, id) => n + (s[id] || 0), 0);
      return { entry, score };
    }).filter(x => x.score > 0);
    if (scored.length) {
      const max = Math.max(...scored.map(x => x.score));
      const top = scored.filter(x => x.score === max).map(x => x.entry);
      return applyToneBoost('pose', pick(top));
    }
  }
  return applyToneBoost('pose', pick(bank));
}

function rollPoseSection() {
  let bank = filterBankByTone(charBanks.pose || [], charTone);
  bank = filterPoseBankByPreset(bank);
  bank = filterPoseBankBySpicyAction(bank);
  bank = filterPoseByOutfitContext(bank);
  if (hasActiveJob()) bank = filterPoseForActiveJob(bank);
  const picked = pickPoseFromBank(bank);
  if (picked) return picked;
  if (hasActiveJob() && hasSpecificJobTypes()) {
    const fb = getJobPoseFallbackBank();
    return fb.length ? applyToneBoost('pose', pick(fb)) : '';
  }
  return '';
}

function toggleCharPosePreset(id) {
  if (id === 'all') {
    charPosePresets = new Set(['all']);
  } else {
    charPosePresets.delete('all');
    charPosePresets.has(id) ? charPosePresets.delete(id) : charPosePresets.add(id);
    if (!charPosePresets.size) charPosePresets.add('all');
  }
  if (id !== 'all' && charPosePresets.has(id)) resolvePosePresetConflicts(id);
  if (SAFE_SELFIE_IDS.includes(id) && charPosePresets.has(id)) {
    if (getActiveJobTypes().some(j => JOB_POSE_SELFIE_BLOCK.includes(j))) {
      charPosePresets.delete(id);
      if (!charPosePresets.size) charPosePresets.add('all');
      toast('自拍姿勢與性交体位 NSFW 衝突');
    } else if (CUTE_SELFIE_OUTFIT_IDS.includes(id)) {
      applySafeSelfieDefaults();
    }
  }
  if (!charPosePresets.size) charPosePresets.add('all');
  checkPresetConflicts();
  renderCharPoseChips();
  const inc = document.getElementById('char-inc-pose');
  if (inc && id !== 'all') inc.checked = true;
  if (charIsIncluded('pose')) generateChar();
  else renderChar();
  saveActiveSession();
}

function buildGroupedChipsHtml(groups, allItems, activeSet, toggleFn, opts = {}) {
  const spicyCls = opts.spicy ? ' spicy' : '';
  const itemMap = Object.fromEntries(allItems.map(i => [i.id, i]));
  return groups.map(g => {
    const chips = g.ids.map(id => {
      const item = itemMap[id];
      if (!item) return '';
      return `<span class="chip compact${spicyCls}${activeSet.has(id) ? ' on' : ''}" onclick="${toggleFn}('${id}')">${item.label}</span>`;
    }).join('');
    const lbl = g.label ? `<div class="chip-group-lbl">${g.label}</div>` : '';
    return `<div class="chip-group">${lbl}<div class="chip-grid">${chips}</div></div>`;
  }).join('');
}

function renderGroupedChips(containerId, groups, allItems, activeSet, toggleFn, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const html = buildGroupedChipsHtml(groups, allItems, activeSet, toggleFn, opts);
  el.innerHTML = html;
  if (opts.mirrorId) {
    const mirror = document.getElementById(opts.mirrorId);
    if (mirror) mirror.innerHTML = html;
  }
}

const EMBED_CHAR_TABS = ['frame', 'breast', 'leg', 'outfit', 'pose', 'nsfw'];

function setEmbedCharTab(tab) {
  if (!EMBED_CHAR_TABS.includes(tab)) return;
  document.querySelectorAll('.embed-char-tab').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.ect === tab);
  });
  document.querySelectorAll('.embed-char-tab-pane').forEach(pane => {
    pane.classList.toggle('on', pane.dataset.ectPane === tab);
  });
  try { localStorage.setItem('void-rng-embed-tab', tab); } catch (_) {}
}
window.setEmbedCharTab = setEmbedCharTab;

function bindEmbedCharTabs() {
  document.querySelectorAll('.embed-char-tab-bar').forEach(bar => {
    if (bar.dataset.bound) return;
    bar.dataset.bound = '1';
    bar.addEventListener('click', e => {
      const btn = e.target.closest('.embed-char-tab[data-ect]');
      if (!btn) return;
      e.preventDefault();
      setEmbedCharTab(btn.dataset.ect);
    });
  });
}

function toggleSpicyChipSet(activeSet, id, fallback) {
  if (id === 'none') return new Set(['none']);
  if (id === 'all') return new Set(['all']);
  const next = new Set(activeSet);
  next.delete('all');
  next.delete('none');
  next.has(id) ? next.delete(id) : next.add(id);
  if (!next.size) next.add(fallback === 'none' ? 'all' : fallback);
  return next;
}

function toggleCharSpicyOutfit(id) {
  if (id === 'none') {
    charSpicyOutfits = new Set(['none']);
  } else {
    charSpicyOutfits = toggleSpicyChipSet(charSpicyOutfits, id, 'all');
    if (charSpicyOutfits.has(id)) resolveSpicyOutfitConflicts(id);
  }
  checkPresetConflicts();
  renderCharSpicyOutfitChips();
  if (charIsIncluded('outfit')) generateChar();
  else renderChar();
  saveActiveSession();
}

function toggleCharSpicyAction(id) {
  if (id === 'none') {
    charSpicyActions = new Set(['none']);
  } else {
    charSpicyActions = toggleSpicyChipSet(charSpicyActions, id, 'all');
    if (charSpicyActions.has(id)) resolveSpicyActionConflicts(id);
  }
  checkPresetConflicts(true);
  renderCharSpicyActionChips();
  if (charIsIncluded('pose') || charIsIncluded('face')) generateChar();
  else renderChar();
  saveActiveSession();
}

function renderCharSpicyOutfitChips() {
  renderGroupedChips('char-spicy-outfit-chips', SPICY_OUTFIT_GROUPS, SPICY_OUTFIT_TYPES, charSpicyOutfits, 'toggleCharSpicyOutfit', { mirrorId: 'char-spicy-outfit-chips-embed' });
}

function renderCharSpicyActionChips() {
  renderGroupedChips('char-spicy-action-chips', SPICY_ACTION_GROUPS, SPICY_ACTION_TYPES, charSpicyActions, 'toggleCharSpicyAction', { spicy: true, mirrorId: 'char-spicy-action-chips-embed' });
}

function toggleBodyChipSet(activeSet, id, opts = {}) {
  if (id === 'none') return new Set(['none']);
  const next = new Set(activeSet);
  next.delete('none');
  if (next.has(id)) {
    next.delete(id);
  } else {
    (opts.conflicts?.[id] || []).forEach(x => next.delete(x));
    (opts.mutexIds || []).forEach(x => next.delete(x));
    next.add(id);
  }
  if (!next.size) next.add('none');
  return next;
}

function toggleCharBodyFrame(id) {
  charBodyFrame = toggleBodyChipSet(charBodyFrame, id, { conflicts: BODY_FRAME_CONFLICTS });
  if (id !== 'none' && charBodyFrame.has(id)) clearConflictingBodyFigures([id]);
  renderCharBodyChips();
  checkBodySoftConflicts();
  refreshBodyFilteredChar();
}

function toggleCharBodyBreast(id) {
  charBodyBreast = toggleBodyChipSet(charBodyBreast, id, { mutexIds: BODY_BREAST_MUTEX });
  renderCharBodyChips();
  checkBodySoftConflicts();
  refreshBodyFilteredChar();
}

function toggleCharBodyFigure(id) {
  charBodyFigure = toggleBodyChipSet(charBodyFigure, id);
  renderCharBodyChips();
  checkBodySoftConflicts();
  refreshBodyFilteredChar();
}

function refreshBodyFilteredChar() {
  if (charIsIncluded('subject') || charIsIncluded('details') || charIsIncluded('outfit')) generateChar();
  else renderChar();
  saveActiveSession();
}

function setBodyComboState(comboId) {
  const combo = BODY_COMBOS[comboId];
  if (!combo) return false;
  charBodyFrame = new Set(combo.frame);
  charBodyBreast = new Set(combo.breast);
  charBodyFigure = new Set(combo.figure);
  renderCharBodyChips();
  return true;
}

function resetBodyFilters(opts = {}) {
  charBodyFrame = new Set(['none']);
  charBodyBreast = new Set(['none']);
  charBodyFigure = new Set(['none']);
  renderCharBodyChips();
  if (!opts.stateOnly) refreshBodyFilteredChar();
  if (!opts.silent) toast('已清除身材篩選');
}

function applyBodyCombo(comboId, opts = {}) {
  if (!setBodyComboState(comboId)) return;
  if (!opts.stateOnly) refreshBodyFilteredChar();
  if (!opts.silent) toast('已套用身材搭配：' + BODY_COMBOS[comboId].label);
}

function renderCharBodyComboChips() {
  const el = document.getElementById('char-body-combo-chips');
  const html = (() => {
    const combos = Object.entries(BODY_COMBOS).map(([id, combo]) => {
      const on = combo.frame.every(x => charBodyFrame.has(x))
        && combo.breast.every(x => charBodyBreast.has(x))
        && combo.figure.every(x => charBodyFigure.has(x));
      return `<span class="chip compact body${on ? ' on' : ''}" onclick="applyBodyCombo('${id}')">${combo.label}</span>`;
    }).join('');
    const clearOn = !isBodyFilterActive();
    return combos + `<span class="chip compact body${clearOn ? ' on' : ''}" onclick="resetBodyFilters()">清除篩選</span>`;
  })();
  if (el) el.innerHTML = html;
  const emb = document.getElementById('char-body-combo-chips-embed');
  if (emb) emb.innerHTML = html;
}

function renderCharBodyChips() {
  renderCharBodyComboChips();
  renderGroupedChips('char-body-frame-chips', BODY_FRAME_GROUPS, BODY_FRAME_TYPES, charBodyFrame, 'toggleCharBodyFrame', { mirrorId: 'char-body-frame-chips-embed' });
  renderGroupedChips('char-body-breast-chips', BODY_BREAST_GROUPS, BODY_BREAST_TYPES, charBodyBreast, 'toggleCharBodyBreast', { mirrorId: 'char-body-breast-chips-embed' });
  renderGroupedChips('char-body-figure-chips', BODY_FIGURE_GROUPS, BODY_FIGURE_TYPES, charBodyFigure, 'toggleCharBodyFigure');
  renderGroupedChips('char-body-shape-chips', BODY_FIGURE_SHAPE_GROUPS, BODY_FIGURE_TYPES, charBodyFigure, 'toggleCharBodyFigure', { mirrorId: 'char-body-shape-chips-embed' });
  renderGroupedChips('char-body-leg-chips', BODY_FIGURE_LEG_GROUPS, BODY_FIGURE_TYPES, charBodyFigure, 'toggleCharBodyFigure', { mirrorId: 'char-body-leg-chips-embed' });
}

function renderCharPoseChips() {
  renderGroupedChips('char-pose-chips', POSE_PRESET_GROUPS, POSE_PRESETS, charPosePresets, 'toggleCharPosePreset', { mirrorId: 'char-pose-chips-embed' });
}

function renderCharActionChips() {
  renderCharPoseChips();
  renderCharSpicyActionChips();
}

function toggleCharEnvPreset(id) {
  charEnvPresets = toggleSpicyChipSet(charEnvPresets, id, 'none');
  renderCharEnvChips();
  if (charIsIncluded('env')) generateChar();
  else renderChar();
  saveActiveSession();
}

function renderCharEnvChips() {
  renderGroupedChips('char-env-chips', ENV_PRESET_GROUPS, ENV_PRESET_TYPES, charEnvPresets, 'toggleCharEnvPreset', { mirrorId: 'char-env-chips-embed' });
}

function toggleCharJobType(id) {
  if (id === 'none') {
    charJobTypes = new Set(['none']);
    renderCharJobChips();
    const inc = document.getElementById('char-inc-job');
    if (inc) inc.checked = false;
    charSlots.job = '';
    renderChar();
    saveActiveSession();
    return;
  }
  if (id === 'all') {
    charJobTypes = new Set(['all']);
  } else {
    charJobTypes.delete('all');
    charJobTypes.delete('none');
    const adding = !charJobTypes.has(id);
    charJobTypes.has(id) ? charJobTypes.delete(id) : charJobTypes.add(id);
    if (!charJobTypes.size) charJobTypes.add('all');
    if (adding && charJobTypes.has(id)) {
      resolveJobTypeConflicts(id);
      if (JOB_POSE_SELFIE_BLOCK.includes(id)) syncJobPoseMutex({ source: 'job', silent: true });
    }
  }
  checkPresetConflicts(true);
  renderCharJobChips();
  const inc = document.getElementById('char-inc-job');
  if (inc) inc.checked = true;
  if (charIsIncluded('pose') && hasActiveJob() && !charLocked.has('pose')) {
    charSlots.pose = rollPoseSection();
  }
  if (charIsIncluded('job') && !charLocked.has('job')) {
    charSlots.job = rollJobSection();
  }
  if (charIsIncluded('job') || charIsIncluded('pose')) generateChar();
  else renderChar();
  saveActiveSession();
}

function renderCharJobChips() {
  renderGroupedChips('char-job-chips', JOB_PRESET_GROUPS, JOB_TYPES, charJobTypes, 'toggleCharJobType', { mirrorId: 'char-job-chips-embed' });
}

function applyQuickPreset(preset, opts = {}) {
  const poseInc = document.getElementById('char-inc-pose');
  const jobInc = document.getElementById('char-inc-job');
  const intEl = document.getElementById('char-tone-intensity');
  if (preset === 'pure_selfie') {
    setCharTone('cute');
    if (intEl) { intEl.value = 3; syncCharIntensity(); }
    charJobTypes = new Set(['none']);
    charPosePresets = new Set(['cute_outfit_normal']);
    charSpicyOutfits = new Set(['none']);
    charSpicyActions = new Set(['none']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = false;
    if (poseInc) poseInc.checked = true;
    charSlots.job = '';
  } else if (preset === 'spicy_selfie') {
    setCharTone('tempt');
    if (intEl) { intEl.value = 3; syncCharIntensity(); }
    charJobTypes = new Set(['none']);
    charPosePresets = new Set(['tempt_high_collar', 'tempt_sit_legs']);
    charSpicyOutfits = new Set(['all']);
    charSpicyActions = new Set(['all']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = false;
    if (poseInc) poseInc.checked = true;
    charSlots.job = '';
  } else if (preset === 'super_spicy') {
    setCharTone('tempt');
    if (intEl) { intEl.value = 5; syncCharIntensity(); }
    charJobTypes = new Set(['none']);
    charPosePresets = new Set(['tempt_high_collar', 'tempt_low_upskirt', 'tempt_sit_legs', 'tempt_jump_skirt']);
    charSpicyOutfits = new Set(['all']);
    charSpicyActions = new Set(['all']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = false;
    if (poseInc) poseInc.checked = true;
    charSlots.job = '';
  } else if (preset === 'full_nsfw') {
    setCharTone('sex');
    if (intEl) { intEl.value = 4; syncCharIntensity(); }
    charJobTypes = new Set(['all']);
    charPosePresets = new Set(['all']);
    charSpicyOutfits = new Set(['all']);
    charSpicyActions = new Set(['all']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = true;
    if (poseInc) poseInc.checked = true;
  } else if (preset === 'sex_lover') {
    setCharTone('sex');
    if (intEl) { intEl.value = 5; syncCharIntensity(); }
    charJobTypes = new Set(['all']);
    charPosePresets = new Set(['all']);
    charSpicyOutfits = new Set(['all']);
    charSpicyActions = new Set(['all']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = true;
    if (poseInc) poseInc.checked = true;
  } else if (preset === 'pix_cute') {
    setCharTone('cute');
    if (intEl) { intEl.value = 3; syncCharIntensity(); }
    charJobTypes = new Set(['none']);
    charPosePresets = new Set(['cute_outfit_normal', 'portrait_clean', 'sitting_casual']);
    charSpicyOutfits = new Set(['none']);
    charSpicyActions = new Set(['none']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = false;
    if (poseInc) poseInc.checked = true;
    charSlots.job = '';
    generateChar();
    applyPixFormulaTemplate('cute');
    renderChar();
    saveActiveSession();
    if (!opts.silent) toast('已套用：PIX·清純完整式');
    return;
  } else if (preset === 'pix_tempt') {
    setCharTone('tempt');
    if (intEl) { intEl.value = 4; syncCharIntensity(); }
    charJobTypes = new Set(['none']);
    charPosePresets = new Set(['tempt_high_collar', 'tempt_sit_legs']);
    charSpicyOutfits = new Set(['lingerie', 'garter', 'sheer']);
    charSpicyActions = new Set(['bedroom_eyes', 'bite_lip', 'cleavage']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = false;
    if (poseInc) poseInc.checked = true;
    charSlots.job = '';
    generateChar();
    applyPixFormulaTemplate('tempt');
    renderChar();
    saveActiveSession();
    if (!opts.silent) toast('已套用：PIX·誘惑完整式');
    return;
  } else if (preset === 'pix_cinematic') {
    setCharTone('spicy');
    if (intEl) { intEl.value = 4; syncCharIntensity(); }
    charJobTypes = new Set(['none']);
    charPosePresets = new Set(['all']);
    charSpicyOutfits = new Set(['none']);
    charSpicyActions = new Set(['none']);
    charMode = 'mix';
    setCharMode('mix');
    if (jobInc) jobInc.checked = false;
    if (poseInc) poseInc.checked = true;
    charSlots.job = '';
    generateChar();
    applyPixFormulaTemplate('cinematic');
    renderChar();
    saveActiveSession();
    if (!opts.silent) toast('已套用：PIX·電影光完整式');
    return;
  }
  if (PRESET_BODY_MAP[preset]) setBodyComboState(PRESET_BODY_MAP[preset]);
  else resetBodyFilters({ stateOnly: true, silent: true });
  renderCharJobChips();
  renderCharActionChips();
  renderCharSpicyOutfitChips();
  renderCharBodyChips();
  renderCharEnvChips();
  generateChar();
  saveActiveSession();
  if (!opts.silent) {
    const labels = {
      pure_selfie:'清純自拍', spicy_selfie:'色氣撩人', super_spicy:'超級色氣',
      full_nsfw:'成人全開', sex_lover:'超愛做愛的寶貝',
    };
    const bodyLabel = PRESET_BODY_MAP[preset] ? ' · ' + BODY_COMBOS[PRESET_BODY_MAP[preset]].label : '';
    toast('已套用：' + (labels[preset] || preset) + bodyLabel);
  }
}

function rollCharSection(key) {
  if (key === 'job') return rollJobSection();
  if (key === 'pose') return rollPoseSection();
  let bank = getCharBankFiltered(key);
  if (key === 'quality') bank = bank.map(sanitizeQualityText).filter(Boolean);
  if (!bank.length) return '';
  const bodyScored = isBodyFilterActive() && ['subject', 'details', 'outfit'].includes(key);
  if (bodyScored) {
    const picked = pickBodyScoredFromBank(bank);
    return picked ? finalizeSlotText(key, applyToneBoost(key, picked)) : '';
  }
  if (Math.random() < 0.4) {
    const tags = rollCharTags(key);
    if (tags) return finalizeSlotText(key, tags);
  }
  return finalizeSlotText(key, applyToneBoost(key, pick(bank)));
}

function generateChar() {
  if (charMode === 'template') {
    const tpl = pick(charTemplates);
    if (!tpl) return toast('無可用範本');
    CHAR_SECTIONS.forEach(s => {
      if (!charIsIncluded(s.key)) { charSlots[s.key] = ''; return; }
      if (s.key === 'job' && isJobDisabled()) { charSlots[s.key] = ''; return; }
      if (!charLocked.has(s.key)) charSlots[s.key] = tpl[s.key] || '';
    });
  } else if (charMode === 'learn') {
    generateCharLearn();
  } else {
    if (hasActiveJob() && charIsIncluded('job') && !charLocked.has('job')) {
      charSlots.job = rollJobSection();
    }
    CHAR_SECTIONS.forEach(s => {
      if (!charIsIncluded(s.key)) { charSlots[s.key] = ''; return; }
      if (s.key === 'job') {
        if (isJobDisabled()) charSlots[s.key] = '';
        else if (!charLocked.has('job') && !charSlots.job) charSlots.job = rollJobSection();
        return;
      }
      if (s.key === 'pose' && hasActiveJob()) return;
      if (!charLocked.has(s.key)) charSlots[s.key] = rollCharSection(s.key);
    });
    if (hasActiveJob() && charIsIncluded('pose') && !charLocked.has('pose')) {
      charSlots.pose = rollPoseSection();
    }
  }
  syncPoseJobCoherence();
  syncOutfitPoseCoherence();
  renderChar();
}

function rerollCharRow(key) {
  if (!charIsIncluded(key)) return;
  if (charMode === 'template') {
    const tpl = pick(charTemplates);
    const fallback = key === 'job' ? rollJobSection() : rollCharSection(key);
    charSlots[key] = tpl ? (tpl[key] || fallback) : fallback;
  } else if (charMode === 'learn') {
    charSlots[key] = key === 'job' ? rollJobSection() : key === 'pose' ? rollPoseSection() : (rollCharTags(key) || rollCharSection(key));
  } else {
    charSlots[key] = rollCharSection(key);
  }
  if (hasActiveJob() && (key === 'job' || key === 'pose')) coerceSlotsForActiveJob();
  if (key === 'outfit' || key === 'pose') syncOutfitPoseCoherence();
  renderChar();
}

function toggleCharLock(key) {
  charLocked.has(key) ? charLocked.delete(key) : charLocked.add(key);
  renderCharTable();
}

function sanitizePoseJobSlots() {
  if (isJobDisabled()) return;
  syncPoseJobCoherence();
}

function buildCharPrompt() {
  sanitizePoseJobSlots();
  const parts = [];
  CHAR_SECTIONS.forEach(s => {
    const val = getSlotOutputValue(s.key);
    if (!charIsIncluded(s.key) || !val) return;
    const label = shouldMergeJobPose() && s.key === 'pose'
      ? 'Pose / Composition & Act'
      : s.label;
    if (charFmt === 'structured') {
      parts.push(`// ❖ ${label}\n${val}`);
    } else {
      parts.push(val);
    }
  });
  return charFmt === 'structured' ? parts.join('\n\n') : parts.join(', ');
}

function buildCharTagsOnly() {
  return CHAR_SECTIONS
    .filter(s => charIsIncluded(s.key) && getSlotOutputValue(s.key))
    .map(s => getSlotOutputValue(s.key))
    .join(', ');
}

function renderChar() {
  sanitizeNegativeFromSlots();
  const text = buildCharPrompt();
  setOutputText('char-output', text, '請至少勾選一個區塊…');
  const toneLabel = TONE_LABELS[charTone] || charTone;
  const lvlLabel = (INTENSITY_LABELS[charTone] || INTENSITY_LABELS.balance)[charToneIntensity] || '';
  const modeLabel = { mix:'混合', learn:'學習迭代', template:'範本' }[charMode] || charMode;
  const learnedN = getUserLearnedTemplates().length;
  const tagTotal = CHAR_SECTIONS.reduce((n, s) => n + getSectionTagPool(s.key).length, 0);
  const jobLabel = isJobDisabled()
    ? 'JOB無'
    : charIsIncluded('job')
      ? ([...charJobTypes].filter(c => c !== 'all').map(c => JOB_TYPES.find(j => j.id === c)?.label).filter(Boolean).join('+') || 'JOB全')
      : 'JOB關';
  const poseLabel = charIsIncluded('pose')
    ? ([...charPosePresets].filter(c => c !== 'all').map(c => POSE_PRESETS.find(p => p.id === c)?.label).filter(Boolean).join('+') || '姿勢全') + (isSafeSelfieMode() ? '·無性交' : '')
    : '';
  const outfitLabel = !charSpicyOutfits.has('none')
    ? ([...charSpicyOutfits].filter(c => c !== 'all').map(c => SPICY_OUTFIT_TYPES.find(x => x.id === c)?.label).filter(Boolean).join('+') || '穿著全')
    : '';
  const actionLabel = !charSpicyActions.has('none')
    ? ([...charSpicyActions].filter(c => c !== 'all').map(c => SPICY_ACTION_TYPES.find(x => x.id === c)?.label).filter(Boolean).join('+') || '動作全')
    : '';
  const bodyFrameLabel = [...charBodyFrame].filter(c => c !== 'none').map(c => BODY_FRAME_TYPES.find(x => x.id === c)?.label).filter(Boolean).join('+');
  const bodyBreastLabel = [...charBodyBreast].filter(c => c !== 'none').map(c => BODY_BREAST_TYPES.find(x => x.id === c)?.label).filter(Boolean).join('+');
  const bodyFigureLabel = [...charBodyFigure].filter(c => c !== 'none').map(c => BODY_FIGURE_TYPES.find(x => x.id === c)?.label).filter(Boolean).join('+');
  const envLabel = !charEnvPresets.has('none')
    ? ([...charEnvPresets].filter(c => c !== 'all').map(c => ENV_PRESET_TYPES.find(x => x.id === c)?.label).filter(Boolean).join('+') || '背景全')
    : '';
  document.getElementById('char-meta').textContent =
    `${buildCharTagsOnly().length} 字 · ${modeLabel} · 範本${learnedN}`;
  const bar = document.getElementById('char-status-bar');
  if (bar) {
    const pills = [
      `<span class="status-pill on">${toneLabel}${lvlLabel ? ' ' + lvlLabel : ''}</span>`,
      bodyFrameLabel ? `<span class="status-pill on" style="border-color:rgba(180,210,255,.35);color:#b8d4f0">體型 ${bodyFrameLabel}</span>` : '',
      bodyBreastLabel ? `<span class="status-pill on" style="border-color:rgba(180,210,255,.35);color:#b8d4f0">胸型 ${bodyBreastLabel}</span>` : '',
      bodyFigureLabel ? `<span class="status-pill on" style="border-color:rgba(180,210,255,.35);color:#b8d4f0">身材 ${bodyFigureLabel}</span>` : '',
      outfitLabel ? `<span class="status-pill on">服裝 ${outfitLabel}</span>` : '',
      poseLabel ? `<span class="status-pill${isSafeSelfieMode() ? ' safe' : ''}">拍照 ${poseLabel}</span>` : '',
      actionLabel ? `<span class="status-pill on" style="border-color:rgba(255,192,203,.4);color:#f0b8c8">${actionLabel}</span>` : '',
      `<span class="status-pill${isJobDisabled() ? ' safe' : ''}">NSFW ${jobLabel}</span>`,
      envLabel ? `<span class="status-pill on">背景 ${envLabel}</span>` : '',
      `<span class="status-pill">詞庫 ${tagTotal}</span>`,
      ...collectPresetConflictWarnings().slice(0, 3).map(w => `<span class="status-pill warn" title="${escHtml(w)}">⚠ ${escHtml(w)}</span>`),
    ].filter(Boolean).join('');
    bar.innerHTML = pills;
  }
  updateEmbedCharConflictHint();
  renderCharTable();
  renderBankStats();
}

function renderCharTable() {
  const active = document.activeElement;
  const activeKey = active?.dataset?.slotKey;
  document.getElementById('char-table-body').innerHTML = CHAR_SECTIONS.filter(s => charIsIncluded(s.key)).map(s => {
    const val = (activeKey === s.key && active?.classList?.contains('cell-edit')) ? active.value : (charSlots[s.key] || '');
    const lc = charLocked.has(s.key) ? ' class="locked"' : '';
    const sub = shouldMergeJobPose() && s.key === 'job'
      ? `${s.zh} · 輸出併入姿勢`
      : shouldMergeJobPose() && s.key === 'pose'
        ? `${s.zh} · 含動作`
        : s.zh;
    return `<tr${lc} ondblclick="toggleCharLock('${s.key}')">
      <td><span class="char-sec-name">${s.label}</span><span class="char-sec-sub">${sub}</span></td>
      <td class="char-cell-val"><textarea class="cell-edit" data-slot-key="${s.key}" rows="2" oninput="onCharCellEdit('${s.key}', this)" onblur="commitCharCellEdit()" ondblclick="event.stopPropagation()">${escTextarea(val)}</textarea></td>
      <td><div class="char-actions"><span class="char-act" onclick="event.stopPropagation();rerollCharRow('${s.key}')">↻</span><span class="char-act" onclick="event.stopPropagation();toggleCharLock('${s.key}')">${charLocked.has(s.key)?'🔒':'🔓'}</span></div></td>
    </tr>`;
  }).join('');
}

function onCharCellEdit(key, el) {
  charSlots[key] = el.value;
  setOutputText('char-output', buildCharPrompt(), '請至少勾選一個區塊…');
  const toneLabel = TONE_LABELS[charTone] || charTone;
  const modeLabel = { mix:'混合', learn:'學習迭代', template:'範本' }[charMode] || charMode;
  const learnedN = getUserLearnedTemplates().length;
  document.getElementById('char-meta').textContent = `${buildCharTagsOnly().length} 字 · ${modeLabel} · 範本${learnedN}`;
}

function commitCharCellEdit() {
  if (hasActiveJob()) syncPoseJobCoherence();
  syncOutfitPoseCoherence();
  saveActiveSession();
  renderChar();
}

function commitCharOutputEdit() {
  const text = document.getElementById('char-output')?.value?.trim();
  if (!text) return;
  if (charFmt === 'structured' || text.includes('// ❖')) {
    const parsed = parseStructuredSections(text, CHAR_SECTIONS);
    CHAR_SECTIONS.forEach(s => {
      if (!charIsIncluded(s.key)) return;
      if (parsed[s.key] === undefined) return;
      if (s.key === 'pose' && shouldMergeJobPose()) {
        const split = splitMergedPoseJob(parsed.pose);
        charSlots.pose = split.pose;
        if (charIsIncluded('job')) charSlots.job = split.job || charSlots.job;
        return;
      }
      charSlots[s.key] = parsed[s.key];
    });
  } else {
    assignListToSlots(text, CHAR_SECTIONS, charSlots, charIsIncluded);
  }
  if (hasActiveJob()) syncPoseJobCoherence();
  renderCharTable();
  saveActiveSession();
}

function getCharPromptText() {
  const out = document.getElementById('char-output');
  return (out?.value?.trim()) || buildCharPrompt();
}

function copyCharOutputStandalone() {
  copyCharOutput();
}

function renderBankStats() {
  const ver = window.VoidRngData?.ready && window.VoidRngData?.version != null
    ? `v${window.VoidRngData.version}`
    : '內建';
  const head = `<div class="bank-stat bank-stat-ver"><div class="bank-stat-num">✓</div><div class="bank-stat-lbl">辭庫 ${ver}</div></div>`;
  document.getElementById('bank-stats').innerHTML = head + CHAR_SECTIONS.map(s =>
    `<div class="bank-stat"><div class="bank-stat-num">${(charBanks[s.key]||[]).length}</div><div class="bank-stat-lbl">${s.zh}</div></div>`
  ).join('');
}

function renderCharIncChecks() {
  document.getElementById('char-inc-checks').innerHTML = CHAR_SECTIONS.map(s => {
    const defOn = s.key !== 'job';
    return `<label class="chk-row"><input type="checkbox" id="char-inc-${s.key}"${defOn ? ' checked' : ''} onchange="renderChar()"> ${s.zh}</label>`;
  }).join('');
}

function copyCharOutput() {
  const t = getCharPromptText();
  if (!t) return toast('尚無內容');
  navigator.clipboard.writeText(t).then(() => toast('已複製'));
}
function copyCharTagsOnly() {
  const t = buildCharTagsOnly();
  if (!t) return toast('尚無內容');
  navigator.clipboard.writeText(t).then(() => toast('已複製標籤'));
}
function addCharHistory() {
  const t = getCharPromptText();
  if (!t) return;
  charHistory.unshift({ text:t, ts:Date.now() });
  charHistory = charHistory.slice(0,30);
  saveActiveSession();
  renderCharHistory();
  toast('已加入歷史');
}
function renderCharHistory() {
  const list = document.getElementById('char-hist-list');
  if (!charHistory.length) { list.innerHTML = '<div class="meta">尚無紀錄</div>'; return; }
  list.innerHTML = charHistory.map((h,i) =>
    `<div class="hist-item" onclick="loadCharHistory(${i})">${escHtml(h.text.slice(0,60).replace(/\n/g,' '))}…</div>`
  ).join('');
}
function loadCharHistory(i) {
  const out = document.getElementById('char-output');
  if (!out || !charHistory[i]) return;
  out.value = charHistory[i].text;
  out.classList.remove('empty');
  commitCharOutputEdit();
  toast('已載入');
}

function exportCharBanks() {
  const blob = new Blob([JSON.stringify({ banks: charBanks, templates: charTemplates }, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'void-char-banks.json'; a.click();
}
function importCharBanks() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
  inp.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (data.banks) CHAR_SECTIONS.forEach(s => {
          if (data.banks[s.key]) charBanks[s.key] = [...new Set([...(charBanks[s.key]||[]), ...data.banks[s.key]])];
        });
        if (data.templates) charTemplates = [...charTemplates, ...data.templates];
        saveCharBanks(); renderChar(); toast('辭庫已匯入');
      } catch { toast('匯入失敗'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ── 學習對話窗 + 自動分類 ─────────────────────────────────────────
function _mkDebounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const SECTION_MATCHERS = [
  { key:'quality',  patterns:[/quality\s*\/\s*technical/i, /quality/i, /technical\s*tags?/i, /品質/, /技術標籤/] },
  { key:'subject',  patterns:[/subject\s*&\s*character/i, /主體與角色/, /主題與角色/, /角色主體/] },
  { key:'face',     patterns:[/facial\s*features?/i, /臉部特徵/, /面部特徵/] },
  { key:'details',  patterns:[/character\s*details?/i, /角色細節/, /人物細節/] },
  { key:'outfit',   patterns:[/outfit/i, /服裝/, /穿搭/, /衣著/] },
  { key:'pose',     patterns:[/pose\s*\/\s*composition/i, /pose/i, /composition/i, /姿勢/, /構圖/] },
  { key:'job',      patterns:[/\bjob\b/i, /\bact\b/i, /行為/, /玩法/] },
  { key:'env',      patterns:[/environment\s*&\s*lighting/i, /environment/i, /lighting/i, /環境與光線/, /環境/, /光線/] },
  { key:'styleRef', patterns:[/style\s*references?/i, /風格參考/, /畫風/] },
];

const CLASSIFY_RULES = {
  subject:  { w:1.0, kw:['1girl','1boy','2girls','solo','girl','boy','woman','man','catgirl','cat girl','angel','demon','elf','character','figure','petite','petite body','slim','slim figure','small breasts','small breast','flat chest','delicate proportions','curvy','mature','young','east asian','asian','fair skin','smooth skin','no bra','cosplay','idol','maid','bunny'] },
  face:     { w:1.0, kw:['eyes','eye','smile','expression','face','blush','cheek','lips','gaze','looking at viewer','looking at','wink','tongue','heterochromia','teary','pout','iris','eyelash','bedroom eyes','sultry gaze'] },
  details:  { w:1.0, kw:['hair','bangs','braid','ponytail','twin','tail','ears','cat ears','horn','wings','halo','ribbon','hair clip','ahoge','hime cut','bob','silver hair','white hair','black hair','blonde','messy hair','wet hair','fur','petite frame','slim waist','small breasts','delicate collarbone'] },
  outfit:   { w:1.1, kw:['dress','skirt','hoodie','shirt','blouse','bikini','swimsuit','stockings','thigh-high','panties','bra','lingerie','lace lingerie','蕾絲內衣','lace bra','lace panties','uniform','leotard','apron','jacket','crop top','sweater','fabric','sleeves','neckline','sheer','transparent','see-through','lace','garter','maid outfit','cosplay','micro','ruffled','bow','choker','wet fabric','no bra','sideboob','cleavage','bodycon','latex','fishnet','bodystocking','keyhole','wet shirt','halter','backless','tube top','hot pants','qipao','cheongsam','side slit','garter belt','bustier','camisole','towel','raincoat','wet white'] },
  pose:     { w:1.0, kw:['pose','standing','sitting','lying','kneeling','squatting','selfie','angle','shot','from above','from below','high angle','low angle','dutch angle','extreme angle','close-up','full body','upper body','bust','arm','leg','legs','thigh','thighs','crossed legs','crossed','tilted','arched','heart shape','lifting','pulling','straddling','on all fours','looking back','composition','dynamic','peace sign','head tilt','covering breasts','arm across','skirt lift','pulling skirt','lifting skirt','collarbone','neckline','unbuttoned','off-shoulder','from behind','hip sway','foreshortening','worm eye','mirror selfie','smartphone','pov','kawaii','blush','biting lip','wall lean','hands behind head','shirt lift','collar tug','wet hair','towel','silhouette','boudoir','adjusting stocking','hip cocked','twirling','bent over','straddling pillow'] },
  job:      { w:1.3, kw:['handjob','fellatio','blowjob','oral sex','deepthroat','cunnilingus','paizuri','titjob','fingering','footjob','soles','breast squeeze','licking penis','licking pussy','stroking','penis in mouth','penis between breasts','hand on penis','pussyjob','labia','vulva','outercourse','grinding on penis','through panties','panties on','no penetration','saliva trail','drool'] },
  env:      { w:1.0, kw:['indoor','outdoor','room','bedroom','bathroom','beach','forest','city','street','window','background','lighting','daylight','night','neon','bokeh','studio','atmosphere','sunset','golden hour','soft light','rim light','ambient','setting','sky','ocean'] },
  styleRef: { w:1.0, kw:['anime','illustration','photorealistic','realistic','painting','watercolor','digital art','cel-shaded','style','aesthetic','moe','pixiv','eroge','concept art','cinematic','oil painting','fan-service','fan service','glossy','brush'] },
  quality:  { w:1.2, kw:['masterpiece','best quality','ultra detailed','ultra-detailed','high resolution','highres','absurdres','8k','4k','sharp focus','detailed','perfect anatomy','perfect hands','perfect face','no text','no watermark','raw photo','intricate','high quality','quality'] },
};

let learnAutoMode = true;
let learnClassified = null;

function detectSectionHeader(header) {
  const h = header.replace(/^\/\/\s*❖?\s*/i, '').trim();
  for (const m of SECTION_MATCHERS) {
    if (m.patterns.some(p => p.test(h))) return m.key;
  }
  return null;
}

function splitPromptTags(text) {
  return text
    .replace(/\n+/g, ',')
    .split(',')
    .map(t => t.trim())
    .filter(t => t && !t.startsWith('//') && t !== '❖');
}

function scoreTagForSection(tag, key) {
  const rule = CLASSIFY_RULES[key];
  if (!rule) return 0;
  const t = tag.toLowerCase();
  let score = 0;
  rule.kw.forEach(kw => {
    if (t.includes(kw)) score += rule.w * (kw.length > 6 ? 1.4 : 1);
  });
  return score;
}

function classifyTag(tag) {
  let best = 'subject', bestScore = 0;
  for (const key of Object.keys(CLASSIFY_RULES)) {
    const s = scoreTagForSection(tag, key);
    if (s > bestScore) { bestScore = s; best = key; }
  }
  return bestScore > 0 ? best : 'subject';
}

function parseStructuredPrompt(text) {
  const result = {};
  let current = null;
  const lines = text.split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//')) {
      const sec = detectSectionHeader(line);
      if (sec) { current = sec; if (!result[current]) result[current] = ''; }
      continue;
    }
    if (current) {
      result[current] = result[current] ? result[current] + ', ' + line : line;
    }
  }
  return result;
}

function hasStructuredSections(text) {
  const parsed = parseStructuredPrompt(text);
  return Object.values(parsed).some(v => v);
}

function autoClassifyPrompt(text) {
  if (hasStructuredSections(text)) {
    const structured = parseStructuredPrompt(text);
    const buckets = {};
    CHAR_SECTIONS.forEach(s => { buckets[s.key] = []; });
    Object.entries(structured).forEach(([key, val]) => {
      if (!buckets[key]) buckets[key] = [];
      splitPromptTags(val).forEach(t => buckets[key].push(t));
    });
    return buckets;
  }

  const buckets = {};
  CHAR_SECTIONS.forEach(s => { buckets[s.key] = []; });
  splitPromptTags(text).forEach(tag => {
    buckets[classifyTag(tag)].push(tag);
  });
  return buckets;
}

function bucketsToPromptData(buckets) {
  const data = {};
  CHAR_SECTIONS.forEach(s => {
    const tags = buckets[s.key] || [];
    if (tags.length) data[s.key] = tags.join(', ');
  });
  return data;
}

function setLearnAuto(on) {
  learnAutoMode = on;
  document.getElementById('learn-auto-on')?.classList.toggle('on', on);
  document.getElementById('learn-auto-off')?.classList.toggle('on', !on);
  const fb = document.getElementById('learn-fallback-sec');
  if (fb) fb.style.display = on ? 'none' : 'inline-block';
  previewLearn();
}

function renderLearnPreview(buckets) {
  const total = Object.values(buckets).reduce((n, a) => n + a.length, 0);
  const statsHtml =
    `<span>共 ${total} 個詞彙</span>` +
    CHAR_SECTIONS.map(s => {
      const c = (buckets[s.key] || []).length;
      return c ? `<span>${s.zh} ${c}</span>` : '';
    }).join('');

  const previewHtml = CHAR_SECTIONS.map(s => {
    const tags = buckets[s.key] || [];
    const tagHtml = tags.length
      ? tags.map((t, i) =>
          `<span class="learn-tag" title="點擊移到其他區塊" onclick="moveLearnTag('${s.key}',${i})">${escHtml(t)}</span>`
        ).join('')
      : '<span class="learn-tag empty">—</span>';
    return `<div class="learn-sec-box">
      <div class="learn-sec-head"><span>❖ ${s.zh}</span><span class="learn-sec-count">${tags.length}</span></div>
      <div class="learn-tags">${tagHtml}</div>
    </div>`;
  }).join('');

  const statsEl = document.getElementById('learn-stats');
  const previewEl = document.getElementById('learn-preview');
  if (statsEl) statsEl.innerHTML = statsHtml;
  if (previewEl) previewEl.innerHTML = previewHtml;

  const qStats = document.getElementById('quick-learn-stats');
  const qPreview = document.getElementById('quick-learn-preview');
  if (qStats) qStats.innerHTML = statsHtml;
  if (qPreview) qPreview.innerHTML = previewHtml;
}

function clearLearnPreviewUI() {
  const empty = '<span class="meta">貼上 prompt 後自動顯示分類</span>';
  const statsEl = document.getElementById('learn-stats');
  const previewEl = document.getElementById('learn-preview');
  const qStats = document.getElementById('quick-learn-stats');
  const qPreview = document.getElementById('quick-learn-preview');
  if (statsEl) statsEl.innerHTML = '';
  if (previewEl) previewEl.innerHTML = empty;
  if (qStats) qStats.innerHTML = '';
  if (qPreview) qPreview.innerHTML = '';
}

function moveLearnTag(fromKey, idx) {
  if (!learnClassified || !learnClassified[fromKey]) return;
  const tag = learnClassified[fromKey][idx];
  if (!tag) return;
  const others = CHAR_SECTIONS.filter(s => s.key !== fromKey);
  const names = others.map((s, i) => `${i + 1}. ${s.zh}`).join('\n');
  const pick = prompt(`將「${tag}」移到：\n${names}\n\n輸入編號 (1-${others.length})：`);
  if (!pick) return;
  const n = parseInt(pick, 10);
  if (n < 1 || n > others.length) return toast('無效編號');
  learnClassified[fromKey].splice(idx, 1);
  learnClassified[others[n - 1].key].push(tag);
  learnPreviewData = bucketsToPromptData(learnClassified);
  renderLearnPreview(learnClassified);
}

function previewLearn() {
  const text = (document.getElementById('learn-input')?.value || document.getElementById('quick-learn-input')?.value || '').trim();
  if (!text) {
    learnPreviewData = null;
    learnClassified = null;
    clearLearnPreviewUI();
    return;
  }

  if (learnAutoMode) {
    learnClassified = autoClassifyPrompt(text);
    learnPreviewData = bucketsToPromptData(learnClassified);
    renderLearnPreview(learnClassified);
  } else {
    learnClassified = null;
    learnPreviewData = parseStructuredPrompt(text);
    const fb = document.getElementById('learn-fallback-sec')?.value || 'subject';
    if (!Object.values(learnPreviewData).some(v => v)) {
      learnPreviewData[fb] = text.replace(/\n/g, ', ').trim();
    }
    const buckets = {};
    CHAR_SECTIONS.forEach(s => {
      buckets[s.key] = learnPreviewData[s.key] ? splitPromptTags(learnPreviewData[s.key]) : [];
    });
    renderLearnPreview(buckets);
  }
}

const debouncedAutoLearn = _mkDebounce(() => previewLearn(), 400);
const debouncedQuickLearn = _mkDebounce(() => {
  const q = document.getElementById('quick-learn-input')?.value?.trim();
  if (q && document.getElementById('learn-input')) {
    document.getElementById('learn-input').value = q;
  }
  previewLearn();
}, 400);

function importCurrentPrompt() {
  const t = buildCharPrompt();
  if (!t) return toast('目前無 Prompt');
  document.getElementById('learn-input').value = t;
  previewLearn();
  toast('已匯入目前角色 Prompt');
}

function applyLearnToCurrent() {
  if (!learnPreviewData) previewLearn();
  if (!learnPreviewData) return toast('請先輸入內容');
  CHAR_SECTIONS.forEach(s => {
    if (learnPreviewData[s.key]) charSlots[s.key] = learnPreviewData[s.key];
  });
  renderChar();
  toast('已套用到目前角色');
}

function commitLearnFromData(clearInputs) {
  if (!learnPreviewData) previewLearn();
  if (!learnPreviewData) return toast('請先輸入內容');

  let added = 0;
  let tagAdded = 0;
  const newTpl = {};
  CHAR_SECTIONS.forEach(s => {
    const v = learnPreviewData[s.key];
    if (!v || !v.trim()) return;
    const trimmed = finalizeSlotText(s.key, v.trim());
    if (!trimmed) return;
    newTpl[s.key] = trimmed;
    if (s.key === 'job' && !sanitizeJobBankEntry(trimmed)) return;
    if (!charBanks[s.key].includes(trimmed)) {
      charBanks[s.key].push(trimmed);
      added++;
    }
  });

  if (learnClassified) {
    CHAR_SECTIONS.forEach(s => {
      tagAdded += addTagsToBank(s.key, learnClassified[s.key] || []);
    });
  } else {
    CHAR_SECTIONS.forEach(s => {
      if (!learnPreviewData[s.key]) return;
      tagAdded += addTagsToBank(s.key, splitPromptTags(learnPreviewData[s.key]));
    });
  }

  if (newTpl.subject) {
    const isDupe = charTemplates.some(t => t.subject === newTpl.subject && t.outfit === newTpl.outfit);
    if (!isDupe) charTemplates.push({ ...newTpl });
  }

  saveCharBanks();
  setCharMode('learn');
  generateChar();
  if (clearInputs) {
    const li = document.getElementById('learn-input');
    const qi = document.getElementById('quick-learn-input');
    if (li) li.value = '';
    if (qi) qi.value = '';
    learnPreviewData = null;
    learnClassified = null;
    const done = '<span class="meta">已加入，可繼續貼上下一則</span>';
    const previewEl = document.getElementById('learn-preview');
    const statsEl = document.getElementById('learn-stats');
    const qPreview = document.getElementById('quick-learn-preview');
    const qStats = document.getElementById('quick-learn-stats');
    if (previewEl) previewEl.innerHTML = done;
    if (statsEl) statsEl.innerHTML = '';
    if (qPreview) qPreview.innerHTML = done;
    if (qStats) qStats.innerHTML = '';
  }
  toast(`已加入辭庫（${added} 段 · ${tagAdded} 詞）並亂數迭代生成`);
}

function commitLearn() { commitLearnFromData(true); }

function quickLearnCommit() {
  const q = document.getElementById('quick-learn-input')?.value?.trim();
  if (q) document.getElementById('learn-input').value = q;
  learnAutoMode = true;
  setLearnAuto(true);
  commitLearnFromData(true);
}

function openLearnPanel() {
  const q = document.getElementById('quick-learn-input')?.value?.trim();
  if (q) document.getElementById('learn-input').value = q;
  document.getElementById('learn-overlay').classList.add('open');
  previewLearn();
  document.getElementById('learn-input').focus();
}
function closeLearnPanel() {
  document.getElementById('learn-overlay').classList.remove('open');
}

const LEARN_EXAMPLES = {
  1: `// ❖ Subject & Character
1girl, solo, cute catgirl with long white hair, pink eyes, playful expression

// ❖ Facial Features
pink eyes, cute playful smile, slightly blushing cheeks, looking at viewer

// ❖ Character Details
long white hair in single braid, black cat ears hoodie with white bow, black cat tail

// ❖ Outfit
black cropped hoodie with cat ears, white sailor bow, black ruffled micro skirt with side strings, black lace thigh-high stockings, black panties visible

// ❖ Pose / Composition
standing pose, both hands holding and pulling cat-ear hood, body slightly tilted, seductive cute pose

// ❖ Environment & Lighting
indoor setting with soft lighting, glowing abstract background elements, clean white and black color scheme

// ❖ STYLE REFERENCES
high quality anime illustration, detailed hair and fabric texture, glossy highlights, cute yet seductive aesthetic

// ❖ QUALITY / TECHNICAL TAGS
masterpiece, best quality, ultra detailed, sharp focus, high resolution, perfect anatomy, glossy skin and clothing`,
  2: `// ❖ Subject & Character
1girl, solo, young East Asian woman, short bob haircut with straight bangs, fair smooth skin, slim figure, no bra

// ❖ Facial Features
beautiful face, dark eyes, gentle neutral expression, looking at viewer

// ❖ Character Details
short bob hair with straight bangs

// ❖ Outfit
pink sheer floral maxi dress, semi-transparent fabric, delicate pink floral pattern, long voluminous puff sleeves, gathered round neckline, slightly visible panty outline through the dress, no bra, modest yet subtly revealing silhouette

// ❖ Pose / Composition
standing pose, making heart shape with both hands in front of chest, full body visible

// ❖ Environment & Lighting
bright indoor room with large window showing green trees and balcony outside, natural daylight, soft even lighting

// ❖ STYLE REFERENCES
photorealistic, high detail, natural colors, clean composition

// ❖ QUALITY / TECHNICAL TAGS
masterpiece, best quality, ultra detailed, sharp focus, high resolution, subtle see-through effect`,
};

function fillLearnExample(n) {
  document.getElementById('learn-input').value = LEARN_EXAMPLES[n] || '';
  learnAutoMode = true;
  setLearnAuto(true);
  previewLearn();
}

// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// 關鍵字搜尋 — 三頁套用處理
// ═══════════════════════════════════════════════════════════════════
function applyCharSearchEffects(effects, opts) {
  const fillMode = effects.fillMode || opts.fillMode || 'smart';
  if (effects.unlockAll) charLocked.clear();

  const hadPreset = !!effects.preset;
  if (effects.preset) applyQuickPreset(effects.preset, { silent: true });

  if (effects.tone) setCharTone(effects.tone);
  if (effects.mode) setCharMode(effects.mode);
  if (effects.intensity) {
    const el = document.getElementById('char-tone-intensity');
    if (el) { el.value = effects.intensity; syncCharIntensity(); }
  }
  if (effects.jobTypes) {
    charJobTypes = effects.jobTypes;
    renderCharJobChips();
    const jobInc = document.getElementById('char-inc-job');
    if (jobInc) jobInc.checked = !effects.jobTypes.has('none');
    if (effects.jobTypes.has('none')) {
      charSlots.job = '';
    } else if (charIsIncluded('job') && !charLocked.has('job')) {
      charSlots.job = rollJobSection();
    }
  }
  if (effects.posePresets?.size) {
    charPosePresets = new Set(effects.posePresets);
    if ([...charPosePresets].some(id => SAFE_SELFIE_IDS.includes(id)) && isJobDisabled()) {
      applySafeSelfieDefaults();
    }
    renderCharPoseChips();
    document.getElementById('char-inc-pose').checked = true;
  }
  syncJobPoseMutex({ silent: !effects._poseClearedForJob?.length });
  if (effects._poseClearedForJob?.length) {
    toast('POSE·自拍 與 JOB 衝突（已清除自拍預設，保留 JOB）');
  }
  if (hasActiveJob() && charIsIncluded('pose') && !charLocked.has('pose')) {
    charSlots.pose = rollPoseSection();
  }
  if (effects.bodyReset) resetBodyFilters({ stateOnly: true, silent: true });
  else if (effects.bodyCombo && BODY_COMBOS[effects.bodyCombo]) {
    setBodyComboState(effects.bodyCombo);
  } else {
    if (effects.bodyFrame?.size) {
      charBodyFrame = migrateBodySet([...effects.bodyFrame], BODY_FRAME_TYPES);
      if (!effects.bodyFigure?.size) clearConflictingBodyFigures([...effects.bodyFrame]);
    }
    if (effects.bodyBreast?.size) {
      charBodyBreast = migrateBodySet([...effects.bodyBreast], BODY_BREAST_TYPES);
    }
    if (effects.bodyFigure?.size) {
      charBodyFigure = migrateBodySet([...effects.bodyFigure], BODY_FIGURE_TYPES);
    }
    if (effects.bodyFrame?.size || effects.bodyBreast?.size || effects.bodyFigure?.size) {
      renderCharBodyChips();
      checkBodySoftConflicts();
    }
  }
  if (effects.spicyOutfits?.size) {
    charSpicyOutfits = migrateSpicySet([...effects.spicyOutfits], SPICY_OUTFIT_TYPES, 'none');
    renderCharSpicyOutfitChips();
  }
  if (effects.spicyActions?.size) {
    charSpicyActions = migrateSpicySet([...effects.spicyActions], SPICY_ACTION_TYPES, 'none');
    renderCharSpicyActionChips();
  }

  const hinted = new Set(Object.keys(effects.sectionHints || {}));
  for (const [section, hints] of Object.entries(effects.sectionHints || {})) {
    if (!hints.length || charLocked.has(section) || !charIsIncluded(section)) continue;
    charSlots[section] = finalizeSlotText(section, applyToneBoost(section, pickFromBankFiltered(section, hints)));
  }

  for (const section of effects.reroll || []) {
    if (!charLocked.has(section) && charIsIncluded(section)) rerollCharRow(section);
  }
  if (hadPreset && effects.posePresets?.size && !effects.sectionHints?.pose && !charLocked.has('pose') && charIsIncluded('pose')) {
    charSlots.pose = rollPoseSection();
  }

  if (effects.action === 'copy') {
    const t = buildCharPrompt();
    if (t) navigator.clipboard.writeText(t);
    toast(t ? '已複製 Prompt' : '無 Prompt 可複製');
  }
  if (effects.action === 'save') {
    let n = 0;
    CHAR_SECTIONS.forEach(s => {
      const v = charSlots[s.key];
      if (!v || charBanks[s.key].includes(v)) return;
      charBanks[s.key].push(v);
      n++;
    });
    saveCharBanks();
    setCharMode('learn');
    VoidSearch.rebuildLearnedRules(getLearnedSearchTags);
    toast(`已記住 ${n} 段`);
  }

  if (effects.regenerate && !hadPreset) {
    generateChar();
  } else if (fillMode === 'full') {
    charLocked.clear();
    generateChar();
  } else if (fillMode === 'smart' && !hadPreset) {
    CHAR_SECTIONS.forEach(s => {
      if (!charIsIncluded(s.key) || charLocked.has(s.key)) return;
      if (hinted.has(s.key)) return;
      if (s.key === 'job' && isJobDisabled()) { charSlots.job = ''; return; }
      if (!charSlots[s.key]) {
        charSlots[s.key] = s.key === 'job' ? rollJobSection() : s.key === 'pose' ? rollPoseSection() : rollCharSection(s.key);
      }
    });
    coerceSlotsForActiveJob();
    renderChar();
  } else {
    coerceSlotsForActiveJob();
    renderChar();
  }
  saveActiveSession();
}

function pickStyleFromHints(key, hints) {
  if (!hints?.length) return rollSlot(key);
  const bank = BANKS[key];
  if (!bank) return rollSlot(key);
  const lower = hints.map(h => h.toLowerCase());
  const zh = bank.zh || [], en = bank.en || [];
  const pool = [...zh.map((t, i) => ({ t, lang: 'zh' })), ...en.map(t => ({ t, lang: 'en' }))];
  const scored = pool.map(({ t, lang: l }) => {
    const e = t.toLowerCase();
    const score = lower.reduce((n, h) => n + (e.includes(h) ? 1 : 0), 0);
    return { t, l, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length) {
    const top = scored[0].score;
    const best = scored.filter(x => x.score === top);
    const pick = best[Math.floor(Math.random() * best.length)];
    return { display: pick.t, prompt: pick.t };
  }
  if (key === 'subject') return { display: hints.join(', '), prompt: hints.join(', ') };
  return rollSlot(key);
}

function applyStyleSearchEffects(effects, opts) {
  const fillMode = effects.fillMode || opts.fillMode || 'smart';
  if (effects.styleMode) {
    mode = effects.styleMode;
    document.querySelectorAll('#mode-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.mode === mode));
    applyModePreset(mode);
  }
  const hinted = new Set();
  for (const [section, hints] of Object.entries(effects.sectionHints || {})) {
    if (section === 'negative' || section === 'style') continue;
    if (!SLOT_KEYS.includes(section) || locked.has(section) || !isIncluded(section)) continue;
    slots[section] = pickStyleFromHints(section, hints);
    hinted.add(section);
  }
  for (const section of effects.reroll || []) {
    if (SLOT_KEYS.includes(section) && !locked.has(section) && isIncluded(section)) {
      slots[section] = rollSlot(section);
    }
  }
  if (effects.regenerate || fillMode === 'full') {
    locked.clear();
    generateAll();
  } else if (fillMode === 'smart') {
    SLOT_KEYS.forEach(k => {
      if (!isIncluded(k) || locked.has(k) || hinted.has(k)) return;
      if (!slots[k]) slots[k] = rollSlot(k);
    });
    renderStyle();
  } else {
    renderStyle();
  }
  saveActiveSession();
}

function pickJewelFromHints(key, hints) {
  const bank = getJewelBankFiltered(key);
  const lower = (hints || []).map(h => h.toLowerCase());
  const scored = bank.map(entry => {
    const e = (typeof entry === 'string' ? entry : jewelText(entry)).toLowerCase();
    const score = lower.reduce((n, h) => n + (e.includes(h) ? 1 : 0), 0);
    return { entry, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length) {
    const top = scored[0].score;
    const best = scored.filter(x => x.score === top);
    const raw = best[Math.floor(Math.random() * best.length)].entry;
    return typeof raw === 'string' ? raw : jewelText(raw);
  }
  return hints?.length ? hints.join(', ') : rollJewelSection(key);
}

function applyJewelSearchEffects(effects, opts) {
  const fillMode = effects.fillMode || opts.fillMode || 'smart';
  if (effects.jewelCats?.size) {
    jewelActiveCats = new Set(effects.jewelCats);
    if (!jewelActiveCats.size) jewelActiveCats.add('all');
    renderJewelCatChips();
  }
  const hinted = new Set();
  for (const [section, hints] of Object.entries(effects.sectionHints || {})) {
    if (section === 'negative') continue;
    const key = section === 'jewel' ? 'product' : section;
    if (!jewelIsIncluded(key) || jewelLocked.has(key)) continue;
    jewelSlots[key] = pickJewelFromHints(key, hints);
    hinted.add(key);
  }
  for (const section of effects.reroll || []) {
    if (!jewelLocked.has(section) && jewelIsIncluded(section)) rerollJewelSlot(section);
  }
  if (effects.regenerate || fillMode === 'full') {
    jewelLocked.clear();
    generateJewel();
  } else if (fillMode === 'smart') {
    JEWEL_SECTIONS.forEach(s => {
      if (!jewelIsIncluded(s.key) || jewelLocked.has(s.key) || hinted.has(s.key)) return;
      if (!jewelSlots[s.key]) jewelSlots[s.key] = rollJewelSection(s.key);
    });
    renderJewel();
  } else {
    renderJewel();
  }
  saveActiveSession();
}

async function onSearchTranslateToBank(result, opts = {}) {
  const english = result?.english?.trim();
  if (!english) return 0;

  learnAutoMode = true;
  learnClassified = autoClassifyPrompt(english);
  learnPreviewData = bucketsToPromptData(learnClassified);

  let tagAdded = 0;
  let added = 0;
  CHAR_SECTIONS.forEach(s => {
    const v = learnPreviewData[s.key];
    if (v?.trim()) {
      const trimmed = v.trim();
      if (s.key !== 'job' || sanitizeJobBankEntry(trimmed)) {
        if (!charBanks[s.key].includes(trimmed)) {
          charBanks[s.key].push(trimmed);
          added++;
        }
      }
    }
    tagAdded += addTagsToBank(s.key, learnClassified[s.key] || []);
  });

  if (learnPreviewData.subject) {
    const tpl = { ...learnPreviewData };
    const isDupe = charTemplates.some(t => t.subject === tpl.subject && t.outfit === tpl.outfit);
    if (!isDupe) charTemplates.push(tpl);
  }

  saveCharBanks();
  setCharMode('learn');
  VoidSearch.rebuildLearnedRules(getLearnedSearchTags);
  renderBankStats();

  if (currentPage === 'char') {
    CHAR_SECTIONS.forEach(s => {
      if (learnPreviewData[s.key]) charSlots[s.key] = learnPreviewData[s.key];
    });
    generateChar();
  }

  const preview = document.getElementById('prompt-search-preview');
  if (preview) {
    preview.textContent = english;
    preview.classList.remove('empty');
  }

  toast(`翻譯入庫：${tagAdded} 詞 · ${added} 段（${result.method === 'grok' ? 'Grok' : '辭庫'}）`);
  return tagAdded;
}

function getLearnedSearchTags() {
  const out = [];
  CHAR_SECTIONS.forEach(s => {
    const bank = charBanks[s.key] || [];
    const defaults = new Set(DEFAULT_CHAR_BANKS[s.key] || []);
    bank.filter(e => e && !defaults.has(e)).slice(-8).forEach(entry => {
      const short = entry.length > 28 ? entry.slice(0, 28) + '…' : entry;
      out.push({ section: s.key, label: short, hints: splitPromptTags(entry).slice(0, 5) });
    });
  });
  return out.slice(0, 30);
}

function initVoidSearch() {
  VoidSearch.init({
    initialPage: currentPage,
    onSessionSave: saveActiveSession,
    onTranslateToBank: onSearchTranslateToBank,
    getLearnedTags: getLearnedSearchTags,
    handlers: {
      char: { apply: applyCharSearchEffects, buildPrompt: buildCharPrompt },
      style: { apply: applyStyleSearchEffects, buildPrompt: buildStylePrompt },
      jewel: { apply: applyJewelSearchEffects, buildPrompt: buildJewelPrompt },
      space: { apply: applySpaceSearchEffects, buildPrompt: getSpaceActivePrompt },
    },
  });
}

function focusSearch() { VoidSearch.focusSearch(); }

// 快捷鍵 & 初始化
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) return;
  if (EMBED_CHAR && e.key === '/') return;
  if (e.key === '/') {
    e.preventDefault();
    VoidSearch.focusSearch();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (currentPage === 'style') generateAll();
    else if (currentPage === 'jewel') generateJewel();
    else if (currentPage === 'space') generateSpaceCards();
    else generateChar();
  }
  if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
    if (currentPage === 'style') copyStyleOutput();
    else if (currentPage === 'jewel') copyJewelOutput();
    else if (currentPage === 'space') copySpaceActiveCard();
    else copyCharOutput();
  }
  if (e.key === 'Escape') { closeLearnPanel(); closeSessionPanel(); }
});

// init
function bootVoidRng() {
try {
  if (typeof voidRngApplyLatestData === 'function' && window.VoidRngData?.payload) {
    voidRngApplyLatestData(window.VoidRngData.payload);
  }
  mergeUserSpaceBanks();
  loadSessionsFromStorage();
  renderPoolChips();
  renderCharIncChecks();
  renderCharJobChips();
  renderCharActionChips();
  renderCharSpicyOutfitChips();
  renderCharBodyChips();
  renderCharEnvChips();
  renderJewelCatChips();
  renderJewelIncChecks();
  renderSpaceCatChips();
  renderSpaceStylePoolChips();
  renderSpaceStyleCodeHint();
  renderSpaceIncChecks();
  document.getElementById('learn-fallback-sec').innerHTML = CHAR_SECTIONS.map(s =>
    `<option value="${s.key}">${s.zh} (${s.label})</option>`
  ).join('');
  renderBankStats();
  const _activeSess = sessions.find(s => s.id === activeSessionId);
  if (_activeSess?.data) {
    applySessionSnapshot(_activeSess.data);
  } else {
    if (!EMBED_CHAR) {
      renderStyleHistory();
      renderJewelHistory();
      renderSpaceHistory();
      generateAll();
      generateJewel();
      generateSpaceCards();
    }
    renderCharHistory();
    setCharTone(charTone);
    const _intEl = document.getElementById('char-tone-intensity');
    if (_intEl) { _intEl.value = charToneIntensity; syncCharIntensity(); }
    generateChar();
  }
  bindPageTabs();
  restoreSavedPage();
  initVoidSearch();
  updateSessionPill();
  window.addEventListener('beforeunload', saveActiveSession);
  setInterval(saveActiveSession, 30000);
} catch (e) {
  console.error('VOID.RNG init failed:', e);
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="background:#2a1010;color:#e84040;padding:12px 16px;font-size:11px;border-bottom:1px solid #441818">載入錯誤：'+e.message+' — 請重新整理，或清除瀏覽器本機資料後再試。</div>');
  try { generateAll(); generateChar(); generateJewel(); generateSpaceCards(); } catch {}
}
}
window.bootVoidRng = bootVoidRng;
(function exposeVoidRngApi() {
  const fns = [
    'switchPage', 'generateChar', 'generateAll', 'generateJewel', 'generateSpaceCards', 'toast',
    'setCharTone', 'setCharMode', 'setCharFmt', 'applyQuickPreset', 'openLearnPanel',
    'closeSessionPanel', 'openSessionPanel', 'closeLearnPanel', 'copyCharOutput',
    'copyStyleOutput', 'copyJewelOutput', 'copySpaceActiveCard', 'feedSpaceSlotsToBank',
  ];
  fns.forEach((name) => {
    const fn = globalThis[name];
    if (typeof fn === 'function') globalThis[name] = fn;
  });
  globalThis.__VOID_RNG_ENGINE__ = true;
})();

/* boot 由 app.js 在載入最新 data 後呼叫 bootVoidRng() */
