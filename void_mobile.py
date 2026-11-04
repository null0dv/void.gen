"""Private, loopback-only mobile gateway for VOID and Tailscale Serve."""
import argparse
import asyncio
import base64
import contextlib
import ctypes
import hashlib
import io
import json
import logging
import os
import secrets
import shutil
import sqlite3
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientSession, ClientTimeout, ClientError, web
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mobile_workflows import (generate, caption, QWEN_CLIP, QWEN_MODEL, KLEIN_CLIP,
                              KLEIN_VAE, KLEIN_LORA, KLEIN_NODES, KLEIN_EDIT_NODES)

ROOT = Path(__file__).resolve().parent
TERMINAL = ('done', 'error', 'cancelled')
IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.webp'}
MOTION_GRAPH = json.loads((ROOT / 'mobile_motion_graph.json').read_text(encoding='utf-8'))
MOTION_SIZES = {'landscape': (640, 384), 'portrait': (384, 640), 'square': (512, 512)}


def motion_settings(data):
    prompt = data.get('prompt', '')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000:
        raise ValueError('請輸入 1 至 4000 字的動作描述')
    size = data.get('size', 'portrait')
    seconds = data.get('seconds', 5)
    if size not in MOTION_SIZES or seconds not in (5, 10):
        raise ValueError('影片比例或長度不支援')
    gallery_id, upload_id = data.get('gallery'), data.get('upload')
    if bool(gallery_id) == bool(upload_id):
        raise ValueError('請選擇一張起始圖片')
    return {'kind': 'motion', 'engine': 'wan', 'prompt': prompt.strip(), 'size': size,
            'seconds': seconds, 'gallery': gallery_id, 'upload': upload_id}


def image_meta(path):
    with Image.open(path) as image:
        width, height = image.size
        data = image.info
        meta = json.loads(data.get('void_mobile', '{}')) if isinstance(data.get('void_mobile', '{}'), str) else {}
        wf = json.loads(data.get('prompt', '{}')) if isinstance(data.get('prompt', '{}'), str) else {}
    if not isinstance(meta, dict):
        meta = {}
    if isinstance(wf, dict) and not meta:
        nodes = list(wf.values())
        find = lambda kind: next((n.get('inputs', {}) for n in nodes if isinstance(n, dict) and n.get('class_type') == kind), {})
        sample = find('MOSSOfficialSampler') or find('KSampler') or find('KSamplerAdvanced')
        model = find('MOSSOfficialDiffusionLoader').get('model_name') or find('UnetLoaderGGUF').get('unet_name') or find('CheckpointLoaderSimple').get('ckpt_name', '')
        text = find('MOSSOfficialTextEncode') or find('TextEncodeQwenImage21')
        meta = {'engine': 'moss' if find('MOSSOfficialSampler') else 'qwen' if 'qwen' in model.lower() else 'sd', 'model': model,
                'prompt': text.get('positive', text.get('prompt', '')), 'negative': text.get('negative', text.get('negative_prompt', ''))}
        for ref, key in [('positive', 'prompt'), ('negative', 'negative')]:
            value = sample.get(ref)
            if isinstance(value, list) and len(value) == 2:
                source = wf.get(str(value[0]), {})
                if source.get('class_type') == 'CLIPTextEncode':
                    meta[key] = source['inputs'].get('text', '')
        for key in ('steps', 'cfg', 'seed', 'sampler_name', 'scheduler', 'shift'):
            if key in sample:
                meta[{'sampler_name': 'sampler', 'shift': 'mossShift'}.get(key, key)] = sample[key]
    meta.update(width=width, height=height)
    return meta


