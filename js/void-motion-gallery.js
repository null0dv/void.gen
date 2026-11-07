'use strict';
(()=>{
  const base='http://127.0.0.1:8090',dialog=$('source-gallery');
  let offset=0,version=0,loading=false,choosing=false,timer;
  const openButton=document.createElement('button');
  openButton.id='open-source-gallery';openButton.className='gallery-source-button';openButton.textContent='▦ 從圖庫選擇';
  $('drop').after(openButton);
  async function load(reset=false){
    if(loading&&!reset)return;
    const request=++version;
    if(reset){offset=0;$('gallery-grid').replaceChildren();}
    loading=true;$('gallery-more').hidden=true;$('gallery-message').textContent='正在讀取共用圖庫…';
    try{
      const query=new URLSearchParams({offset,search:$('gallery-search').value.trim(),favorite:$('gallery-favorites').checked?'1':'0'});
      const response=await fetch(base+'/api/gallery?'+query,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('圖庫服務回應失敗');
      const page=await response.json();if(request!==version)return;
      for(const item of page.images){
        const button=document.createElement('button');button.className='picker-item';button.title=item.name;button.setAttribute('aria-label','選擇 '+item.name);
        const img=document.createElement('img');img.src=base+item.thumb;img.loading='lazy';img.alt=item.name;
        const caption=document.createElement('span');caption.textContent=(item.favorite?'★ ':'')+item.name;
        button.append(img,caption);button.onclick=()=>choose(item);$('gallery-grid').append(button);
      }
      offset+=page.images.length;
      $('gallery-message').textContent=page.total?`共 ${page.total} 張 · 點選圖片作為影片起始畫面`:'沒有符合條件的圖片';
      $('gallery-more').hidden=offset>=page.total;
    }catch(error){if(request===version)$('gallery-message').textContent='無法讀取共用圖庫。請執行 Start-VOID-Motion.cmd 啟動服務後再試。';}
    finally{if(request===version)loading=false;}
  }
  async function choose(item){
    if(choosing)return;
    choosing=true;dialog.classList.add('choosing');$('gallery-message').textContent='正在載入原圖…';
    try{
      const response=await fetch(base+item.url,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error('原圖已不存在，請重新開啟圖庫');
      const blob=await response.blob();
      const type=blob.type||({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'}[item.name.split('.').pop().toLowerCase()]);
      await upload(new File([blob],item.name,{type}));
      if(imageName){dialog.close();openButton.focus();}
      else $('gallery-message').textContent=$('status').textContent;
    }catch(error){$('gallery-message').textContent='圖片載入失敗：'+error.message;}
    finally{choosing=false;dialog.classList.remove('choosing');}
  }
  openButton.onclick=()=>{dialog.showModal();load(true);};
  $('gallery-close').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  $('gallery-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),250);};
  $('gallery-favorites').onchange=()=>load(true);
  $('gallery-more').onclick=()=>load();
})();
