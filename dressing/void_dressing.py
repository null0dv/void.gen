"""VOID character dressing routes, state and bounded Klein multi-reference graphs."""
import asyncio
import hashlib
import json
import math
import re
import secrets
import time
import uuid
from pathlib import Path

from aiohttp import web
from PIL import Image, ImageOps
import sdxl_dressing
import image_edit

HERE = Path(__file__).resolve().parent
RAW = HERE.parent / 'tools/posewear/assets-raw'

def body_constraints(shape, has_person):
    instructions={
        'reference': 'Use the character reference images as the sole source of body shape and chest size. Preserve the original chest volume and silhouette; do not enlarge it.' if has_person else 'Use the described character body shape with natural adult proportions; do not infer chest size from the pose or clothing references.',
        'flat': 'Body setting: an adult character with a flat chest and minimal chest projection. Keep adult age, height, identity and other body proportions unchanged. Let the clothing fit this chest naturally without added bust volume.',
        'small': 'Body setting: an adult character with a small chest and modest natural chest volume. Keep adult age, height, identity and other body proportions unchanged. Let the clothing fit this body naturally without enlarging the chest.'
    }
    if shape not in instructions:
        raise ValueError('胸型設定無效')
    return instructions[shape]+' Pose references specify joint positions, limb placement and camera angle only: ignore their chest, waist, hip volumes and body contour. Clothing references specify garment design only: adapt the fit to the character rather than copying mannequin anatomy.'

def extend_graph(original, gateway):
    def generate(data, catalog, source=None, reference=None, mask=None):
        if data.get('imageEdit') is not None:
            return image_edit.graph(original,data,catalog,gateway,source,reference,mask)
        if not data.get('dressing'):
            return original(data,catalog,source,reference,mask)
        if data.get('engine') == 'sd':
            return sdxl_dressing.graph(original, data, catalog, gateway, source)
        refs = data.get('dressingReferences', [])
        if data.get('engine')=='klein' and data.get('mode')=='txt2img' and refs==[]:
            wf,meta=original(data,catalog)
            meta.update(dressing=data['dressing'],dressingReferences=[])
            return wf,meta
        if not isinstance(refs,list) or len(refs)>9 or data.get('engine')!='klein' or data.get('continuous') is not True:
            raise ValueError('搭配參考資料無效')
        names = [gateway.generation_source(dict(mode='img2img',continuous=True,referenceUpload=r),'referenceUpload') for r in refs]
        wf, meta = original(data,catalog,source,None,mask)
        positive, negative = ['13',0], ['14',0]
        for i,name in enumerate(names):
            a,b,c,d,e = map(str,range(100+i*5,105+i*5))
            wf[a] = {'class_type':'LoadImage','inputs':{'image':name}}
            wf[b] = {'class_type':'ImageScaleToTotalPixels','inputs':{'image':[a,0],'upscale_method':'area','megapixels':.16 if len(names)>3 else .25,'resolution_steps':16}}
            wf[c] = {'class_type':'VAEEncode','inputs':{'pixels':[b,0],'vae':['3',0]}}
            wf[d] = {'class_type':'ReferenceLatent','inputs':{'conditioning':positive,'latent':[c,0]}}
            wf[e] = {'class_type':'ReferenceLatent','inputs':{'conditioning':negative,'latent':[c,0]}}
            positive,negative = [d,0],[e,0]
        wf['17']['inputs'].update(positive=positive,negative=negative)
        meta.update(dressing=data['dressing'],dressingReferences=refs)
        return wf,meta
    return generate

