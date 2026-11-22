/* Image editing surface for Pocket: one shared source, references and versions. */
window.VoidEditStudio=class {
 constructor(env){
  this.env=env;this.cap=null;this.pose=null;this.pending=[];this.version=0;this.historyToken=0;this.lastGroup='';this.result=null;
  const $=id=>document.getElementById(id);this.$=$;
  const surface=document.createElement('section');surface.className='edit-surface';surface.hidden=true;
  surface.innerHTML=`<div class="edit-stage-head"><div><p class="eyebrow">IMAGE WORKSPACE</p><h2>圖改圖工作區</h2></div><button id="edit-new" type="button">新的一輪</button><span id="edit-stage-label">先加入主圖</span></div>
   <div class="edit-stage"><img id="edit-stage-image" alt="目前選擇的圖片" hidden><div id="edit-stage-empty"><span>＋</span><h3>從一張圖開始</h3><p>加入主圖，選擇動作，再描述想修改的地方。</p></div></div>
   <div class="edit-stage-actions"><button id="edit-use-result" type="button" hidden>用這張繼續改 ↗</button><button id="edit-show-source" type="button" hidden>查看目前主圖</button><a id="edit-download" class="button" hidden download>下載結果</a></div>
   <p id="edit-status" class="hint" role="status">選定結果後才會換成下一輪主圖，原角色參考會保留。</p>
   <div class="edit-ingredients"><article id="edit-main-card"><h3>主圖 <small>這次要改的圖</small></h3></article><article id="edit-anchor-card"><h3>角色參考 <small>固定外觀與原服裝</small></h3><button id="edit-anchor-source" type="button">以目前主圖固定角色</button></article><article id="edit-pose-card"><h3>動作 <small>選填</small></h3><div id="edit-pose-preview" class="edit-pose-preview"><p class="hint">不選時沿用主圖動作</p></div><div class="two"><button id="edit-pose-open" type="button">選動作</button><button id="edit-pose-clear" type="button">清除</button></div><label for="edit-pose-angle" hidden id="edit-pose-angle-label">動作角度</label><select id="edit-pose-angle" hidden></select></article></div>
   <p id="edit-engine-note" class="hint"></p>`;
  const versions=document.createElement('section');versions.className='edit-version-panel';versions.hidden=true;
  versions.innerHTML='<div class="label-row"><h2>版本紀錄</h2><button id="edit-versions-refresh" type="button">重新整理</button></div><p class="hint">點選版本作為主圖，從這個版本繼續修改。</p><div id="edit-version-grid" class="edit-version-grid"></div>';
  const form=$('generate-form'),controls=document.createElement('div');controls.className='edit-controls';
  while(form.firstChild)controls.append(form.firstChild);
  form.append(surface,controls,versions);this.surface=surface;this.versions=versions;
  const main=$('gen-source').closest('input'),mainZone=document.querySelector('label[for="gen-source"]');
  mainZone.append(main);main.hidden=false;main.className='edit-file-input';
  $('edit-main-card').append(mainZone,$('gen-source-gallery'));
  const reference=$('gen-reference'),zone=document.querySelector('label[for="gen-reference"]');
  zone.append(reference);reference.hidden=false;reference.className='edit-file-input';
  zone.querySelector('span').textContent='＋ 上傳原角色參考';
  $('edit-anchor-card').append(zone,$('gen-reference-gallery'),$('gen-reference-clear'));
  $('gen-source-gallery').textContent='圖庫選主圖';$('gen-reference-gallery').textContent='圖庫選角色參考';
  $('edit-anchor-source').onclick=()=>{const c=env.context();if(!c.upload){env.toast('請先加入主圖');return;}env.anchor(c.upload);$('gen-reference-preview').src='/upload/'+c.upload;$('gen-reference-preview').hidden=false;this.persist();env.toast('角色參考已固定，繼續改圖時會保留');};
  $('edit-use-result').onclick=()=>{if(this.result)void env.select(this.result);};
  $('edit-new').onclick=()=>{env.reset();this.pose=null;this.prepared=null;this.pending=[];this.lastGroup='';this.result=null;this.historyToken++;$('edit-version-grid').replaceChildren();this.renderPose();this.showSource();this.persist();env.toast('已開始新的一輪；先前任務與作品仍保留在圖庫');};
  $('edit-show-source').onclick=()=>this.showSource();
  $('edit-versions-refresh').onclick=()=>void this.loadVersions(true);
  $('edit-pose-open').onclick=()=>{this.dialog.showModal();void this.loadPoses();};
  $('edit-pose-clear').onclick=()=>{this.pose=null;this.prepared=null;this.renderPose();this.persist();};
  $('edit-pose-angle').onchange=()=>{this.pose.angle=$('edit-pose-angle').value;this.prepared=null;this.renderPose();this.persist();};
  this.buildPicker();
  try{const saved=JSON.parse(localStorage.getItem('void-pocket-edit-studio')||'{}');this.pose=saved.pose||null;this.pending=Array.isArray(saved.pending)?saved.pending:[];env.restore(saved);if(Number.isFinite(saved.characterStrength))$('edit-character-strength').value=saved.characterStrength;if(Number.isFinite(saved.poseStrength))$('edit-pose-strength').value=saved.poseStrength;}catch{}
  $('edit-character-strength').addEventListener('change',()=>this.persist());$('edit-pose-strength').addEventListener('change',()=>this.persist());
  this.renderPose();
  $('gen-source-preview').addEventListener('load',()=>{if(!this.result)this.showSource();});
  void env.api('/api/image-edit/capabilities').then(data=>{this.cap=data.sdxl;env.changed();}).catch(()=>{this.cap={ready:false,models:[],missing:['無法讀取 SDXL 元件']};env.changed();});
 }
 persist(){const c=this.env.context();try{localStorage.setItem('void-pocket-edit-studio',JSON.stringify({pose:this.pose,pending:this.pending,upload:c.upload,anchor:c.anchor,group:c.group,parent:c.parent,characterStrength:Number(this.$('edit-character-strength').value),poseStrength:Number(this.$('edit-pose-strength').value)}));}catch{}}
 buildPicker(){
  const dialog=document.createElement('dialog');dialog.id='edit-pose-picker';
  dialog.innerHTML=`<div class="dialog-head"><h2>選擇動作</h2><button type="button" id="edit-pose-close" aria-label="關閉">✕</button></div><div class="edit-pose-filters"><input id="edit-pose-search" type="search" placeholder="搜尋動作、編號…" aria-label="搜尋動作"><select id="edit-pose-framing" aria-label="動作範圍"><option value="">全部範圍</option><option value="upper">半身</option><option value="full">全身</option></select><select id="edit-pose-rating" aria-label="素材分級"><option value="all">全部分級</option><option value="general">一般</option><option value="adult">18+</option></select></div><p id="edit-pose-status" class="hint" role="status"></p><div id="edit-pose-grid"></div><div class="two"><button id="edit-pose-prev" type="button">上一頁</button><button id="edit-pose-next" type="button">下一頁</button></div>`;
  document.body.append(dialog);this.dialog=dialog;this.offset=0;this.searchTimer=null;
  this.$('edit-pose-close').onclick=()=>dialog.close();
  for(const id of ['edit-pose-search','edit-pose-framing','edit-pose-rating'])this.$(id).addEventListener(id.endsWith('search')?'input':'change',()=>{clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>{this.offset=0;void this.loadPoses();},200);});
  this.$('edit-pose-prev').onclick=()=>{this.offset=Math.max(0,this.offset-24);void this.loadPoses();};
  this.$('edit-pose-next').onclick=()=>{this.offset+=24;void this.loadPoses();};
 }
 asset(rel){return '/api/dressing/image/'+rel.split('/').map(encodeURIComponent).join('/');}
 async loadPoses(){
  const rev=++this.version,$=this.$;$('edit-pose-status').textContent='讀取動作…';
  try{const q=new URLSearchParams({kind:'pose',q:$('edit-pose-search').value,framing:$('edit-pose-framing').value,rating:$('edit-pose-rating').value,limit:24,offset:this.offset});const r=await this.env.api('/api/dressing/items?'+q);if(rev!==this.version)return;
   $('edit-pose-grid').replaceChildren(...r.items.map(item=>{const b=document.createElement('button');b.type='button';const img=document.createElement('img');img.src=this.asset(item.angles[0].thumb);img.loading='lazy';img.alt='';const name=document.createElement('span');name.textContent=item.title+(item.adult?' · 18+':'');b.append(img,name);b.onclick=()=>{this.pose={id:item.id,title:item.title,en:item.en,angles:item.angles,angle:item.angles[0].id};this.prepared=null;this.renderPose();this.persist();this.dialog.close();};return b;}));$('edit-pose-status').textContent=`共 ${r.total} 組 · 第 ${Math.floor(this.offset/24)+1} 頁`;$('edit-pose-prev').disabled=!this.offset;$('edit-pose-next').disabled=this.offset+24>=r.total;
  }catch(e){if(rev===this.version)$('edit-pose-status').textContent=e.message;}
 }
 renderPose(){const $=this.$,box=$('edit-pose-preview');box.replaceChildren();$('edit-pose-angle').hidden=$('edit-pose-angle-label').hidden=!this.pose;if(!this.pose){const p=document.createElement('p');p.className='hint';p.textContent='不選時沿用主圖動作';box.append(p);return;}const angle=this.pose.angles.find(a=>a.id===this.pose.angle)||this.pose.angles[0];this.pose.angle=angle.id;const image=document.createElement('img');image.src=this.asset(angle.thumb);image.alt=this.pose.title;const p=document.createElement('p');p.textContent=this.pose.title;box.append(image,p);$('edit-pose-angle').replaceChildren(...this.pose.angles.map(a=>new Option(a.label,a.id)));$('edit-pose-angle').value=angle.id;}
 sync(){const c=this.env.context(),edit=c.mode==='img2img',advanced=edit&&c.chain,$=this.$;document.body.classList.toggle('edit-studio',advanced);this.surface.hidden=this.versions.hidden=!advanced;const zone=document.querySelector('label[for="gen-source"]'),gallery=$('gen-source-gallery');if(advanced){$('edit-main-card').append(zone,gallery);}else{$('gen-source-settings').prepend(gallery,zone);}const sd=c.engine==='sd';$('edit-anchor-card').hidden=!c.chain&&!sd;$('edit-pose-card').hidden=!['sd','klein'].includes(c.engine)||(!c.chain&&!sd);$('edit-engine-note').textContent=sd?'SDXL 會以主圖作底圖修改。改動幅度越高，越容易改變角色。動作目前使用原始配對深度圖，仍可能帶入人偶體型。':'Klein 依圖片與文字指令修改；角色參考固定外觀，動作圖只作姿態參考。';if(advanced)void this.loadVersions();}
 sourceSelected(upload,image,anchor){if(this.loadingResult)return;this.result=null;this.env.anchor(image?.meta?.anchorUpload||anchor||upload);this.persist();this.showSource();void this.loadVersions(true);}
 showSource(){const c=this.env.context(),$=this.$;$('edit-stage-image').src=c.upload?'/upload/'+c.upload:'';$('edit-stage-image').hidden=!c.upload;$('edit-stage-empty').hidden=!!c.upload;$('edit-stage-label').textContent=c.upload?'目前主圖':'先加入主圖';$('edit-use-result').hidden=true;$('edit-show-source').hidden=true;$('edit-download').hidden=true;}
 async prepare(data){const c=this.env.context();if(c.mode!=='img2img'||!['sd','klein'].includes(c.engine)||!c.chain)return data;
  if(c.engine==='sd'&&this.cap?.ready!==true)throw new Error('SDXL 元件尚未就緒');
  const imageEdit={};
  if(this.pose){const spec={id:this.pose.id,angle:this.pose.angle,variant:'original'};const key=JSON.stringify(spec);if(this.prepared?.key!==key)this.prepared={key,...await this.env.send('/api/image-edit/prepare',{pose:spec})};Object.assign(imageEdit,{pose:spec,poseUpload:this.prepared.poseUpload,depthUpload:this.prepared.depthUpload,poseDescription:this.pose.en||''});}
  data.imageEdit=imageEdit;data.anchorUpload=c.anchor||c.upload;data.count=1;
  if(c.engine==='sd'){data.continuous=false;delete data.referenceUpload;delete data.maskUpload;data.characterStrength=Number(this.$('edit-character-strength').value);data.poseStrength=Number(this.$('edit-pose-strength').value);if(this.pose&&String(data.prompt||'').trim())data.prompt+=`, ${this.pose.en||this.pose.title}`;}
  else if(this.pose)data.prompt+='\nReference order: Image 1 is the current image to edit. '+(data.referenceUpload?'Image 2 is the original character identity and outfit reference. ':'')+'The last image specifies the target pose and camera angle ONLY. Preserve character identity, face, hair, clothing, body shape and chest size from the character images. Ignore the pose mannequin body volume, chest, clothing and texture. Change only the requested action and explicitly requested details.';
  return data;
 }
 submitted(ids){this.pending=[...new Set([...this.pending,...ids])];this.persist();this.$('edit-status').textContent='已加入共用佇列，完成後會出現在此處。你可以先切換頁面。';}
 async updateJobs(jobs){if(!this.pending.length||this.checking)return;this.checking=true;try{for(const id of [...this.pending]){const job=jobs.find(j=>j.id===id);if(!job)continue;const group=this.env.context().group;if(job.request?.editGroup!==group){this.pending=this.pending.filter(x=>x!==id);continue;}if(['error','cancelled'].includes(job.state)){this.pending=this.pending.filter(x=>x!==id);this.$('edit-status').textContent=job.error||'這一輪已取消';continue;}if(job.state!=='done')continue;const gallery=job.result?.gallery?.[0];if(!gallery)continue;const result=await this.env.api('/api/gallery/'+gallery);this.pending=this.pending.filter(x=>x!==id);if(group!==this.env.context().group)continue;this.result=result;const $=this.$;$('edit-stage-image').src=this.result.url;$('edit-stage-image').hidden=false;$('edit-stage-empty').hidden=true;$('edit-stage-label').textContent='新結果 · 尚未替換主圖';$('edit-use-result').hidden=false;$('edit-show-source').hidden=false;$('edit-download').hidden=false;$('edit-download').href=this.result.url;$('edit-status').textContent='完成。按「用這張繼續改」接續，或從版本紀錄選另一個分支。';void this.loadVersions(true);}this.persist();}catch(e){this.$('edit-status').textContent=e.message;}finally{this.checking=false;}}
 async loadVersions(force=false){const c=this.env.context();if(!c.group){this.$('edit-version-grid').textContent='生成第一版後，紀錄會保存在這裡。';this.lastGroup='';return;}if(this.lastGroup===c.group&&!force)return;const token=++this.historyToken;this.lastGroup=c.group;try{const r=await this.env.api('/api/gallery?'+new URLSearchParams({editGroup:c.group,limit:60}));if(token!==this.historyToken||c.group!==this.env.context().group)return;this.$('edit-version-grid').replaceChildren(...r.images.slice().reverse().map((image,index)=>{const b=document.createElement('button');b.type='button';const img=document.createElement('img');img.src=image.thumb;img.loading='lazy';img.alt='';const label=document.createElement('span');label.textContent=`第 ${index+1} 版 · 繼續改圖`;b.append(img,label);b.onclick=()=>void this.env.select(image);return b;}));}catch(e){this.lastGroup='';this.$('edit-status').textContent='版本紀錄讀取失敗：'+e.message;}}
};
