/* VOID FULL and Pocket read the same computer-owned gallery. */
window.VoidSharedGallery = (() => {
  const base='http://127.0.0.1:8091';
  let online=false,lastSignature='',refreshing=false;
  const pathOf=record=>[record.meta?.subfolder||'',record.meta?.filename||record.filename||''].filter(Boolean).join('/').replaceAll('\\','/');
  async function request(path,options={}) {
    const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('共用圖庫連線失敗（'+response.status+'）');
    return response.json();
  }
  async function list(){
    const images=[];let total=Infinity;
    while(images.length<total){const page=await request('/api/gallery?offset='+images.length);total=page.total;images.push(...page.images);if(!page.images.length)break;}
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
    try{const remote=await list();online=true;lastSignature=JSON.stringify(remote);return merge(local,remote);}
    catch(error){online=false;console.warn('[VOID shared gallery]',error);return local;}
  }
  async function favorite(id,value){return request('/api/gallery/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:value})});}
  async function fullData(id){
    const response=await fetch(base+'/media/'+encodeURIComponent(id),{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('原圖讀取失敗');
    const blob=await response.blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  }
  async function poll(){
    if(refreshing||document.hidden||window.voidGalleryClearing||typeof gallerySelectMode==='undefined'||gallerySelectMode||document.getElementById('modal-bg')?.classList.contains('open'))return;
    refreshing=true;
    try{const remote=await list();const signature=JSON.stringify(remote);if(signature!==lastSignature){const view=document.getElementById('gallery-view'),scroll=view?.scrollTop||0;await loadSavedGallery();if(view)view.scrollTop=scroll;}}catch{}finally{refreshing=false;}
  }
  window.addEventListener('load',()=>{
    const toolbar=document.querySelector('.gallery-toolbar');
    if(toolbar){const button=document.createElement('button');button.className='tb-btn';button.textContent='更新共用圖庫';button.onclick=async()=>{button.disabled=true;try{await loadSavedGallery();setStatus(online?'共用圖庫已更新':'共用圖庫離線，顯示瀏覽器紀錄',online?'ok':'warn');}finally{button.disabled=false;}};toolbar.prepend(button);}
    setInterval(poll,8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  });
  return {load,merge,favorite,fullData,isOnline:()=>online};
})();
