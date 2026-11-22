"""Image-first edits for the existing Pocket UI; uses the shared worker."""
import math
import uuid
import sdxl_dressing

def graph(original, data, catalog, gateway, source, reference=None, mask=None):
    if data.get('engine') not in ('sd','klein') or data.get('mode') != 'img2img' or not source:
        raise ValueError('圖改圖請先選主圖，使用 SDXL 或 Klein')
    try:
        count=float(data.get('count',1))
    except (TypeError,ValueError):
        raise ValueError('連續版本每次生成一張')
    if count != 1:
        raise ValueError('連續版本每次生成一張')
    for key in ('editGroup','editId','parent'):
        if data.get(key) is not None and (not isinstance(data[key],str) or len(data[key])>160):
            raise ValueError('版本識別資料無效')
    settings=data.get('imageEdit')
    if not isinstance(settings,dict):
        raise ValueError('圖改圖設定無效')
    # Resolve every upload with the gateway's existing allowlist/ownership checks.
    anchor=data.get('anchorUpload') or data.get('upload')
    gateway.generation_source(dict(mode='img2img', upload=anchor))
    pose=settings.get('poseUpload')
    depth=settings.get('depthUpload')
    for upload in (pose,depth):
        if upload:
            gateway.generation_source(dict(mode='img2img',upload=upload))
    if data['engine']=='sd':
        if data.get('continuous') or data.get('maskUpload'):
            raise ValueError('SDXL 圖改圖不使用 Klein 局部遮罩；請清除遮罩或切回 Klein')
        try:
            amount=float(data.get('denoise',.55))
        except (TypeError,ValueError):
            raise ValueError('改動幅度無效')
        if not math.isfinite(amount) or not .01<=amount<=.95:
            raise ValueError('改動幅度須為 0.01～0.95，保留主圖作為修改底圖')
        if pose and not depth:
            raise ValueError('此動作尚無配對深度圖')
        text=str(data.get('prompt') or '').strip()
        automatic=not text
        if automatic:
            text='high quality, detailed image, coherent composition, consistent character appearance, original clothing and accessories'
            hint=settings.get('poseDescription')
            if isinstance(hint,str) and hint.strip():
                text+=', '+hint.strip()[:2000]
        sd=dict(data, prompt=text, continuous=False, sdxlPerson=anchor, sdxlPose=depth, denoise=amount)
        wf,meta=sdxl_dressing.graph(original,sd,catalog,gateway,source)
        meta['automaticPrompt']=automatic
        assert wf['4']['class_type']=='VAEEncode'
    else:
        if data.get('continuous') is not True:
            raise ValueError('Klein 動作參考需要啟用連續改圖')
        text=str(data.get('prompt') or '').strip()
        automatic=not text
        if automatic:
            text=('Change the pose of the character in the first image to match the last reference image. Preserve the character identity, face, hair, original clothing, accessories and body proportions. Use the last image for posture and camera angle only; ignore mannequin appearance and body volume.' if pose else 'Convert this illustration into a photorealistic live-action photograph. Preserve the subject, outfit, pose, composition and background.')
        wf,meta=original(dict(data,prompt=text),catalog,source,reference,mask)
        meta['automaticPrompt']=automatic
        if pose:
            try: strength=float(data.get('poseStrength',.8))
            except (TypeError,ValueError): raise ValueError('動作強度無效')
            if not math.isfinite(strength) or not 0<=strength<=1.5:
                raise ValueError('動作強度須為 0～1.5')
            def node(kind,**inputs):return {'class_type':kind,'inputs':inputs}
            name=gateway.generation_source(dict(mode='img2img',upload=pose))
            wf['300']=node('LoadImage',image=name)
            wf['301']=node('ImageScaleToTotalPixels',image=['300',0],upscale_method='area',megapixels=.25,resolution_steps=16)
            wf['302']=node('VAEEncode',pixels=['301',0],vae=['3',0])
            wf['303']=node('ReferenceLatent',conditioning=wf['17']['inputs']['positive'],latent=['302',0])
            wf['304']=node('ReferenceLatent',conditioning=wf['17']['inputs']['negative'],latent=['302',0])
            wf['17']['inputs'].update(positive=['303',0],negative=['304',0])
    meta.update(imageEdit=settings, anchorUpload=anchor, editGroup=data.get('editGroup') or uuid.uuid4().hex, editId=data.get('editId') or uuid.uuid4().hex, parent=data.get('parent',''))
    return wf,meta
