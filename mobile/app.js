(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const terminal=new Set(['done','error','cancelled']);
  const titles={wan:'Wan 2.2',qwen:'Qwen',sd:'SD / SDXL',moss:'MOSS',moody:'Moody Moss Mix',klein:'Klein 9B',wd14:'WD14',florence:'Florence-2'};
  const states={queued:'等待執行',submitting:'正在提交',running:'執行中',done:'已完成',error:'失敗',cancelled:'已取消'};
  const jobPhases={saving:'正在存檔',preparing:'載入模型／準備素材',generating:'生成中'};
  const defaults={qwen:{width:1024,height:1024,steps:25,cfg:1,sampler:'euler',scheduler:'simple'},sd:{width:1024,height:1024,steps:20,cfg:7,sampler:'euler_ancestral',scheduler:'karras'},moody:{width:1024,height:1024,steps:25,cfg:3,sampler:'euler',scheduler:'simple'},moss:{width:512,height:512,steps:8,cfg:3,shift:5},klein:{width:512,height:512,steps:8,cfg:1}};
  let engine='qwen',catalog=null,online=false,status={},jobs=[],selectedImage=null,images=[],offset=0,favorites=false,refreshing=false,toastTimer,uploading=false;
  let generationMode='txt2img', editUpload='', editUploading=false, generationSubmitting=false;
  let motionSource=null, motionBusy=false, imageOpenVersion=0;
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
  function tab(name){if(name!=='image-dialog')++imageOpenVersion;if(!['generate','motion','recognize','gallery','jobs','rng','image-dialog','video-dialog','settings-dialog'].includes(name))name='generate';if(document.body.dataset.tab==='video-dialog'&&name!=='video-dialog')$('motion-player').pause();if(name!=='gallery'){galleryRole='';resetTrashSelection();$('gallery-pick-context').hidden=true;}document.body.dataset.tab=name;document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active',page.id===name));document.querySelectorAll('nav button').forEach(button=>{button.classList.toggle('active',button.dataset.tab===name);button.setAttribute('aria-current',button.dataset.tab===name?'page':'false');});if(!name.endsWith('-dialog'))localStorage.setItem('void-pocket-tab',name);if(name==='rng')void loadRng();window.scrollTo({top:0});if(name==='gallery')loadGallery().catch(error=>toast(error.message));}
  function options(id,values,preferred,empty=false){const select=$(id);select.replaceChildren(...(empty?[new Option('不使用','')]:[]),...values.map(value=>new Option(value,value)));if([...select.options].some(option=>option.value===preferred))select.value=preferred;}
  const fields=['model','prompt','negative','steps','cfg','width','height','seed','sampler','scheduler','shift','lora','lora-strength','count'];
  const supportsEdit=candidate=>continuous()?candidate==='klein':['sd','klein'].includes(candidate);
  const currentModels=()=>generationMode==='img2img'&&engine==='sd'?catalog?.sdEditModels||[]:catalog?.models[engine]||[];
  function formData(){const data={engine,mode:generationMode};if(generationMode==='img2img'){data.upload=editUpload;if(engine==='klein')data.kleinStrength=$('gen-klein-strength').value;else data.denoise=$('gen-denoise').value;if(continuous())Object.assign(data,{continuous:true,referenceUpload,editGroup,parent:editParent});}for(const field of fields)data[field==='lora-strength'?'loraStrength':field]=$('gen-'+field).value;return data;}
  function saveForm(){if(!catalog)return;preferences[engine]=formData();localStorage.setItem('void-pocket-generate',JSON.stringify(preferences));localStorage.setItem('void-pocket-gen-engine',engine);}
  function sizeLabel(){const width=Number($('gen-width').value),height=Number($('gen-height').value);$('size-label').textContent=`${width} × ${height}`;document.querySelectorAll('[data-ratio]').forEach(button=>button.classList.toggle('selected',button.dataset.ratio===(width===height?'square':width<height?'portrait':'landscape')));}
  function chooseEngine(next,remember=true){if(!defaults[next]||(generationMode==='img2img'&&!supportsEdit(next)))return;if(remember)saveForm();engine=next;const values={...defaults[engine],seed:-1,count:1,...preferences[engine]};document.querySelectorAll('[data-engine]').forEach(button=>button.classList.toggle('selected',button.dataset.engine===engine));if(catalog){options('gen-model',currentModels(),values.model||(engine==='qwen'?'qwen-image-2.1-UC-Q4_K_M.gguf':engine==='moss'?'moss-image-sft-bf16.safetensors':''));options('gen-sampler',catalog.samplers,values.sampler);options('gen-scheduler',catalog.schedulers,values.scheduler);options('gen-lora',catalog.loras,values.lora,true);}for(const field of fields){if(['model','sampler','scheduler','lora'].includes(field))continue;const value=values[field==='lora-strength'?'loraStrength':field];if(value!==undefined)$('gen-'+field).value=value;}$('gen-width').step=$('gen-height').step=['moss','klein','moody'].includes(engine)?'16':'32';$('native-sampler').hidden=['moss','klein'].includes(engine);$('moss-options').hidden=engine!=='moss';$('lora-options').hidden=engine!=='sd';for(const id of ['native-sampler','moss-options','lora-options'])$(id).querySelectorAll('input,select').forEach(input=>input.disabled=$(id).hidden);$('gen-hint').textContent=engine==='moody'?'Moody Moss Mix V4.1 · 1024 × 1024、25 步、CFG 3。':engine==='moss'?'MOSS 預設使用已跑通的 512 × 512、8 步。文字編碼較吃記憶體。':'任務交給電腦執行，圖片保存在電腦；多張會依序處理。';if(engine==='sd')$('gen-denoise').value=values.denoise??.55;sizeLabel();localStorage.setItem('void-pocket-gen-engine',engine);syncContinuous();}
  function ratio(name){const sizes=['moss','klein'].includes(engine)?{square:[512,512],portrait:[512,768],landscape:[768,512]}:{square:[1024,1024],portrait:[832,1216],landscape:[1216,832]};[$('gen-width').value,$('gen-height').value]=sizes[name];sizeLabel();saveForm();}
  function setGenerationMode(mode){
    const edit=mode==='img2img';
    if(generationMode!==mode)saveForm();
    generationMode=mode;
    $('mode-text').setAttribute('aria-pressed',String(!edit));
    $('mode-image').setAttribute('aria-pressed',String(edit));
    $('gen-source-settings').hidden=!edit;
    if(edit&&!supportsEdit(engine))chooseEngine(continuous()?'klein':catalog?.sdEdit?'sd':'klein',false);
    else chooseEngine(engine,false);
    syncContinuous();
  }
  function uploadEditSource(){
    const input=$('gen-source');
    void selectEditImage('main',input.files[0]);
    input.value='';
  }
  function updateButtons(){$('motion-submit').disabled=!online||!catalog?.motion||!motionSource||motionBusy;const active=jobs.find(job=>job.id===lastRec&&!terminal.has(job.state));const edit=generationMode==='img2img';$('generate-submit').disabled=!online||!currentModels().length||generationSubmitting||(edit&&(!(continuous()?catalog?.kleinContinuous:engine==='sd'?catalog?.sdEdit:catalog?.kleinEdit)||!editUpload||editUploading));$('generate-submit').textContent=editUploading?'正在上傳…':generationSubmitting?'正在送出…':edit?'開始圖生圖 ↗':'開始生成 ↗';$('recognize-submit').disabled=!online||uploading||!uploadId||!!active||!catalog?.recognition[$('rec-engine').value];$('recognize-submit').textContent=uploading?'正在上傳…':active?'電腦辨識中 · 可至任務取消':'辨識提示詞 ↗';}
  function recSettings(){const selected=$('rec-engine').value;$('rec-qwen').hidden=selected!=='qwen';$('rec-wd14').hidden=selected!=='wd14';$('rec-florence').hidden=selected!=='florence';localStorage.setItem('void-pocket-recognition',JSON.stringify({engine:selected,style:$('rec-style').value,detail:$('rec-detail').value,instruction:$('rec-instruction').value}));updateButtons();}
  async function submitGeneration(event){event.preventDefault();if($('generate-submit').disabled)return;saveForm();generationSubmitting=true;updateButtons();try{const form=formData();if(form.continuous&&maskPainted)form.maskUpload=await uploadMask();const data=await send('/api/jobs',{kind:'generate',...form});toast(`已提交 ${data.ids.length} 個任務，電腦會繼續執行`);tab('jobs');await refresh();}catch(error){toast(error.message);}finally{generationSubmitting=false;updateButtons();}}
  async function uploadPhoto(file){if(!file||uploading)return;uploading=true;uploadId='';localStorage.removeItem('void-pocket-upload');$('rec-preview').src=URL.createObjectURL(file);$('rec-preview').hidden=false;updateButtons();const body=new FormData();body.append('image',file,file.name||'clipboard.png');try{const result=await api('/api/upload',{method:'POST',body});uploadId=result.id;localStorage.setItem('void-pocket-upload',uploadId);const old=$('rec-preview').src;$('rec-preview').src=result.url;if(old.startsWith('blob:'))URL.revokeObjectURL(old);toast('圖片已存到電腦，可開始辨識');}catch(error){toast(error.message);}finally{uploading=false;updateButtons();}}
  async function submitRecognition(){if(!uploadId)return;try{const result=await send('/api/jobs',{kind:'caption',engine:$('rec-engine').value,upload:uploadId,style:$('rec-style').value,instruction:$('rec-instruction').value,detail:$('rec-detail').value,threshold:$('rec-threshold').value,character_threshold:$('rec-character').value});lastRec=result.ids[0];localStorage.setItem('void-pocket-caption',lastRec);$('rec-result').hidden=true;toast('已提交辨識，切換 App 後也可回來查看');await refresh();}catch(error){toast(error.message);}}
  function renderJobs(){const active=jobs.filter(job=>!terminal.has(job.state));$('jobs-count').textContent=`${active.length} 個執行中`;$('job-badge').hidden=!active.length;$('jobs-empty').hidden=!!jobs.length;const signature=JSON.stringify(jobs.map(job=>[job.id,job.state,job.updated,job.progress]));if($('jobs-list').dataset.signature!==signature){$('jobs-list').dataset.signature=signature;$('jobs-list').innerHTML=jobs.map(job=>{const pct=job.progress?.max?Math.min(100,job.progress.value/job.progress.max*100):0;return `<article class="job-card"><div class="job-head"><strong>${job.kind==='caption'?'圖片辨識':job.kind==='motion'?'影片生成':'圖片生成'} · ${esc(titles[job.engine])}</strong><span class="job-state ${job.state==='error'?'error':''}">${esc((job.state==='running'&&jobPhases[job.progress?.phase])||states[job.state]||job.state)}</span></div><p class="excerpt">${esc(job.kind==='caption'?'照片與指令已交給電腦':job.request.prompt)}</p>${!terminal.has(job.state)?`<div class="progress"><span style="width:${pct}%"></span></div>`:''}${job.error?`<p class="error-message">${esc(job.error)}</p>`:''}<small>${new Date(job.created*1000).toLocaleString('zh-TW')}${job.result?.seconds?` · ${job.result.seconds} 秒`:''}${job.progress?.max&&!terminal.has(job.state)?` · ${job.progress.value}/${job.progress.max}`:''}</small><div class="job-actions">${!terminal.has(job.state)?`<button data-job-cancel="${job.id}">取消工作</button>`:`${job.state==='done'?`<button data-job-open="${job.id}">${job.kind==='caption'?'查看文字':job.kind==='motion'?'播放影片':'查看圖片'}</button>`:''}<button data-job-retry="${job.id}">再次執行</button>`}</div></article>`;}).join('');}
    const rec=jobs.find(job=>job.id===lastRec);if(rec?.state==='done'&&$('rec-result').dataset.job!==rec.id){$('rec-text').value=rec.result.text||'';$('rec-result-engine').textContent=`${titles[rec.engine]} · ${rec.result.seconds||''} 秒`;$('rec-result').hidden=false;$('rec-result').dataset.job=rec.id;}updateButtons();}
  async function refresh(){if(refreshing)return;refreshing=true;try{const [nextStatus,result]=await Promise.all([api('/api/status'),api('/api/jobs')]);status=nextStatus;online=!!status.online;jobs=result.jobs;if(!lastRec){lastRec=jobs.find(job=>job.kind==='caption')?.id||'';if(lastRec)localStorage.setItem('void-pocket-caption',lastRec);}if(!catalog&&online){catalog=await api('/api/catalog');chooseEngine(engine,false);for(const option of $('rec-engine').options)option.disabled=!catalog.recognition[option.value];}$('connection').className='connection '+(online?'online':'offline');$('connection').querySelector('span').textContent=online?(jobs.some(job=>!terminal.has(job.state))?'電腦執行中':'電腦已連線'):'ComfyUI 離線';$('device-name').textContent=status.device||'電腦上的 ComfyUI 尚未啟動';$('remote-info').textContent=status.remoteUrl||'私人網址尚未設定，請在電腦完成 Tailscale 登入及連線設定。';$('keep-awake').checked=!!status.keepAwake;renderJobs();}catch(error){online=false;$('connection').className='connection offline';$('connection').querySelector('span').textContent='電腦未連線';updateButtons();}finally{refreshing=false;}}
  async function loadGallery(more=false){try{if(!more){offset=0;images=[];}$('gallery-more').disabled=true;const query=new URLSearchParams({offset:String(offset),search:$('gallery-search').value,favorite:favorites?'1':'0',album:$('gallery-album').value});const result=await api('/api/gallery?'+query);images.push(...result.images);offset=images.length;$('gallery-grid').innerHTML=images.map(image=>`<button class="gallery-tile" data-image="${image.id}" aria-label="查看 ${esc(image.name)}"><img loading="lazy" src="${image.thumb}" alt="${esc(image.meta.prompt?.slice(0,100)||image.name)}"><p>${image.favorite?'♥ ':''}${esc(titles[image.meta.engine]||image.meta.model||image.name)}</p></button>`).join('');$('gallery-count').textContent=`${result.total} 張圖片 · 原圖儲存在電腦`;$('gallery-empty').hidden=result.total>0;$('gallery-more').hidden=offset>=result.total;if(result.albums){const previous=$('gallery-album').value;options('gallery-album',result.albums,previous,true);$('gallery-album').options[0].text='全部相簿';$('gallery-album').hidden=!result.albums.length;}renderTrashSelection();}finally{$('gallery-more').disabled=false;}}
  async function openImage(id){const version=++imageOpenVersion;let image=images.find(item=>item.id===id);if(!image){image=await api('/api/gallery/'+encodeURIComponent(id));if(!image){tab('gallery');toast('請在圖庫查看最新圖片');return;}}if(version!==imageOpenVersion)return;if(galleryRole){const role=galleryRole;if(role==='motion'){setMotionSource({gallery:image.id},image.url);tab('motion');}else if(role==='recognize'){await recognizeGalleryImage(image);}else await selectEditImage(role,null,image);return;}selectedImage=image;$('image-rating').value=String(image.meta.rating||0);$('image-tags').value=(image.meta.tags||[]).join(', ');$('image-albums').value=(image.meta.albums||[]).join(', ');$('image-full').removeAttribute('src');$('image-full').src=image.url;$('image-title').textContent=image.name;$('image-prompt').textContent=image.meta.prompt||'這張圖片沒有提示詞記錄';$('image-meta').textContent=[titles[image.meta.engine]||image.meta.model,`${image.meta.width} × ${image.meta.height}`,image.meta.steps?`${image.meta.steps} steps`:'',image.meta.seed!==undefined?`seed ${image.meta.seed}`:''].filter(Boolean).join(' · ');$('image-favorite').textContent=image.favorite?'♥ 已收藏':'♡ 收藏';$('image-download').href=image.url+(image.url.includes('?')?'&':'?')+'download=1';$('image-download').download=image.name;tab('image-dialog');void showVersions(image).catch(error=>toast(error.message));}
  async function favoriteImage(){if(!selectedImage)return;const favorite=!selectedImage.favorite;await send('/api/gallery/'+selectedImage.id,{favorite},'PATCH');selectedImage.favorite=favorite?1:0;$('image-favorite').textContent=favorite?'♥ 已收藏':'♡ 收藏';if(document.body.dataset.tab==='gallery')await loadGallery();}
  function reuseImage(){const meta=selectedImage.meta;if(!catalog?.models[meta.engine]?.length){toast('無法辨識這張圖片使用的引擎');return;}const missing=[meta.model&&!catalog.models[meta.engine].includes(meta.model)?'模型 '+meta.model:'',...(meta.loras||[]).filter(lora=>!catalog.loras.includes(lora.name)).map(lora=>'LoRA '+lora.name),meta.sampler&&!catalog.samplers.includes(meta.sampler)?'採樣器 '+meta.sampler:'',meta.scheduler&&meta.scheduler!=='Flux2Scheduler'&&!catalog.schedulers.includes(meta.scheduler)?'排程器 '+meta.scheduler:''];const multiple=['sd','qwen'].includes(meta.engine)?32:16;if([meta.width,meta.height].some(n=>n&&(n<256||n>2048||n%multiple)))missing.push('解析度');if(missing.some(Boolean)){toast('配方有無法使用的設定：'+missing.filter(Boolean).join('、'));return;}saveForm();setGenerationMode('txt2img');preferences[meta.engine]={...meta,shift:meta.mossShift||5,count:1,lora:meta.loras?.[0]?.name||'',loraStrength:meta.loras?.[0]?.strength??.8};chooseEngine(meta.engine,false);tab('generate');saveForm();toast('已套用提示詞與生成參數');}
  async function copy(text){try{await navigator.clipboard.writeText(text);}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw new Error('請選取文字手動複製');}toast('已複製');}
  async function jobAction(event){const cancel=event.target.closest('[data-job-cancel]'),retry=event.target.closest('[data-job-retry]'),open=event.target.closest('[data-job-open]');try{if(cancel){await send('/api/jobs/'+cancel.dataset.jobCancel+'/cancel',{});await refresh();}if(retry){const job=jobs.find(item=>item.id===retry.dataset.jobRetry);const result=await send('/api/jobs',{kind:'retry',jobId:job.id});if(job.kind==='caption'){lastRec=result.ids[0];localStorage.setItem('void-pocket-caption',lastRec);}toast('已重新加入任務');await refresh();}if(open){const job=jobs.find(item=>item.id===open.dataset.jobOpen);if(job.kind==='caption'){lastRec=job.id;localStorage.setItem('void-pocket-caption',lastRec);$('rec-result').dataset.job='';renderJobs();tab('recognize');$('rec-result').scrollIntoView({behavior:'smooth'});}else if(job.kind==='motion'){
      openVideo(job,'jobs');
    }else await openImage(job.result.gallery?.[0]);}}catch(error){toast(error.message);}}
  function setMotionSource(source, url){
    motionSource=source;
    $('motion-preview').src=url;
    $('motion-preview').hidden=false;
    updateButtons();
  }
  let playingJob=null, videoReturn='jobs';
  function openVideo(job, from){
    playingJob=job;videoReturn=from;
    $('motion-actual').textContent='讀取影片尺寸…';
    $('motion-description').textContent=job.request.prompt||'';
    $('motion-original').hidden=!job.request.gallery;
    $('motion-player').src=job.result.url;
    $('motion-download').href=job.result.url+'?download=1';
    tab('video-dialog');
  }
  $('motion-player').onloadedmetadata=event=>{
    const video=event.currentTarget;
    $('motion-actual').textContent=video.videoWidth+' × '+video.videoHeight+' · '+video.duration.toFixed(2)+' 秒';
  };
  $('motion-reuse').onclick=()=>{
    const data=playingJob?.request;
    if(!data)return;
    const source=data.gallery?{gallery:data.gallery}:{upload:data.upload};
    setMotionSource(source,data.gallery?'/media/'+data.gallery:'/upload/'+data.upload);
    $('motion-prompt').value=data.prompt;$('motion-size').value=data.size;
    $('motion-seconds').value=String(data.seconds);$('motion-edge').value=data.shortEdge||'';
    tab('motion');
  };
  $('motion-original').onclick=()=>{if(playingJob?.request.gallery)void openImage(playingJob.request.gallery).catch(error=>toast(error.message));};
  $('motion-capture').onclick=()=>{
    const video=$('motion-player');
    if(video.readyState<2){toast('請等影片載入後再擷取');return;}
    video.pause();
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0);
    canvas.toBlob(blob=>{
      if(!blob){toast('無法擷取畫面');return;}
      setGenerationMode('img2img');tab('generate');
      void selectEditImage('main',new File([blob],'video-frame.png',{type:'image/png'}));
    },'image/png');
  };
  $('gallery-videos').addEventListener('toggle',async()=>{
    if(!$('gallery-videos').open)return;
    const list=$('gallery-video-list');
    try{
      const {jobs:records}=await api('/api/jobs?kind=motion&state=done');
      list.replaceChildren(...records.map(job=>{
        const card=document.createElement('button');card.type='button';card.className='wide';
        card.textContent='▶ '+(job.request.prompt||'影片').slice(0,90)+' · '+new Date(job.created*1000).toLocaleDateString();
        card.onclick=()=>openVideo(job,'gallery');return card;
      }));
      if(!records.length)list.textContent='尚無影片作品';
    }catch(error){list.textContent=error.message;}
  });
  const useMotion=document.createElement('button');
  useMotion.textContent='用於 MOTION ↗';
  useMotion.onclick=()=>{
    if(motionBusy||!selectedImage)return;
    setMotionSource({gallery:selectedImage.id},selectedImage.url);

    tab('motion');
  };
  $('image-reuse').after(useMotion);
  async function uploadMotion(file){
    if(!file||motionBusy)return;
    motionBusy=true;
    updateButtons();
    const body=new FormData();
    body.append('image',file,file.name||'clipboard.png');
    try{
      const result=await api('/api/upload',{method:'POST',body});
      setMotionSource({upload:result.id},result.url);
    }catch(error){toast(error.message);}
    finally{motionBusy=false;$('motion-file').value='';updateButtons();}
  }
  $('motion-file').onchange=event=>void uploadMotion(event.target.files[0]);
  $('motion-form').onsubmit=async event=>{
    event.preventDefault();
    if($('motion-submit').disabled)return;
    motionBusy=true;
    updateButtons();
    try{
      await send('/api/jobs',{kind:'motion',...motionSource,prompt:$('motion-prompt').value,
        size:$('motion-size').value,seconds:Number($('motion-seconds').value),shortEdge:Number($('motion-edge').value)||null});
      toast('已送交電腦生成影片');
      tab('jobs');
      await refresh();
    }catch(error){toast(error.message);}
    finally{motionBusy=false;updateButtons();}
  };

  document.querySelectorAll('nav button').forEach(button=>button.addEventListener('click',()=>tab(button.dataset.tab)));
  document.querySelectorAll('[data-engine]').forEach(button=>button.addEventListener('click',()=>chooseEngine(button.dataset.engine)));
  document.querySelectorAll('[data-ratio]').forEach(button=>button.addEventListener('click',()=>ratio(button.dataset.ratio)));
  $('mode-text').addEventListener('click',()=>setGenerationMode('txt2img'));
  $('mode-image').addEventListener('click',()=>setGenerationMode('img2img'));
  $('gen-source').addEventListener('change',uploadEditSource);
  $('gen-klein-strength').disabled=true;
  $('generate-form').addEventListener('invalid',event=>{event.preventDefault();const field=event.target;const details=field.closest('details');if(details)details.open=true;const label=document.querySelector('label[for="'+field.id+'"]');toast((label?.textContent||'生成設定')+'：'+field.validationMessage);field.focus();},true);
  $('generate-form').addEventListener('submit',submitGeneration);$('generate-form').addEventListener('change',()=>{sizeLabel();saveForm();});
  $('rec-file').addEventListener('change',event=>{void uploadPhoto(event.target.files[0]);event.target.value='';});$('recognize-submit').addEventListener('click',submitRecognition);
  for(const id of ['rec-engine','rec-style','rec-detail','rec-instruction'])$(id).addEventListener('change',recSettings);
  $('copy-caption').addEventListener('click',()=>copy($('rec-text').value).catch(error=>toast(error.message)));
  $('use-caption').addEventListener('click',()=>{$('gen-prompt').value=$('rec-text').value;saveForm();tab('generate');toast('已填入生成提示詞');});
  $('jobs-list').addEventListener('click',jobAction);$('gallery-grid').addEventListener('click',event=>{const tile=event.target.closest('[data-image]');if(!tile||trashBusy)return;
    if(selectingTrash&&!galleryRole){
      const id=tile.dataset.image;
      if(selectedForTrash.has(id))selectedForTrash.delete(id);
      else {
        const image=images.find(row=>row.id===id);
        if(image)selectedForTrash.set(id,image);
      }
      $('gallery-trash-confirm').hidden=true;
      renderTrashSelection();
      return;
    }
    openImage(tile.dataset.image).catch(error=>toast(error.message));});
  $('gallery-refresh').addEventListener('click',()=>loadGallery().catch(error=>toast(error.message)));$('gallery-more').addEventListener('click',()=>loadGallery(true).catch(error=>toast(error.message)));
  let searchTimer;$('gallery-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadGallery().catch(error=>toast(error.message)),350);});
  $('gallery-album').addEventListener('change',()=>loadGallery().catch(error=>toast(error.message)));
  $('favorites').addEventListener('click',()=>{favorites=!favorites;$('favorites').setAttribute('aria-pressed',String(favorites));loadGallery().catch(error=>toast(error.message));});
  $('connection').addEventListener('click',()=>{tab('settings-dialog');refresh();});document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>tab({'image-dialog':'gallery','video-dialog':videoReturn,'settings-dialog':localStorage.getItem('void-pocket-tab')||'generate'}[button.dataset.close])));
  $('keep-awake').addEventListener('change',async()=>{try{await send('/api/settings',{keepAwake:$('keep-awake').checked},'PATCH');toast('已更新電腦連線設定');}catch(error){toast(error.message);}});
  $('copy-url').addEventListener('click',()=>{if(!status.remoteUrl){toast('請先在電腦完成 Tailscale 設定');return;}copy(status.remoteUrl).catch(error=>toast(error.message));});
  $('image-favorite').addEventListener('click',()=>favoriteImage().catch(error=>toast(error.message)));$('image-reuse').addEventListener('click',reuseImage);
  $('image-share').addEventListener('click',async()=>{try{const response=await fetch(selectedImage.url);const file=new File([await response.blob()],selectedImage.name,{type:response.headers.get('Content-Type')||'image/png'});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else toast('此瀏覽器請先下載圖片，再從相簿分享');}catch(error){if(error.name!=='AbortError')toast('分享失敗，請改用下載');}});
  const selectedForTrash = new Map();
  let selectingTrash = false, trashBusy = false;
  function renderTrashSelection(){
    $('gallery-select').hidden=!!galleryRole;
    $('gallery-recycle').hidden=$('gallery-videos').hidden=!!galleryRole;
    $('gallery-select').disabled=trashBusy;
    $('gallery-select').setAttribute('aria-pressed',String(selectingTrash));
    $('gallery-select').textContent=selectingTrash?'取消選取':'選取圖片';
    $('gallery-selection').hidden=!selectingTrash||!!galleryRole;
    $('gallery-selection-count').textContent='已選 '+selectedForTrash.size+' 張';
    $('gallery-review-trash').disabled=trashBusy||!selectedForTrash.size;
    $('gallery-cancel-trash').disabled=trashBusy;
    $('gallery-trash-selected').disabled=trashBusy||!selectedForTrash.size;
    $('gallery-trash-selected').textContent=trashBusy?'處理中…':'確認移除';
    for(const tile of $('gallery-grid').querySelectorAll('[data-image]')){
      if(selectingTrash&&!galleryRole)tile.setAttribute('aria-pressed',String(selectedForTrash.has(tile.dataset.image)));
      else tile.removeAttribute('aria-pressed');
    }
  }
  function resetTrashSelection(){
    if(trashBusy)return;
    selectingTrash=false;
    selectedForTrash.clear();
    $('gallery-trash-confirm').hidden=true;
    renderTrashSelection();
  }
  $('gallery-select').onclick=()=>{
    if(selectingTrash){resetTrashSelection();return;}
    selectingTrash=true;
    renderTrashSelection();
  };
  $('gallery-review-trash').onclick=()=>{$('gallery-trash-confirm').hidden=false;};
  $('gallery-cancel-trash').onclick=()=>{$('gallery-trash-confirm').hidden=true;};
  $('gallery-trash-selected').onclick=async()=>{
    if(trashBusy||!selectedForTrash.size)return;
    trashBusy=true;
    renderTrashSelection();
    let removed=0;
    const failures=[];
    try{
      for(const [id,image] of selectedForTrash){
        try{
          await send('/api/trash',{filename:image.meta.filename,subfolder:image.meta.subfolder});
          selectedForTrash.delete(id);
          removed++;
        }catch(error){failures.push(error.message);}
      }
    }finally{
      trashBusy=false;
      $('gallery-trash-confirm').hidden=true;
      if(!selectedForTrash.size)resetTrashSelection();
      else renderTrashSelection();
    }
    if(document.body.dataset.tab==='gallery'){
      try{await loadGallery();}catch(error){toast('已移除 '+removed+' 張，圖庫更新失敗：'+error.message);return;}
    }
    toast(failures.length?'已移除 '+removed+' 張，'+failures.length+' 張失敗：'+failures[0]:'已從共用圖庫移除 '+removed+' 張');
  };

  const continuous = () => $('gen-continuous').checked;
  let sharedProjects=[];
  function renderProjectList(){
    const query=$('project-search').value.trim().toLowerCase();
    $('project-list').replaceChildren(...sharedProjects.filter(row=>(row.name||'未命名圖板').toLowerCase().includes(query)).map(row=>{
      const button=document.createElement('button');button.type='button';button.className='wide';button.textContent=row.name||'未命名圖板';
      button.onclick=async()=>{
        $('project-status').textContent='讀取專案…';
        try{
          const project=await api('/api/projects/'+encodeURIComponent(row.id));
          $('project-preview').replaceChildren(...project.rounds.map((round,index)=>{
            const card=document.createElement('button');card.type='button';card.className='gallery-tile';
            const image=document.createElement('img');image.loading='lazy';image.alt='';
            image.src=round.meta?.sharedId?'/thumb/'+round.meta.sharedId:round.thumbUrl||round.url||'';
            const text=document.createElement('p');text.textContent='第 '+(index+1)+' 版 · 點選繼續改圖';
            card.append(image,text);
            card.onclick=()=>{
              $('gen-continuous').checked=true;setGenerationMode('img2img');
              $('gen-prompt').value=project.prompt||'';
              const url=round.meta?.sharedId?'/media/'+round.meta.sharedId:round.url;
              if(!url){toast('此版本找不到原圖');return;}
              void selectEditImage('main',null,{url,name:round.title||'project.png',meta:{...round.meta,editGroup:project.id}});
            };
            return card;
          }));
          $('project-status').textContent=(project.name||'未命名圖板')+' · '+project.rounds.length+' 個版本';
        }catch(error){$('project-status').textContent=error.message;}
      };
      return button;
    }));
  }
  $('project-search').oninput=renderProjectList;
  $('gallery-projects').addEventListener('toggle',async()=>{
    if(!$('gallery-projects').open)return;
    try{sharedProjects=(await api('/api/projects')).projects;renderProjectList();$('project-status').textContent=sharedProjects.length?'':'尚無共用圖板';}
    catch(error){$('project-status').textContent=error.message;}
  });
  let recycleRevision=0;
  async function loadRecycle(){
    const revision=++recycleRevision;
    const results=$('recycle-results');
    $('recycle-status').textContent='讀取回收區…';
    $('recycle-restore').disabled=true;
    results.replaceChildren();
    try{
      const {items}=await api('/api/trash?q='+encodeURIComponent($('recycle-query').value));
      if(revision!==recycleRevision)return;
      for(const item of items){
        const label=document.createElement('label'), check=document.createElement('input');
        check.type='checkbox';check.value=item.id;
        label.append(check,' '+item.name+' · '+new Date(item.trashedAt*1000).toLocaleDateString());
        results.append(label);
      }
      $('recycle-status').textContent=items.length?'共 '+items.length+' 件作品':'沒有符合的作品';
    }catch(error){if(revision===recycleRevision)$('recycle-status').textContent=error.message;}
  }
  $('gallery-recycle').addEventListener('toggle',()=>{if($('gallery-recycle').open)void loadRecycle();});
  $('recycle-search').onsubmit=event=>{event.preventDefault();void loadRecycle();};
  $('recycle-results').onchange=()=>{$('recycle-restore').disabled=!$('recycle-results').querySelector(':checked');};
  $('recycle-empty').onclick=()=>{$('recycle-empty-confirm').hidden=false;};
  $('recycle-empty-cancel').onclick=()=>{$('recycle-empty-confirm').hidden=true;};
  $('recycle-empty-accept').onclick=async()=>{
    const controls=['recycle-empty','recycle-empty-accept','recycle-empty-cancel','recycle-restore','recycle-query'];
    controls.forEach(id=>$(id).disabled=true);
    $('recycle-status').textContent='正在移到 Windows 資源回收筒…';
    try{
      const result=await send('/api/trash/empty',{destination:'windows-recycle-bin'});
      $('recycle-empty-confirm').hidden=true;await loadRecycle();
      $('recycle-status').textContent='已移到 Windows 資源回收筒 '+result.moved+' 筆資料';
    }catch(error){await loadRecycle().catch(()=>{});$('recycle-status').textContent=error.message;}
    finally{controls.filter(id=>id!=='recycle-restore').forEach(id=>$(id).disabled=false);}
  };
  $('recycle-restore').onclick=async()=>{
    const ids=[...$('recycle-results').querySelectorAll(':checked')].map(input=>input.value);
    if(!ids.length)return;
    if(ids.length>100){$('recycle-status').textContent='每次最多還原 100 件作品';return;}
    $('recycle-restore').disabled=true;
    try{
      const result=await send('/api/trash/restore',{ids});
      await loadRecycle();
      await loadGallery();
      $('recycle-status').textContent='已還原 '+result.restored.length+' 件'+(result.failed.length?'；'+result.failed.length+' 件失敗：'+result.failed[0].error:'');
    }catch(error){$('recycle-status').textContent=error.message;$('recycle-restore').disabled=false;}
  };
  let referenceUpload='', editGroup='', editParent='', galleryRole='';
  const maskCanvas=$('gen-mask-canvas'), maskLayer=document.createElement('canvas');
  let maskPainted=false, brushPointer=null, brushPoint;
  function resetMask(){
    maskPainted=false;brushPointer=null;
    maskCanvas.getContext('2d').clearRect(0,0,maskCanvas.width,maskCanvas.height);
    const context=maskLayer.getContext('2d');context.fillStyle='#000';context.fillRect(0,0,maskLayer.width,maskLayer.height);
  }
  $('gen-mask-clear').onclick=resetMask;
  $('gen-source-preview').addEventListener('load',event=>{
    const image=event.currentTarget;
    if(!image.naturalWidth)return;
    maskCanvas.width=maskLayer.width=image.naturalWidth;maskCanvas.height=maskLayer.height=image.naturalHeight;
    maskCanvas.style.backgroundImage='url("'+image.src+'")';
    resetMask();
  });
  function paintMask(event, start){
    const rect=maskCanvas.getBoundingClientRect();
    if(!rect.width||generationSubmitting)return;
    const scale=maskCanvas.width/rect.width;
    const point=[(event.clientX-rect.left)*scale,(event.clientY-rect.top)*maskCanvas.height/rect.height];
    if(start)brushPoint=[point[0]-.1,point[1]];
    for(const [canvas,color] of [[maskCanvas,'#da426f'],[maskLayer,'#fff']]){
      const context=canvas.getContext('2d');
      context.lineCap='round';context.lineJoin='round';context.lineWidth=Number($('gen-mask-size').value)*scale;context.strokeStyle=color;
      context.beginPath();context.moveTo(...brushPoint);context.lineTo(...point);context.stroke();
    }
    brushPoint=point;maskPainted=true;
  }
  maskCanvas.onpointerdown=event=>{
    if(event.button!==0||brushPointer!==null||generationSubmitting)return;
    brushPointer=event.pointerId;maskCanvas.setPointerCapture(brushPointer);paintMask(event,true);
  };
  maskCanvas.onpointermove=event=>{if(event.pointerId===brushPointer)paintMask(event,false);};
  maskCanvas.onlostpointercapture=()=>{brushPointer=null;};
  async function uploadMask(){
    const blob=await new Promise(resolve=>maskLayer.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('無法儲存遮罩');
    const body=new FormData();body.append('image',blob,'edit-mask.png');
    return (await api('/api/upload',{method:'POST',body})).id;
  }
  function syncContinuous() {
    const edit=generationMode==='img2img', chain=edit&&continuous();
    document.querySelectorAll('[data-engine]').forEach(button=>button.disabled=edit&&!supportsEdit(button.dataset.engine));
    $('gen-reference-settings').hidden=!chain;
    $('gen-mask-panel').hidden=!chain||!editUpload||!catalog?.editMask;
    $('gen-klein-settings').hidden=!edit||chain||engine!=='klein';
    $('gen-sd-edit-settings').hidden=!edit||engine!=='sd';
    $('gen-klein-strength').disabled=$('gen-klein-settings').hidden;
    $('gen-denoise').disabled=$('gen-sd-edit-settings').hidden;
    $('gen-count').disabled=chain;
    if(chain)$('gen-count').value='1';
    $('gen-prompt').required=!edit||chain||engine==='sd';
    $('gen-prompt').placeholder=chain?'用中文描述要改的地方，以及要保留的細節':edit&&engine==='klein'?'可留空，套用預設寫實轉換指令':'描述主體、場景、光線與你想要的風格…';
    $('gen-model-status').textContent=!edit?'':chain?(catalog&&!catalog.kleinContinuous?'缺少 Klein 權重或連續改圖節點。':'連續改圖可選已安裝的 Klein 9B 權重。'):engine==='sd'?(catalog&&!catalog.sdEdit?'找不到相容的 SD / SDXL checkpoint，或缺少圖生圖節點。':'可切換 SD / SDXL checkpoint；改圖強度越高，結果越不同。'):(catalog&&!catalog.kleinEdit?'缺少 Klein 權重、寫實 LoRA 或圖生圖節點。':'Klein 寫實轉換使用已安裝的寫實 LoRA。');
    updateButtons();
  }
  async function selectEditImage(role, file, image) {
    if(editUploading||(!file&&!image))return;
    editUploading=true;
    updateButtons();
    try{
      if(image){
        const response=await fetch(image.url,{signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('無法讀取作品原圖');
        file=await response.blob();
      }
      const body=new FormData();
      body.append('image',file,file.name||image?.name||'reference.png');
      const uploaded=await api('/api/upload',{method:'POST',body});
      const preview=$(role==='reference'?'gen-reference-preview':'gen-source-preview');
      preview.src=uploaded.url;
      preview.hidden=false;
      if(role==='reference')referenceUpload=uploaded.id;
      else {
        editUpload=uploaded.id;
        resetMask();
        editGroup=image?.meta?.editGroup||'';
        editParent=image?.meta?.editId||image?.id||'';
      }
      tab('generate');
      syncContinuous();
      toast(role==='reference'?'參考圖已加入':'主圖已加入');
    }catch(error){toast(error.message);}
    finally{editUploading=false;updateButtons();}
  }
  $('gen-continuous').onchange=()=>{if(continuous()&&engine!=='klein')chooseEngine('klein');else syncContinuous();};
  $('gen-denoise').addEventListener('change',saveForm);
  $('gen-reference').onchange=event=>{
    void selectEditImage('reference',event.target.files[0]);
    event.target.value='';
  };
  $('gen-reference-clear').onclick=()=>{referenceUpload='';$('gen-reference-preview').hidden=true;};
  const assetRoles={main:'主圖',reference:'參考圖',motion:'影片起始圖',recognize:'待辨識圖片'};
  for(const [id,role] of [['gen-source-gallery','main'],['gen-reference-gallery','reference'],['motion-gallery','motion'],['recognize-gallery','recognize']]){
    $(id).onclick=()=>{
      tab('gallery');
      resetTrashSelection();
      galleryRole=role;
      renderTrashSelection();
      $('gallery-pick-title').textContent='選擇'+assetRoles[role]+' · 最新作品在前';
      $('gallery-pick-context').hidden=false;
    };
  }
  $('gallery-pick-cancel').onclick=()=>tab(['motion','recognize'].includes(galleryRole)?galleryRole:'generate');
  const pickers={'gen-source':file=>selectEditImage('main',file),'gen-reference':file=>selectEditImage('reference',file),'rec-file':uploadPhoto,'motion-file':uploadMotion};
  for(const [id,apply] of Object.entries(pickers)){
    const zone=document.querySelector('label[for="'+id+'"]');
    zone.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
    zone.addEventListener('drop',event=>{
      event.preventDefault();const file=[...event.dataTransfer.files].find(item=>item.type.startsWith('image/'));if(file)void apply(file);
    });
  }
  document.addEventListener('paste',event=>{
    const id={generate:generationMode==='img2img'?'gen-source':'',recognize:'rec-file',motion:'motion-file'}[document.body.dataset.tab];
    const file=[...event.clipboardData?.files||[]].find(item=>item.type.startsWith('image/'));
    if(id&&file){event.preventDefault();void pickers[id](file);}
  });
  const useEdit=document.createElement('button');
  useEdit.textContent='用這張繼續改圖';
  useEdit.onclick=()=>{
    if(!selectedImage)return;
    setGenerationMode('img2img');
    $('gen-continuous').checked=true;
    $('gen-prompt').value='';
    $('gen-continuous').onchange();
    void selectEditImage('main',null,selectedImage);
  };
  $('image-reuse').after(useEdit);
  const useRecognition=document.createElement('button');
  useRecognition.textContent='用這張辨識';
  async function recognizeGalleryImage(image){
    if(!image||uploading)return;
    uploading=true;
    updateButtons();
    try{
      const response=await fetch(image.url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('無法讀取作品原圖');
      const body=new FormData();
      body.append('image',await response.blob(),image.name);
      const uploaded=await api('/api/upload',{method:'POST',body});
      uploadId=uploaded.id;
      localStorage.setItem('void-pocket-upload',uploadId);
      $('rec-preview').src=uploaded.url;
      $('rec-preview').hidden=false;
      $('rec-result').hidden=true;
      tab('recognize');
    }catch(error){toast(error.message);}
    finally{uploading=false;updateButtons();}
  }
  useRecognition.onclick=()=>void recognizeGalleryImage(selectedImage);
  useEdit.after(useRecognition);
  $('image-save-meta').onclick=async()=>{
    const image=selectedImage;
    if(!image)return;
    const split=value=>value.split(/[,，]/).map(part=>part.trim()).filter(Boolean);
    const fields={rating:Number($('image-rating').value),tags:split($('image-tags').value),albums:split($('image-albums').value)};
    try{await send('/api/gallery/'+image.id,fields,'PATCH');Object.assign(image.meta,fields);toast('已儲存評分與分類');}
    catch(error){toast(error.message);}
  };
  $('image-trash').onclick=async()=>{
    const image=selectedImage;
    if(!image)return;
    $('image-trash').disabled=true;
    try{await send('/api/trash',{filename:image.meta.filename,subfolder:image.meta.subfolder});tab('gallery');toast('已移至電腦回收區');}
    catch(error){toast(error.message);}
    finally{$('image-trash').disabled=false;}
  };

  async function showVersions(image) {
    const group=image.meta?.editGroup;
    $('image-versions').hidden=!group;
    $('image-version-grid').replaceChildren();
    $('image-compare').hidden=true;
    if(!group)return;
    const query=new URLSearchParams({editGroup:group});
    const rows=[];
    while(true){
      query.set('offset',String(rows.length));
      const page=await api('/api/gallery?'+query);
      rows.push(...page.images);
      if(rows.length>=page.total||!page.images.length)break;
    }
    if(selectedImage?.id!==image.id)return;
    rows.reverse();
    const versions=new Map(rows.map((row,index)=>[row.meta.editId,index+1]));
    for(const [index,row] of rows.entries()){
      const tile=document.createElement('button');
      tile.className='gallery-tile';
      tile.setAttribute('aria-current',String(row.id===image.id));
      const thumbnail=document.createElement('img');
      thumbnail.src=row.thumb;
      thumbnail.alt='';
      thumbnail.loading='lazy';
      const label=document.createElement('p');
      const parent=versions.get(row.meta.parent);
      label.textContent='第 '+(index+1)+' 版'+(parent?' · 從第 '+parent+' 版分支':'');
      label.title=row.meta.prompt||'';
      tile.append(thumbnail,label);
      tile.onclick=()=>{
        if(row.id===selectedImage?.id){$('image-compare').hidden=true;return;}
        $('image-compare').src=row.url;
        $('image-compare').hidden=false;
      };
      const edit=document.createElement('button');
      edit.textContent='開啟第 '+(index+1)+' 版';
      edit.onclick=()=>openImage(row.id).catch(error=>toast(error.message));
      const card=document.createElement('div');
      card.className='version-card';
      card.append(tile,edit);
      $('image-version-grid').append(card);
    }
  }
  let rngBank, rngLoading=false, rngFields=[], rngPrefix='', captionFields=[];
  const rngDrafts={};
  function rngPreview(){
    $('rng-preview').value=[rngPrefix,...captionFields.filter(field=>field.enabled).map(field=>field.value),...rngFields.map(field=>field.select.value)].filter(Boolean).join(', ');
  }
  function renderCaptionFields(){
    const fields=captionFields.map(field=>{
      const row=document.createElement('div'), label=document.createElement('label'), check=document.createElement('input'), input=document.createElement('input');
      row.className='rng-row';
      check.type='checkbox';check.checked=field.enabled;
      label.append(check,' '+field.label);input.value=field.value;input.setAttribute('aria-label',field.label);
      check.onchange=()=>{field.enabled=check.checked;rngPreview();};
      input.oninput=()=>{field.value=input.value;rngPreview();};
      row.append(label,input);
      return row;
    });
    $('rng-caption-fields').replaceChildren(...fields);
  }
  function renderRng(){
    if(!rngBank)return;
    const mode=$('rng-mode').value;
    const rows=rngDrafts[mode] ||= rngBank[mode].filter(row=>row.choices.some(word=>typeof word==='string'&&word.trim()))
      .map(row=>({label:row.label, choices:row.choices.filter(word=>typeof word==='string'&&word.trim()), value:'', locked:false}));
    rngFields=rows.map(row=>{
      const wrapper=document.createElement('div');
      wrapper.className='rng-row';
      const label=document.createElement('label');
      label.textContent=row.label;
      const select=document.createElement('select');
      select.add(new Option('略過此欄',''));
      for(const word of row.choices)select.add(new Option(word,word));
      select.value=row.value;
      select.onchange=()=>{row.value=select.value;rngPreview();};
      label.append(select);
      const lockLabel=document.createElement('label');
      const lock=document.createElement('input');
      lock.type='checkbox';
      lock.checked=row.locked;
      lock.onchange=()=>{row.locked=lock.checked;};
      lockLabel.append(lock,' 鎖定');
      wrapper.append(label,lockLabel);
      return {row,select,wrapper};
    });
    $('rng-fields').replaceChildren(...rngFields.map(field=>field.wrapper));
    rngPreview();
  }
  async function loadRng(){
    if(rngBank||rngLoading)return;
    rngLoading=true;
    $('rng-state').textContent='讀取電腦上的 RNG 辭庫…';
    try{rngBank=await api('/api/rng');renderRng();$('rng-state').textContent='可挑選、鎖定欄位，或重抽未鎖定欄位。';}
    catch(error){$('rng-state').textContent=error.message;}
    finally{rngLoading=false;}
  }
  $('rng-mode').onchange=renderRng;
  $('rng-roll').onclick=()=>{
    if(!rngBank){void loadRng();return;}
    for(const {row,select} of rngFields){
      if(row.locked)continue;
      const choices=row.choices.filter(word=>word!==row.value);
      if(choices.length)row.value=choices[Math.floor(Math.random()*choices.length)];
      select.value=row.value;
    }
    rngPreview();
  };
  function applyRng(append){
    const words=$('rng-preview').value.trim();
    if(!words){toast('先抽詞或填入提示詞');return;}
    $('gen-prompt').value=[append?$('gen-prompt').value.trim():'',words].filter(Boolean).join(', ');
    saveForm();
    tab('generate');
  }
  $('rng-append').onclick=()=>applyRng(true);
  $('rng-replace').onclick=()=>applyRng(false);
  $('caption-rng').onclick=()=>{
    const labels={subject:'主體',clothing:'服裝',composition:'構圖',lighting:'光線',setting:'環境',colors:'色彩'};
    const raw=$('rec-text').value.trim();
    captionFields=raw.split(/\r?\n/).map(line=>line.match(/^\s*[*\-]*\s*(\w+)\s*:\s*(.+)$/))
      .filter(match=>match&&labels[match[1].toLowerCase()]).map(match=>({label:labels[match[1].toLowerCase()],value:match[2].trim(),enabled:true}));
    rngPrefix=captionFields.length?'':raw;
    renderCaptionFields();rngPreview();tab('rng');
  };
  $('rng-save-recipe').onclick=()=>{
    const prompt=$('rng-preview').value.trim();if(!prompt){toast('請先填入配方');return;}
    localStorage.setItem('void-pocket-rng-recipe',JSON.stringify({mode:$('rng-mode').value,prompt,rngPrefix,captionFields,drafts:rngDrafts}));
    toast('配方已儲存在這台裝置');
  };
  $('rng-load-recipe').onclick=()=>{
    const recipe=load('void-pocket-rng-recipe',null);if(!recipe){toast('尚未儲存配方');return;}
    $('rng-mode').value=recipe.mode;rngPrefix=recipe.rngPrefix;captionFields=recipe.captionFields;Object.assign(rngDrafts,recipe.drafts);
    renderRng();renderCaptionFields();$('rng-preview').value=recipe.prompt;
  };

  $('resource-profile').onchange=async()=>{
    const select=$('resource-profile');select.disabled=true;
    try{await send('/api/resources',{profile:select.value},'PATCH');toast('資源模式已更新');}
    catch(error){toast(error.message);}finally{select.disabled=false;}
  };
  $('connection').addEventListener('click',()=>{void api('/api/resources').then(result=>{$('resource-profile').value=result.profile;}).catch(error=>toast(error.message));});
  const recSaved=load('void-pocket-recognition',{});for(const [key,id]of Object.entries({engine:'rec-engine',style:'rec-style',detail:'rec-detail',instruction:'rec-instruction'}))if(recSaved[key])$(id).value=recSaved[key];recSettings();
  if(uploadId){$('rec-preview').src='/upload/'+uploadId;$('rec-preview').hidden=false;}
  engine=localStorage.getItem('void-pocket-gen-engine')||'qwen';if(!defaults[engine])engine='qwen';chooseEngine(engine,false);tab(localStorage.getItem('void-pocket-tab')||'generate');refresh();
  setInterval(()=>{if(!document.hidden)refresh();},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();if(document.body.dataset.tab==='gallery')loadGallery().catch(()=>{});}});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();
