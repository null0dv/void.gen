(() => {
  'use strict';
  const type='application/x-void-gallery-image';
  let dragged=null;
  const imageFile=file=>file&&(file.type.startsWith('image/')||/\.(png|jpe?g|webp|avif|bmp|gif)$/i.test(file.name));
  const hint=document.createElement('div');hint.className='void-drop-hint';hint.hidden=true;
  hint.textContent='放開圖片以載入 · 主圖／參考圖／辨識';document.body.append(hint);
  const reset=()=>{hint.hidden=true;document.querySelectorAll('.void-drop-active').forEach(el=>el.classList.remove('void-drop-active'));};
  function targetFor(target){
    const ref=target.closest('#studio-reference-controls,label[for="studio-ref"]');
    if(ref)return {node:ref,role:'ref'};
    const studio=target.closest('#studio-dialog');
    if(studio)return {node:target.closest('.studio-hero,.studio-asset')||studio,role:'main'};
    const caption=target.closest('#img2txt-section');
    if(caption)return {node:caption,role:'caption'};
    const source=target.closest('#img2img-section');
    if(source)return {node:source,role:'source'};
    if(target.closest('.main')&&['create',undefined].includes(document.body.dataset.fullView))
      return {node:document.getElementById('center-panel'),role:currentMode==='img2txt'?'caption':'source'};
    return null;
  }
  document.addEventListener('dragstart',event=>{
    const card=event.target.closest('.gallery-card');
    if(!card||!event.target.closest('img,.card-img-wrap'))return;
    const key=crypto.randomUUID();dragged={key,card};
    event.dataTransfer.setData(type,key);event.dataTransfer.effectAllowed='copy';
  },true);
  document.addEventListener('dragover',event=>{
    if(![...event.dataTransfer.types].some(value=>['Files',type,'text/uri-list'].includes(value)))return;
    const target=targetFor(event.target);if(!target)return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';
    reset();target.node?.classList.add('void-drop-active');hint.hidden=false;
  },true);
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)reset();},true);
  document.addEventListener('dragend',()=>{dragged=null;reset();},true);
  async function readDrop(event){
    const key=event.dataTransfer.getData(type);
    const card=key&&dragged?.key===key?dragged.card:null;
    const file=[...event.dataTransfer.files].find(imageFile);
    const uri=event.dataTransfer.getData('text/uri-list').split(/\r?\n/).find(line=>line&&!line.startsWith('#'));
    if(card){
      const url=await _cardFullDataUrl(card);
      if(!url)throw new Error('無法讀取作品原圖，請重新整理圖庫');
      const response=await fetch(url);if(!response.ok)throw new Error('作品原圖讀取失敗');
      return new File([await response.blob()],'gallery-image.png',{type:'image/png'});
    }
    if(file)return file;
    if(uri){
      const url=new URL(uri,location.href);
      if(![location.origin,'http://127.0.0.1:8090','http://127.0.0.1:8188'].includes(url.origin)&&!uri.startsWith('data:image/'))
        throw new Error('請拖入本機圖片或 VOID 作品卡');
      const response=await fetch(url.href);if(!response.ok)throw new Error('圖片讀取失敗');
      const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('拖入的內容不是圖片');
      return new File([blob],'dropped-image.png',{type:blob.type});
    }
    throw new Error('請拖入圖片檔或 VOID 作品卡');
  }
  document.addEventListener('drop',event=>{
    const target=targetFor(event.target);if(!target)return;
    if(![...event.dataTransfer.types].some(value=>['Files',type,'text/uri-list'].includes(value)))return;
    event.preventDefault();event.stopImmediatePropagation();reset();
    // Read DataTransfer before leaving the event: browsers clear it afterwards.
    const incoming=readDrop(event);dragged=null;
    void incoming.then(async file=>{
      if(file.size>32*1024*1024)throw new Error('請使用 32 MB 以內的圖片');
      if(target.role==='main'||target.role==='ref')await VoidStudio.addFile(file,target.role);
      else if(target.role==='caption'){setMode('img2txt');_load2txtFile(file);}
      else{setMode('img2img');if(currentMode!=='img2img')throw new Error('請先停止目前的任務再載入圖片');_loadImg2imgFile(file);}
    }).catch(error=>setStatus(error.message,'error'));
  },true);
})();
