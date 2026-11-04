/* Engine-specific graphs share the panel's queue, output and gallery. */
window.VoidEngines = (() => {
  const $ = id => document.getElementById(id);
  const key = 'void-engine';
  let engine = 'sd', info = null, requestId = 0;
  const settingsIds = ['model-select', 'sampler-select', 'scheduler-select', 'steps-num', 'cfg-num', 'size-w', 'size-h', 'engine-clip', 'engine-vae', 'moss-shift', 'klein-strength'];
  const kleinLora = 'klein9b-anything-to-real.safetensors';
  const isActive = () => engine !== 'sd';
  const isMoss = () => engine === 'moss';
  const isKlein = () => engine === 'klein';
  const isKleinEdit = () => isKlein() && currentMode === 'img2img';
  const supportsImageEdit = () => !isActive() || isKlein();
  const label = () => isKlein() ? 'Klein 9B' : isMoss() ? 'MOSS' : 'Qwen';
  const requiredNodes = () => isKlein()
    ? ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', ...(isKleinEdit() ? ['LoraLoaderModelOnly', 'LoadImage', 'ImageScaleToTotalPixels', 'VAEEncode', 'ReferenceLatent'] : []), 'EmptyFlux2LatentImage', 'RandomNoise', 'CFGGuider', 'KSamplerSelect', 'Flux2Scheduler', 'SamplerCustomAdvanced', 'VAEDecode', 'SaveImage']
    : isMoss()
    ? ['MOSSOfficialDiffusionLoader', 'MOSSOfficialTextEncoderLoader', 'MOSSOfficialVAELoader', 'MOSSOfficialTextEncode', 'MOSSOfficialSampler', 'MOSSOfficialVAEDecode', 'SaveImage']
    : ['UnetLoaderGGUF', 'TextEncodeQwenImage21', 'CLIPLoader', 'VAELoader', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'];
  const readSettings = name => {
    try {
      const saved = JSON.parse(localStorage.getItem('void-engine-' + name) || '{}');
      for (const [oldId, id] of [['qwen-clip','engine-clip'], ['qwen-vae','engine-vae']]) {
        if (saved[oldId] !== undefined) { saved[id] = saved[oldId]; delete saved[oldId]; }
      }
      return saved;
    }
    catch { return {}; }
  };
  function remember() {
    localStorage.setItem('void-engine-' + engine, JSON.stringify({...Object.fromEntries(settingsIds.map(id => [id, $(id).value])), batch:currentBatch}));
  }
  function apply(settings) {
    for (const [id, value] of Object.entries(settings)) if ($(id)) $(id).value = value;
    for (const name of ['steps', 'cfg']) { syncParam(name, $(name + '-num').value); $(name + '-slider').value = $(name + '-num').value; }
    currentW = Number($('size-w').value); currentH = Number($('size-h').value);
    setSize(currentW, currentH, null);
    if (settings.batch) setBatch(Number(settings.batch), document.querySelector(`.batch-btn[onclick^="setBatch(${Number(settings.batch)},"]`));
  }
  function fill(id, names, preferred) {
    $(id).replaceChildren(...names.map(name => new Option(name, name)));
    if (names.includes(preferred)) $(id).value = preferred;
    if (!names.length) $(id).add(new Option('缺少模型檔案', ''));
  }
  async function loadModels() {
    if (isGenerating) return;
    const version = ++requestId;
    info = null;
    $('engine-status').textContent = `正在檢查 ${label()} 元件…`;
    try {
      const response = await _fetchWithTimeout(`${COMFY_API}/object_info`, 15000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!isActive() || version !== requestId) return;
      info = data;
      const saved = readSettings(engine);
      if (isKlein()) {
        fill('model-select', (data.UnetLoaderGGUF?.input.required.unet_name[0] || []).filter(n => /flux-2-klein-9b-.*\.gguf$/i.test(n)), saved['model-select']);
        fill('engine-clip', (data.CLIPLoader?.input.required.clip_name[0] || []).filter(n => n === 'qwen_3_8b_fp4mixed.safetensors'), saved['engine-clip']);
        fill('engine-vae', (data.VAELoader?.input.required.vae_name[0] || []).filter(n => n === 'flux2-vae.safetensors'), saved['engine-vae']);
      } else if (isMoss()) {
        fill('model-select', (data.MOSSOfficialDiffusionLoader?.input.required.model_name[0] || []).filter(n => /moss-image-(base|sft)/i.test(n)), saved['model-select'] || 'moss-image-sft-bf16.safetensors');
        fill('engine-clip', (data.MOSSOfficialTextEncoderLoader?.input.required.model_name[0] || []).filter(n => /moss-image-qwen35/i.test(n)), saved['engine-clip']);
        fill('engine-vae', (data.MOSSOfficialVAELoader?.input.required.model_name[0] || []).filter(n => /moss-image-vae/i.test(n)), saved['engine-vae']);
      } else {
        fill('model-select', (data.UnetLoaderGGUF?.input.required.unet_name[0] || []).filter(n => /qwen.*2[._-]1/i.test(n)), saved['model-select'] || 'qwen-image-2.1-UC-Q4_K_M.gguf');
        fill('engine-clip', (data.CLIPLoader?.input.required.clip_name[0] || []).filter(n => /qwen3vl_8b/i.test(n)), saved['engine-clip']);
        fill('engine-vae', (data.VAELoader?.input.required.vae_name[0] || []).filter(n => /qwen.*2[._-]1/i.test(n)), saved['engine-vae']);
      }
      updateStatus();
      if ($('m-model')) $('m-model').textContent = $('model-select').value.replace(/\.(gguf|safetensors)$/i, '').slice(0,16);
      updateModelBadge();
    } catch (error) {
      if (version !== requestId || !isActive()) return;
      info = null;
      $('engine-status').textContent = `無法檢查：${error.message}`;
    }
  }
  function updateStatus() {
    const missing = missingComponents();
    $('engine-status').textContent = missing.length ? `缺少：${missing.join('、')}。安裝後重啟 ComfyUI，再按 CHECK。` : isMoss()
        ? 'MOSS 已就緒 · 預設 512×512、8 步、CFG 3、batch 1。文字編碼使用 CPU，記憶體需求較高。'
        : isKlein() ? (isKleinEdit() ? 'Klein 9B 圖生圖已就緒。上傳來源圖片後可套用寫實 LoRA。' : 'Klein 9B 文生圖已就緒。')
        : 'Qwen 已就緒 · 建議 1024×1024、25 步、CFG 1、batch 1。首次載入較久。';
  }
  function missingComponents() {
    const missing = requiredNodes().filter(n => !info?.[n]);
    if (isKleinEdit() && !info?.LoraLoaderModelOnly?.input.required.lora_name[0].includes(kleinLora)) missing.push('寫實 LoRA');
    for (const [id, name] of [['model-select', `${label()} 主模型`], ['engine-clip', '文字編碼器'], ['engine-vae', `${label()} VAE`]]) if (!$(id).value) missing.push(name);
    return missing;
  }
  async function validate() {
    if (!isKlein() && currentMode !== 'txt2img') throw new Error(`${label()} 支援 TXT→IMG，請切回文字生圖。`);
    const missing = missingComponents();
    if (missing.length) throw new Error(`${label()} 缺少：` + missing.join('、'));
    for (const id of ['size-w', 'size-h']) {
      const size = Number($(id).value);
      const multiple = isMoss() || isKlein() ? 16 : 32;
      const min = isMoss() ? 16 : 256, max = isMoss() ? 4096 : 2048;
      if (!Number.isInteger(size) || size < min || size > max || size % multiple) throw new Error(`${label()} 尺寸須為 ${min}～${max}，且是 ${multiple} 的倍數。`);
    }
    if (isMoss() && (!Number.isFinite(Number($('moss-shift').value)) || Number($('moss-shift').value) < 0.01 || Number($('moss-shift').value) > 100)) throw new Error('MOSS shift 須為 0.01～100。');
    if (isKlein()) {
      const strength = $('klein-strength').valueAsNumber;
      const steps = Number($('steps-num').value);
      if (isKleinEdit() && !(strength >= 0 && strength <= 2)) throw new Error('寫實 LoRA 強度須為 0～2。');
      if (!Number.isInteger(steps) || steps < 1 || steps > 100) throw new Error('步數須為 1～100 的整數。');
    }
    remember();
  }
  async function switchEngine(next, initial = false) {
    if (isGenerating || window.VoidRecognition?.isBusy()) { $('engine-select').value = engine; setStatus('請等待目前工作完成再切換引擎', 'warn'); return; }
    if (!initial) remember();
    engine = 'sd';
    localStorage.setItem(key, engine);
    $('engine-select').value = engine;
    $('engine-components').hidden = !isActive();
    $('moss-settings').hidden = !isMoss();
    $('klein-settings').hidden = !isKlein();
    $('denoise-slider').closest('.param-row').hidden = isKlein();
    $('image-batch-settings').hidden = isKlein();
    $('engine-vae-label').textContent = `${label().toUpperCase()} VAE`;
    $('engine-clip').setAttribute('aria-label', `${label()} 文字編碼器`);
    $('engine-vae').setAttribute('aria-label', `${label()} VAE`);
    $('sampler-select').closest('.ss').hidden = isMoss() || isKlein();
    for (const id of ['refiner-select', 'vae-select', 'lora-sel-0', 'hires-enable', 'upscale-enable']) {
      const section = $(id)?.closest('.ss');
      if (section) section.hidden = isActive();
    }
    if (!supportsImageEdit() && currentMode === 'img2img') setMode('txt2img');
    document.querySelectorAll('.mode-btn[data-mode="img2img"]').forEach(button => {
      button.setAttribute('aria-disabled', String(!supportsImageEdit()));
      button.style.opacity = supportsImageEdit() ? '' : '.4';
    });
    const defaults = isMoss() ? {'steps-num':8, 'cfg-num':3, 'size-w':512, 'size-h':512, 'moss-shift':5, batch:1}
      : isKlein() ? {'steps-num':8, 'cfg-num':1, 'size-w':512, 'size-h':512, 'klein-strength':0.8, batch:1}
      : isActive() ? {'steps-num':25, 'cfg-num':1, 'sampler-select':'euler', 'scheduler-select':'simple', 'size-w':1024, 'size-h':1024} : {};
    const settings = Object.assign(defaults, readSettings(engine));
    if (isKlein()) settings.batch = 1;
    apply(settings);
    if (isActive()) await loadModels();
    else { requestId++; await loadComfyModels(); const saved = readSettings('sd'); if (saved['model-select']) $('model-select').value = saved['model-select']; updateModelBadge(); }
  }
  function buildWorkflow(task, model, seed, source) {
    const node = (class_type, inputs) => ({class_type, inputs});
    if (isKlein()) {
      const edit = isKleinEdit();
      if (edit && !source) throw new Error('請上傳來源圖片。');
      const width = Number($('size-w').value), height = Number($('size-h').value);
      const prompt = task.prompt?.trim() || (edit ? 'Convert this illustration into a photorealistic live-action photograph. Preserve the subject, outfit, pose, composition and background.' : '');
      return {saveNodeId:'7', wf:{
        '1':node('UnetLoaderGGUF', {unet_name:model}),
        '2':node('CLIPLoader', {clip_name:$('engine-clip').value, type:'flux2', device:'default'}),
        '3':node('VAELoader', {vae_name:$('engine-vae').value}),
        '4':node('EmptyFlux2LatentImage', {width, height, batch_size:1}),
        '5':node('SamplerCustomAdvanced', {noise:['16',0], guider:['17',0], sampler:['18',0], sigmas:['19',0], latent_image:['4',0]}),
        '6':node('VAEDecode', {samples:['5',0], vae:['3',0]}),
        '7':node('SaveImage', {images:['6',0], filename_prefix:edit ? 'void-klein-realism' : 'void-klein'}),
        '11':node('CLIPTextEncode', {clip:['2',0], text:prompt}),
        '12':node('CLIPTextEncode', {clip:['2',0], text:task.negative || ''}),
        ...(edit && {
          '8':node('LoadImage', {image:source}),
          '9':node('ImageScaleToTotalPixels', {image:['8',0], upscale_method:'area', megapixels:Math.min(width*height/1e6, 1), resolution_steps:16}),
          '10':node('VAEEncode', {pixels:['9',0], vae:['3',0]}),
          '13':node('ReferenceLatent', {conditioning:['11',0], latent:['10',0]}),
          '14':node('ReferenceLatent', {conditioning:['12',0], latent:['10',0]}),
          '15':node('LoraLoaderModelOnly', {model:['1',0], lora_name:kleinLora, strength_model:Number($('klein-strength').value)})
        }),
        '16':node('RandomNoise', {noise_seed:seed}),
        '17':node('CFGGuider', {model:[edit ? '15' : '1',0], positive:[edit ? '13' : '11',0], negative:[edit ? '14' : '12',0], cfg:Number($('cfg-num').value)}),
        '18':node('KSamplerSelect', {sampler_name:'euler'}),
        '19':node('Flux2Scheduler', {steps:Number($('steps-num').value), width, height})
      }};
    }
    if (source) throw new Error(`${label()} 圖片編輯尚未啟用`);
    if (isMoss()) {
      return {saveNodeId:'7', wf:{
        '1':node('MOSSOfficialDiffusionLoader', {model_name:model, device:'auto', precision:'bf16'}),
        '2':node('MOSSOfficialTextEncoderLoader', {model_name:$('engine-clip').value, device:'auto'}),
        '3':node('MOSSOfficialVAELoader', {model_name:$('engine-vae').value, device:'auto'}),
        '4':node('MOSSOfficialTextEncode', {text_encoder:['2',0], positive:task.prompt || '', negative:task.negative || '', max_sequence_length:4096}),
        '5':node('MOSSOfficialSampler', {dit:['1',0], conditioning:['4',0], seed, steps:Number($('steps-num').value), cfg:Number($('cfg-num').value), shift:Number($('moss-shift').value), width:Number($('size-w').value), height:Number($('size-h').value), batch_size:Math.max(1, Number(currentBatch || 1)), uncond_skip_layers:'22', slg_layers:'', slg_scale:0, slg_start:0, slg_stop:1}),
        '6':node('MOSSOfficialVAEDecode', {vae:['3',0], latent:['5',0], tiled:false}),
        '7':node('SaveImage', {images:['6',0], filename_prefix:'void-moss'})
      }};
    }
    const wf = {
      '1': node('UnetLoaderGGUF', {unet_name:model}),
      '8': node('CLIPLoader', {clip_name:$('engine-clip').value, type:'qwen_image', device:'default'}),
      '9': node('VAELoader', {vae_name:$('engine-vae').value}),
      '2': node('TextEncodeQwenImage21', {clip:['8',0], prompt:task.prompt || '', negative_prompt:task.negative || '', resolution:1024}),
      '4': node('EmptyLatentImage', {width:Number($('size-w').value), height:Number($('size-h').value), batch_size:Math.max(1, Number(task.batch || currentBatch || 1))}),
      '5': node('KSampler', {model:['1',0], positive:['2',0], negative:['2',1], latent_image:['4',0], seed, steps:Number($('steps-num').value), cfg:Number($('cfg-num').value), sampler_name:$('sampler-select').value, scheduler:$('scheduler-select').value, denoise:1}),
      '6': node('VAEDecode', {samples:['5',0], vae:['9',0]}),
      '7': node('SaveImage', {images:['6',0], filename_prefix:'void-qwen'})
    };
    return {wf, saveNodeId:'7'};
  }
  const restore = restoreFromMeta;
  restoreFromMeta = function(meta) {
    if (isGenerating) return [];
    const target = /flux-2-klein-9b/i.test(meta?.model || '') ? 'klein' : meta?.engine || (/moss-image/i.test(meta?.model || '') ? 'moss' : /qwen.*2[._-]1/i.test(meta?.model || '') ? 'qwen' : 'sd');
    if (target !== engine) {
      switchEngine(target).then(() => restoreFromMeta(meta));
      return ['ENGINE'];
    }
    if (meta?.qwenClip || meta?.mossClip) $('engine-clip').value = meta.mossClip || meta.qwenClip;
    if (meta?.qwenVae || meta?.mossVae) $('engine-vae').value = meta.mossVae || meta.qwenVae;
    if (meta?.mossShift !== undefined) $('moss-shift').value = meta.mossShift;
    if (isKlein() && meta?.kleinStrength !== undefined) $('klein-strength').value = meta.kleinStrength;
    if (meta?.batch && !isKlein()) setBatch(meta.batch, null);
    if (meta?.scheduler && !isMoss()) $('scheduler-select').value = meta.scheduler;
    if (meta?.width && meta?.height) { $('size-w').value = meta.width; $('size-h').value = meta.height; currentW = meta.width; currentH = meta.height; }
    const applied = restore(isActive() ? {...meta, loras:undefined, sampler:isMoss() ? undefined : meta?.sampler} : meta);
    if (isActive()) remember();
    return applied;
  };
  window.addEventListener('beforeunload', remember);
  const busyObserver = new MutationObserver(() => {
    for (const id of ['engine-select', 'model-select', 'engine-clip', 'engine-vae', 'moss-shift', 'klein-strength']) $(id).disabled = isGenerating;
  });
  busyObserver.observe(document.body, {attributes:true, attributeFilter:['data-void-gen-state']});
  setTimeout(() => switchEngine('sd', true), 0);
  function captureMeta(workflow, task) {
    if (isKlein()) {
      const {width,height,steps} = workflow['19'].inputs;
      return {engine, width, height, steps, batch:1, sampler:'euler', scheduler:'Flux2Scheduler', cfg:workflow['17'].inputs.cfg, prompt:workflow['11'].inputs.text, negative:workflow['12'].inputs.text, kleinStrength:workflow['15']?.inputs.strength_model};
    }
    const sample = workflow['5'].inputs;
    const size = isMoss() ? sample : workflow['4'].inputs;
    return {engine, prompt:task.prompt, negative:task.negative, width:size.width, height:size.height,
      steps:sample.steps, cfg:sample.cfg, loras:[], batch:sample.batch_size || size.batch_size,
      ...(isMoss()
        ? {mossClip:workflow['2'].inputs.model_name, mossVae:workflow['3'].inputs.model_name, mossShift:sample.shift, sampler:'MOSS Euler', scheduler:'MOSS official'}
        : {qwenClip:workflow['8'].inputs.clip_name, qwenVae:workflow['9'].inputs.vae_name, sampler:sample.sampler_name, scheduler:sample.scheduler})};
  }
  return {isActive, supportsImageEdit, modeChanged:() => {if (isKlein() && info) updateStatus();}, switchEngine, loadModels, validate, buildWorkflow, missingComponents, captureMeta, getEngine:() => engine};
})();