def install_dressing(app, g, root, namespace):
    # The pose/costume library (PoseWear assets + catalog.json) is optional and not in the repo.
    # Without it the edit studio still works for plain image edits; the dressing library is just empty.
    catalog_file = HERE/'catalog.json'
    catalog = json.loads(catalog_file.read_text(encoding='utf-8')) if catalog_file.is_file() else {'version': 0, 'items': []}
    by_id = {i['id']:i for i in catalog['items']}
    paths = set()
    variants = {}
    variant_root = (HERE/'pose-variants/ab-cup').resolve()
    for item in catalog['items']:
        if item['kind']=='pose':
            item['framing'] = 'upper' if item['id'].startswith('pose:upper') else 'full'
            for a in item['angles']:
                paths.update(a[k] for k in ('thumb','full','depthThumb','depth'))
        else:
            paths.update([item['thumb'],item['full']])
    variant_stamp = None

    def refresh_variants():
        nonlocal variant_stamp
        stamp = variant_root.stat().st_mtime_ns if variant_root.is_dir() else 0
        if stamp == variant_stamp:
            return
        available = {}
        for candidate in variant_root.glob('*-ab-v*.png'):
            match = re.fullmatch(r'(.+)-ab-v(\d+)\.png',candidate.name)
            selected = candidate.resolve()
            if not match or not selected.is_relative_to(variant_root) or not selected.is_file():
                continue
            key,version = match[1],int(match[2])
            if key not in available or version > available[key][0]:
                available[key] = (version,selected)
        variants.clear()
        for item in catalog['items']:
            if item['kind']!='pose':
                continue
            for angle in item['angles']:
                angle.pop('smallFull',None)
                angle.pop('smallThumb',None)
                entry = available.get(angle['id'])
                if entry:
                    rel = 'variants/ab/'+entry[1].name
                    variants[rel] = entry[1]
                    angle['smallFull'] = angle['smallThumb'] = rel
            item['smallAngles'] = sum(bool(a.get('smallFull')) for a in item['angles'])
        variant_stamp = stamp

    refresh_variants()
    namespace['generate'] = extend_graph(namespace['generate'],g)
    g.db.execute('CREATE TABLE IF NOT EXISTS dressing_state(id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)')
    g.db.commit()
    submit_lock = asyncio.Lock()

    def file_path(rel):
        refresh_variants()
        if rel in variants:
            return variants[rel]
        dest=(RAW/rel).resolve()
        if rel not in paths or not dest.is_relative_to(RAW.resolve()) or not dest.is_file():
            raise web.HTTPNotFound()
        return dest

    def resolve_spec(spec, role):
        if not isinstance(spec,dict):
            raise ValueError('參考圖格式錯誤')
        if spec.get('upload'):
            name=g.generation_source(dict(mode='img2img',upload=spec['upload']))
            return g.input/name
        item=by_id.get(spec.get('id'))
        allowed={'person':{'portrait'},'garment':{'costume','anime'},'pose':{'pose'}}
        if not item or item['kind'] not in allowed[role]:
            raise ValueError('素材用途或編號無效')
        if role=='pose':
            refresh_variants()
            angle=next((a for a in item['angles'] if a['id']==spec.get('angle')),None)
            if not angle:
                raise ValueError('請選擇有效的姿勢角度')
            if spec.get('variant') not in (None,'original','ab'):
                raise ValueError('姿勢素材版本無效')
            if spec.get('variant')=='ab':
                if spec.get('depth'):
                    raise ValueError('小胸版尚未提供配對深度圖，請使用線稿')
                if not angle.get('smallFull'):
                    raise ValueError('此角度的小胸版尚未完成，請改用原始版或其他角度')
                return file_path(angle['smallFull'])
            return file_path(angle['depth'] if spec.get('depth') else angle['full'])
        return file_path(item['full'])

    async def materialize(spec,role):
        source=resolve_spec(spec,role)
        upload_id=hashlib.sha256(('void-dressing-v1:'+str(source)+':'+str(source.stat().st_mtime_ns)).encode()).hexdigest()[:32]
        filename='void-mobile-'+upload_id+'.png'
        dest=g.input/filename
        if not dest.is_file():
            def prepare():
                with Image.open(source) as im:
                    if im.width*im.height>40000000:
                        raise ValueError('參考圖片過大')
                    im=ImageOps.exif_transpose(im).convert('RGB')
                    im.thumbnail((1024,1024))
                    im.save(dest)
            await asyncio.to_thread(prepare)
        g.db.execute('INSERT OR IGNORE INTO uploads VALUES(?,?,?)',(upload_id,filename,time.time()))
        return upload_id

    async def static(request):
        name=request.match_info.get('file','index.html')
        if name not in ('index.html','app.js','style.css','zip.js','edit-studio.js','edit-studio.css'):
            raise web.HTTPNotFound()
        response=web.FileResponse(HERE.parent/'tools/posewear/src/zip.js' if name=='zip.js' else HERE/'web'/name)
        response.headers['Cache-Control']='no-cache'
        return response

    async def items(request):
        refresh_variants()
        kind=request.query.get('kind','costume')
        q=request.query.get('q','').casefold().split()
        category=request.query.get('category','')
        rating=request.query.get('rating','all')
        framing=request.query.get('framing','')
        variant=request.query.get('variant','')
        if rating not in ('all','general','adult') or framing not in ('','upper','full') or variant not in ('','ab'):
            raise ValueError('素材篩選無效')
        limit=min(80,max(1,int(request.query.get('limit',48))))
        offset=max(0,int(request.query.get('offset',0)))
        pool=[i for i in catalog['items'] if i['kind']==kind]
        categories=sorted({i['category'] for i in pool})
        pool=[i for i in pool if (not category or i['category']==category) and all(w in json.dumps(i,ensure_ascii=False).casefold() for w in q)]
        pool=[i for i in pool if (rating=='all' or bool(i.get('adult'))==(rating=='adult')) and (not framing or i.get('framing')==framing) and (not variant or i.get('smallAngles',0)>0)]
        return web.json_response({'items':pool[offset:offset+limit],'total':len(pool),'categories':categories,'version':catalog['version']})

    async def image(request):
        response=web.FileResponse(file_path(request.match_info['path']))
        response.headers['Cache-Control']='private,max-age=86400'
        return response

    async def state(request):
        if request.method=='GET':
            row=g.db.execute('SELECT snapshot FROM dressing_state WHERE id=?',('main',)).fetchone()
            return web.json_response(json.loads(row['snapshot']) if row else {})
        data=await request.json()
        if not isinstance(data,dict) or len(json.dumps(data))>1000000:
            raise ValueError('搭配狀態過大或格式錯誤')
        # Persist only references and settings, never an uploaded image body.
        g.db.execute('INSERT OR REPLACE INTO dressing_state VALUES(?,?)',('main',json.dumps(data,ensure_ascii=False)))
        g.db.commit()
        return web.json_response({'ok':True})

    async def jobs(request):
        data=await request.json()
        if not isinstance(data,dict):
            raise ValueError('搭配資料格式錯誤')
        engine = data.get('engine', 'klein')
        if engine != 'klein':
            raise ValueError('角色換裝使用 Klein；SDXL 請改到圖改圖工作區')
        persons,garments,poses=(data.get(k,[]) for k in ('persons','garments','poses'))
        if not all(isinstance(x,list) for x in (persons,garments,poses)) or len(persons)>3 or len(garments)>2 or len(poses)>6:
            raise ValueError('角色最多 3 圖、服裝可不選或最多 2 圖、姿勢最多 6 個')
        if not persons and data.get('mode')!='describe':
            raise ValueError('請先上傳或選擇角色，或切換到描述角色')
        if engine == 'sd' and (len(persons)>1 or garments or data.get('batch')=='sheet'):
            raise ValueError('SDXL 快速版請選一張角色、不選新服裝，並使用每個姿勢分開出圖；換裝請切回 Klein')
        body_shape=data.get('bodyShape','reference')
        if not isinstance(body_shape,str):
            raise ValueError('胸型設定無效')
        body_instruction=body_constraints(body_shape,bool(persons))
        count=data.get('count',1)
        if isinstance(count,bool) or not isinstance(count,int) or not 1<=count<=4:
            raise ValueError('張數須為 1～4')
        prompt=data.get('prompt','')
        if not isinstance(prompt,str) or not 1<=len(prompt.strip())<=20000:
            raise ValueError('請輸入 1～20000 字的搭配指令')
        width,height=data.get('width',512),data.get('height',768)
        if any(isinstance(x,bool) or not isinstance(x,int) or not 256<=x<=1536 or x%16 for x in (width,height)) or width*height>1100000:
            raise ValueError('搭配尺寸無效，請選擇 110 萬像素以下的 16 倍數尺寸')
        # Validate the whole batch before copying images or creating any jobs.
        for role,group in [('person',persons),('garment',garments),('pose',poses)]:
            for spec in group:
                resolve_spec(spec,role)
        sets=[poses] if data.get('batch')=='sheet' else [[p] for p in poses] or [[]]
        prompts=data.get('prompts')
        if prompts is not None and (not isinstance(prompts,list) or len(prompts)!=len(sets) or any(not isinstance(p,str) or not 1<=len(p)<=19000 for p in prompts)):
            raise ValueError('各姿勢搭配指令格式錯誤')
        if max(len(persons)+len(garments)+len(p) for p in sets)>10:
            raise ValueError('單次最多 10 張參考，請減少角度或改成分開出圖')
        cap=await g.catalog()
        if engine == 'klein' and not cap.get('kleinContinuous'):
            raise ValueError('Klein 多參考改圖尚未就緒，請確認本機模型與節點')
        sd_cap = sdxl_dressing.capabilities(g, cap) if engine == 'sd' else None
        if sd_cap and not sd_cap['ready']:
            raise ValueError('SDXL 元件未就緒：'+', '.join(sd_cap['missing']))
        models=sd_cap['models'] if sd_cap else cap.get('models',{}).get('klein',[])
        model=data.get('model') or (models[0] if models else '')
        if model not in models:
            raise ValueError('所選引擎模型未安裝或不相容')
        seed=data.get('seed',-1)
        if isinstance(seed,bool) or not isinstance(seed,int) or not -1<=seed<=2**53-1:
            raise ValueError('種子無效')
        seed=secrets.randbits(32) if seed==-1 else seed
        token=data.get('requestId')
        if not isinstance(token,str) or not 16<=len(token)<=80:
            raise ValueError('缺少任務識別碼')
        async with submit_lock:
            prior=g.db.execute('SELECT snapshot FROM dressing_state WHERE id=?',('request:'+token,)).fetchone()
            if prior:
                return web.json_response(json.loads(prior['snapshot']))
            requests=[]
            group=data.get('group') if isinstance(data.get('group'),str) and len(data['group'])<=80 else uuid.uuid4().hex
            for set_index,pose_set in enumerate(sets):
                refs=[await materialize(s,role) for role,arr in [('person',persons),('garment',garments),('pose',pose_set)] for s in arr] if engine == 'klein' else []
                sd_person = await materialize(persons[0], 'person') if engine == 'sd' and persons else None
                # Depth maps are paired to ORIGINAL geometry, never claim A/B pairing.
                sd_pose = await materialize(dict(pose_set[0], variant='original', depth=True), 'pose') if engine == 'sd' and pose_set else None
                for n in range(count):
                    snapshot={k:data.get(k) for k in ('persons','garments','style','keepBg','batch','lang','extra','charText','mode','ratio','quality')}
                    snapshot['bodyShape']=body_shape
                    snapshot.update(engine=engine, model=model, characterStrength=data.get('characterStrength',.75), poseStrength=data.get('poseStrength',.8))
                    snapshot.update(poses=pose_set,group=group,index=len(requests))
                    instruction=prompts[set_index] if prompts is not None else prompt
                    if persons and not garments:
                        instruction+='\nPreserve the original character clothing, colors, materials, shoes and accessories. Do not replace or remove the outfit. Change only the requested pose and other explicitly requested visual settings.'
                    if data.get('batch')!='sheet' and pose_set:
                        p=by_id[pose_set[0]['id']]
                        a=next(a for a in p['angles'] if a['id']==pose_set[0]['angle'])
                        instruction+='\nCurrent pose: '+p['en']+'; '+a['label']+'. Use only this pose for this image.'
                    instruction+='\n'+body_instruction
                    item=dict(engine='klein',mode='img2img' if refs else 'txt2img',continuous=bool(refs),model=model,prompt=instruction,upload=refs[0] if refs else None,dressingReferences=refs[1:],dressing=snapshot,width=width,height=height,steps=8,cfg=1,negative='',seed=(seed+len(requests))%(2**53),editGroup='dress:'+group,editId=uuid.uuid4().hex)
                    if engine == 'sd':
                        item.update(engine='sd', mode='txt2img' if sd_pose or not sd_person else 'img2img', continuous=False, upload=sd_person, sdxlPerson=sd_person, sdxlPose=sd_pose, characterStrength=data.get('characterStrength',.75), poseStrength=data.get('poseStrength',.8), width=max(256,width//32*32), height=max(256,height//32*32), steps=25, cfg=5.5, sampler='euler_ancestral', scheduler='karras', denoise=.5, negative='low quality, blurry, malformed anatomy, extra limbs, extra fingers, multiple people, mannequin, grey skin, sketch, text, watermark')
                    _,meta=namespace['generate'](item,cap,g.generation_source(item))
                    item.update(meta)
                    requests.append(item)
            ids=[]
            with g.db:
                for i,item in enumerate(requests):
                    jid=uuid.uuid4().hex; now=time.time()+i*.001
                    g.db.execute('INSERT INTO jobs(id,kind,engine,state,created,updated,request) VALUES(?,?,?,?,?,?,?)',(jid,'generate',engine,'queued',now,now,json.dumps(item,ensure_ascii=False)))
                    ids.append(jid)
                result={'ids':ids,'group':group}
                g.db.execute('INSERT INTO dressing_state VALUES(?,?)',('request:'+token,json.dumps(result)))
            g.wake.set()
        return web.json_response(result,status=201)

    async def engines(request):
        cap = await g.catalog()
        return web.json_response({'sdxl': sdxl_dressing.capabilities(g, cap)})

    async def prepare_edit(request):
        data=await request.json()
        spec=data.get('pose') if isinstance(data,dict) else None
        if not isinstance(spec,dict):
            raise ValueError('請選擇有效動作')
        resolve_spec(spec,'pose')
        pose_upload=await materialize(dict(spec,depth=False),'pose')
        depth_upload=await materialize(dict(spec,variant='original',depth=True),'pose') if spec.get('variant')!='ab' else None
        g.db.commit()
        return web.json_response({'poseUpload':pose_upload,'depthUpload':depth_upload,'pose':spec})

    app.router.add_get('/api/image-edit/capabilities',engines)
    app.router.add_post('/api/image-edit/prepare',prepare_edit)
    app.router.add_get('/api/dressing/engines',engines)
    app.router.add_get('/dressing',static)
    app.router.add_get('/dressing/',static)
    app.router.add_get('/dressing/{file}',static)
    app.router.add_get('/api/dressing/items',items)
    app.router.add_get('/api/dressing/image/{path:.+}',image)
    app.router.add_get('/api/dressing/state',state)
    app.router.add_post('/api/dressing/state',state)
    app.router.add_post('/api/dressing/jobs',jobs)