class Gateway:
    def __init__(self, data_dir=None, output=None, input_dir=None, comfy='http://127.0.0.1:8188', keep_awake=True):
        self.data_dir = Path(data_dir or ROOT / 'void-data')
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.thumbs = self.data_dir / 'thumbs'
        self.thumbs.mkdir(exist_ok=True)
        self.output = Path(output or ROOT / 'ComfyUI_windows_portable/ComfyUI/output').resolve()
        self.input = Path(input_dir or ROOT / 'ComfyUI_windows_portable/ComfyUI/input').resolve()
        self.input.mkdir(parents=True, exist_ok=True)
        self.output.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.data_dir / 'mobile.sqlite3')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, kind TEXT, engine TEXT, state TEXT, created REAL, updated REAL, native_id TEXT, request TEXT, result TEXT, error TEXT, progress TEXT, cancel INTEGER DEFAULT 0);
          CREATE TABLE IF NOT EXISTS gallery(id TEXT PRIMARY KEY, rel TEXT UNIQUE, mtime REAL, size INTEGER, meta TEXT, favorite INTEGER DEFAULT 0);
          CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, filename TEXT, created REAL);
          CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, image_id TEXT);
        ''')
        self.config_path = self.data_dir / 'remote.json'
        self.comfy = comfy.rstrip('/')
        self.keep_awake = keep_awake
        self.info = None
        self.info_time = 0
        self.scan_time = 0
        self.scan_lock = asyncio.Lock()
        self.session = None
        self.wake = asyncio.Event()
        self.active_native = None
        self.stopping = False

    def config(self):
        try:
            return json.loads(self.config_path.read_text(encoding='utf-8-sig'))
        except (OSError, ValueError):
            return {}

    async def comfy_request(self, path, data=None, timeout=20):
        method = 'GET' if data is None else 'POST'
        async with self.session.request(method, self.comfy + path, json=data, timeout=ClientTimeout(total=timeout)) as response:
            text = await response.text()
            value = json.loads(text) if text else {}
            if response.status >= 400:
                errors = [e.get('details', e.get('message', '')) for n in value.get('node_errors', {}).values() for e in n.get('errors', [])]
                raise ValueError(value.get('error', {}).get('message', '') + ' '.join(errors) or f'ComfyUI HTTP {response.status}')
            return value

    async def catalog(self):
        if not self.info or time.time() - self.info_time > 30:
            self.info = await self.comfy_request('/object_info')
            self.info_time = time.time()
        info = self.info
        def choices(node, field):
            return info.get(node, {}).get('input', {}).get('required', {}).get(field, [[]])[0]
        klein_ready = (KLEIN_NODES <= info.keys()
                       and KLEIN_CLIP in choices('CLIPLoader', 'clip_name')
                       and 'flux2' in choices('CLIPLoader', 'type')
                       and KLEIN_VAE in choices('VAELoader', 'vae_name'))
        klein_models = [m for m in choices('UnetLoaderGGUF', 'unet_name')
                        if m.lower().startswith('flux-2-klein-9b-') and m.lower().endswith('.gguf')] if klein_ready else []
        return {'kleinEdit': bool(klein_models and KLEIN_EDIT_NODES <= info.keys()
                                  and KLEIN_LORA in choices('LoraLoaderModelOnly', 'lora_name')),
                'models': {'sd': choices('CheckpointLoaderSimple', 'ckpt_name'),
                           'qwen': [m for m in choices('UnetLoaderGGUF', 'unet_name') if 'qwen' in m.lower() and '2.1' in m],
                           'klein': klein_models,
                           'moss': [m for m in choices('MOSSOfficialDiffusionLoader', 'model_name') if 'moss-image-' in m]},
                'samplers': choices('KSampler', 'sampler_name'), 'schedulers': choices('KSampler', 'scheduler'),
                'loras': choices('LoraLoader', 'lora_name'),
                'motion': all(node['class_type'] in info and all(
                    value in choices(node['class_type'], key)
                    for key, value in node['inputs'].items()
                    if key in ('unet_name', 'clip_name', 'vae_name', 'lora_name'))
                    for node in MOTION_GRAPH.values()),
                'recognition': {'wd14': any('WD14Tagger' in n for n in info),
                                'qwen': 'TextGenerate' in info and QWEN_CLIP in choices('CLIPLoader', 'clip_name'),
                                'florence': 'Florence2Run' in info and 'Florence-2-large' in choices('Florence2ModelLoader', 'model')}}

    def job(self, job_id):
        row = self.db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not row:
            return None
        job = dict(row)
        for key in ('request', 'result', 'progress'):
            job[key] = json.loads(job[key] or '{}')
        return job

    def update_job(self, job_id, **changes):
        changes['updated'] = time.time()
        for key in ('result', 'progress'):
            if key in changes:
                changes[key] = json.dumps(changes[key], ensure_ascii=False)
        self.db.execute('UPDATE jobs SET ' + ','.join(f'{k}=?' for k in changes) + ' WHERE id=?', (*changes.values(), job_id))
        self.db.commit()

    async def scan(self, force=False):
        async with self.scan_lock:
            if not force and time.time() - self.scan_time < 8:
                return
            known = {r['rel']: dict(r) for r in self.db.execute('SELECT rel,mtime,size FROM gallery')}
            def files():
                found, updates = set(), []
                for path in self.output.rglob('*'):
                    if not path.is_file() or path.suffix.lower() not in IMAGE_EXT or not path.resolve().is_relative_to(self.output):
                        continue
                    rel = path.relative_to(self.output).as_posix()
                    found.add(rel)
                    stat = path.stat()
                    if rel in known and known[rel]['mtime'] == stat.st_mtime and known[rel]['size'] == stat.st_size:
                        continue
                    try:
                        updates.append((hashlib.sha256(rel.encode()).hexdigest()[:24], rel, stat.st_mtime, stat.st_size, json.dumps(image_meta(path), ensure_ascii=False)))
                    except (OSError, ValueError, Image.DecompressionBombError):
                        continue
                return found, updates
            found, updates = await asyncio.to_thread(files)
            self.db.executemany('INSERT INTO gallery(id,rel,mtime,size,meta) VALUES(?,?,?,?,?) ON CONFLICT(rel) DO UPDATE SET mtime=excluded.mtime,size=excluded.size,meta=excluded.meta', updates)
            for rel in known.keys() - found:
                self.db.execute('DELETE FROM gallery WHERE rel=?', (rel,))
            self.db.commit()
            self.scan_time = time.time()

    def image_path(self, image_id):
        row = self.db.execute('SELECT * FROM gallery WHERE id=?', (image_id,)).fetchone()
        if not row:
            raise web.HTTPNotFound()
        path = (self.output / row['rel']).resolve()
        if not path.is_relative_to(self.output) or not path.is_file():
            raise web.HTTPNotFound()
        return path, dict(row)

    def gallery_item(self, row):
        data = dict(row)
        data['meta'] = json.loads(data['meta'])
        rel = Path(data['rel'])
        data['meta'].update(filename=rel.name, subfolder=rel.parent.as_posix() if rel.parent.as_posix() != '.' else '')
        data['name'] = Path(data.pop('rel')).name
        data['url'] = '/media/' + data['id']
        data['thumb'] = '/thumb/' + data['id'] + '?v=' + str(int(data['mtime']))
        return data

    async def cancel_native(self, native_id):
        if not native_id:
            return
        await self.comfy_request('/queue', {'delete': [native_id]})
        queue = await self.comfy_request('/queue')
        if any(item[1] == native_id for item in queue.get('queue_running', [])):
            await self.comfy_request('/interrupt', {})

    def generation_source(self, data):
        if data.get('mode') != 'img2img':
            return None
        row = self.db.execute('SELECT filename FROM uploads WHERE id=?', (data.get('upload'),)).fetchone()
        if not row or not (self.input / row['filename']).is_file():
            raise ValueError('請重新上傳來源圖片')
        return row['filename']

    async def motion_workflow(self, job_id, data):
        if data['gallery']:
            path, _ = self.image_path(data['gallery'])
            filename = 'void-motion-' + job_id + path.suffix.lower()
            await asyncio.to_thread(shutil.copyfile, path, self.input / filename)
        else:
            row = self.db.execute('SELECT filename FROM uploads WHERE id=?', (data['upload'],)).fetchone()
            if not row:
                raise ValueError('來源圖片已不存在，請重新上傳')
            filename = row['filename']
        width, height = MOTION_SIZES[data['size']]
        seed = secrets.randbits(32)
        graph = json.loads(json.dumps(MOTION_GRAPH))
        graph['2']['inputs']['text'] = data['prompt']
        graph['5']['inputs']['image'] = filename
        graph['6']['inputs'].update(width=width, height=height, length=data['seconds'] * 16 + 1)
        for node in ('30', '31'):
            graph[node]['inputs']['noise_seed'] = seed
        return graph, {'engine': 'wan', 'seed': seed, 'width': width, 'height': height}

    async def execute(self, job):
        job_id, data = job['id'], job['request']
        if not job['native_id']:
            if job['kind'] == 'generate':
                workflow, meta = generate(data, await self.catalog(), self.generation_source(data))
            elif job['kind'] == 'motion':
                workflow, meta = await self.motion_workflow(job_id, data)
            elif job['engine'] == 'wd14':
                self.update_job(job_id, state='running')
                upload = self.db.execute('SELECT filename FROM uploads WHERE id=?', (data['upload'],)).fetchone()
                if not upload:
                    raise ValueError('來源圖片已不存在，請重新上傳')
                from urllib.parse import urlencode
                query = urlencode({'filename': upload['filename'], 'type': 'input', 'threshold': number_value(data, 'threshold', .30, .05, .9), 'character_threshold': number_value(data, 'character_threshold', .75, .05, .95)})
                text = await self.comfy_request('/pysssss/wd14tagger/tag?' + query, timeout=120)
                if not self.job(job_id)['cancel']:
                    self.update_job(job_id, state='done', result={'text': text})
                return
            else:
                upload = self.db.execute('SELECT filename FROM uploads WHERE id=?', (data['upload'],)).fetchone()
                if not upload:
                    raise ValueError('來源圖片已不存在，請重新上傳')
                workflow, meta = caption(data, upload['filename']), {}
            # Save intent before sending; never retry an ambiguous POST automatically.
            if self.job(job_id)['cancel']:
                return
            self.update_job(job_id, state='submitting')
            response = await self.comfy_request('/prompt', {'prompt': workflow, 'client_id': 'void-mobile', 'extra_data': {'extra_pnginfo': {'void_mobile': meta}}})
            native = response['prompt_id']
            if self.job(job_id)['cancel']:
                self.update_job(job_id, native_id=native)
                await self.cancel_native(native)
                return
            self.update_job(job_id, native_id=native, state='queued')
        else:
            native = job['native_id']
        self.active_native = native
        missing = 0
        while not self.stopping:
            current = self.job(job_id)
            if current['cancel']:
                await self.cancel_native(native)
                return
            history = await self.comfy_request('/history/' + native)
            if self.job(job_id)['cancel']:
                return
            item = history.get(native)
            if item:
                if item.get('status', {}).get('status_str') != 'success':
                    error = next((m[1].get('exception_message', '執行失敗') for m in item.get('status', {}).get('messages', []) if m[0] == 'execution_error'), '工作已中斷')
                    raise ValueError(error)
                if job['kind'] == 'caption':
                    result = {'text': '\n'.join(item.get('outputs', {}).get('4', {}).get('text', []))}
                elif job['kind'] == 'motion':
                    videos = item.get('outputs', {}).get('34', {}).get('images', [])
                    video = next((v for v in videos if v.get('filename', '').endswith('.mp4')
                                  and v.get('subfolder') == 'VOID-Motion'), None)
                    if not video:
                        raise ValueError('未取得輸出影片')
                    result = {'video': video['filename'], 'url': '/video/' + job_id}
                else:
                    result = {'images': item.get('outputs', {}).get('7', {}).get('images', [])}
                    if not result['images']:
                        raise ValueError('未取得輸出圖片')
                    await self.scan(True)
                    result['gallery'] = [hashlib.sha256((str(Path(i.get('subfolder', '')) / i['filename']).replace('\\', '/')).encode()).hexdigest()[:24] for i in result['images']]
                result['seconds'] = round(time.time() - job['created'], 1)
                self.update_job(job_id, state='done', result=result)
                return
            queue = await self.comfy_request('/queue')
            if self.job(job_id)['cancel']:
                return
            running = any(i[1] == native for i in queue.get('queue_running', []))
            pending = any(i[1] == native for i in queue.get('queue_pending', []))
            self.update_job(job_id, state='running' if running else 'queued')
            missing = 0 if running or pending else missing + 1
            if missing > 5:
                raise ValueError('ComfyUI 工作已移除或後端重啟，請重新執行')
            await asyncio.sleep(2)

    async def worker(self):
        while not self.stopping:
            row = self.db.execute("SELECT id FROM jobs WHERE state IN ('queued','running') AND cancel=0 ORDER BY created LIMIT 1").fetchone()
            if not row:
                self.wake.clear()
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(self.wake.wait(), 3)
                continue
            job = self.job(row['id'])
            try:
                await self.comfy_request('/system_stats', timeout=5)
            except (OSError, asyncio.TimeoutError, ClientError, ValueError):
                await asyncio.sleep(3)
                continue
            try:
                await self.execute(job)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                if not self.job(job['id'])['cancel']:
                    self.update_job(job['id'], state='error', error=str(error)[:1500])
                logging.exception('Mobile job failed: %s', job['id'])
            finally:
                self.active_native = None

    async def progress_listener(self):
        while not self.stopping:
            try:
                async with self.session.ws_connect(self.comfy + '/ws?clientId=void-mobile', heartbeat=20) as socket:
                    async for message in socket:
                        if message.type.name != 'TEXT':
                            continue
                        event = json.loads(message.data)
                        data = event.get('data', {})
                        if event.get('type') == 'progress' and data.get('prompt_id') == self.active_native:
                            row = self.db.execute('SELECT id FROM jobs WHERE native_id=?', (self.active_native,)).fetchone()
                            if row:
                                self.update_job(row['id'], progress={'value': data.get('value', 0), 'max': data.get('max', 0)})
            except (OSError, asyncio.TimeoutError, ClientError, ValueError):
                await asyncio.sleep(3)

    async def awake_loop(self):
        while not self.stopping:
            if os.name == 'nt':
                ctypes.windll.kernel32.SetThreadExecutionState(0x80000001 if self.keep_awake else 0x80000000)
            await asyncio.sleep(30)

    async def start(self, app):
        self.session = ClientSession()
        self.db.execute("UPDATE jobs SET state='error', error='提交時服務曾中斷，請先查看 ComfyUI 再重新執行' WHERE state='submitting'")
        self.db.commit()
        self.tasks = [asyncio.create_task(self.worker()), asyncio.create_task(self.progress_listener()), asyncio.create_task(self.awake_loop())]

    async def stop(self, app):
        self.stopping = True
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.session.close()
        self.db.close()
        if os.name == 'nt':
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)


def number_value(data, key, default, low, high):
    value = float(data.get(key, default))
    if not low <= value <= high:
        raise ValueError(f'{key} 不在允許範圍')
    return value


def create_app(gateway=None):
    g = gateway or Gateway()

    @web.middleware
    async def private_access(request, handler):
        config = g.config()
        host = urlsplit('//' + request.host).hostname
        local = host in ('127.0.0.1', 'localhost', '::1')
        remote_host = config.get('hostname', '').rstrip('.')
        login = request.headers.get('Tailscale-User-Login', '')
        if not local and (host != remote_host or not config.get('owner') or login.casefold() != config['owner'].casefold()):
            raise web.HTTPForbidden(text='這是私人 VOID 服務，請使用擁有者帳號連線。')
        origin = request.headers.get('Origin')
        desktop_origin = origin in ('http://127.0.0.1:8081', 'http://localhost:8081')
        desktop_path = request.path in ('/api/import', '/api/trash') or ((request.path == '/api/gallery' or request.path.startswith(('/media/', '/thumb/'))) and request.method in ('GET', 'OPTIONS')) or (request.path.startswith('/api/gallery/') and request.method in ('PATCH', 'OPTIONS'))
        if origin and urlsplit(origin).netloc != request.host and not (desktop_origin and local and desktop_path):
            raise web.HTTPForbidden(text='不允許此來源')
        if request.method == 'OPTIONS':
            response = web.Response()
        else:
            try:
                response = await handler(request)
            except (ValueError, KeyError, TypeError) as error:
                response = web.json_response({'error': str(error)}, status=400)
        if desktop_origin and local and desktop_path:
            response.headers.update({'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin'})
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    app = web.Application(middlewares=[private_access], client_max_size=22*1024*1024)
    app['gateway'] = g
    app.on_startup.append(g.start)
    app.on_cleanup.append(g.stop)

    async def status(request):
        config = g.config()
        try:
            stats = await g.comfy_request('/system_stats', timeout=4)
            online = True
        except Exception:
            stats, online = {}, False
        devices = stats.get('devices', [])
        return web.json_response({'online': online, 'remoteUrl': config.get('url', ''), 'keepAwake': g.keep_awake, 'device': devices[0].get('name', '') if devices else '', 'version': 1})

    async def catalog(request):
        try:
            return web.json_response(await g.catalog())
        except Exception:
            return web.json_response({'error': 'ComfyUI 尚未啟動，請在電腦啟動 VOID。'}, status=503)

    async def jobs(request):
        if request.method == 'GET':
            ids = g.db.execute('SELECT id FROM jobs ORDER BY created DESC LIMIT 150').fetchall()
            return web.json_response({'jobs': [g.job(row['id']) for row in ids]})
        data = await request.json()
        kind = data.get('kind', 'generate')
        catalog_data = await g.catalog()
        if kind == 'generate':
            _, meta = generate(data, catalog_data, g.generation_source(data))
            data.update(meta)
            count_value = number_value(data, 'count', 1, 1, 4)
            if not count_value.is_integer():
                raise ValueError('張數必須是整數')
            count = int(count_value)
        elif kind == 'caption':
            if not catalog_data['recognition'].get(data.get('engine')):
                raise ValueError('所選辨識引擎尚未就緒')
            if not g.db.execute('SELECT id FROM uploads WHERE id=?', (data.get('upload'),)).fetchone():
                raise ValueError('請先上傳圖片')
            count = 1
        elif kind == 'motion':
            if not catalog_data['motion']:
                raise ValueError('Wan 影片模型尚未就緒')
            data = motion_settings(data)
            if data['gallery']:
                g.image_path(data['gallery'])
            elif not g.db.execute('SELECT id FROM uploads WHERE id=?', (data['upload'],)).fetchone():
                raise ValueError('請重新上傳來源圖片')
            count = 1
        else:
            raise ValueError('未知的任務類型')
        created = []
        for index in range(count):
            item = dict(data)
            if kind == 'generate':
                item['seed'] = (meta['seed'] + index) % (2**53)
            job_id = uuid.uuid4().hex
            now = time.time()
            g.db.execute('INSERT INTO jobs(id,kind,engine,state,created,updated,request) VALUES(?,?,?,?,?,?,?)', (job_id, kind, item['engine'], 'queued', now+index*.001, now, json.dumps(item, ensure_ascii=False)))
            created.append(job_id)
        g.db.commit()
        g.wake.set()
        return web.json_response({'ids': created}, status=201)

    async def cancel(request):
        job = g.job(request.match_info['id'])
        if not job:
            raise web.HTTPNotFound()
        if job['state'] not in TERMINAL:
            g.update_job(job['id'], cancel=1, state='cancelled')
            with contextlib.suppress(OSError, asyncio.TimeoutError, ClientError, ValueError):
                await g.cancel_native(job['native_id'])
        return web.json_response({'ok': True})

    async def upload(request):
        form = await request.multipart()
        field = await form.next()
        if not field or field.name != 'image':
            raise ValueError('請選擇圖片')
        content = bytearray()
        while chunk := await field.read_chunk():
            content.extend(chunk)
            if len(content) > 20*1024*1024:
                raise ValueError('圖片請小於 20MB')
        upload_id = uuid.uuid4().hex
        filename = 'void-mobile-' + upload_id + '.png'
        def prepare():
            with Image.open(io.BytesIO(content)) as image:
                if image.width*image.height > 40000000:
                    raise ValueError('圖片解析度過大，請先縮小')
                image = ImageOps.exif_transpose(image)
                image.thumbnail((1024, 1024))
                if image.mode == 'RGBA':
                    background = Image.new('RGB', image.size, 'white')
                    background.paste(image, mask=image.getchannel('A'))
                    image = background
                image.convert('RGB').save(g.input / filename)
        await asyncio.to_thread(prepare)
        g.db.execute('INSERT INTO uploads VALUES(?,?,?)', (upload_id, filename, time.time()))
        g.db.commit()
        return web.json_response({'id': upload_id, 'url': '/upload/' + upload_id})

    async def upload_view(request):
        row = g.db.execute('SELECT filename FROM uploads WHERE id=?', (request.match_info['id'],)).fetchone()
        if not row:
            raise web.HTTPNotFound()
        return web.FileResponse(g.input / row['filename'])

    async def gallery(request):
        await g.scan()
        rows = g.db.execute('SELECT * FROM gallery ORDER BY mtime DESC').fetchall()
        search = request.query.get('search', '').casefold()
        favorite = request.query.get('favorite') == '1'
        albums = sorted({a for r in rows for a in json.loads(r['meta']).get('albums', []) if isinstance(a, str)})
        album = request.query.get('album', '')
        selected = [r for r in rows if (not album or album in json.loads(r['meta']).get('albums', []))]
        selected = [r for r in selected if (not favorite or r['favorite']) and (not search or search in (r['rel']+r['meta']).casefold())]
        offset = max(0, int(request.query.get('offset', 0)))
        return web.json_response({'images': [g.gallery_item(r) for r in selected[offset:offset+40]], 'total': len(selected), 'offset': offset, 'albums': albums})

    async def image_file(request):
        path, row = g.image_path(request.match_info['id'])
        if request.path.startswith('/thumb/'):
            thumb = g.thumbs / (row['id'] + '-' + str(int(row['mtime']*1000)) + '.jpg')
            if not thumb.exists():
                def build_thumb():
                    with Image.open(path) as image:
                        if image.width*image.height > 40000000:
                            raise ValueError('圖片太大，請下載原圖查看')
                        image = ImageOps.exif_transpose(image)
                        image.thumbnail((480, 480))
                        image.convert('RGB').save(thumb, quality=82)
                await asyncio.to_thread(build_thumb)
            response = web.FileResponse(thumb)
        else:
            response = web.FileResponse(path)
            if request.query.get('download') == '1':
                from urllib.parse import quote
                response.headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + quote(path.name)
        response.headers['Cache-Control'] = 'private, max-age=3600'
        return response

    async def favorite(request):
        g.image_path(request.match_info['id'])
        data = await request.json()
        g.db.execute('UPDATE gallery SET favorite=? WHERE id=?', (int(bool(data.get('favorite'))), request.match_info['id']))
        g.db.commit()
        return web.json_response({'ok': True})

    async def import_record(request):
        data = await request.json()
        await g.scan()
        import_id = str(data.get('id', ''))[:100]
        if not import_id:
            raise ValueError('缺少匯入識別碼')
        meta = data.get('meta') or {}
        rel = str(Path(meta.get('subfolder', '')) / meta.get('filename', '')).replace('\\', '/')
        existing = g.db.execute('SELECT id FROM gallery WHERE rel=?', (rel,)).fetchone()
        prior = g.db.execute('SELECT image_id FROM imports WHERE id=?', (import_id,)).fetchone()
        if existing or prior:
            image_id = existing['id'] if existing else prior['image_id']
        else:
            raw = str(data.get('dataUrl', ''))
            if not raw.startswith('data:image/') or ',' not in raw:
                raise ValueError('此圖片沒有可匯入的原圖資料')
            content = base64.b64decode(raw.split(',', 1)[1], validate=True)
            dest = g.output / 'VOID-import' / (uuid.uuid4().hex + '.png')
            dest.parent.mkdir(exist_ok=True)
            with Image.open(io.BytesIO(content)) as image:
                if image.width*image.height > 40000000:
                    raise ValueError('圖片解析度過大')
                from PIL.PngImagePlugin import PngInfo
                png = PngInfo()
                png.add_text('void_mobile', json.dumps(meta, ensure_ascii=False))
                image.save(dest, pnginfo=png)
            await g.scan(True)
            image_id = hashlib.sha256(dest.relative_to(g.output).as_posix().encode()).hexdigest()[:24]
        previous = g.db.execute('SELECT meta FROM gallery WHERE id=?', (image_id,)).fetchone()
        merged = {**json.loads(previous['meta']), **meta} if previous else meta
        g.db.execute('UPDATE gallery SET favorite=?,meta=? WHERE id=?', (int(bool(data.get('favorite'))), json.dumps(merged, ensure_ascii=False), image_id))
        g.db.execute('INSERT OR REPLACE INTO imports VALUES(?,?)', (import_id, image_id))
        g.db.commit()
        return web.json_response({'ok': True, 'id': image_id})

    async def trash(request):
        data = await request.json()
        filename = str(data.get('filename', ''))
        subfolder = str(data.get('subfolder', '')).replace('\\', '/')
        if not filename or '/' in filename or '\\' in filename or ':' in filename or Path(filename).suffix.lower() not in IMAGE_EXT:
            raise ValueError('缺少正確的圖片檔名，未刪除任何檔案')
        if '..' in subfolder.split('/') or ':' in subfolder or subfolder.startswith('/'):
            raise ValueError('輸出子資料夾無效')
        source = (g.output / subfolder / filename).resolve()
        if not source.is_relative_to(g.output):
            raise ValueError('只能處理 ComfyUI output 內的圖片')
        if not source.exists():
            return web.json_response({'ok': True, 'missing': True})
        if not source.is_file():
            raise ValueError('來源不是圖片檔案')
        trash_id = uuid.uuid4().hex
        destination = g.data_dir / 'trash' / trash_id
        destination.mkdir(parents=True)
        manifest = {'original': source.relative_to(g.output).as_posix(), 'filename': filename, 'trashedAt': time.time()}
        (destination / 'restore.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
        try:
            source.rename(destination / filename)
        except OSError as error:
            return web.json_response({'error': '原檔移至回收區失敗，圖庫紀錄已保留：' + str(error)}, status=409)
        await g.scan(True)
        return web.json_response({'ok': True, 'trashId': trash_id})

    async def settings(request):
        data = await request.json()
        g.keep_awake = bool(data.get('keepAwake'))
        return web.json_response({'keepAwake': g.keep_awake})

    async def video_file(request):
        job = g.job(request.match_info['id'])
        if not job or job['kind'] != 'motion' or job['state'] != 'done':
            raise web.HTTPNotFound()
        directory = g.output / 'VOID-Motion'
        path = (directory / job['result'].get('video', '')).resolve()
        if path.parent != directory or path.suffix != '.mp4' or not path.is_file():
            raise web.HTTPNotFound()
        response = web.FileResponse(path)
        response.headers['Cache-Control'] = 'private, no-store'
        if request.query.get('download') == '1':
            response.headers['Content-Disposition'] = f'attachment; filename="{job["id"]}.mp4"'
        return response

    async def static(request):
        name = request.match_info.get('name') or 'index.html'
        if name not in ('index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png'):
            raise web.HTTPNotFound()
        response = web.FileResponse(ROOT / 'mobile' / name)
        response.headers['Cache-Control'] = 'no-cache'
        return response

    app.router.add_get('/api/status', status)
    app.router.add_get('/api/catalog', catalog)
    app.router.add_get('/api/jobs', jobs)
    app.router.add_post('/api/jobs', jobs)
    app.router.add_post('/api/jobs/{id}/cancel', cancel)
    app.router.add_post('/api/upload', upload)
    app.router.add_get('/upload/{id}', upload_view)
    app.router.add_get('/api/gallery', gallery)
    app.router.add_patch('/api/gallery/{id}', favorite)
    app.router.add_route('*', '/api/import', import_record)
    app.router.add_post('/api/trash', trash)
    app.router.add_options('/api/trash', trash)
    app.router.add_patch('/api/settings', settings)
    app.router.add_get('/media/{id}', image_file)
    app.router.add_get('/thumb/{id}', image_file)
    app.router.add_get('/video/{id}', video_file)
    app.router.add_get('/', static)
    app.router.add_get('/{name}', static)
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8090)
    parser.add_argument('--allow-sleep', action='store_true')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    web.run_app(create_app(Gateway(keep_awake=not args.allow_sleep)), host='127.0.0.1', port=args.port, access_log=None)
