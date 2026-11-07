'use strict';
const $=id=>document.getElementById(id), API='http://127.0.0.1:8188';
let ready=false, imageName='', sourceURL='', job=null, socket=null, checking=false, submitting=false;
const stages={'1':'載入文字編碼器','2':'理解動作提示詞','3':'處理負面提示詞','4':'載入 VAE','5':'讀取照片','6':'建立影片起始畫面','10':'載入高噪模型','11':'套用高噪加速','12':'準備高噪模型','20':'載入低噪模型','21':'套用低噪加速','22':'準備低噪模型','30':'生成動態 · 前半段','31':'生成細節 · 後半段','32':'分塊解碼影片','33':'建立影片','34':'儲存 MP4'};
async function api(path,body){const r=await fetch(API+path,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const text=await r.text(),data=text?JSON.parse(text):{};if(!r.ok)throw Error(data.error?.message||JSON.stringify(data));return data;}
function status(s){$('status').textContent=s;}
function buttons(){ $('generate').disabled=!ready||!imageName||!!job||submitting; $('cancel').hidden=!job; }
function settings(){const [width,height]=$('size').value.split(',').map(Number),fps=Number($('fps').value),frames=4*Math.round(Number($('seconds').value)*fps/4)+1;return{width,height,fps,frames,prompt:$('prompt').value.trim(),negative:$('negative').value.trim(),seed:Number($('seed').value)<0?crypto.getRandomValues(new Uint32Array(1))[0]:Number($('seed').value),image:imageName};}
function remember(){localStorage.setItem('void-motion-settings',JSON.stringify(Object.fromEntries(['prompt','negative','size','seconds','fps','seed'].map(id=>[id,$(id).value]))));const p=settings();$('estimate').textContent=`${p.width} × ${p.height} / ${p.frames} 幀 / ${(p.frames/p.fps).toFixed(1)} 秒 · 無音軌`;$('estimate').title='10 秒或 24 FPS 會增加生成時間及記憶體需求。';}
async function check(){if(checking)return;checking=true;try{const [stats,info]=await Promise.all([api('/system_stats'),api('/object_info')]);const g=buildMotionGraph({image:'check.png',width:640,height:384,frames:81,fps:16,seed:1,prompt:'test'});const missing=[];for(const n of Object.values(g)){const s=info[n.class_type];if(!s){missing.push(n.class_type);continue;}for(const [k,v]of Object.entries(n.inputs)){const spec=s.input.required?.[k]||s.input.optional?.[k];if(['unet_name','clip_name','vae_name','lora_name'].includes(k)&&Array.isArray(spec?.[0])&&!spec[0].includes(v))missing.push(v);}}ready=!missing.length;$('dot').classList.add('online');$('connection').textContent=ready?'已就緒':'模型安裝中';$('hardware').textContent=`${stats.devices?.[0]?.name?.replace(/^cuda:0 /,'').split(' : ')[0]||'GPU'} / 本機生成`;if(missing.length&&!job)status('尚缺元件：'+[...new Set(missing)].join('、'));else if(!job)status('模型已就緒 · 上傳照片即可開始');}catch(e){ready=false;$('dot').classList.remove('online');$('connection').textContent='未連線';if(!job)status('請先執行 Start-VOID-Full.cmd 啟動本機服務。');}finally{checking=false;buttons();}}
async function upload(file){if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>30*1024*1024){status('請選擇 30MB 以內的 PNG、JPG 或 WEBP。');return;}imageName='';buttons();status('上傳照片至本機…');try{const form=new FormData();form.append('image',file);form.append('type','input');form.append('overwrite','false');const r=await fetch(API+'/upload/image',{method:'POST',body:form,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('照片上傳失敗');const data=await r.json();imageName=(data.subfolder?data.subfolder+'/':'')+data.name;if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=URL.createObjectURL(file);$('source').src=sourceURL;$('source').hidden=false;$('upload-label').hidden=true;$('source-meta').textContent=file.name;status('照片已載入 · 描述你想要的動態');}catch(e){status(e.message);}buttons();}
function busy(on){$('busy').hidden=!on;buttons();}
function finish(message){job=null;localStorage.removeItem('void-motion-active');busy(false);status(message);if(socket){socket.close();socket=null;}}
function connect(){if(socket)socket.close();socket=new WebSocket(API.replace('http','ws')+'/ws?clientId='+encodeURIComponent(job.client));socket.onmessage=event=>{if(typeof event.data!=='string')return;const {type,data}=JSON.parse(event.data);if(!job||data.prompt_id&&data.prompt_id!==job.id)return;if(type==='executing'&&data.node){$('phase').textContent=stages[data.node]||'處理影片';}if(type==='progress'){$('progress').value=Math.round(data.value/data.max*100);$('phase').textContent=`${stages[data.node]||'採樣中'} · ${data.value}/${data.max}`;}};}
async function generate(){if(job||submitting)return;const p=settings();if(!p.prompt){$('prompt').focus();status('請先描述動作，或點選一個動態範例。');return;}if(!imageName||!ready)return;remember();submitting=true;buttons();try{const client=crypto.randomUUID(),graph=buildMotionGraph(p);const result=await api('/prompt',{prompt:graph,client_id:client,extra_data:{extra_pnginfo:{void_motion:p}}});job={id:result.prompt_id,client,started:Date.now(),settings:p};localStorage.setItem('void-motion-active',JSON.stringify(job));$('progress').value=0;$('phase').textContent='排隊等待中';status('已加入本機佇列；首次載入模型可能較久。');busy(true);connect();}catch(e){status('無法開始：'+e.message);}finally{submitting=false;buttons();}}
async function poll(){if(!job)return;const active=job;$('elapsed').textContent=`已等待 ${Math.floor((Date.now()-active.started)/1000)} 秒`;try{const history=await api('/history/'+active.id);if(job!==active)return;const entry=history[active.id];if(entry){if(entry.status?.status_str==='error'){const error=entry.status.messages?.find(x=>x[0]==='execution_error')?.[1];finish('生成失敗：'+(error?.exception_message||'請查看 ComfyUI 記錄'));return;}if(entry.status?.completed){finish(entry.status.status_str==='success'?'影片已完成，已儲存在本機。':'生成已停止');$('progress').value=100;await library();return;}}const queue=await api('/queue');if(job!==active)return;if(queue.queue_running.some(x=>x[1]===active.id))status('正在生成影片 · 可切換分頁，回來後會恢復進度');else if(queue.queue_pending.some(x=>x[1]===active.id))status('正在佇列中等待');else if(Date.now()-active.started>15000)finish('任務已結束或被清除，請重新整理影片列表。');}catch(e){status('連線暫時中斷，正在重試；任務可能仍在本機執行。');}}
async function cancel(){if(!job)return;const active=job;try{const q=await api('/queue');if(q.queue_running.some(x=>x[1]===active.id))await api('/interrupt',{prompt_id:active.id});else if(q.queue_pending.some(x=>x[1]===active.id))await api('/queue',{delete:[active.id]});finish('已停止這次生成');}catch(e){status('停止失敗：'+e.message);}}
function videoURL(v){return API+'/view?'+new URLSearchParams({filename:v.filename,subfolder:v.subfolder||'',type:v.type||'output'});}
function selectClip(v,p,button){
  $('player').src=videoURL(v);$('player').hidden=false;$('empty').hidden=true;
  $('download').href=videoURL(v);$('download').download=v.filename;$('download').hidden=false;
  document.querySelectorAll('.clip').forEach(x=>x.classList.remove('selected'));button?.classList.add('selected');
  $('reuse').hidden=!p?.image;
  $('reuse').onclick=()=>{
    imageName=p.image;
    $('source').src=videoURL({filename:p.image.split('/').pop(),subfolder:p.image.includes('/')?p.image.slice(0,p.image.lastIndexOf('/')):'',type:'input'});
    $('source').hidden=false;$('upload-label').hidden=true;$('source-meta').textContent=p.image;
    $('prompt').value=p.prompt;$('negative').value=p.negative;$('seed').value=p.seed;
    const size=p.width+','+p.height;
    if([...$('size').options].some(x=>x.value===size))$('size').value=size;
    $('fps').value=p.fps;$('seconds').value=p.frames/p.fps>7?'10':'5';
    remember();buttons();status('已沿用照片與設定，可修改動態後重新生成。');
  };
  if(p&&!job)status(`${p.width} × ${p.height} · ${(p.frames/p.fps).toFixed(1)} 秒 · seed ${p.seed}`);
}
async function library(){
  try{
    const history=await api('/history?max_items=200');
    const archived=JSON.parse(localStorage.getItem('void-motion-clips')||'[]');
    const found=[];
    for(const entry of Object.values(history).reverse()){
      if(!entry.prompt?.[2]?.['34']?.inputs?.filename_prefix?.startsWith('VOID-Motion/'))continue;
      const p=entry.prompt[3]?.extra_pnginfo?.void_motion;
      for(const out of Object.values(entry.outputs||{}))for(const values of Object.values(out)){
        if(!Array.isArray(values))continue;
        for(const v of values)if(v?.filename?.endsWith('.mp4'))found.push({v,p});
      }
    }
    const unique=new Map();
    for(const clip of [...found,...archived]){const key=clip.v.subfolder+'/'+clip.v.filename;if(!unique.has(key))unique.set(key,clip);}
    const clips=[...unique.values()];
    localStorage.setItem('void-motion-clips',JSON.stringify(clips));
    $('count').textContent=String(clips.length).padStart(2,'0');
    if(!clips.length)return;
    $('library').replaceChildren();
    for(const {v,p}of clips){
      const b=document.createElement('button');b.className='clip';
      const video=document.createElement('video');video.src=videoURL(v);video.muted=true;video.preload='metadata';
      const caption=document.createElement('div');caption.className='caption';
      caption.textContent=p?`${p.width}×${p.height} / ${(p.frames/p.fps).toFixed(1)}s / ${p.fps}fps`:v.filename;
      b.append(video,caption);b.onclick=()=>selectClip(v,p,b);$('library').append(b);
    }
    selectClip(clips[0].v,clips[0].p,$('library').firstChild);
  }catch(e){if(!job)status('讀取影片列表失敗：'+e.message);}
}
$('file').onchange=e=>upload(e.target.files[0]);$('drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click();}};for(const kind of ['dragenter','dragover'])$('drop').addEventListener(kind,e=>{e.preventDefault();$('drop').classList.add('over');});for(const kind of ['dragleave','drop'])$('drop').addEventListener(kind,e=>{e.preventDefault();$('drop').classList.remove('over');if(kind==='drop')upload(e.dataTransfer.files[0]);});
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('prompt').value=b.dataset.prompt;remember();});
for(const id of ['prompt','negative','size','seconds','fps','seed'])$(id).addEventListener('change',remember);
$('generate').onclick=generate;$('cancel').onclick=cancel;$('check').onclick=check;$('refresh').onclick=library;
try{const saved=JSON.parse(localStorage.getItem('void-motion-settings')||'{}');for(const [id,value]of Object.entries(saved))if($(id))$(id).value=value;job=JSON.parse(localStorage.getItem('void-motion-active')||'null');}catch{}
remember();check();library();if(job){busy(true);connect();poll();}setInterval(poll,3000);setInterval(()=>{if(!job)check();},30000);
