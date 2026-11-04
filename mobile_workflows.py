"""Graphs for the private mobile gateway; only installed engines are exposed."""
import secrets

QWEN_CLIP = 'qwen3vl_8b_int8_convrot.safetensors'
QWEN_VAE = 'qwen_image_2.1_vae_bf16.safetensors'
QWEN_MODEL = 'qwen-image-2.1-UC-Q4_K_M.gguf'
MOSS_MODEL = 'moss-image-sft-bf16.safetensors'
MOSS_CLIP = 'moss-image-qwen35-bf16.safetensors'
MOSS_VAE = 'moss-image-vae.safetensors'
KLEIN_CLIP = 'qwen_3_8b_fp4mixed.safetensors'
KLEIN_VAE = 'flux2-vae.safetensors'
KLEIN_LORA = 'klein9b-anything-to-real.safetensors'
KLEIN_NODES = {'UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'EmptyFlux2LatentImage', 'RandomNoise', 'CFGGuider', 'KSamplerSelect', 'Flux2Scheduler', 'SamplerCustomAdvanced', 'VAEDecode', 'SaveImage'}
KLEIN_EDIT_NODES = {'LoadImage', 'ImageScaleToTotalPixels', 'VAEEncode', 'ReferenceLatent', 'LoraLoaderModelOnly'}
CAPTIONS = {
    'prompt': 'Describe only visible contents as one factual English image-generation prompt. Include subject, visible appearance, clothing, pose, setting, composition, lighting and colors where applicable. Omit uncertain details and do not invent camera settings.',
    'zh': '請以繁體中文客觀描述圖片中清楚可見的主體、外觀、服裝、姿勢、環境、構圖、光線與色彩，整理成一段文字；略過不確定細節，不要猜測身分或編造相機參數。',
    'brief': 'Describe only the visible contents of this image in one or two factual English sentences.'}


def number(data, key, default, low, high, integer=False):
    value = float(data.get(key, default))
    if not low <= value <= high or (integer and not value.is_integer()):
        raise ValueError(f'{key} 必須在 {low}～{high} 之間')
    return int(value) if integer else value


def node(kind, **inputs):
    return {'class_type': kind, 'inputs': inputs}


def generate(data, catalog, source=None):
    engine = data.get('engine', 'qwen')
    mode = data.get('mode', 'txt2img')
    edit = mode == 'img2img'
    if mode not in ('txt2img', 'img2img') or (edit and engine != 'klein'):
        raise ValueError('圖生圖請使用 Klein 9B')
    if edit and (not catalog.get('kleinEdit') or not source):
        raise ValueError('請確認寫實 LoRA 已安裝並上傳來源圖片')
    if engine not in ('sd', 'qwen', 'moss', 'klein'):
        raise ValueError('未知的生圖引擎')
    prompt = str(data.get('prompt', '')).strip()
    if edit and not prompt:
        prompt = 'Convert this illustration into a photorealistic live-action photograph. Preserve the subject, outfit, pose, composition and background.'
    if not prompt or len(prompt) > 20000:
        raise ValueError('請輸入提示詞（最多 20000 字元）')
    defaults = {'sd': (1024, 20, 7), 'qwen': (1024, 25, 1), 'moss': (512, 8, 3), 'klein': (512, 8, 1)}[engine]
    width = number(data, 'width', defaults[0], 256, 2048, True)
    height = number(data, 'height', defaults[0], 256, 2048, True)
    multiple = 16 if engine in ('moss', 'klein') else 32
    if width % multiple or height % multiple:
        raise ValueError(f'尺寸須為 {multiple} 的倍數')
    steps = number(data, 'steps', defaults[1], 1, 100, True)
    cfg = number(data, 'cfg', defaults[2], 0, 30)
    seed = number(data, 'seed', -1, -1, 2**53-1, True)
    if seed == -1:
        seed = secrets.randbelow(2**32)
    models = catalog['models'][engine]
    model = data.get('model') or (MOSS_MODEL if engine == 'moss' else QWEN_MODEL if engine == 'qwen' else models[0] if models else '')
    if model not in models:
        raise ValueError('所選模型未安裝，請重新選擇')
    negative = str(data.get('negative', ''))[:20000]
    meta = dict(engine=engine, model=model, prompt=prompt, negative=negative, width=width, height=height, steps=steps, cfg=cfg, seed=seed)
    wf = {'7': node('SaveImage', filename_prefix=f'VOID-mobile/{engine}', images=['6', 0])}
    if engine == 'klein':
        wf.update({
            '1': node('UnetLoaderGGUF', unet_name=model),
            '2': node('CLIPLoader', clip_name=KLEIN_CLIP, type='flux2', device='default'),
            '3': node('VAELoader', vae_name=KLEIN_VAE),
            '4': node('EmptyFlux2LatentImage', width=width, height=height, batch_size=1),
            '5': node('SamplerCustomAdvanced', noise=['16', 0], guider=['17', 0], sampler=['18', 0], sigmas=['19', 0], latent_image=['4', 0]),
            '6': node('VAEDecode', samples=['5', 0], vae=['3', 0]),
            '11': node('CLIPTextEncode', clip=['2', 0], text=prompt),
            '12': node('CLIPTextEncode', clip=['2', 0], text=negative),
            '16': node('RandomNoise', noise_seed=seed),
            '17': node('CFGGuider', model=['15' if edit else '1', 0], positive=['13' if edit else '11', 0], negative=['14' if edit else '12', 0], cfg=cfg),
            '18': node('KSamplerSelect', sampler_name='euler'),
            '19': node('Flux2Scheduler', steps=steps, width=width, height=height),
        })
        meta.update(mode=mode, sampler='euler', scheduler='Flux2Scheduler')
        if edit:
            strength = number(data, 'kleinStrength', .8, 0, 2)
            wf.update({
                '8': node('LoadImage', image=source),
                '9': node('ImageScaleToTotalPixels', image=['8', 0], upscale_method='area', megapixels=min(width * height / 1e6, 1), resolution_steps=16),
                '10': node('VAEEncode', pixels=['9', 0], vae=['3', 0]),
                '13': node('ReferenceLatent', conditioning=['11', 0], latent=['10', 0]),
                '14': node('ReferenceLatent', conditioning=['12', 0], latent=['10', 0]),
                '15': node('LoraLoaderModelOnly', model=['1', 0], lora_name=KLEIN_LORA, strength_model=strength),
            })
            meta['kleinStrength'] = strength
    elif engine == 'moss':
        shift = number(data, 'shift', 5, .01, 100)
        wf.update({'1': node('MOSSOfficialDiffusionLoader', model_name=model, device='auto', precision='bf16'),
                   '2': node('MOSSOfficialTextEncoderLoader', model_name=MOSS_CLIP, device='auto'),
                   '3': node('MOSSOfficialVAELoader', model_name=MOSS_VAE, device='auto'),
                   '4': node('MOSSOfficialTextEncode', text_encoder=['2', 0], positive=prompt, negative=negative, max_sequence_length=4096),
                   '5': node('MOSSOfficialSampler', dit=['1', 0], conditioning=['4', 0], seed=seed, steps=steps, cfg=cfg, shift=shift, width=width, height=height, batch_size=1, uncond_skip_layers='22', slg_layers='', slg_scale=0, slg_start=0, slg_stop=1),
                   '6': node('MOSSOfficialVAEDecode', vae=['3', 0], latent=['5', 0], tiled=False)})
        meta.update(mossShift=shift, mossClip=MOSS_CLIP, mossVae=MOSS_VAE)
    else:
        sampler = data.get('sampler', 'euler' if engine == 'qwen' else 'euler_ancestral')
        scheduler = data.get('scheduler', 'simple' if engine == 'qwen' else 'karras')
        if sampler not in catalog['samplers'] or scheduler not in catalog['schedulers']:
            raise ValueError('採樣設定無效')
        wf['4'] = node('EmptyLatentImage', width=width, height=height, batch_size=1)
        if engine == 'qwen':
            wf.update({'1': node('UnetLoaderGGUF', unet_name=model),
                       '8': node('CLIPLoader', clip_name=QWEN_CLIP, type='qwen_image', device='default'),
                       '9': node('VAELoader', vae_name=QWEN_VAE),
                       '2': node('TextEncodeQwenImage21', clip=['8', 0], prompt=prompt, negative_prompt=negative, resolution=1024)})
            model_ref, pos, neg, vae = ['1', 0], ['2', 0], ['2', 1], ['9', 0]
            meta.update(qwenClip=QWEN_CLIP, qwenVae=QWEN_VAE)
        else:
            wf['1'] = node('CheckpointLoaderSimple', ckpt_name=model)
            model_ref, clip, vae = ['1', 0], ['1', 1], ['1', 2]
            lora = data.get('lora', '')
            if lora:
                if lora not in catalog['loras']:
                    raise ValueError('LoRA 未安裝')
                strength = number(data, 'loraStrength', .8, -2, 2)
                wf['10'] = node('LoraLoader', model=model_ref, clip=clip, lora_name=lora, strength_model=strength, strength_clip=strength)
                model_ref, clip = ['10', 0], ['10', 1]
                meta['loras'] = [{'name': lora, 'strength': strength}]
            wf['2'] = node('CLIPTextEncode', clip=clip, text=prompt)
            wf['3'] = node('CLIPTextEncode', clip=clip, text=negative)
            pos, neg = ['2', 0], ['3', 0]
        wf['5'] = node('KSampler', model=model_ref, positive=pos, negative=neg, latent_image=['4', 0], seed=seed, steps=steps, cfg=cfg, sampler_name=sampler, scheduler=scheduler, denoise=1)
        wf['6'] = node('VAEDecode', samples=['5', 0], vae=vae)
        meta.update(sampler=sampler, scheduler=scheduler)
    return wf, meta


def caption(data, filename):
    engine = data.get('engine', 'qwen')
    wf = {'1': node('LoadImage', image=filename)}
    if engine == 'qwen':
        instruction = str(data.get('instruction') or CAPTIONS.get(data.get('style'), CAPTIONS['prompt']))[:4000]
        wf['2'] = node('CLIPLoader', clip_name=QWEN_CLIP, type='stable_diffusion', device='default')
        wf['3'] = node('TextGenerate', clip=['2', 0], image=['1', 0], prompt=instruction, max_length=512, sampling_mode='off', thinking=False, use_default_template=True, mtp='off')
        wf['4'] = node('PreviewAny', source=['3', 0])
    elif engine == 'florence':
        task = data.get('detail', 'more_detailed_caption')
        if task not in ('caption', 'detailed_caption', 'more_detailed_caption'):
            raise ValueError('描述詳細度無效')
        wf['2'] = node('Florence2ModelLoader', model='Florence-2-large', precision='fp16', convert_to_safetensors=False)
        wf['3'] = node('Florence2Run', image=['1', 0], florence2_model=['2', 0], text_input='', task=task, fill_mask=False, keep_model_loaded=False, max_new_tokens=256, num_beams=3, do_sample=False, seed=1)
        wf['4'] = node('PreviewAny', source=['3', 2])
    else:
        raise ValueError('未知的辨識引擎')
    return wf
