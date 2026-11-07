(() => {
 const bar=document.querySelector('.topbar-right');if(!bar)return;
 const open=document.createElement('button');open.className='tb-btn';open.textContent='手機／共用圖庫';open.onclick=()=>window.open('http://127.0.0.1:8090','_blank','noopener');bar.prepend(open);
 const sync=document.createElement('button');sync.className='tb-btn';sync.textContent='同步舊圖庫';sync.title='將此瀏覽器的圖片、收藏與相簿複製至電腦共用圖庫';bar.append(sync);
 sync.onclick=async()=>{
  sync.disabled=true;let done=0,failed=0;
  try {
   const rows=await dbLoadGalleryList();const albums=typeof getAlbums==='function'?getAlbums():[];
   const favs=new Set(JSON.parse(localStorage.getItem('void-gen-favs')||'[]'));
   for(const item of rows){
    const rec=await dbLoadById(item.id);if(!rec)continue;
    const key='db_'+rec.id;
    const meta={...rec.meta,filename:rec.meta?.filename||rec.filename,albums:albums.filter(a=>a.cards?.includes(key)).map(a=>a.name)};
    try{const response=await fetch('http://127.0.0.1:8090/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'desktop:'+rec.id,meta,dataUrl:rec.dataUrl,favorite:favs.has(key)||favs.has('ts_'+rec.ts)})});if(!response.ok)throw Error();done++;}catch{failed++;}
    sync.textContent=`同步 ${done}/${rows.length}`;
   }
   alert(`已同步 ${done} 張${failed?'，失敗 '+failed+' 張（請確認手機服務已啟動）':''}。原本的圖片仍保留。`);
  }catch(error){alert('同步失敗：'+error.message);}finally{sync.disabled=false;sync.textContent='同步舊圖庫';}
 };
})();
