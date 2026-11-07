/* VOID FULL and Pocket read the same computer-owned gallery. */
window.VoidSharedGallery = (() => {
  const base='http://127.0.0.1:8090';
  let online=false,lastSignature='',refreshing=false;
  const pathOf=record=>[record.meta?.subfolder||'',record.meta?.filename||record.filename||''].filter(Boolean).join('/').replaceAll('\\','/');
  async function request(path,options={}) {
    const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(12000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'共用服務連線失敗（'+response.status+'）');
    return result;
  }
  async function list(){
    const images=[];let total=Infinity;
    while(images.length<total){const page=await request('/api/gallery?offset='+images.length);total=page.total;if(!images.length)images.revision=page.revision;images.push(...page.images);if(!page.images.length)break;}
    return images;
  }
  function merge(local,remote){
    const byPath=new Map(),duplicates=[];
    for(const record of local){const path=pathOf(record);if(path){if(!byPath.has(path))byPath.set(path,record);}else duplicates.push(record);}
    const records=remote.map(image=>{
      const path=pathOf(image),prior=byPath.get(path);byPath.delete(path);
      return {...prior,id:prior?.id??null,title:prior?.title||image.name,thumbUrl:base+image.thumb,dataUrl:null,ts:image.mtime*1000,
        meta:{...prior?.meta,...image.meta,ts:image.mtime*1000,sharedId:image.id,sharedUrl:base+image.url,sharedFavorite:!!image.favorite}};
    });
    for(const record of [...byPath.values(),...duplicates])if(!record.meta?.sharedId&&!pathOf(record))records.push(record);
    return records.sort((a,b)=>(b.ts||0)-(a.ts||0));
  }
  async function load(local){
    try{const remote=await list();online=true;lastSignature=remote.revision||'';return merge(local,remote);}
    catch(error){online=false;console.warn('[VOID shared gallery]',error);return local;}
  }
  const send=(path,data,method='POST')=>request(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  async function uploadFile(blob){
    const body=new FormData();body.append('image',blob,'studio-source.png');
    return request('/api/upload?preserve=1',{method:'POST',body});
  }
  const uploadAsset=async blob=>(await uploadFile(blob)).id;
  const submitJob=data=>send('/api/jobs',data);
  const saveProject=data=>send('/api/projects',data);
  const getProject=id=>request('/api/projects/'+encodeURIComponent(id));
  const listProjects=async()=>(await request('/api/projects')).projects;
  const cancelJob=id=>send('/api/jobs/'+encodeURIComponent(id)+'/cancel',{});
  const getJob=id=>request('/api/jobs/'+encodeURIComponent(id));
  let activeDesktopJob=null;
  async function runWorkflow(workflow,saveNodeId,meta,onProgress){
    const {ids}=await submitJob({kind:'workflow',engine:meta.engine||'sd',workflow,saveNodeId,meta,prompt:meta.prompt});
    activeDesktopJob=ids[0];
    let preview;
    try{
      preview=new WebSocket(base.replace(/^http/,'ws')+'/api/jobs/'+encodeURIComponent(ids[0])+'/preview');
      preview.binaryType='arraybuffer';
      preview.onmessage=event=>{
        if(activeDesktopJob!==ids[0]||!(event.data instanceof ArrayBuffer)||event.data.byteLength<8)return;
        const header=new DataView(event.data);
        if(header.getUint32(0)!==1)return;
        const mime=header.getUint32(4)===2?'image/png':'image/jpeg';
        if(typeof showLivePreview==='function')showLivePreview(URL.createObjectURL(new Blob([event.data.slice(8)],{type:mime})));
      };
    }catch(error){console.warn('即時預覽連線失敗，仍繼續等待成品',error);}
    try{
      const until=Date.now()+60*60*1000;
      while(Date.now()<until){
        const job=await getJob(ids[0]);onProgress?.(job);
        if(job.state==='done')return job;
        if(['error','cancelled'].includes(job.state))throw new Error(job.error||'任務已取消');
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw new Error('等待逾時，任務仍可從共用任務查看');
    }finally{
      activeDesktopJob=null;
      if(preview){preview.onmessage=null;preview.close();}
      if(typeof clearLivePreview==='function')clearLivePreview();
    }
  }
  const cancelDesktop=()=>activeDesktopJob?cancelJob(activeDesktopJob):Promise.resolve();
  const update=(id,data)=>send('/api/gallery/'+encodeURIComponent(id),data,'PATCH');
  const favorite=(id,value)=>update(id,{favorite:value});
  function sharedPanel(title){
    let panel=document.getElementById('void-shared-panel');
    if(!panel){
      panel=document.createElement('section');panel.id='void-shared-panel';
      panel.style.cssText='padding:10px;max-height:33vh;overflow:auto;border-bottom:1px solid var(--border,#444);';
      document.getElementById('gallery-toolbar').after(panel);
    }
    const heading=document.createElement('strong'), close=document.createElement('button');
    heading.textContent=title;close.textContent='關閉';close.className='tb-btn';close.onclick=()=>panel.replaceChildren();
    panel.replaceChildren(heading,' ',close,document.createElement('br'));
    return panel;
  }
  function editMetadata(meta,focus='tags'){
    const panel=sharedPanel('作品分類');
    const form=document.createElement('form'), status=document.createElement('p');
    status.setAttribute('role','status');
    const fields=Object.fromEntries([['albums','相簿'],['tags','標籤']].map(([key,name])=>{
      const label=document.createElement('label'), input=document.createElement('input');
      label.append(name+'（逗號分隔） ',input);input.value=(meta[key]||[]).join(', ');form.append(label,' ');
      return [key,input];
    }));
    const save=document.createElement('button');save.textContent='儲存分類';save.className='tb-btn';form.append(save,status);panel.append(form);
    form.onsubmit=async event=>{
      event.preventDefault();save.disabled=true;
      try{
        const values=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean)]));
        await update(meta.sharedId,values);await loadSavedGallery();status.textContent='已同步分類';
      }catch(error){status.textContent=error.message;}finally{save.disabled=false;}
    };
    fields[focus].focus();
  }
  function showRecycle(){
    const panel=sharedPanel('回收區'), form=document.createElement('form'), input=document.createElement('input');
    input.type='search';input.placeholder='搜尋檔名、提示詞、標籤';input.setAttribute('aria-label','搜尋回收區');
    const search=document.createElement('button'), restore=document.createElement('button'), results=document.createElement('div'), status=document.createElement('p');
    search.textContent='搜尋';restore.textContent='還原選取';restore.disabled=true;status.setAttribute('role','status');
    form.append(input,search);panel.append(form,results,restore,status);
    const empty=document.createElement('button'), confirm=document.createElement('div'), explanation=document.createElement('p');
    const cancel=document.createElement('button'), accept=document.createElement('button');
    empty.type=cancel.type=accept.type='button';empty.textContent='清空回收區';
    explanation.textContent='將全部 VOID 回收資料（包含搜尋條件以外的項目）移到 Windows 資源回收筒。之後需從 Windows 還原。';
    cancel.textContent='取消';accept.textContent='確認移到 Windows 資源回收筒';confirm.hidden=true;
    confirm.append(explanation,cancel,accept);panel.append(empty,confirm);
    empty.onclick=()=>{confirm.hidden=false;};
    cancel.onclick=()=>{confirm.hidden=true;};
    accept.onclick=async()=>{
      empty.disabled=accept.disabled=cancel.disabled=restore.disabled=search.disabled=input.disabled=true;
      status.textContent='正在移到 Windows 資源回收筒…';
      try{
        const result=await send('/api/trash/empty',{destination:'windows-recycle-bin'});
        confirm.hidden=true;await load();
        status.textContent='已移到 Windows 資源回收筒 '+result.moved+' 筆資料';
      }catch(error){await load().catch(()=>{});status.textContent=error.message;}
      finally{empty.disabled=accept.disabled=cancel.disabled=search.disabled=input.disabled=false;}
    };
    let revision=0;
    async function load(){
      const token=++revision;restore.disabled=true;results.replaceChildren();status.textContent='讀取回收區…';
      const {items}=await request('/api/trash?q='+encodeURIComponent(input.value));
      if(token!==revision)return;
      for(const item of items){
        const label=document.createElement('label'), check=document.createElement('input');
        label.style.display='block';check.type='checkbox';check.value=item.id;label.append(check,' '+item.name);results.append(label);
      }
      status.textContent=items.length?'共 '+items.length+' 件作品':'沒有符合的作品';
    }
    results.onchange=()=>{restore.disabled=!results.querySelector(':checked');};
    const showError=error=>{status.textContent=error.message;};
    form.onsubmit=event=>{event.preventDefault();void load().catch(showError);};
    restore.onclick=async()=>{
      const ids=[...results.querySelectorAll(':checked')].map(box=>box.value);
      if(ids.length>100){status.textContent='每次最多還原 100 件作品';return;}
      if(!ids.length)return;
      restore.disabled=true;
      try{
        const result=await send('/api/trash/restore',{ids});
        await load();await loadSavedGallery();
        status.textContent='已還原 '+result.restored.length+' 件'+(result.failed.length?'；'+result.failed.length+' 件失敗：'+result.failed[0].error:'');
      }catch(error){showError(error);restore.disabled=false;}
    };
    void load().catch(showError);
  }
  async function showVideos(){
    const panel=sharedPanel('影片作品'), list=document.createElement('div');
    panel.append(list);list.textContent='讀取影片…';
    try{
      const {jobs}=await request('/api/jobs?kind=motion&state=done');
      list.replaceChildren(...jobs.map(job=>{
        const button=document.createElement('button');button.type='button';button.className='tb-btn';
        button.textContent='▶ '+(job.request.prompt||'影片').slice(0,65);
        button.onclick=()=>{
          const view=sharedPanel('影片作品'), player=document.createElement('video'), meta=document.createElement('p');
          const back=document.createElement('button'), download=document.createElement('a'), capture=document.createElement('button');
          player.controls=true;player.preload='metadata';player.crossOrigin='anonymous';
          player.style.cssText='display:block;max-height:20vh;max-width:100%';
          player.src=base+job.result.url;
          player.onloadedmetadata=()=>{meta.textContent=player.videoWidth+' × '+player.videoHeight+' · '+player.duration.toFixed(2)+' 秒 · '+job.request.prompt;};
          back.textContent='回影片列表';back.onclick=showVideos;
          download.href=base+job.result.url+'?download=1';download.textContent='下載 MP4';
          capture.textContent='擷取畫面改圖';
          capture.onclick=()=>{
            if(player.readyState<2){setStatus('請等影片載入','warn');return;}
            player.pause();
            try{
              const canvas=document.createElement('canvas');canvas.width=player.videoWidth;canvas.height=player.videoHeight;
              canvas.getContext('2d').drawImage(player,0,0);
              window.VoidStudio.open({url:canvas.toDataURL('image/png'),title:'影片擷取畫面'});
            }catch(error){setStatus(error.message,'error');}
          };
          view.append(player,meta,back,' ',download,' ',capture);
        };
        return button;
      }));
      if(!jobs.length)list.textContent='尚無影片作品';
    }catch(error){list.textContent=error.message;}
  }
  async function fullData(id){
    const response=await fetch(base+'/media/'+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('原圖讀取失敗');
    const blob=await response.blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  }
  async function poll(){
    if(refreshing||document.hidden||window.voidGalleryClearing||typeof gallerySelectMode==='undefined'||gallerySelectMode||document.getElementById('modal-bg')?.classList.contains('open'))return;
    refreshing=true;
    try{const {revision:signature}=await request('/api/gallery?revisionOnly=1');if(signature!==lastSignature){const view=document.getElementById('gallery-view'),scroll=view?.scrollTop||0;await loadSavedGallery();if(view)view.scrollTop=scroll;}}catch{}finally{refreshing=false;}
  }
  async function renderJobs(){
    const target=document.getElementById('shared-jobs-results');
    if(!target||target.dataset.loading)return;
    target.dataset.loading='1';
    try{
      const {jobs}=await request('/api/jobs'), list=document.createDocumentFragment();
      const phases={saving:'正在存檔',preparing:'載入模型／準備素材',generating:'生成中'};
      const states={queued:'等待',submitting:'準備提交',running:'執行中',done:'已完成',error:'失敗',cancelled:'已取消'};
      for(const job of jobs.slice(0,40)){
        const row=document.createElement('div'), title=document.createElement('strong'), text=document.createElement('p');
        row.style.cssText='padding:8px 0;border-bottom:1px solid var(--border,#444)';
        const type=job.kind==='motion'?'轉影片':job.kind==='caption'?'圖片辨識':job.request.continuous?'連續改圖':job.request.mode==='img2img'?'圖生圖':'文生圖';
        const progress=job.state==='running'&&job.progress.max?' · '+job.progress.value+'/'+job.progress.max:'';
        title.textContent=type+' · '+job.engine+' · '+((job.state==='running'&&phases[job.progress?.phase])||states[job.state]||job.state)+progress;
        text.textContent=(job.error||job.result.text||job.request.prompt||'').slice(0,400);
        row.append(title,text);
        const action=document.createElement('button');action.type='button';action.className='tb-btn';
        const ended=['done','error','cancelled'].includes(job.state);action.textContent=ended?'再次執行':'取消任務';
        action.onclick=async()=>{
          action.disabled=true;
          try{if(ended)await submitJob({kind:'retry',jobId:job.id});else await cancelJob(job.id);void renderJobs();}
          catch(error){text.textContent=error.message;action.disabled=false;}
        };
        row.append(action);
        if(job.state==='done'&&job.kind==='motion'&&job.result.video){
          const link=document.createElement('a');link.href=base+'/video/'+encodeURIComponent(job.id)+'?download=1';link.textContent='下載影片';row.append(link);
        }
        list.append(row);
      }
      target.replaceChildren(jobs.length?list:'目前沒有共用任務');
    }catch(error){target.textContent=error.message;}
    finally{delete target.dataset.loading;}
  }
  window.addEventListener('load',()=>{
    const toolbar=document.getElementById('gallery-toolbar');
    if(toolbar){const button=document.createElement('button');button.className='tb-btn';button.textContent='更新共用圖庫';button.onclick=async()=>{button.disabled=true;try{await loadSavedGallery();setStatus(online?'共用圖庫已更新':'共用圖庫離線，顯示瀏覽器紀錄',online?'ok':'warn');}finally{button.disabled=false;}};toolbar.prepend(button);}
    if(toolbar){const button=document.createElement('button');button.className='tb-btn';button.textContent='回收區';button.onclick=showRecycle;toolbar.append(button);}
    if(toolbar){const button=document.createElement('button');button.className='tb-btn';button.textContent='影片作品';button.onclick=showVideos;toolbar.append(button);}
    if(toolbar){
      const label=document.createElement('label'), select=document.createElement('select');
      label.textContent='資源 ';select.setAttribute('aria-label','資源模式');
      for(const [value,name] of [['economy','省資源 · 閒置30秒釋放'],['balanced','均衡 · 閒置5分鐘釋放'],['creative','連續創作 · 閒置30分鐘釋放']])select.add(new Option(name,value));
      label.append(select);toolbar.append(label);select.disabled=true;
      request('/api/resources').then(result=>{select.value=result.profile;select.disabled=false;}).catch(()=>{});
      select.onchange=async()=>{
        select.disabled=true;
        try{await send('/api/resources',{profile:select.value},'PATCH');setStatus('資源模式已更新','ok');}
        catch(error){setStatus(error.message,'error');}
        finally{select.disabled=false;}
      };
    }
    document.getElementById('shared-jobs-refresh')?.addEventListener('click',renderJobs);
    document.querySelector('[data-full-view="queue"]')?.addEventListener('click',renderJobs);
    setInterval(()=>{if(!document.hidden&&document.getElementById('shared-jobs')?.getClientRects().length)void renderJobs();},5000);
    setInterval(poll,8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  });
  return {load,list,merge,favorite,update,editMetadata,fullData,uploadAsset,uploadFile,submitJob,getJob,cancelJob,runWorkflow,cancelDesktop,saveProject,getProject,listProjects,base,isOnline:()=>online};
})();
