(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const terminal=new Set(['done','error','cancelled']);
  const titles={wan:'Wan 2.2',qwen:'Qwen',sd:'SD / SDXL',moss:'MOSS',klein:'Klein 9B',wd14:'WD14',florence:'Florence-2'};
  const states={queued:'等待執行',submitting:'正在提交',running:'執行中',done:'已完成',error:'失敗',cancelled:'已取消'};
  const defaults={qwen:{width:1024,height:1024,steps:25,cfg:1,sampler:'euler',scheduler:'simple'},sd:{width:1024,height:1024,steps:20,cfg:7,sampler:'euler_ancestral',scheduler:'karras'},moss:{width:512,height:512,steps:8,cfg:3,shift:5},klein:{width:512,height:512,steps:8,cfg:1}};
  let engine='qwen',catalog=null,online=false,status={},jobs=[],selectedImage=null,images=[],offset=0,favorites=false,refreshing=false,toastTimer,uploading=false;
  let generationMode='txt2img', editUpload='', editUploading=false, generationSubmitting=false;
  let motionSource=null, motionBusy=false;
  const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
  let preferences=load('void-pocket-generate',{}),uploadId=localStorage.getItem('void-pocket-upload')||'',lastRec=localStorage.getItem('void-pocket-caption')||'';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
  async function api(path,options={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try {const response=await fetch(path,{...options,signal:controller.signal});const text=await response.text();let data;try{data=text?JSON.parse(text):{};}catch{throw new Error(response.status===403?'請以你的 Tailscale 帳號連線':'服務回應異常，請重試');}if(!response.ok)throw new Error(data.error||`連線失敗（${response.status}）`);return data;}
    finally{clearTimeout(timer);}
  }
  const send=(path,data,method='POST')=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  function tab(name){if(!['generate','motion','recognize','gallery','jobs'].includes(name))name='generate';document.body.dataset.tab=name;document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active',page.id===name));document.querySelectorAll('nav button').forEach(button=>{button.classList.toggle('active',button.dataset.tab===name);button.setAttribute('aria-current',button.dataset.tab===name?'page':'false');});localStorage.setItem('void-pocket-tab',name);window.scrollTo({top:0});if(name==='gallery')loadGallery().catch(error=>toast(error.message));}
  function options(id,values,preferred,empty=false){const select=$(id);select.replaceChildren(...(empty?[new Option('不使用','')]:[]),...values.map(value=>new Option(value,value)));if([...select.options].some(option=>option.value===preferred))select.value=preferred;}
  const fields=['model','prompt','negative','steps','cfg','width','height','seed','sampler','scheduler','shift','lora','lora-strength','count'];
  function formData(){const data={engine,mode:generationMode};if(generationMode==='img2img'){data.upload=editUpload;data.kleinStrength=$('gen-klein-strength').value;}for(const field of fields)data[field==='lora-strength'?'loraStrength':field]=$('gen-'+field).value;return data;}
  function saveForm(){if(!catalog)return;preferences[engine]=formData();localStorage.setItem('void-pocket-generate',JSON.stringify(preferences));localStorage.setItem('void-pocket-gen-engine',engine);}
  function sizeLabel(){const width=Number($('gen-width').value),height=Number($('gen-height').value);$('size-label').textContent=`${width} × ${height}`;document.querySelectorAll('[data-ratio]').forEach(button=>button.classList.toggle('selected',button.dataset.ratio===(width===height?'square':width<height?'portrait':'landscape')));}
  function chooseEngine(next,remember=true){if(!defaults[next]||(generationMode==='img2img'&&next!=='klein'))return;if(remember)saveForm();engine=next;const values={...defaults[engine],seed:-1,count:1,...preferences[engine]};document.querySelectorAll('[data-engine]').forEach(button=>button.classList.toggle('selected',button.dataset.engine===engine));if(catalog){options('gen-model',catalog.models[engine]||[],values.model||(engine==='qwen'?'qwen-image-2.1-UC-Q4_K_M.gguf':engine==='moss'?'moss-image-sft-bf16.safetensors':''));options('gen-sampler',catalog.samplers,values.sampler);options('gen-scheduler',catalog.schedulers,values.scheduler);options('gen-lora',catalog.loras,values.lora,true);}for(const field of fields){if(['model','sampler','scheduler','lora'].includes(field))continue;const value=values[field==='lora-strength'?'loraStrength':field];if(value!==undefined)$('gen-'+field).value=value;}$('gen-width').step=$('gen-height').step=['moss','klein'].includes(engine)?'16':'32';$('native-sampler').hidden=['moss','klein'].includes(engine);$('moss-options').hidden=engine!=='moss';$('lora-options').hidden=engine!=='sd';for(const id of ['native-sampler','moss-options','lora-options'])$(id).querySelectorAll('input,select').forEach(input=>input.disabled=$(id).hidden);$('gen-hint').textContent=engine==='moss'?'MOSS 預設使用已跑通的 512 × 512、8 步。文字編碼較吃記憶體。':'任務交給電腦執行，圖片保存在電腦；多張會依序處理。';sizeLabel();localStorage.setItem('void-pocket-gen-engine',engine);updateButtons();}
  function ratio(name){const sizes=['moss','klein'].includes(engine)?{square:[512,512],portrait:[512,768],landscape:[768,512]}:{square:[1024,1024],portrait:[832,1216],landscape:[1216,832]};[$('gen-width').value,$('gen-height').value]=sizes[name];sizeLabel();saveForm();}
  function setGenerationMode(mode){
    const edit=mode==='img2img';
    generationMode=mode;
    $('mode-text').setAttribute('aria-pressed',String(!edit));
    $('mode-image').setAttribute('aria-pressed',String(edit));
    $('gen-source-settings').hidden=!edit;
    $('gen-klein-strength').disabled=!edit;
    $('gen-prompt').required=!edit;
    $('gen-prompt').placeholder=edit?'可留空，套用預設寫實轉換指令':'描述主體、場景、光線與你想要的風格…';
    document.querySelectorAll('[data-engine]').forEach(button=>button.disabled=edit&&button.dataset.engine!=='klein');
    if(edit&&engine!=='klein')chooseEngine('klein');
    updateButtons();
  }
  async function uploadEditSource(){
    const file=$('gen-source').files[0];
    if(!file||editUploading)return;
    editUploading=true;
    editUpload='';
    $('gen-source-preview').hidden=true;
    updateButtons();
    try{
      const body=new FormData();
      body.append('image',file);
      const result=await api('/api/upload',{method:'POST',body});
      editUpload=result.id;
      $('gen-source-preview').src=result.url;
      $('gen-source-preview').hidden=false;
      toast('來源圖片已上傳');
    }catch(error){toast(error.message);}
    finally{editUploading=false;$('gen-source').value='';updateButtons();}
  }
  function updateButtons(){$('motion-submit').disabled=!online||!catalog?.motion||!motionSource||motionBusy;const active=jobs.find(job=>job.id===lastRec&&!terminal.has(job.state));const edit=generationMode==='img2img';$('generate-submit').disabled=!online||!catalog?.models[engine]?.length||generationSubmitting||(edit&&(!catalog?.kleinEdit||!editUpload||editUploading));$('generate-submit').textContent=editUploading?'正在上傳…':generationSubmitting?'正在送出…':edit?'開始圖生圖 ↗':'開始生成 ↗';$('recognize-submit').disabled=!online||uploading||!uploadId||!!active||!catalog?.recognition[$('rec-engine').value];$('recognize-submit').textContent=uploading?'正在上傳…':active?'電腦辨識中 · 可至任務取消':'辨識提示詞 ↗';}
  function recSettings(){const selected=$('rec-engine').value;$('rec-qwen').hidden=selected!=='qwen';$('rec-wd14').hidden=selected!=='wd14';$('rec-florence').hidden=selected!=='florence';localStorage.setItem('void-pocket-recognition',JSON.stringify({engine:selected,style:$('rec-style').value,detail:$('rec-detail').value,instruction:$('rec-instruction').value}));updateButtons();}
  async function submitGeneration(event){event.preventDefault();if($('generate-submit').disabled)return;saveForm();generationSubmitting=true;updateButtons();try{const data=await send('/api/jobs',{kind:'generate',...formData()});toast(`已提交 ${data.ids.length} 個任務，電腦會繼續執行`);tab('jobs');await refresh();}catch(error){toast(error.message);}finally{generationSubmitting=false;updateButtons();}}
  async function uploadPhoto(){const file=$('rec-file').files[0];if(!file)return;uploading=true;uploadId='';localStorage.removeItem('void-pocket-upload');$('rec-preview').src=URL.createObjectURL(file);$('rec-preview').hidden=false;updateButtons();const body=new FormData();body.append('image',file);try{const result=await api('/api/upload',{method:'POST',body});uploadId=result.id;localStorage.setItem('void-pocket-upload',uploadId);const old=$('rec-preview').src;$('rec-preview').src=result.url;if(old.startsWith('blob:'))URL.revokeObjectURL(old);toast('圖片已存到電腦，可開始辨識');}catch(error){toast(error.message);}finally{uploading=false;updateButtons();}}
  async function submitRecognition(){if(!uploadId)return;try{const result=await send('/api/jobs',{kind:'caption',engine:$('rec-engine').value,upload:uploadId,style:$('rec-style').value,instruction:$('rec-instruction').value,detail:$('rec-detail').value,threshold:$('rec-threshold').value,character_threshold:$('rec-character').value});lastRec=result.ids[0];localStorage.setItem('void-pocket-caption',lastRec);$('rec-result').hidden=true;toast('已提交辨識，切換 App 後也可回來查看');await refresh();}catch(error){toast(error.message);}}
  function renderJobs(){const active=jobs.filter(job=>!terminal.has(job.state));$('jobs-count').textContent=`${active.length} 個執行中`;$('job-badge').hidden=!active.length;$('jobs-empty').hidden=!!jobs.length;const signature=JSON.stringify(jobs.map(job=>[job.id,job.state,job.updated,job.progress]));if($('jobs-list').dataset.signature!==signature){$('jobs-list').dataset.signature=signature;$('jobs-list').innerHTML=jobs.map(job=>{const pct=job.progress?.max?Math.min(100,job.progress.value/job.progress.max*100):0;return `<article class="job-card"><div class="job-head"><strong>${job.kind==='caption'?'圖片辨識':job.kind==='motion'?'影片生成':'圖片生成'} · ${esc(titles[job.engine])}</strong><span class="job-state ${job.state==='error'?'error':''}">${esc(states[job.state]||job.state)}</span></div><p class="excerpt">${esc(job.kind==='caption'?'照片與指令已交給電腦':job.request.prompt)}</p>${!terminal.has(job.state)?`<div class="progress"><span style="width:${pct}%"></span></div>`:''}${job.error?`<p class="error-message">${esc(job.error)}</p>`:''}<small>${new Date(job.created*1000).toLocaleString('zh-TW')}${job.result?.seconds?` · ${job.result.seconds} 秒`:''}${job.progress?.max&&!terminal.has(job.state)?` · ${job.progress.value}/${job.progress.max}`:''}</small><div class="job-actions">${!terminal.has(job.state)?`<button data-job-cancel="${job.id}">取消工作</button>`:`${job.state==='done'?`<button data-job-open="${job.id}">${job.kind==='caption'?'查看文字':job.kind==='motion'?'播放影片':'查看圖片'}</button>`:''}<button data-job-retry="${job.id}">再次執行</button>`}</div></article>`;}).join('');}
    const rec=jobs.find(job=>job.id===lastRec);if(rec?.state==='done'&&$('rec-result').dataset.job!==rec.id){$('rec-text').value=rec.result.text||'';$('rec-result-engine').textContent=`${titles[rec.engine]} · ${rec.result.seconds||''} 秒`;$('rec-result').hidden=false;$('rec-result').dataset.job=rec.id;}updateButtons();}
  async function refresh(){if(refreshing)return;refreshing=true;try{const [nextStatus,result]=await Promise.all([api('/api/status'),api('/api/jobs')]);status=nextStatus;online=!!status.online;jobs=result.jobs;if(!lastRec){lastRec=jobs.find(job=>job.kind==='caption')?.id||'';if(lastRec)localStorage.setItem('void-pocket-caption',lastRec);}if(!catalog&&online){catalog=await api('/api/catalog');chooseEngine(engine,false);for(const option of $('rec-engine').options)option.disabled=!catalog.recognition[option.value];}$('connection').className='connection '+(online?'online':'offline');$('connection').querySelector('span').textContent=online?(jobs.some(job=>!terminal.has(job.state))?'電腦執行中':'電腦已連線'):'ComfyUI 離線';$('device-name').textContent=status.device||'電腦上的 ComfyUI 尚未啟動';$('remote-info').textContent=status.remoteUrl||'私人網址尚未設定，請在電腦完成 Tailscale 登入及連線設定。';$('keep-awake').checked=!!status.keepAwake;renderJobs();}catch(error){online=false;$('connection').className='connection offline';$('connection').querySelector('span').textContent='電腦未連線';updateButtons();}finally{refreshing=false;}}
  async function loadGallery(more=false){try{if(!more){offset=0;images=[];}$('gallery-more').disabled=true;const query=new URLSearchParams({offset:String(offset),search:$('gallery-search').value,favorite:favorites?'1':'0',album:$('gallery-album').value});const result=await api('/api/gallery?'+query);images.push(...result.images);offset=images.length;$('gallery-grid').innerHTML=images.map(image=>`<button class="gallery-tile" data-image="${image.id}" aria-label="查看 ${esc(image.name)}"><img loading="lazy" src="${image.thumb}" alt="${esc(image.meta.prompt?.slice(0,100)||image.name)}"><p>${image.favorite?'♥ ':''}${esc(titles[image.meta.engine]||image.meta.model||image.name)}</p></button>`).join('');$('gallery-count').textContent=`${result.total} 張圖片 · 原圖儲存在電腦`;$('gallery-empty').hidden=result.total>0;$('gallery-more').hidden=offset>=result.total;if(result.albums){const previous=$('gallery-album').value;options('gallery-album',result.albums,previous,true);$('gallery-album').options[0].text='全部相簿';$('gallery-album').hidden=!result.albums.length;}}finally{$('gallery-more').disabled=false;}}
  async function openImage(id){let image=images.find(item=>item.id===id);if(!image){const result=await api('/api/gallery?search=');image=result.images.find(item=>item.id===id);if(!image){tab('gallery');toast('請在圖庫查看最新圖片');return;}}selectedImage=image;$('image-full').src=image.url;$('image-title').textContent=image.name;$('image-prompt').textContent=image.meta.prompt||'這張圖片沒有提示詞記錄';$('image-meta').textContent=[titles[image.meta.engine]||image.meta.model,`${image.meta.width} × ${image.meta.height}`,image.meta.steps?`${image.meta.steps} steps`:'',image.meta.seed!==undefined?`seed ${image.meta.seed}`:''].filter(Boolean).join(' · ');$('image-favorite').textContent=image.favorite?'♥ 已收藏':'♡ 收藏';$('image-download').href=image.url+'?download=1';$('image-download').download=image.name;$('image-dialog').showModal();}
  async function favoriteImage(){if(!selectedImage)return;const favorite=!selectedImage.favorite;await send('/api/gallery/'+selectedImage.id,{favorite},'PATCH');selectedImage.favorite=favorite?1:0;$('image-favorite').textContent=favorite?'♥ 已收藏':'♡ 收藏';if(document.body.dataset.tab==='gallery')await loadGallery();}
  function reuseImage(){const meta=selectedImage.meta;if(!catalog?.models[meta.engine]){toast('無法辨識這張圖片使用的引擎');return;}saveForm();setGenerationMode('txt2img');preferences[meta.engine]={...meta,shift:meta.mossShift||5,count:1,lora:meta.loras?.[0]?.name||'',loraStrength:meta.loras?.[0]?.strength??.8};chooseEngine(meta.engine,false);$('image-dialog').close();tab('generate');saveForm();toast('已套用提示詞與生成參數');}
  async function copy(text){try{await navigator.clipboard.writeText(text);}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw new Error('請選取文字手動複製');}toast('已複製');}
  async function jobAction(event){const cancel=event.target.closest('[data-job-cancel]'),retry=event.target.closest('[data-job-retry]'),open=event.target.closest('[data-job-open]');try{if(cancel){await send('/api/jobs/'+cancel.dataset.jobCancel+'/cancel',{});await refresh();}if(retry){const job=jobs.find(item=>item.id===retry.dataset.jobRetry);const result=await send('/api/jobs',{...job.request,kind:job.kind,count:1});if(job.kind==='caption'){lastRec=result.ids[0];localStorage.setItem('void-pocket-caption',lastRec);}toast('已重新加入任務');await refresh();}if(open){const job=jobs.find(item=>item.id===open.dataset.jobOpen);if(job.kind==='caption'){lastRec=job.id;localStorage.setItem('void-pocket-caption',lastRec);$('rec-result').dataset.job='';renderJobs();tab('recognize');$('rec-result').scrollIntoView({behavior:'smooth'});}else if(job.kind==='motion'){
      $('motion-player').src=job.result.url;
      $('motion-download').href=job.result.url+'?download=1';
      $('video-dialog').showModal();
    }else await openImage(job.result.gallery?.[0]);}}catch(error){toast(error.message);}}
  function setMotionSource(source, url){
    motionSource=source;
    $('motion-preview').src=url;
    $('motion-preview').hidden=false;
    updateButtons();
  }
  $('motion-gallery').onclick=()=>{tab('gallery');toast('開啟一張圖片，再點「用於 MOTION」');};
  const useMotion=document.createElement('button');
  useMotion.textContent='用於 MOTION ↗';
  useMotion.onclick=()=>{
    if(motionBusy||!selectedImage)return;
    setMotionSource({gallery:selectedImage.id},selectedImage.url);
    $('image-dialog').close();
    tab('motion');
  };
  $('image-reuse').after(useMotion);
  $('motion-file').onchange=async()=>{
    const file=$('motion-file').files[0];
    if(!file||motionBusy)return;
    motionBusy=true;
    updateButtons();
    const body=new FormData();
    body.append('image',file);
    try{
      const result=await api('/api/upload',{method:'POST',body});
      setMotionSource({upload:result.id},result.url);
    }catch(error){toast(error.message);}
    finally{motionBusy=false;$('motion-file').value='';updateButtons();}
  };
  $('motion-form').onsubmit=async event=>{
    event.preventDefault();
    if($('motion-submit').disabled)return;
    motionBusy=true;
    updateButtons();
    try{
      await send('/api/jobs',{kind:'motion',...motionSource,prompt:$('motion-prompt').value,
        size:$('motion-size').value,seconds:Number($('motion-seconds').value)});
      toast('已送交電腦生成影片');
      tab('jobs');
      await refresh();
    }catch(error){toast(error.message);}
    finally{motionBusy=false;updateButtons();}
  };
  $('video-dialog').addEventListener('close',()=>{$('motion-player').pause();});
  document.querySelectorAll('nav button').forEach(button=>button.addEventListener('click',()=>tab(button.dataset.tab)));
  document.querySelectorAll('[data-engine]').forEach(button=>button.addEventListener('click',()=>chooseEngine(button.dataset.engine)));
  document.querySelectorAll('[data-ratio]').forEach(button=>button.addEventListener('click',()=>ratio(button.dataset.ratio)));
  $('mode-text').addEventListener('click',()=>setGenerationMode('txt2img'));
  $('mode-image').addEventListener('click',()=>setGenerationMode('img2img'));
  $('gen-source').addEventListener('change',uploadEditSource);
  $('gen-klein-strength').disabled=true;
  $('generate-form').addEventListener('invalid',event=>{event.preventDefault();const field=event.target;const details=field.closest('details');if(details)details.open=true;const label=document.querySelector('label[for="'+field.id+'"]');toast((label?.textContent||'生成設定')+'：'+field.validationMessage);field.focus();},true);
  $('generate-form').addEventListener('submit',submitGeneration);$('generate-form').addEventListener('change',()=>{sizeLabel();saveForm();});
  $('rec-file').addEventListener('change',uploadPhoto);$('recognize-submit').addEventListener('click',submitRecognition);
  for(const id of ['rec-engine','rec-style','rec-detail','rec-instruction'])$(id).addEventListener('change',recSettings);
  $('copy-caption').addEventListener('click',()=>copy($('rec-text').value).catch(error=>toast(error.message)));
  $('use-caption').addEventListener('click',()=>{$('gen-prompt').value=$('rec-text').value;saveForm();tab('generate');toast('已填入生成提示詞');});
  $('jobs-list').addEventListener('click',jobAction);$('gallery-grid').addEventListener('click',event=>{const tile=event.target.closest('[data-image]');if(tile)openImage(tile.dataset.image).catch(error=>toast(error.message));});
  $('gallery-refresh').addEventListener('click',()=>loadGallery().catch(error=>toast(error.message)));$('gallery-more').addEventListener('click',()=>loadGallery(true).catch(error=>toast(error.message)));
  let searchTimer;$('gallery-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadGallery().catch(error=>toast(error.message)),350);});
  $('gallery-album').addEventListener('change',()=>loadGallery().catch(error=>toast(error.message)));
  $('favorites').addEventListener('click',()=>{favorites=!favorites;$('favorites').setAttribute('aria-pressed',String(favorites));loadGallery().catch(error=>toast(error.message));});
  $('connection').addEventListener('click',()=>{$('settings-dialog').showModal();refresh();});document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('keep-awake').addEventListener('change',async()=>{try{await send('/api/settings',{keepAwake:$('keep-awake').checked},'PATCH');toast('已更新電腦連線設定');}catch(error){toast(error.message);}});
  $('copy-url').addEventListener('click',()=>{if(!status.remoteUrl){toast('請先在電腦完成 Tailscale 設定');return;}copy(status.remoteUrl).catch(error=>toast(error.message));});
  $('image-favorite').addEventListener('click',()=>favoriteImage().catch(error=>toast(error.message)));$('image-reuse').addEventListener('click',reuseImage);
  $('image-share').addEventListener('click',async()=>{try{const response=await fetch(selectedImage.url);const file=new File([await response.blob()],selectedImage.name,{type:response.headers.get('Content-Type')||'image/png'});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else toast('此瀏覽器請先下載圖片，再從相簿分享');}catch(error){if(error.name!=='AbortError')toast('分享失敗，請改用下載');}});
  const recSaved=load('void-pocket-recognition',{});for(const [key,id]of Object.entries({engine:'rec-engine',style:'rec-style',detail:'rec-detail',instruction:'rec-instruction'}))if(recSaved[key])$(id).value=recSaved[key];recSettings();
  if(uploadId){$('rec-preview').src='/upload/'+uploadId;$('rec-preview').hidden=false;}
  engine=localStorage.getItem('void-pocket-gen-engine')||'qwen';if(!defaults[engine])engine='qwen';chooseEngine(engine,false);tab(localStorage.getItem('void-pocket-tab')||'generate');refresh();
  setInterval(()=>{if(!document.hidden)refresh();},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();if(document.body.dataset.tab==='gallery')loadGallery().catch(()=>{});}});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();
