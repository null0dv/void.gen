/* Desktop interface: scoped to Full V3; legacy mobile editing is retired. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, attrs = {}, text = '') => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    node.textContent = text;
    return node;
  };
  let noticeTimer, scheduled = false;
  let revealedLoras = new Set();
  const cloud = () => !!(window.VoidPixai && VoidPixai.isActive());
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  const button = (label, action, className = 'tb-btn') => {
    const b = make('button', { type:'button', class:className }, label);
    b.addEventListener('click', action); return b;
  };
  function notify(message, error = false) {
    const toast = $('vd-toast');
    toast.hidden = false; toast.textContent = message;
    toast.setAttribute('role', error ? 'alert' : 'status');
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => toast.hidden = true, 7000);
  }
  function confirmAction(title, description, action) {
    const dialog = $('vd-confirm');
    if (dialog.open) return Promise.resolve(false);
    $('vd-confirm-title').textContent = title;
    $('vd-confirm-body').textContent = description;
    $('vd-confirm-accept').textContent = action;
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once:true });
      dialog.showModal(); $('vd-confirm-cancel').focus();
    });
  }
  function readiness(all) {
    if (window.VoidRecognition?.isBusy()) return '正在辨識圖片，請稍候或取消。';
    if (window.voidGalleryClearing) return '正在清空圖庫，請稍候。';
    if (innerWidth <= 900) return '手機版已暫停，請使用電腦開啟。';
    if (currentMode === 'img2txt') return img2txtBase64 ? '圖片已載入，可按「辨識提示詞」開始。' : '請上傳圖片，使用「辨識提示詞」操作。';
    if (!cloud() && !window.voidApiOnline) return '尚未連接 ComfyUI，請重新連線。';
    if (window.VoidEngines?.isActive() && VoidEngines.missingComponents().length) return '引擎元件尚未就緒，請查看模型區提示。';
    if (!$('model-select').value) return '請先選擇模型。';
    if (currentMode === 'img2img' && !img2imgBase64) return '請先上傳來源圖片。';
    if (!_getGenerateTaskIndices(all).length) return all ? '請至少完成一個任務的提示詞。' : '請輸入目前任務的提示詞。';
    return '';
  }
  function canGenerate(all) {
    const reason = readiness(all);
    if (reason) { notify(reason, true); return false; }
    if ($('vd-confirm').open) return false;
    return true;
  }
  function syncLoras() {
    const items = [...document.querySelectorAll('#lora-slots .lora-item')];
    items.forEach((item, i) => {
      const populated = !!item.querySelector('select')?.value;
      item.hidden = !populated && !revealedLoras.has(i);
    });
    $('vd-add-lora').disabled = items.length === 0 || items.every(item => !item.hidden);
  }
  function refresh() {
    const runnable = _getGenerateTaskIndices(true).length;
    const batch = cloud() ? Math.min(4, currentBatch || 1) : (currentBatch || 1);
    setText($('vd-summary'), `目前任務 ${activeTask + 1} / ${tasks.length} · 每任務 ${batch} 張${cloud() && currentBatch > 4 ? '（雲端上限 4 張）' : ''}`);
    setText($('vd-run-all'), `執行全部 ${runnable} 個任務 · ${runnable * batch} 張`);
    if (!isGenerating) setText($('gen-label'), `生成目前任務 · ${batch} 張`);
    const activeReason = readiness(false);
    const allReason = readiness(true);
    $('gen-btn').disabled = isGenerating || !!activeReason;
    $('vd-run-all').disabled = isGenerating || !!allReason;
    $('gen-btn').title = isGenerating ? '目前正在生成，請等待完成或停止。' : activeReason;
    $('vd-run-all').title = isGenerating ? '目前正在生成，請等待完成或停止。' : allReason;
    const state = window.VoidGenFlow?.getState() || 'idle';
    const labels = { idle:'待命', queued:'排隊中', generating:'生成中', saving:'儲存中', done:'已完成', error:'生成失敗', cancelled:'已停止', connecting:'連接中' };
    setText($('vd-state'), window.VoidRecognition?.isBusy() ? '辨識中' : labels[state] || '待命');
    if (!isGenerating && !(currentMode === 'img2txt' && ['done','error','cancelled'].includes(state)) && (activeReason || state === 'idle')) setText($('vd-detail'), activeReason || '設定就緒，可以生成圖片。');
    $('vd-retry').hidden = cloud() || !!window.voidApiOnline;
    document.body.classList.toggle('has-preview', !!lastResult || isGenerating);
    syncLoras();
    document.querySelectorAll('#task-editor input,#task-editor textarea').forEach(el => {
      el.setAttribute('aria-label', ({'te-title':'任務名稱','te-prompt':'正向提示詞','te-neg':'負向提示詞'})[el.id] || el.id);
    });
    document.querySelectorAll('.mode-btn,.center-tab,.size-btn,.batch-btn,.seed-icon-btn,.icon-btn,.sec-label.clickable,.album-chip').forEach(el => {
      if (el.tagName !== 'BUTTON' && !el.querySelector('button,select,input')) {
        el.setAttribute('role','button'); el.tabIndex = 0;
        el.setAttribute('aria-label', el.title || el.textContent.trim());
      }
    });
  }
  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; refresh(); });
  }
  window.VoidDesktop = { confirm:confirmAction, notify, refresh, canGenerate };

  const top = document.querySelector('.topbar-right');
  const more = make('details', {class:'vd-more'});
  more.append(make('summary',{class:'tb-btn'},'更多 ⋯'));
  const menu = make('div',{class:'vd-menu'}); more.append(menu);
  const names = { 'saveTasks()':'儲存任務', 'checkApi()':'重新連線', 'clearGallery()':'清空瀏覽器圖庫…', 'resetTasks()':'重設全部任務…', 'showShortcuts()':'鍵盤快捷鍵' };
  [...top.querySelectorAll('button')].forEach(b => {
    const handler = b.getAttribute('onclick');
    if (names[handler]) {
      b.textContent = names[handler]; menu.append(b);
      if (/clearGallery|resetTasks/.test(handler)) b.classList.add('vd-danger');
      b.addEventListener('click', () => more.open = false);
    }
  });
  menu.append(button('復原上次重設的任務', async () => {
    more.open = false;
    if (isGenerating) return notify('請先停止生成。', true);
    const saved = localStorage.getItem('void-tasks-before-reset');
    if (!saved) return notify('沒有可復原的任務備份。');
    if (!await confirmAction('復原上次任務？','目前的任務草稿將被備份中的任務取代。','復原任務')) return;
    if (isGenerating) return;
    try {
      const restored = JSON.parse(saved);
      if (!Array.isArray(restored) || !restored.length) throw new Error('Invalid backup');
      tasks = restored; activeTask = 0; queueStatuses = {};
      saveTasks(); renderTaskTabs(); renderTaskEditor(); renderQueue(); refresh(); notify('任務已復原。');
    } catch (_) { notify('無法讀取任務備份。', true); }
  }));
  top.insertBefore(more, $('api-dot'));
  $('folder-btn').textContent = '輸出資料夾'; $('presets-btn').textContent = '預設集';
  $('theme-btn').textContent = '外觀'; $('theme-btn').setAttribute('aria-label','外觀主題');
  const stateBar = make('div',{id:'vd-state-bar',role:'status','aria-live':'polite'});
  stateBar.append(make('span',{id:'vd-state'},'待命'), make('span',{id:'vd-detail'},'檢查連線中…'));
  const retry = button('重新連線', async () => { retry.disabled = true; setText($('vd-detail'),'正在連接 ComfyUI…'); try { await checkApi(); } finally { retry.disabled = false; refresh(); } });
  retry.id = 'vd-retry'; stateBar.append(retry);
  document.querySelector('.topbar').after(stateBar);
  const genWrap = document.querySelector('.gen-wrap');
  genWrap.prepend(make('div',{id:'vd-summary'}));
  const all = button('執行全部', () => startGenerate(true), 'vd-run-all'); all.id = 'vd-run-all'; genWrap.append(all);

  const advanced = make('details',{class:'vd-advanced'});
  advanced.append(make('summary',{},'進階設定 · 採樣 / Seed / VAE / Pipeline'));
  const scroll = document.querySelector('.sidebar-scroll');
  ['refiner-select','sampler-select','steps-slider','seed-input','vae-select','pipeline-body'].forEach(id => {
    const section = $(id)?.closest('.ss'); if (section) advanced.append(section);
  });
  scroll.append(advanced);
  const addLora = button('＋ 新增 LoRA', () => {
    const items = [...document.querySelectorAll('#lora-slots .lora-item')];
    const i = items.findIndex(item => item.hidden);
    if (i >= 0) { revealedLoras.add(i); syncLoras(); items[i].querySelector('select').focus(); }
  }, 'tb-btn vd-lora-add');
  addLora.id = 'vd-add-lora'; $('lora-body').append(addLora);
  const toolbar = $('gallery-toolbar');
  const sorting = make('select',{class:'sel','aria-label':'圖庫排序'});
  [['time','最新圖片'],['model','依模型'],['rating','依評分']].forEach(([value,label]) => sorting.append(make('option',{value},label)));
  sorting.addEventListener('change', () => sortGallery(sorting.value));
  toolbar.querySelectorAll('[data-sort]').forEach(b => b.hidden = true);
  if (toolbar.firstElementChild?.tagName === 'SPAN') toolbar.firstElementChild.hidden = true;
  toolbar.prepend(sorting);
  $('select-mode-btn').textContent = '選取'; $('del-btn').textContent = '刪除所選';
  $('gallery-search').placeholder = '搜尋圖片提示詞…';
  $('gallery-search').setAttribute('aria-label','搜尋圖片提示詞');
  $('gallery-empty').append(make('p',{class:'vd-empty-help'},'從左側選擇模型、輸入提示詞，再生成第一張圖片。圖片會顯示在這裡。'));
  document.querySelectorAll('.mode-btn').forEach((b,i) => b.textContent = ['文生圖','圖生圖','圖片辨識'][i]);
  $('interrogate-btn').textContent = '辨識提示詞';
  const paused = make('section',{id:'vd-mobile-paused'});
  paused.append(make('div',{},'VOID.gen / DESKTOP'),make('h1',{},'手機版已暫停使用'),make('p',{},'VOID.GEN 後續僅維護桌面版。請使用電腦開啟；現有任務與圖片資料不會因此刪除。'));
  document.body.append(paused,make('div',{id:'vd-toast',hidden:'',role:'status'}));
  const dialog = make('dialog',{id:'vd-confirm','aria-labelledby':'vd-confirm-title','aria-describedby':'vd-confirm-body'});
  dialog.append(make('h2',{id:'vd-confirm-title'}),make('p',{id:'vd-confirm-body'}));
  const actions = make('div',{class:'vd-dialog-actions'});
  const cancel = button('取消', () => dialog.close('cancel')); cancel.id = 'vd-confirm-cancel';
  const accept = button('確認', () => dialog.close('accept'),'vd-danger'); accept.id = 'vd-confirm-accept';
  actions.append(cancel,accept); dialog.append(actions); document.body.append(dialog);
  // Keep operational messages visible; state comes from explicit lifecycle events.
  const baseStatus = window.setStatus;
  window.setStatus = function(message, type) {
    baseStatus(message,type);
    if (message !== 'Void.gen') setText($('vd-detail'),message);
    if (type === 'error') notify(message,true);
    scheduleRefresh();
  };
  document.addEventListener('input', scheduleRefresh);
  document.addEventListener('change', scheduleRefresh);
  document.addEventListener('click', e => {
    if (!more.contains(e.target)) more.open = false;
    scheduleRefresh();
  });
  document.addEventListener('keydown', e => {
    const el = e.target;
    if (innerWidth <= 900) { e.stopImmediatePropagation(); return; }
    if (e.key === 'Escape') more.open = false;
    if ((e.key === 'Enter' || e.key === ' ') && el.matches('[role="button"]') && !el.matches('button,input,textarea,select')) {
      e.preventDefault(); el.click();
    }
  }, true);
  window.addEventListener('void-connection-change', scheduleRefresh);
  window.addEventListener('void-generation-state', scheduleRefresh);
  window.addEventListener('resize', scheduleRefresh);
  const observer = new MutationObserver(scheduleRefresh);
  ['task-editor','lora-slots','model-select'].forEach(id => observer.observe($(id),{childList:true,subtree:true}));
  refresh();
})();
