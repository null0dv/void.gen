window.VoidStudio = (() => {
  const $ = id => document.getElementById(id);
  const dialog = $('studio-dialog');
  const rounds = [];
  let groupId = crypto.randomUUID();
  let main, reference, comparison, busy = false;
  let models = [], modelRequest = 0, modelKey = '';
  const selectedModels = {};
  const videoMode = () => $('studio-mode').value === 'video';
  function navigate(view) {
    document.body.dataset.fullView = view;
    $('rng-panel').hidden = view !== 'rng';
    dialog.hidden = view !== 'studio';
    $('studio-picker').hidden = view !== 'picker';
    const activeView = view === 'picker' ? pickerReturnView : view;
    for (const button of document.querySelectorAll('[data-full-view]')) {
      if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.fullView === activeView));
    }
    $('rng-open').setAttribute('aria-pressed', String(activeView === 'rng'));
    $('studio-open').setAttribute('aria-pressed', String(activeView === 'studio'));
    if (!['create', 'library', 'queue'].includes(view)) return;
    const tab = view === 'queue' ? 'queue' : 'gallery';
    switchCenterTab(tab, document.querySelectorAll('.center-tab')[tab === 'queue' ? 1 : 0]);
  }
  for (const button of document.querySelectorAll('button[data-full-view]')) {
    button.onclick = () => navigate(button.dataset.fullView);
  }
  const status = message => { $('studio-status').textContent = message; };
  let projectTimer, projectDb;
  function projectStore(){
    return projectDb ||= new Promise((resolve,reject)=>{
      const req=indexedDB.open('void-studio-projects',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('boards',{keyPath:'id'});
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async function projectOperation(write,operation){
    return operation({
      put:data=>VoidSharedGallery.saveProject(data),
      get:id=>VoidSharedGallery.getProject(id),
      getAll:async()=>{
        const remote=await VoidSharedGallery.listProjects();
        const db=await projectStore();
        const local=await new Promise((resolve,reject)=>{
          const request=db.transaction('boards','readonly').objectStore('boards').getAll();
          request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
        });
        for(const project of local){
          if(remote.some(row=>row.id===project.id))continue;
          await VoidSharedGallery.saveProject(project);
          remote.push(project);
        }
        return remote;
      }
    });
  }
  function snapshot(){
    return {id:groupId,name:$('studio-project-name').value.trim(),updated:Date.now(),rounds:[...rounds],
      positions:JSON.parse(localStorage.getItem('void-studio-board:'+groupId)||'{}'),main:rounds.indexOf(main),reference,models:{...selectedModels},mode:$('studio-mode').value,prompt:$('studio-prompt').value};
  }
  async function saveProject(){
    clearTimeout(projectTimer);
    const data=snapshot();
    if(!data.name&&!data.rounds.length&&!data.reference&&!data.prompt)return;
    await projectOperation(true,store=>store.put(data));
  }
  function queueProjectSave(){
    clearTimeout(projectTimer);
    projectTimer=setTimeout(()=>void saveProject().catch(error=>status('圖板存檔失敗：'+error.message)),450);
  }
  async function showProjects(){
    const rows=await projectOperation(false,store=>store.getAll());
    const query=$('studio-project-search').value.trim().toLowerCase();
    const matches=rows.filter(row=>(row.name||'未命名圖板').toLowerCase().includes(query)).sort((a,b)=>b.updated-a.updated);
    $('studio-project-list').replaceChildren(...matches.map(row=>{
      const button=document.createElement('button');button.type='button';button.className='tb-btn';
      button.textContent=(row.name||'未命名圖板')+' · '+(row.rounds?.length??'')+' 張';
      button.onclick=async()=>{
        if(busy)return;
        try{
          await saveProject();
          const saved=await projectOperation(false,store=>store.get(row.id));
          if(!saved)return;
          groupId=saved.id;if(saved.positions)localStorage.setItem('void-studio-board:'+groupId,JSON.stringify(saved.positions));rounds.splice(0,rounds.length,...saved.rounds);
          reference=saved.reference;comparison=null;main=null;Object.assign(selectedModels,saved.models||{});
          $('studio-project-name').value=saved.name;$('studio-mode').value=saved.mode;$('studio-prompt').value=saved.prompt;
          if(rounds[saved.main])await selectRound(rounds[saved.main]);else render();
          void refreshModels();
        }catch(error){status(error.message);}
      };
      return button;
    }));
    if(!matches.length)$('studio-project-list').textContent='沒有符合的專案';
  }
  const showProjectList=()=>void showProjects().catch(error=>status(error.message));
  $('studio-projects').ontoggle=()=>{if($('studio-projects').open)void saveProject().then(showProjectList).catch(error=>status(error.message));};
  $('studio-project-search').oninput=showProjectList;
  $('studio-project-name').onchange=()=>void saveProject().then(showProjectList).catch(error=>status(error.message));
  $('studio-prompt').addEventListener('input',queueProjectSave);
  $('studio-project-new').onclick=async()=>{
    if(busy)return;
    try{
      await saveProject();
      groupId=crypto.randomUUID();rounds.length=0;main=reference=comparison=null;
      $('studio-project-name').value='';$('studio-prompt').value='';render();showProjectList();$('studio-project-name').focus();
    }catch(error){status(error.message);}
  };
  async function selectRound(round) {
    if (busy) return;
    try {
      if (!round.url) round.url = round.meta?.sharedId ? await VoidSharedGallery.fullData(round.meta.sharedId) : (await dbLoadById(round.id))?.dataUrl;
      if (!round.url) throw new Error('這個版本的原圖目前無法讀取。');
      main = round;
      render();
    } catch (error) { status(error.message); }
  }
  function renderCanvas() {
    const canvas = $('studio-canvas');
    if ($('studio-canvas-wrap').hidden) return;
    let positions;
    try { positions = JSON.parse(localStorage.getItem('void-studio-board:' + groupId) || '{}') || {}; }
    catch { positions = {}; }
    const tiles = rounds.map((round, index) => {
      const key = round.meta?.editId || round.boardId || (round.boardId = crypto.randomUUID());
      const pos = positions[key] || {x:16+(index%4)*160,y:16+Math.floor(index/4)*126};
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'studio-tile';
      tile.style.left = pos.x + 'px';
      tile.style.top = pos.y + 'px';
      tile.setAttribute('aria-pressed', String(main === round));
      const src = round.thumbUrl || round.url;
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.draggable = false;
        tile.append(img);
      }
      const title = document.createElement('span');
      title.textContent = round.title;
      tile.append(title);
      let drag, dragged = false;
      tile.onpointerdown = event => {
        if (busy || event.button !== 0) return;
        drag = {id:event.pointerId,x:event.clientX,y:event.clientY,left:tile.offsetLeft,top:tile.offsetTop};
        dragged = false;
        tile.setPointerCapture(event.pointerId);
      };
      tile.onpointermove = event => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!dragged && Math.hypot(dx,dy) < 4) return;
        dragged = true;
        tile.style.left = Math.max(0, Math.min(canvas.clientWidth-144, drag.left+dx)) + 'px';
        tile.style.top = Math.max(0, Math.min(canvas.clientHeight-110, drag.top+dy)) + 'px';
      };
      tile.onlostpointercapture = () => {
        if (dragged) {
          positions[key] = {x:tile.offsetLeft,y:tile.offsetTop};
          try { localStorage.setItem('void-studio-board:' + groupId, JSON.stringify(positions)); queueProjectSave(); } catch {}
        }
        drag = null;
      };
      tile.onclick = async event => {
        if (busy || (dragged && event.detail)) return;
        await selectRound(round);
      };
      return tile;
    });
    canvas.style.height = Math.max(480, Math.ceil(rounds.length/4)*126+32,
      ...Object.values(positions).map(pos => Number(pos.y)+130 || 0)) + 'px';
    canvas.replaceChildren(...tiles);
  }
  function render() {
    queueProjectSave();
    for (const [key, asset] of [['main', main], ['ref', reference], ['compare', comparison]]) {
      const img = $('studio-' + key + '-img');
      img.hidden = !asset;
      if (asset) img.src = asset.url;
      else img.removeAttribute('src');
    }
    $('studio-compare-wrap').hidden = !comparison;
    $('studio-clear-ref').hidden = !reference;
    $('studio-compare').disabled = !main || !rounds.some(round => round !== main);
    $('studio-compare').setAttribute('aria-pressed', String(!!comparison));
    $('studio-rounds').hidden = !rounds.length;
    $('studio-rounds').replaceChildren(...rounds.map((round, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-round';
      button.setAttribute('aria-label', '第 ' + (index + 1) + ' 版 · ' + round.title);
      button.title = round.meta?.prompt || round.title;
      const preview = round.thumbUrl || round.url;
      if (preview) {
        const thumbnail = document.createElement('img');
        thumbnail.src = preview;
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        button.append(thumbnail);
      }
      const number = document.createElement('span');
      number.textContent = String(index + 1);
      button.append(number);
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(main === round));
      button.onclick = () => selectRound(round);
      return button;
    }));
    $('studio-main-name').textContent = main?.title || '尚未選擇';
    $('studio-ref-name').textContent = reference?.title || '選填';
    $('studio-edit').disabled = busy || !main || !$('studio-model').value;
    $('studio-edit').textContent = busy ? '處理中…' : videoMode() ? '生成影片 ↑' : '生成下一版 ↑';
    $('studio-reference-controls').hidden = videoMode();
    $('studio-video-options').hidden = !videoMode();
    $('studio-prompt').placeholder = videoMode()
      ? '描述影片裡的動作，例如：頭髮隨風飄動，鏡頭緩慢推近'
      : '描述下一步，例如：把背景改成夕陽，保留人物與構圖';
    for (const id of ['studio-mode','studio-model','studio-refresh-models','studio-main-library','studio-ref-library']) {
      $(id).disabled = busy || (id === 'studio-model' && !models.length);
    }
    renderCanvas();
  }
  function open(asset) {
    navigate('studio');
    if (asset && !busy) {
      main = asset;
      if (!rounds.includes(asset)) rounds.push(asset);
    }
    render();
    if (modelKey !== COMFY_API + '/' + $('studio-mode').value && !busy) void refreshModels();
  }
  function read(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('無法讀取圖片。'));
      reader.readAsDataURL(blob);
    });
  }
  async function prepare(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return {base64:canvas.toDataURL('image/png').split(',')[1], ratio:canvas.width/canvas.height};
  }
  async function addFile(file, key) {
    if (busy || !file) return;
    try {
      if (!file.type.startsWith('image/') || file.size > 32 * 1024 * 1024) throw new Error('請選擇 32 MB 以內的圖片。');
      const asset = {url:await read(file), title:file.name};
      if (busy) return;
      if (key === 'main') open(asset);
      else { reference = asset; render(); }
      status('');
    } catch (error) { status(error.message); }
  }
  for (const key of ['main', 'ref']) {
    const picker = $('studio-' + key);
    picker.onchange = () => { void addFile(picker.files[0], key); picker.value = ''; };
    const zones = [...dialog.querySelectorAll('label[for="' + picker.id + '"]')];
    if (key === 'main') zones.push(dialog.querySelector('.studio-hero'));
    for (const zone of zones) {
      zone.ondragover = event => { event.preventDefault(); event.stopPropagation(); };
      zone.ondrop = event => {
        event.preventDefault();
        event.stopPropagation();
        void addFile(event.dataTransfer.files[0], key);
      };
    }
  }
  async function api(path, init) {
    const response = await fetch(COMFY_API + path, {...init, signal:AbortSignal.timeout(30000)});
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(comfyValidationMessage(detail, response.status));
    }
    return response;
  }
  const clip = 'qwen_3_8b_fp4mixed.safetensors', vae = 'flux2-vae.safetensors';
  async function refreshModels() {
    const version = ++modelRequest;
    const mode = $('studio-mode').value;
    modelKey = COMFY_API + '/' + mode;
    const model = $('studio-model');
    const message = $('studio-model-status');
    models = [];
    model.replaceChildren(new Option('正在檢查…', ''));
    message.textContent = '讀取本機 ComfyUI 模型';
    render();
    let found = [], hint;
    try {
      const video = mode === 'video';
      const probe = video ? buildMotionGraph({image:'',prompt:'',width:672,height:384,seed:0,fps:16,frames:49})
        : VoidEngines.buildWorkflow({prompt:'檢查'}, '', 0, 'source.png', {width:512,height:512,clip,vae,reference:'reference.png'}).wf;
      const types = [...new Set(Object.values(probe).map(node => node.class_type))];
      const info = Object.fromEntries(await Promise.all(types.map(async type =>
        [type, (await (await api('/object_info/' + type)).json())[type]])));
      const missing = types.filter(type => !info[type]);
      if (missing.length) throw new Error('缺少節點：' + missing.join('、'));
      const choices = (type, name) => info[type]?.input?.required?.[name]?.[0] || [];
      if (video) {
        const required = Object.values(probe).flatMap(node =>
          Object.entries(node.inputs).filter(([name]) => /^(unet|clip|vae|lora)_name$/.test(name))
            .filter(([name, value]) => !choices(node.class_type, name).includes(value)).map(([,value]) => value));
        if (required.length) throw new Error('缺少影片模型：' + required.join('、'));
        found = [{id:'wan22',label:'Wan 2.2 I2V · GGUF'}];
        hint = '使用主圖作為影片起始畫面';
      } else {
        if (!choices('CLIPLoader','clip_name').includes(clip) || !choices('VAELoader','vae_name').includes(vae)) {
          throw new Error('缺少 Klein 所需的 Qwen 文字編碼器或 FLUX.2 VAE。');
        }
        found = choices('UnetLoaderGGUF','unet_name').filter(name => /flux-2-klein-9b-.*\.gguf$/i.test(name))
          .map(name => ({id:name,label:name.replace(/\.gguf$/i,'')}));
        if (!found.length) throw new Error('找不到支援此工作流的 Klein 9B GGUF 模型。');
        hint = '可搭配一張參考圖';
      }
    } catch (error) {
      hint = error.message;
    }
    if (version !== modelRequest) return;
    models = found;
    model.replaceChildren(...(found.length ? found.map(item => new Option(item.label,item.id)) : [new Option('無可用模型', '')]));
    if (found.some(item => item.id === selectedModels[mode])) model.value = selectedModels[mode];
    message.textContent = hint;
    render();
  }
  async function waitForJob(id){
    const until=Date.now()+30*60*1000;
    while(Date.now()<until){
      const job=await VoidSharedGallery.getJob(id);
      if(job.state==='done')return job;
      if(job.state==='error'||job.state==='cancelled')throw new Error(job.error||'任務已取消');
      const {value,max}=job.progress||{};
      status(job.state==='running'?(max?'生成中 · '+value+'/'+max:'正在執行…'):'已加入共用任務，等待電腦執行…');
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    throw new Error('等待逾時，請到共用任務查看進度。');
  }
  async function run(video) {
    if (busy || isGenerating || window.VoidRecognition?.isBusy()) { status('請等目前的任務完成。'); return; }
    const prompt = $('studio-prompt').value.trim();
    if (!main || !prompt) { status('請指定主圖並輸入指令。'); return; }
    const model = $('studio-model').value;
    if (!models.some(item => item.id === model)) { status('請先選擇可用的模型。'); return; }
    busy = true;
    isGenerating = true;
    render();
    status('正在準備模型與素材…');
    try {
      const source=await prepare(main.url);
      const origin=video&&main.meta?.sharedId?{gallery:main.meta.sharedId}:
        {upload:await VoidSharedGallery.uploadAsset(await (await fetch('data:image/png;base64,'+source.base64)).blob())};
      let request;
      if(video){
        request={kind:'motion',prompt,...origin,size:source.ratio>=1?'landscape':'portrait',
          shortEdge:Number($('studio-size').value),seconds:Number($('studio-seconds').value)};
      }else{
        const ratio=Math.min(2,Math.max(.5,source.ratio));
        const width=Math.round(512*Math.sqrt(ratio)/16)*16,height=Math.round(512/Math.sqrt(ratio)/16)*16;
        const ref=reference?await prepare(reference.url):null;
        const referenceUpload=ref?await VoidSharedGallery.uploadAsset(await (await fetch('data:image/png;base64,'+ref.base64)).blob()):null;
        request={kind:'generate',engine:'klein',mode:'img2img',continuous:true,prompt,model,...origin,referenceUpload,width,height,
          editGroup:groupId,parent:main.meta?.editId||main.meta?.filename||main.title};
      }
      const {ids}=await VoidSharedGallery.submitJob(request);
      const job=await waitForJob(ids[0]);
      if(video){
        const player=$('studio-video');
        player.src=VoidSharedGallery.base+job.result.url;player.hidden=false;
        $('studio-video-link').href=player.src;$('studio-video-link').hidden=false;
        if(!dialog.hidden)player.scrollIntoView({block:'nearest'});
        status('影片已完成，可在共用任務與手機作品庫查看。');
      }else{
        const sharedId=job.result.gallery[0],url=await VoidSharedGallery.fullData(sharedId);
        const file=job.result.images[0],meta={...job.request,sharedId,filename:file.filename,subfolder:file.subfolder||''};
        const title='改圖 · '+prompt.slice(0,32);
        main={url,title,meta};rounds.push(main);
        $('studio-prompt').value='';
        if(!dialog.hidden)$('studio-prompt').focus();
        void loadSavedGallery().catch(()=>{});
        status('已存入共用作品庫。可繼續修改，或回到舊版開分支。');
      }
    } catch (error) { status(error.message); }
    finally { busy = false; isGenerating = false; render(); }
  }
  $('studio-open').onclick = () => open();
  $('studio-last').onclick = () => {
    if (lastResult?.dataUrl) open({url:lastResult.dataUrl,title:'最近結果',meta:lastResult.meta});
    else status('目前沒有可用的生成結果。');
  };
  $('studio-clear-ref').onclick = () => { if (!busy) { reference = null; render(); } };
  const pickerDialog = $('studio-picker');
  let pickRole, pickerReturnView = 'create', pickRequest = 0, pickRows = [], pickLimit = 36;
  function renderPicker() {
    const query = $('studio-picker-search').value.trim().toLowerCase();
    const matches = pickRows.filter(row =>
      [row.title, row.meta?.filename, row.meta?.model, row.meta?.prompt]
        .some(value => String(value || '').toLowerCase().includes(query)));
    $('studio-picker-status').textContent = matches.length ? matches.length + ' 張作品' : '找不到符合的作品。';
    $('studio-picker-more').hidden = matches.length <= pickLimit;
    $('studio-picker-grid').replaceChildren(...matches.slice(0, pickLimit).map(row => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-pick';
      if (row.thumbUrl) {
        const img = document.createElement('img');
        img.src = row.thumbUrl;
        img.alt = '';
        img.loading = 'lazy';
        button.append(img);
      }
      const label = document.createElement('span');
      label.textContent = row.title || '未命名作品';
      button.append(label);
      button.onclick = async () => {
        const request = ++pickRequest;
        const role = pickRole;
        $('studio-picker-status').textContent = '讀取原圖…';
        try {
          const url = row.meta?.sharedId ? await VoidSharedGallery.fullData(row.meta.sharedId)
            : (await dbLoadById(row.id))?.dataUrl;
          if (request !== pickRequest || pickerDialog.hidden) return;
          if (!url) throw new Error('這張作品的原圖目前無法讀取。');
          navigate(pickerReturnView);
          if (role === 'main') void openCard(null, {...row,dataUrl:url});
          else if (role === 'ref') { reference = {url,title:label.textContent}; render(); }
          else if (role === 'img2img') await sendToI2IFromGallery(url);
          else if (role === 'img2txt') {
            navigate('create');
            setMode('img2txt');
            if (currentMode === 'img2txt') _load2txtFile(await (await fetch(url)).blob());
          }
        } catch (error) {
          if (request === pickRequest) $('studio-picker-status').textContent = error.message;
        }
      };
      return button;
    }));
  }
  async function openPicker(role) {
    if (busy) return;
    const request = ++pickRequest;
    pickRole = role;
    pickRows = [];
    pickLimit = 36;
    const titles = {main:'從作品庫選主圖',ref:'從作品庫選參考圖',img2img:'選擇圖生圖素材',img2txt:'選擇要辨識的圖片'};
    $('studio-picker-title').textContent = titles[role];
    $('studio-picker-grid').replaceChildren();
    $('studio-picker-search').value = '';
    $('studio-picker-more').hidden = true;
    $('studio-picker-status').textContent = '讀取作品庫…';
    pickerReturnView = document.body.dataset.fullView || 'create';
    navigate('picker');
    $('studio-picker-search').focus();
    const [local, shared] = await Promise.all([
      dbLoadGalleryList().catch(() => []), VoidSharedGallery.list().catch(() => null)
    ]);
    if (request !== pickRequest || pickerDialog.hidden) return;
    pickRows = shared ? VoidSharedGallery.merge(local, shared) : local;
    renderPicker();
  }
  $('studio-main-library').onclick = () => openPicker('main');
  $('studio-ref-library').onclick = () => openPicker('ref');
  $('full-i2i-library').onclick = () => openPicker('img2img');
  $('full-recognition-library').onclick = () => openPicker('img2txt');
  $('full-result-studio').onclick = () => {
    if (lastResult?.dataUrl) open({url:lastResult.dataUrl,title:'最近結果',meta:lastResult.meta});
    else setStatus('目前沒有可用的生成結果。', 'warn');
  };
  $('full-lightbox-studio').onclick = () => {
    const card = _lbCards[_lbIdx];
    if (!card) return;
    closeLightbox();
    void openCard(card);
  };
  $('studio-picker-search').oninput = () => { pickLimit = 36; renderPicker(); };
  $('studio-picker-more').onclick = () => { pickLimit += 36; renderPicker(); };
  $('studio-picker-back').onclick = () => { ++pickRequest; navigate(pickerReturnView); };
  $('studio-back').onclick = () => navigate('create');
  $('studio-mode').onchange = refreshModels;
  $('studio-refresh-models').onclick = refreshModels;
  $('studio-model').onchange = event => { selectedModels[$('studio-mode').value] = event.target.value; render(); };
  $('studio-edit').onclick = () => run(videoMode());
  $('studio-prompt').onkeydown = event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      if (!$('studio-edit').disabled) void run(videoMode());
    }
  };
  async function openCard(card, selected) {
    open();
    try {
      const url = card ? await _cardFullDataUrl(card) : selected.dataUrl;
      if (!url) throw new Error('無法讀取作品原圖。');
      let image = url;
      if (!url.startsWith('data:')) {
        const response = await fetch(url, {signal:AbortSignal.timeout(30000)});
        if (!response.ok) throw new Error('無法讀取作品原圖。');
        image = await read(await response.blob());
      }
      const meta = selected?.meta || _metaFromCard(card);
      if (meta?.editGroup && meta.editGroup !== groupId && !busy) {
        await saveProject();
        const list = await VoidSharedGallery.load(await dbLoadGalleryList().catch(() => []));
        if (busy) return;
        groupId = meta.editGroup;
        const saved = await projectOperation(false,store=>store.get(groupId)).catch(()=>null);
        $('studio-project-name').value = saved?.name || '';
        rounds.splice(0, rounds.length, ...list
          .filter(row => row.meta?.editGroup === groupId && row.meta.editId !== meta.editId && (row.id || row.meta.sharedId))
          .sort((a,b) => a.ts-b.ts));
        comparison = null;
      }
      open({url:image,title:selected?.title || card.querySelector('img')?.alt || '圖庫作品',meta});
    } catch (error) { status(error.message); }
  }
  $('studio-card').onclick = () => {
    if (!_ctxData) return;
    const selected = _ctxData;
    const card = [...document.querySelectorAll('.gallery-card')].find(item => item.dataset.favKey === selected.favKey);
    hideCtxMenu();
    void openCard(card, selected);
  };
  $('studio-board-toggle').onclick = () => {
    const wrapper = $('studio-canvas-wrap');
    wrapper.hidden = !wrapper.hidden;
    $('studio-board-toggle').setAttribute('aria-pressed', String(!wrapper.hidden));
    renderCanvas();
  };
  $('studio-compare').onclick = async () => {
    const other = comparison ? null : [...rounds].reverse().find(round => round !== main);
    try {
      if (other && !other.url) other.url = other.meta?.sharedId ? await VoidSharedGallery.fullData(other.meta.sharedId) : (await dbLoadById(other.id))?.dataUrl;
      if (other && !other.url) throw new Error('比較版本的原圖目前無法讀取。');
      comparison = other;
      render();
    } catch (error) { status(error.message); }
  };
  $('studio-template').onchange = event => {
    const templates = {
      outfit:'把主圖人物的服裝換成參考圖的款式與顏色，保留主圖的臉、髮型、姿勢、構圖與背景。',
      light:'把主圖改成柔和的傍晚光線，保留主體、服裝、姿勢和背景細節。',
      motion:'人物自然眨眼，頭髮隨微風吹動，鏡頭緩慢推近。'
    };
    if (templates[event.target.value]) $('studio-prompt').value = templates[event.target.value];
    event.target.value = '';
    queueProjectSave();
  };
  return {open, openCard, navigate, openPicker, addFile};
})();
