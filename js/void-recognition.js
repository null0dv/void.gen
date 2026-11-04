/* Local image recognition shares ComfyUI, with a separate engine preference. */
window.VoidRecognition = (() => {
  const $ = id => document.getElementById(id);
  const titles = {wd14:'WD14 標籤', qwen:'Qwen-VL 詳細描述', florence:'Florence-2 輕量描述'};
  const presets = {
    prompt:'Describe only the visible contents of this image as a single English paragraph suitable for an image generation prompt. Include the subject, visible appearance, clothing, pose, setting, composition, lighting and colors when applicable. Be factual, omit uncertain details and do not invent camera settings.',
    zh:'請用繁體中文客觀描述這張圖片，只描述清楚可見的內容。依照主體、可見外觀、服裝、姿勢、環境、構圖、光線及色彩整理成一段完整文字。略過不確定的細節，不要猜測人物身分或編造相機參數。',
    brief:'Describe the visible contents of this image in one or two factual English sentences.'
  };
  let busy=false, cancelled=false, promptId=null, info=null;
  const engine=() => $('recognition-engine').value;
  const isBusy=() => busy;
  function resultActions(enabled) {
    for (const id of ['tagger-send-btn','tagger-copy-btn']) {
      $(id).setAttribute('aria-disabled',String(!enabled));
      $(id).style.opacity=enabled ? '' : '.4';
    }
  }
  async function request(path, options={}, timeoutMs=15000) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetch(COMFY_API+path,{...options,signal:controller.signal});
      if (!response.ok) {
        const detail=await response.json().catch(()=>({}));
        const nodes=Object.values(detail.node_errors || {}).flatMap(n=>(n.errors || []).map(e=>e.message+': '+e.details));
        throw new Error([detail.error?.message,...nodes].filter(Boolean).join(' · ') || `HTTP ${response.status}`);
      }
      const body=await response.text();
      return body ? JSON.parse(body) : null;
    } finally {clearTimeout(timer);}
  }
  const post=(path,data)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  function presetChanged() {
    $('recognition-instruction').value=presets[$('recognition-style').value] || presets.prompt;
    remember();
  }
  function remember() {
    localStorage.setItem('void-recognition',JSON.stringify({engine:engine(),style:$('recognition-style').value,instruction:$('recognition-instruction').value,task:$('florence-task').value}));
  }
  async function selectEngine() {
    if (busy) return;
    const selected=engine();
    $('wd14-settings').hidden=selected!=='wd14';
    $('qwen-recognition-settings').hidden=selected!=='qwen';
    $('florence-recognition-settings').hidden=selected!=='florence';
    $('tagger-output-wrap').style.display='none';
    $('recognition-source-label').textContent='本機辨識';
    remember();
    await check();
  }
  async function check() {
    const selected=engine();
    $('recognition-info').textContent='正在檢查辨識引擎…';
    try {
      info=await request('/object_info');
      if (selected!==engine()) return;
      if (selected==='qwen') {
        if (!info.TextGenerate || !info.PreviewAny || !info.CLIPLoader?.input.required.clip_name[0].includes('qwen3vl_8b_int8_convrot.safetensors')) throw new Error('缺少 Qwen-VL 模型或文字生成節點，請檢查 ComfyUI。');
        $('recognition-info').textContent='適合照片、人物外觀與場景分析。可輸出英文生圖 prompt 或繁體中文描述。';
      } else if (selected==='florence') {
        if (!info.Florence2Run || !info.Florence2ModelLoader?.input.required.model[0].includes('Florence-2-large')) throw new Error('Florence-2 尚未就緒，請重啟 ComfyUI 後重試。');
        $('recognition-info').textContent='輕量英文圖說，適合快速描述主體與環境。';
      } else {
        if (!Object.keys(info).some(name=>name.includes('WD14Tagger'))) throw new Error('未找到 WD14 節點。');
        $('recognition-info').textContent='快速抽出動漫、服裝、姿勢等標籤；門檻越低，標籤通常越多。';
      }
    } catch(error) {
      if (selected===engine()) $('recognition-info').textContent=error.message;
    }
  }
  function buildWorkflow(selected,image,prompt=presets.prompt,task='more_detailed_caption') {
    const node=(class_type,inputs)=>({class_type,inputs});
    const wf={'1':node('LoadImage',{image})};
    if (selected==='qwen') {
      wf['2']=node('CLIPLoader',{clip_name:'qwen3vl_8b_int8_convrot.safetensors',type:'stable_diffusion',device:'default'});
      wf['3']=node('TextGenerate',{clip:['2',0],image:['1',0],prompt,max_length:512,sampling_mode:'off',thinking:false,use_default_template:true,mtp:'off'});
      wf['4']=node('PreviewAny',{source:['3',0]});
    } else if (selected==='florence') {
      wf['2']=node('Florence2ModelLoader',{model:'Florence-2-large',precision:'fp16',convert_to_safetensors:false});
      wf['3']=node('Florence2Run',{image:['1',0],florence2_model:['2',0],text_input:'',task,fill_mask:false,keep_model_loaded:false,max_new_tokens:256,num_beams:3,do_sample:false,seed:1});
      wf['4']=node('PreviewAny',{source:['3',2]});
    } else throw new Error('不支援的辨識引擎');
    return wf;
  }
  async function prepareImage() {
    const image=new Image();
    image.src=document.querySelector('#img2txt-upload img')?.src || `data:image/png;base64,${img2txtBase64}`;
    await image.decode();
    const scale=Math.min(1,1024/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');
    context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }
  async function cancelJob() {
    if (!promptId) return;
    await post('/queue',{delete:[promptId]});
    const queue=await request('/queue');
    if (queue.queue_running?.some(item=>item[1]===promptId)) await post('/interrupt',{}).catch(()=>{});
  }
  async function cancel() {
    if (!busy) return;
    cancelled=true;
    $('recognition-cancel').disabled=true;
    setStatus('正在取消圖片辨識…','warn');
    await cancelJob().catch(()=>{});
  }
  async function run() {
    if (busy || innerWidth<=900) return;
    if (isGenerating) {setStatus('請等待目前生圖完成，再辨識圖片','warn'); return;}
    if (!img2txtBase64) {setStatus('請先上傳圖片','warn'); return;}
    const selected=engine(), started=Date.now();
    const instruction=$('recognition-instruction').value.trim() || presets[$('recognition-style').value];
    busy=true; cancelled=false; promptId=null; remember();
    resultActions(false);
    $('recognition-engine').disabled=true;
    $('interrogate-btn').disabled=true; $('interrogate-btn').textContent='辨識中…';
    $('recognition-cancel').hidden=false; $('recognition-cancel').disabled=false;
    $('tagger-output-wrap').style.display='none';
    VoidGenFlow?.setState('generating');
    try {
      setStatus(`正在準備圖片 · ${titles[selected]}`);
      const prepared=await prepareImage();
      if (cancelled) throw new Error('辨識已取消');
      const name=await _uploadBase64ToComfyInput(prepared,`void-recognize-${Date.now()}.png`);
      if (cancelled) throw new Error('辨識已取消');
      let text='';
      if (selected==='wd14') {
        const general=Number($('tagger-threshold').value), character=Number($('tagger-char-threshold').value);
        setStatus('正在抽取 WD14 標籤…');
        // The tagger endpoint is local and does not queue a ComfyUI prompt.
        text=await request(`/pysssss/wd14tagger/tag?filename=${encodeURIComponent(name)}&type=input&threshold=${general}&character_threshold=${character}`,{},120000);
      } else {
        const wf=buildWorkflow(selected,name,instruction,$('florence-task').value);
        const response=await post('/prompt',{prompt:wf,client_id:_COMFY_CLIENT_ID+'-recognition'});
        promptId=response.prompt_id;
        if (cancelled) {await cancelJob(); throw new Error('辨識已取消');}
        while (Date.now()-started<5*60*1000) {
          if (cancelled) throw new Error('辨識已取消');
          const history=await request('/history/'+promptId);
          const result=history[promptId];
          if (result) {
            if (result.status?.status_str!=='success') {
              const failure=result.status?.messages?.find(([name])=>name==='execution_error')?.[1];
              throw new Error(failure?.exception_message || '辨識未完成');
            }
            text=(result.outputs?.['4']?.text || []).join('\n');
            break;
          }
          setStatus(`辨識中 · ${titles[selected]} · ${Math.round((Date.now()-started)/1000)} 秒`);
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
      }
      if (cancelled) throw new Error('辨識已取消');
      if (!text?.trim()) throw new Error('未取得辨識文字，請重試或改用其他引擎。');
      $('tagger-output').textContent=text.trim();
      resultActions(true);
      $('recognition-result-label').textContent=`${titles[selected]} · ${((Date.now()-started)/1000).toFixed(1)} 秒`;
      $('tagger-output-wrap').style.display='block';
      VoidGenFlow?.setState('done');
      setStatus('辨識完成，可按 SEND 填入提示詞','ok');
    } catch(error) {
      resultActions(false);
      await cancelJob().catch(()=>{});
      $('tagger-output').textContent=cancelled ? '辨識已取消' : error.message;
      $('recognition-result-label').textContent=titles[selected];
      $('tagger-output-wrap').style.display='block';
      VoidGenFlow?.setState(cancelled ? 'cancelled' : 'error');
      setStatus(cancelled ? '辨識已取消' : `辨識失敗 · ${error.message}`,cancelled ? 'warn' : 'error');
    } finally {
      busy=false; promptId=null;
      $('recognition-engine').disabled=false;
      $('interrogate-btn').disabled=false; $('interrogate-btn').textContent='辨識提示詞';
      $('recognition-cancel').hidden=true;
      window.dispatchEvent(new Event('void-generation-state'));
    }
  }
  let saved={};
  try {saved=JSON.parse(localStorage.getItem('void-recognition') || '{}');} catch {}
  $('recognition-engine').value='wd14';
  $('recognition-style').value=presets[saved.style] ? saved.style : 'prompt';
  $('recognition-instruction').value=saved.instruction || presets[$('recognition-style').value];
  if (['caption','detailed_caption','more_detailed_caption'].includes(saved.task)) $('florence-task').value=saved.task;
  window.addEventListener('beforeunload',remember);
  selectEngine();
  return {run,cancel,isBusy,selectEngine,presetChanged,remember,check,buildWorkflow};
})();
