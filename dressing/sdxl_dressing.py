"""SDXL character reference + paired depth pose control, no extra worker."""
import json
import math

CONTROL = 'void-depth-sdxl-fp16.safetensors'
ADAPTER = 'ip-adapter-plus_sdxl_vit-h.safetensors'
VISION = 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'

def capabilities(g, catalog):
    info = g.info or {}
    def choices(node, field):
        return info.get(node, {}).get('input', {}).get('required', {}).get(field, [[]])[0]
    models = []
    for name in catalog.get('models', {}).get('sd', []):
        path = (g.input.parent / 'models/checkpoints' / name).resolve()
        if not path.is_file() or path.suffix != '.safetensors':
            continue
        try:
            with path.open('rb') as f:
                size = int.from_bytes(f.read(8), 'little')
                if not 0 < size < 100000000:
                    continue
                header = json.loads(f.read(size))
            # SDXL base uses a 2816-wide pooled/time conditioning vector.
            if any(k.endswith(('label_emb.0.0.weight', 'add_embedding.linear_1.weight')) and v.get('shape') == [1280, 2816] for k,v in header.items() if isinstance(v, dict)):
                models.append(name)
        except (OSError, ValueError):
            continue
    nodes = {'IPAdapterAdvanced','IPAdapterModelLoader','CLIPVisionLoader','ControlNetLoader','ControlNetApplyAdvanced'}
    missing = sorted(nodes - info.keys())
    for node, field, value in [('ControlNetLoader','control_net_name',CONTROL), ('IPAdapterModelLoader','ipadapter_file',ADAPTER), ('CLIPVisionLoader','clip_name',VISION)]:
        if value not in choices(node,field):
            missing.append(value)
    if not models:
        missing.append('SDXL base checkpoint')
    models.sort(key=lambda m: (m != 'sd_xl_base_1.0.safetensors', m))
    return dict(ready=not missing, models=models, missing=missing)

def graph(original, data, catalog, gateway, source):
    cap = capabilities(gateway, catalog)
    if not cap['ready'] or data.get('model') not in cap['models']:
        raise ValueError('SDXL 參考／動作元件未就緒：'+', '.join(cap['missing']))
    role_weight = float(data.get('characterStrength', .75))
    pose_weight = float(data.get('poseStrength', .8))
    if any(not math.isfinite(v) or not 0 <= v <= 1.5 for v in (role_weight, pose_weight)):
        raise ValueError('參考強度須為 0～1.5')
    wf, meta = original(data, catalog, source)
    def node(kind, **inputs):
        return {'class_type':kind, 'inputs':inputs}
    person = data.get('sdxlPerson')
    pose = data.get('sdxlPose')
    if person:
        name = gateway.generation_source(dict(mode='img2img', upload=person))
        wf['100'] = node('LoadImage', image=name)
        wf['101'] = node('CLIPVisionLoader', clip_name=VISION)
        wf['102'] = node('IPAdapterModelLoader', ipadapter_file=ADAPTER)
        wf['103'] = node('IPAdapterAdvanced', model=wf['5']['inputs']['model'], ipadapter=['102',0], image=['100',0], clip_vision=['101',0], weight=role_weight, weight_type='linear', combine_embeds='concat', start_at=0., end_at=1., embeds_scaling='V only')
        wf['5']['inputs']['model'] = ['103',0]
    if pose:
        name = gateway.generation_source(dict(mode='img2img', upload=pose))
        wf['110'] = node('LoadImage', image=name)
        wf['111'] = node('ImageScale', image=['110',0], upscale_method='bilinear', width=data['width'], height=data['height'], crop='disabled')
        wf['112'] = node('ControlNetLoader', control_net_name=CONTROL)
        wf['113'] = node('ControlNetApplyAdvanced', positive=['2',0], negative=['3',0], control_net=['112',0], image=['111',0], strength=pose_weight, start_percent=0., end_percent=.85, vae=['1',2])
        wf['5']['inputs'].update(positive=['113',0], negative=['113',1])
    if data.get('dressing'):
        meta['dressing'] = data['dressing']
    meta.update(characterStrength=role_weight, poseStrength=pose_weight, sdxlPerson=person, sdxlPose=pose)
    return wf, meta
