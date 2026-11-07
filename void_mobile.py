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

from mobile_workflows import (generate, caption, SD_EDIT_NODES, MASK_NODES, MOODY_MODEL, MOODY_VAE, MOODY_NODES, MOODY_CLIP, QWEN_CLIP, QWEN_MODEL, KLEIN_CLIP,
                              KLEIN_VAE, KLEIN_LORA, KLEIN_NODES, KLEIN_EDIT_NODES)

PANEL_ROOT = Path(__file__).resolve().parent
ROOT = PANEL_ROOT.parent
TERMINAL = ('done', 'error', 'cancelled')
IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.webp'}
GUEST_OUTPUT = '_void_guests'


def recycle_windows_paths(paths):
    """Ask Windows Shell to recycle paths; never fall back to unlink/rmtree."""
    if not paths:
        return
    if os.name != 'nt':
        raise ValueError('此功能需要 Windows 資源回收筒')
    from ctypes import wintypes
    class Operation(ctypes.Structure):
        _fields_ = [('hwnd', wintypes.HWND), ('wFunc', wintypes.UINT),
                    ('pFrom', wintypes.LPCWSTR), ('pTo', wintypes.LPCWSTR),
                    ('fFlags', wintypes.WORD), ('fAnyOperationsAborted', wintypes.BOOL),
                    ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', wintypes.LPCWSTR)]
    names = ctypes.create_unicode_buffer('\0'.join(str(path) for path in paths) + '\0\0')
    operation = Operation()
    operation.wFunc = 3  # FO_DELETE
    operation.pFrom = ctypes.cast(names, wintypes.LPCWSTR)
    operation.fFlags = 0x0040 | 0x0010 | 0x0400 | 0x0004  # ALLOWUNDO, NOCONFIRMATION, NOERRORUI, SILENT
    shell = ctypes.windll.shell32.SHFileOperationW
    shell.argtypes = [ctypes.POINTER(Operation)]
    shell.restype = ctypes.c_int
    result = shell(ctypes.byref(operation))
    if result or operation.fAnyOperationsAborted:
        raise OSError(f'Windows 資源回收筒移動未完成（{result}），未移走的資料仍保留')

MOTION_GRAPH = json.loads((ROOT / 'mobile_motion_graph.json').read_text(encoding='utf-8'))
MOTION_SIZES = {'landscape': (640, 384), 'portrait': (384, 640), 'square': (512, 512)}


def motion_settings(data):
    prompt = data.get('prompt', '')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 4000:
        raise ValueError('請輸入 1 至 4000 字的動作描述')
    size = data.get('size', 'portrait')
    seconds = data.get('seconds', 5)
    short_edge = data.get('shortEdge')
    if size not in MOTION_SIZES or seconds not in (3, 5, 10) or short_edge not in (None, 384, 480):
        raise ValueError('影片比例或長度不支援')
    gallery_id, upload_id = data.get('gallery'), data.get('upload')
    if bool(gallery_id) == bool(upload_id):
        raise ValueError('請選擇一張起始圖片')
    return {'kind': 'motion', 'engine': 'wan', 'prompt': prompt.strip(), 'size': size,
            'seconds': seconds, 'gallery': gallery_id, 'upload': upload_id,
            **({'shortEdge': short_edge} if short_edge is not None else {})}


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
    def __init__(self, data_dir=None, output=None, input_dir=None, comfy='http://127.0.0.1:8188', keep_awake=True, guest=None):
        self.guest = guest
        self.output_prefix = f'{GUEST_OUTPUT}/{guest}/' if guest else ''
        self.client_id = f'void-guest-{guest}' if guest else 'void-mobile'
        self.data_dir = Path(data_dir or ROOT / 'void-data')
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.thumbs = self.data_dir / 'thumbs'
        self.thumbs.mkdir(exist_ok=True)
        self.output = Path(output or ROOT / 'ComfyUI_windows_portable/ComfyUI/output' / self.output_prefix).resolve()
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
          CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT, updated REAL, snapshot TEXT);
          CREATE INDEX IF NOT EXISTS gallery_order ON gallery(mtime DESC,id DESC);
          CREATE TABLE IF NOT EXISTS gallery_revision(id INTEGER PRIMARY KEY, value INTEGER NOT NULL);
          INSERT OR IGNORE INTO gallery_revision VALUES(1,0);
          CREATE TRIGGER IF NOT EXISTS gallery_insert_revision AFTER INSERT ON gallery BEGIN UPDATE gallery_revision SET value=value+1 WHERE id=1; END;
          CREATE TRIGGER IF NOT EXISTS gallery_update_revision AFTER UPDATE ON gallery BEGIN UPDATE gallery_revision SET value=value+1 WHERE id=1; END;
          CREATE TRIGGER IF NOT EXISTS gallery_delete_revision AFTER DELETE ON gallery BEGIN UPDATE gallery_revision SET value=value+1 WHERE id=1; END;
        ''')
        self.config_path = self.data_dir / 'remote.json'
        self.comfy = comfy.rstrip('/')
        self.keep_awake = keep_awake
        self.info = None
        self.info_time = 0
        self.scan_time = 0
        self.last_activity = time.time()
        self.resources_released = False
        self.gallery_epoch = uuid.uuid4().hex
        self.db.create_function("VOID_CASEFOLD", 1, lambda value: str(value or "").casefold())
        self.scan_lock = asyncio.Lock()
        self.session = None
        self.wake = asyncio.Event()
        self.active_native = None
        self.preview_clients = {}
        self.latest_preview = None
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
        sd_models = [m for m in choices('CheckpointLoaderSimple', 'ckpt_name')
                     if not any(f in m.lower() for f in ('flux', 'qwen', 'moss', 'wan2', 'sd3', 'stable-diffusion-3'))]
        return {'sdEdit': bool(sd_models and SD_EDIT_NODES <= info.keys()), 'sdEditModels': sd_models, 'editMask': MASK_NODES <= info.keys(),
                'kleinContinuous': bool(klein_models and (KLEIN_EDIT_NODES - {'LoraLoaderModelOnly'}) <= info.keys()),
                'kleinEdit': bool(klein_models and KLEIN_EDIT_NODES <= info.keys()
                                  and KLEIN_LORA in choices('LoraLoaderModelOnly', 'lora_name')),
                'models': {'sd': choices('CheckpointLoaderSimple', 'ckpt_name'),
                           'qwen': [m for m in choices('UnetLoaderGGUF', 'unet_name') if 'qwen' in m.lower() and '2.1' in m],
                           'klein': klein_models,
                           'moody': [MOODY_MODEL] if (MOODY_NODES <= info.keys()
                                    and MOODY_MODEL in choices('UNETLoader', 'unet_name')
                                    and MOODY_CLIP in choices('CLIPLoader', 'clip_name')
                                    and 'moss_image' in choices('CLIPLoader', 'type')
                                    and MOODY_VAE in choices('VAELoader', 'vae_name')
                                    and 'euler' in choices('KSampler', 'sampler_name')
                                    and 'simple' in choices('KSampler', 'scheduler')) else [],
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
            known = {r['rel']: dict(r) for r in self.db.execute('SELECT rel,mtime,size,meta FROM gallery')}
            def files():
                found, updates = set(), []
                for path in self.output.rglob('*'):
                    if not path.is_file() or path.suffix.lower() not in IMAGE_EXT or not path.resolve().is_relative_to(self.output):
                        continue
                    rel = path.relative_to(self.output).as_posix()
                    if not self.guest and rel.startswith(GUEST_OUTPUT + '/'):
                        continue
                    found.add(rel)
                    stat = path.stat()
                    if rel in known and known[rel]['mtime'] == stat.st_mtime and known[rel]['size'] == stat.st_size:
                        continue
                    try:
                        meta = image_meta(path)
                        previous = json.loads(known.get(rel, {}).get('meta', '{}'))
                        for key in ('tags', 'albums', 'rating'):
                            if key in previous:
                                meta[key] = previous[key]
                        updates.append((hashlib.sha256(rel.encode()).hexdigest()[:24], rel, stat.st_mtime, stat.st_size, json.dumps(meta, ensure_ascii=False)))
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
        if not path.is_relative_to(self.output) or not path.is_file() or (not self.guest and path.relative_to(self.output).parts[0] == GUEST_OUTPUT):
            raise web.HTTPNotFound()
        return path, dict(row)

    def gallery_item(self, row):
        data = dict(row)
        data['meta'] = json.loads(data['meta'])
        rel = Path(data['rel'])
        data['meta'].update(filename=rel.name, subfolder=rel.parent.as_posix() if rel.parent.as_posix() != '.' else '')
        data['name'] = Path(data.pop('rel')).name
        version = str(int(data['mtime']*1_000_000_000)) + '-' + str(data['size'])
        data['version'] = version
        data['url'] = '/media/' + data['id'] + '?v=' + version
        data['thumb'] = '/thumb/' + data['id'] + '?v=' + version
        return data

    async def cancel_native(self, native_id):
        if not native_id:
            return
        await self.comfy_request('/queue', {'delete': [native_id]})
        queue = await self.comfy_request('/queue')
        if any(item[1] == native_id for item in queue.get('queue_running', [])):
            await self.comfy_request('/interrupt', {'prompt_id': native_id})

    def generation_source(self, data, key='upload'):
        if data.get('mode') != 'img2img':
            return None
        if key in ('referenceUpload', 'maskUpload') and (data.get('continuous') is not True or not data.get(key)):
            return None
        row = self.db.execute('SELECT filename FROM uploads WHERE id=?', (data.get(key),)).fetchone()
        if not row or not (self.input / row['filename']).is_file():
            raise ValueError('請重新上傳來源圖片')
        return row['filename']

    def prepare_edit_region(self, data):
        if not data.get('continuous') or not data.get('maskUpload') or data.get('region'):
            return
        source_name = self.generation_source(data)
        mask_name = self.generation_source(data, 'maskUpload')
        data['originalUpload'] = data['upload']
        data['originalMaskUpload'] = data['maskUpload']
        with Image.open(self.input / source_name) as source, Image.open(self.input / mask_name) as mask:
            source = source.convert('RGB')
            mask = mask.convert('L').resize(source.size)
            bounds = mask.point(lambda value: 255 if value > 8 else 0).getbbox()
            if not bounds:
                raise ValueError('遮罩沒有修改區域')
            pad = max(32, int(max(bounds[2]-bounds[0], bounds[3]-bounds[1])*.2))
            box = (max(0, bounds[0]-pad), max(0, bounds[1]-pad), min(source.width, bounds[2]+pad), min(source.height, bounds[3]+pad))
            width, height = box[2]-box[0], box[3]-box[1]
            data['region'] = {'source': source_name, 'box': list(box), 'width': source.width, 'height': source.height}
            for key, image in (('upload', source.crop(box)), ('maskUpload', mask.crop(box))):
                content = io.BytesIO()
                image.save(content, format='PNG')
                asset_id = hashlib.sha256(b'void-region-v1:'+content.getvalue()).hexdigest()[:32]
                name = 'void-region-'+asset_id+'.png'
                if not (self.input / name).exists():
                    (self.input / name).write_bytes(content.getvalue())
                self.db.execute('INSERT OR IGNORE INTO uploads VALUES(?,?,?)', (asset_id, name, time.time()))
                data[key] = asset_id
            self.db.commit()
            scale = min(1, 768/max(width, height))
            data['width'] = max(256, round(width*scale/16)*16)
            data['height'] = max(256, round(height*scale/16)*16)

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
        if 'shortEdge' in data:
            scale = data['shortEdge'] / min(width, height)
            width, height = (round(edge * scale / 16) * 16 for edge in (width, height))
        seed = secrets.randbits(32)
        graph = json.loads(json.dumps(MOTION_GRAPH))
        graph['2']['inputs']['text'] = data['prompt']
        graph['5']['inputs']['image'] = filename
        graph['6']['inputs'].update(width=width, height=height, length=data['seconds'] * 16 + 1)
        for node in ('30', '31'):
            graph[node]['inputs']['noise_seed'] = seed
        return graph, {'engine': 'wan', 'seed': seed, 'width': width, 'height': height}

    async def execute(self, job):
        self.last_activity = time.time()
        self.resources_released = False
        job_id, data = job['id'], job['request']
        if not job['native_id']:
            if job['kind'] == 'generate':
                workflow, meta = generate(data, await self.catalog(), self.generation_source(data),
                                          self.generation_source(data, 'referenceUpload'), self.generation_source(data, 'maskUpload'))
            elif job['kind'] == 'workflow':
                workflow, meta = data['workflow'], data.get('meta', {})
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
            if self.guest:
                for node in workflow.values():
                    if node['class_type'] in ('SaveImage', 'SaveVideo'):
                        node['inputs']['filename_prefix'] = self.output_prefix + node['inputs']['filename_prefix']
            response = await self.comfy_request('/prompt', {'prompt': workflow, 'client_id': self.client_id,
                'extra_data': {'preview_method': 'latent2rgb', 'extra_pnginfo': {'void_mobile': meta}}})
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
                                  and v.get('subfolder') == self.output_prefix + 'VOID-Motion'), None)
                    if not video:
                        raise ValueError('未取得輸出影片')
                    result = {'video': video['filename'], 'url': '/video/' + job_id}
                else:
                    result = {'images': item.get('outputs', {}).get(str(data.get('saveNodeId', '7')), {}).get('images', [])}
                    if self.guest:
                        result['images'] = [{**image, 'subfolder': image['subfolder'][len(self.output_prefix):]}
                                            for image in result['images']
                                            if image.get('subfolder', '').startswith(self.output_prefix)]
                    if not result['images']:
                        raise ValueError('未取得輸出圖片')
                    self.update_job(job_id, progress={'phase': 'saving'})
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
            state = 'running' if running else 'queued'
            if current['state'] != state:
                self.update_job(job_id, state=state, progress=current['progress'] if current['progress'].get('max') else
                                {'phase': 'preparing' if running else 'queued'})
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
                self.latest_preview = None
                self.last_activity = time.time()

    def resource_profile(self):
        try:
            profile = json.loads((self.data_dir / 'performance.json').read_text(encoding='utf-8')).get('profile')
            return profile if profile in ('economy', 'balanced', 'creative') else 'balanced'
        except (OSError, ValueError, TypeError):
            return 'balanced'

    async def resource_loop(self):
        if self.guest:
            return
        while not self.stopping:
            await asyncio.sleep(10)
            timeout = {'economy': 30, 'balanced': 300, 'creative': 1800}[self.resource_profile()]
            if self.resources_released or time.time() - self.last_activity < timeout:
                continue
            if self.db.execute("SELECT 1 FROM jobs WHERE state IN ('queued','submitting','running') AND cancel=0 LIMIT 1").fetchone():
                continue
            try:
                queue = await self.comfy_request('/queue')
                if queue.get('queue_running') or queue.get('queue_pending'):
                    self.last_activity = time.time()
                    continue
                if self.db.execute("SELECT 1 FROM jobs WHERE state IN ('queued','submitting','running') AND cancel=0 LIMIT 1").fetchone():
                    continue
                await self.comfy_request('/free', {'unload_models': True, 'free_memory': True})
                self.resources_released = True
            except (OSError, asyncio.TimeoutError, ClientError, ValueError):
                continue

    async def progress_listener(self):
        while not self.stopping:
            try:
                async with self.session.ws_connect(self.comfy + '/ws?clientId=' + self.client_id, heartbeat=20) as socket:
                    preview_native = None
                    async for message in socket:
                        if message.type.name == 'BINARY' and self.active_native and preview_native == self.active_native:
                            row = self.db.execute('SELECT id FROM jobs WHERE native_id=?', (self.active_native,)).fetchone()
                            if row and len(message.data) <= 8*1024*1024:
                                job_id = row['id']
                                self.latest_preview = (job_id, message.data)
                                for client in tuple(self.preview_clients.get(job_id, ())):
                                    if not client.closed:
                                        with contextlib.suppress(ConnectionError, asyncio.TimeoutError):
                                            await asyncio.wait_for(client.send_bytes(message.data), 1)
                            continue
                        if message.type.name != 'TEXT':
                            continue
                        event = json.loads(message.data)
                        data = event.get('data', {})
                        if event.get('type') in ('execution_start', 'executing') and data.get('prompt_id'):
                            preview_native = data['prompt_id']
                        if event.get('type') == 'progress' and data.get('prompt_id') == self.active_native:
                            row = self.db.execute('SELECT id FROM jobs WHERE native_id=?', (self.active_native,)).fetchone()
                            if row:
                                self.update_job(row['id'], progress={'phase': 'generating', 'value': data.get('value', 0), 'max': data.get('max', 0)})
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
        self.tasks = [asyncio.create_task(self.worker()), asyncio.create_task(self.progress_listener()), asyncio.create_task(self.awake_loop()), asyncio.create_task(self.resource_loop())]

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
        if g.guest and (local or request.host.casefold() != config.get('authority', '').casefold()):
            raise web.HTTPForbidden(text='請使用此訪客的私人網址。')
        if not local and (host != remote_host or not config.get('owner') or login.casefold() != config['owner'].casefold()):
            raise web.HTTPForbidden(text='這是私人 VOID 服務，請使用擁有者帳號連線。')
        if g.guest and ((request.path in ('/api/resources', '/api/settings') and request.method != 'GET') or request.path == '/api/trash/empty'):
            raise web.HTTPForbidden(text='訪客不能變更主機設定或清空 Windows 回收資料。')
        origin = request.headers.get('Origin')
        desktop_origin = origin in ('http://127.0.0.1:8080', 'http://localhost:8080')
        desktop_path = (request.path in ('/api/import', '/api/trash', '/api/trash/restore', '/api/trash/empty', '/api/upload', '/api/jobs', '/api/resources', '/api/projects') or request.path.startswith('/api/projects/')
                        or (request.path.startswith('/api/jobs/') and request.path.endswith('/cancel'))
                        or ((request.path == '/api/gallery' or request.path.startswith(('/api/jobs/', '/media/', '/thumb/', '/video/'))) and request.method in ('GET', 'OPTIONS'))
                        or (request.path.startswith('/api/gallery/') and request.method in ('PATCH', 'OPTIONS')))
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
        return web.json_response({'online': online, 'remoteUrl': config.get('url', ''), 'keepAwake': g.keep_awake, 'device': devices[0].get('name', '') if devices else '', 'version': 1, 'isolatedGuests': True})

    async def catalog(request):
        try:
            return web.json_response(await g.catalog())
        except Exception:
            return web.json_response({'error': 'ComfyUI 尚未啟動，請在電腦啟動 VOID。'}, status=503)

    async def resources(request):
        if request.method == 'PATCH':
            profile = (await request.json()).get('profile')
            if profile not in ('economy', 'balanced', 'creative'):
                raise ValueError('資源模式無效')
            path = g.data_dir / 'performance.json'
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps({'profile': profile}), encoding='utf-8')
            temporary.replace(path)
            g.resources_released = False
            g.last_activity = time.time()
        profile = g.resource_profile()
        return web.json_response({'profile': profile, 'idleSeconds': {'economy': 30, 'balanced': 300, 'creative': 1800}[profile],
                                  'released': g.resources_released})

    async def projects(request):
        project_id = request.match_info.get('id')
        if request.method == 'GET':
            if project_id:
                row = g.db.execute('SELECT snapshot FROM projects WHERE id=?', (project_id,)).fetchone()
                if not row:
                    raise web.HTTPNotFound()
                return web.json_response(json.loads(row['snapshot']))
            return web.json_response({'projects': [{'id': row['id'], 'name': row['name'], 'updated': row['updated']}
                                                  for row in g.db.execute('SELECT id,name,updated FROM projects ORDER BY updated DESC')]})
        data = await request.json()
        project_id = data.get('id')
        if not isinstance(project_id, str) or not 1 <= len(project_id) <= 160 or not isinstance(data.get('name', ''), str):
            raise ValueError('專案格式無效')
        if len(data.get('name', '')) > 100 or not isinstance(data.get('rounds'), list) or len(data['rounds']) > 300:
            raise ValueError('圖板名稱或卡片數超出限制')
        data['updated'] = time.time()*1000
        g.db.execute('INSERT INTO projects VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated=excluded.updated,snapshot=excluded.snapshot',
                     (project_id, data.get('name', ''), data['updated'], json.dumps(data, ensure_ascii=False)))
        g.db.commit()
        return web.json_response({'ok': True, 'updated': data['updated']})

    async def jobs(request):
        if request.method == 'GET':
            kind, state = request.query.get('kind'), request.query.get('state')
            ids = g.db.execute('SELECT id FROM jobs WHERE (? IS NULL OR kind=?) AND (? IS NULL OR state=?) ORDER BY created DESC LIMIT 150',
                               (kind, kind, state, state)).fetchall()
            records = []
            for row in ids:
                job = g.job(row['id'])
                # Queue cards need summaries, not every stored graph on each refresh.
                job['request'].pop('workflow', None)
                records.append(job)
            return web.json_response({'jobs': records})
        data = await request.json()
        retry = None
        if data.get('kind') == 'retry':
            retry = g.job(str(data.get('jobId', '')))
            if not retry or retry['state'] not in TERMINAL:
                raise ValueError('只能重新執行已結束的任務')
            data = dict(retry['request'])
            data['kind'] = retry['kind']
            data['count'] = 1
        kind = data.get('kind', 'generate')
        catalog_data = await g.catalog()
        if kind == 'generate':
            # Region parameters are server-owned; clients submit only a mask.
            data.pop('region', None)
            if data.get('originalUpload') and data.get('originalMaskUpload'):
                data['upload'], data['maskUpload'] = data['originalUpload'], data['originalMaskUpload']
            if data.get('continuous') and data.get('maskUpload'):
                g.prepare_edit_region(data)
            if data.get('continuous') is True:
                for key in ('editGroup', 'editId', 'parent'):
                    if data.get(key) is not None and (not isinstance(data[key], str) or len(data[key]) > 160):
                        raise ValueError('版本識別資料無效')
                data['editGroup'] = data.get('editGroup') or uuid.uuid4().hex
                data['editId'] = uuid.uuid4().hex
            _, meta = generate(data, catalog_data, g.generation_source(data),
                               g.generation_source(data, 'referenceUpload'), g.generation_source(data, 'maskUpload'))
            data.update(meta)
            count_value = number_value(data, 'count', 1, 1, 4)
            if not count_value.is_integer():
                raise ValueError('張數必須是整數')
            count = int(count_value)
            if data.get('continuous') is True and count != 1:
                raise ValueError('連續改圖每輪生成一張')
        elif kind == 'workflow':
            origin = request.headers.get('Origin', '')
            if not retry and (urlsplit('//' + request.host).hostname not in ('localhost', '127.0.0.1') or origin not in ('http://127.0.0.1:8080', 'http://localhost:8080')):
                raise ValueError('自訂工作流僅供本機桌面使用')
            workflow = data.get('workflow')
            if not isinstance(workflow, dict) or not 1 <= len(workflow) <= 100:
                raise ValueError('工作流格式無效')
            allowed = {'CheckpointLoaderSimple','CLIPTextEncode','EmptyLatentImage','KSampler','KSamplerAdvanced','VAEDecode','VAEDecodeTiled','VAEEncode','LoadImage','ImageScale','ImageScaleToTotalPixels','LoraLoader','LoraLoaderModelOnly','SaveImage','UNETLoader','UnetLoaderGGUF','CLIPLoader','VAELoader','TextEncodeQwenImage21','EmptyFlux2LatentImage','RandomNoise','CFGGuider','KSamplerSelect','Flux2Scheduler','SamplerCustomAdvanced','ReferenceLatent','MOSSOfficialDiffusionLoader','MOSSOfficialTextEncoderLoader','MOSSOfficialVAELoader','MOSSOfficialTextEncode','MOSSOfficialSampler','MOSSOfficialVAEDecode','ModelSamplingFlux','ModelSamplingSD3','FluxGuidance','ConditioningZeroOut','ImageScaleBy','SetLatentNoiseMask','LatentUpscale','UpscaleModelLoader','ImageUpscaleWithModel'}
            for node in workflow.values():
                if not isinstance(node, dict) or node.get('class_type') not in allowed:
                    raise ValueError('工作流包含不支援的節點')
                node_type = node['class_type']
                schema = g.info.get(node_type, {})
                if node_type not in g.info:
                    raise ValueError('缺少 ComfyUI 節點：'+node_type)
                inputs = node.get('inputs')
                if not isinstance(inputs, dict):
                    raise ValueError('節點設定無效：'+node_type)
                spec = schema.get('input', {})
                for field, value in inputs.items():
                    option = spec.get('required', {}).get(field, spec.get('optional', {}).get(field))
                    if option and isinstance(option[0], list) and not isinstance(value, list) and value not in option[0]:
                        raise ValueError(f'缺少模型或無效選項：{node_type} / {field} / {value}')
            save = workflow.get(str(data.get('saveNodeId')))
            if not save or save.get('class_type') != 'SaveImage':
                raise ValueError('工作流缺少圖片輸出')
            for node in workflow.values():
                if node.get('class_type') == 'SaveImage':
                    node['inputs']['filename_prefix'] = 'VOID-mobile/desktop'
            if not isinstance(data.get('meta', {}), dict):
                raise ValueError('作品設定格式無效')
            data['engine'] = str(data.get('engine', 'sd'))[:40]
            count = 1
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

    async def job_record(request):
        job = g.job(request.match_info['id'])
        if not job:
            raise web.HTTPNotFound()
        return web.json_response(job)

    async def job_preview(request):
        job_id = request.match_info['id']
        if not g.job(job_id):
            raise web.HTTPNotFound()
        socket = web.WebSocketResponse(heartbeat=20)
        await socket.prepare(request)
        clients = g.preview_clients.setdefault(job_id, set())
        clients.add(socket)
        try:
            if g.latest_preview and g.latest_preview[0] == job_id:
                await socket.send_bytes(g.latest_preview[1])
            async for _ in socket:
                pass
        finally:
            clients.discard(socket)
            if not clients:
                g.preview_clients.pop(job_id, None)
        return socket

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
        upload_id = hashlib.sha256((b'void-upload-full:' if request.query.get('preserve') == '1' else b'void-upload-v1:') + content).hexdigest()[:32]
        filename = 'void-mobile-' + upload_id + '.png'
        existing = g.db.execute('SELECT filename FROM uploads WHERE id=?', (upload_id,)).fetchone()
        if existing and (g.input / existing['filename']).is_file():
            return web.json_response({'id': upload_id, 'url': '/upload/' + upload_id, 'reused': True, 'filename': existing['filename']})
        def prepare():
            with Image.open(io.BytesIO(content)) as image:
                if image.width*image.height > 40000000:
                    raise ValueError('圖片解析度過大，請先縮小')
                image = ImageOps.exif_transpose(image)
                if request.query.get('preserve') != '1':
                    image.thumbnail((1024, 1024))
                if image.mode == 'RGBA':
                    background = Image.new('RGB', image.size, 'white')
                    background.paste(image, mask=image.getchannel('A'))
                    image = background
                image.convert('RGB').save(g.input / filename)
        await asyncio.to_thread(prepare)
        g.db.execute('INSERT OR IGNORE INTO uploads VALUES(?,?,?)', (upload_id, filename, time.time()))
        g.db.commit()
        return web.json_response({'id': upload_id, 'url': '/upload/' + upload_id, 'filename': filename})

    async def upload_view(request):
        row = g.db.execute('SELECT filename FROM uploads WHERE id=?', (request.match_info['id'],)).fetchone()
        if not row:
            raise web.HTTPNotFound()
        return web.FileResponse(g.input / row['filename'])

    async def gallery(request):
        await g.scan()
        revision = g.gallery_epoch + ':' + str(g.db.execute('SELECT value FROM gallery_revision WHERE id=1').fetchone()[0])
        if request.query.get('revisionOnly') == '1':
            return web.json_response({'revision': revision})
        search = request.query.get('search', '').casefold()
        favorite = request.query.get('favorite') == '1'
        album = request.query.get('album', '')
        group = request.query.get('editGroup', '')
        where = " WHERE (?=0 OR favorite=1) AND (?='' OR instr(VOID_CASEFOLD(rel || meta),?)>0) AND (?='' OR json_extract(meta,'$.editGroup')=?) AND (?='' OR EXISTS (SELECT 1 FROM json_each(gallery.meta,'$.albums') WHERE value=?))"
        params = (int(favorite), search, search, group, group, album, album)
        total = g.db.execute('SELECT count(*) FROM gallery'+where, params).fetchone()[0]
        offset = max(0, int(request.query.get('offset', 0)))
        rows = g.db.execute('SELECT * FROM gallery'+where+' ORDER BY mtime DESC,id DESC LIMIT 40 OFFSET ?', (*params, offset)).fetchall()
        albums = [row[0] for row in g.db.execute("SELECT DISTINCT value FROM gallery,json_each(gallery.meta,'$.albums') WHERE json_each.type='text' ORDER BY value")]
        return web.json_response({'images': [g.gallery_item(r) for r in rows], 'total': total, 'offset': offset, 'albums': albums, 'revision': revision})

    async def gallery_record(request):
        _, row = g.image_path(request.match_info['id'])
        return web.json_response(g.gallery_item(row))

    async def rng_catalog(request):
        root = PANEL_ROOT / 'void-rng/data'
        def read(name):
            return json.loads((root / (name + '.json')).read_text(encoding='utf-8-sig'))
        characters = read('char-banks')
        styles = read('style-banks')
        labels = read('slot-labels')
        def categories(name):
            bank = read(name + '-banks')
            return [{'label': section['zh'], 'choices': [choice['en'] for choice in bank.get(section['key'], [])
                                                          if isinstance(choice, dict) and choice.get('en')]}
                    for section in read(name + '-sections')]
        return web.json_response({
            'character': [{'label': section['zh'], 'choices': characters.get(section['key'], [])}
                          for section in read('char-sections')],
            'style': [{'label': labels[key], 'choices': [item['en'] for item in read('style-codes')]
                       if key == 'style' else styles.get(key, {}).get('en', [])}
                      for key in read('slot-keys')],
            'jewel': categories('jewel'),
            'space': categories('space'),
        })

    async def image_file(request):
        path, row = g.image_path(request.match_info['id'])
        if request.path.startswith('/thumb/'):
            stat = path.stat()
            thumb = g.thumbs / (row['id'] + '-' + str(stat.st_mtime_ns) + '-' + str(stat.st_size) + '.jpg')
            if not thumb.exists():
                def build_thumb():
                    with Image.open(path) as image:
                        if image.width*image.height > 40000000:
                            raise ValueError('圖片太大，請下載原圖查看')
                        image = ImageOps.exif_transpose(image)
                        image.thumbnail((480, 480))
                        temporary = thumb.with_name(thumb.name + '.' + uuid.uuid4().hex + '.tmp')
                        try:
                            image.convert('RGB').save(temporary, format='JPEG', quality=82)
                            temporary.replace(thumb)
                        finally:
                            temporary.unlink(missing_ok=True)
                await asyncio.to_thread(build_thumb)
            response = web.FileResponse(thumb)
        else:
            response = web.FileResponse(path)
            if request.query.get('download') == '1':
                from urllib.parse import quote
                response.headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + quote(path.name)
        response.headers['Cache-Control'] = 'private, no-cache, must-revalidate'
        return response

    async def favorite(request):
        _, row = g.image_path(request.match_info['id'])
        data = await request.json()
        meta = json.loads(row['meta'])
        if 'rating' in data:
            if type(data['rating']) is not int or not 0 <= data['rating'] <= 5:
                raise ValueError('評分須為 0 至 5')
            meta['rating'] = data['rating']
        for key in ('albums', 'tags'):
            if key in data:
                values = data[key]
                if not isinstance(values, list) or len(values) > 25 or any(
                    not isinstance(value, str) or not 0 < len(value.strip()) <= 60 for value in values
                ):
                    raise ValueError('每項最多 60 字，共 25 項')
                meta[key] = list(dict.fromkeys(value.strip() for value in values))
        favorite_value = int(bool(data['favorite'])) if 'favorite' in data else row['favorite']
        g.db.execute('UPDATE gallery SET favorite=?,meta=? WHERE id=?',
                     (favorite_value, json.dumps(meta, ensure_ascii=False), row['id']))
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
        if not g.guest and source.relative_to(g.output).parts[0] == GUEST_OUTPUT:
            raise ValueError('這不是目前圖庫的圖片')
        if not source.exists():
            return web.json_response({'ok': True, 'missing': True})
        if not source.is_file():
            raise ValueError('來源不是圖片檔案')
        trash_id = uuid.uuid4().hex
        destination = g.data_dir / 'trash' / trash_id
        destination.mkdir(parents=True)
        rel = source.relative_to(g.output).as_posix()
        row = g.db.execute('SELECT meta,favorite FROM gallery WHERE rel=?', (rel,)).fetchone()
        manifest = {'original': rel, 'filename': filename, 'trashedAt': time.time(),
                    'meta': json.loads(row['meta']) if row else image_meta(source),
                    'favorite': bool(row and row['favorite'])}
        (destination / 'restore.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
        try:
            source.rename(destination / filename)
        except OSError as error:
            return web.json_response({'error': '原檔移至回收區失敗，圖庫紀錄已保留：' + str(error)}, status=409)
        await g.scan(True)
        return web.json_response({'ok': True, 'trashId': trash_id})

    def trash_entry(item_id):
        if len(item_id) != 32 or any(c not in '0123456789abcdef' for c in item_id):
            raise ValueError('回收項目編號無效')
        root = (g.data_dir / 'trash').resolve()
        folder = (root / item_id).resolve()
        if folder.parent != root or folder.name != item_id:
            raise ValueError('回收位置無效')
        manifest = json.loads((folder / 'restore.json').read_text(encoding='utf-8'))
        source = (folder / manifest['filename']).resolve()
        if source.parent != folder or not source.is_file() or source.suffix.lower() not in IMAGE_EXT:
            raise ValueError('找不到回收區原檔')
        return manifest, source

    async def trash_list(request):
        query = request.query.get('q', '').casefold().strip()
        def records():
            items = []
            for folder in (g.data_dir / 'trash').glob('*'):
                try:
                    manifest, _ = trash_entry(folder.name)
                    meta = manifest.get('meta', {})
                    if query and query not in json.dumps(manifest, ensure_ascii=False).casefold():
                        continue
                    items.append({'id': folder.name, 'name': manifest['filename'],
                                  'trashedAt': manifest.get('trashedAt', 0), 'meta': meta})
                except (OSError, ValueError, KeyError, TypeError):
                    continue
            return sorted(items, key=lambda item: item['trashedAt'], reverse=True)
        return web.json_response({'items': await asyncio.to_thread(records)})

    async def trash_restore(request):
        data = await request.json()
        ids = data.get('ids')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or not all(isinstance(i, str) for i in ids):
            raise ValueError('每次請選擇 1～100 張作品')
        restored, failed = [], []
        async with g.scan_lock:
            for item_id in dict.fromkeys(ids):
                try:
                    manifest, source = trash_entry(item_id)
                    target = (g.output / manifest['original']).resolve()
                    if not target.is_relative_to(g.output) or target.suffix.lower() not in IMAGE_EXT:
                        raise ValueError('原始位置無效')
                    if target.exists():
                        raise ValueError('原始位置已有同名檔案')
                    meta = manifest.get('meta') or image_meta(source)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    source.rename(target)
                    rel = target.relative_to(g.output).as_posix()
                    stat = target.stat()
                    g.db.execute('INSERT INTO gallery(id,rel,mtime,size,meta,favorite) VALUES(?,?,?,?,?,?) ON CONFLICT(rel) DO UPDATE SET mtime=excluded.mtime,size=excluded.size,meta=excluded.meta,favorite=excluded.favorite',
                                 (hashlib.sha256(rel.encode()).hexdigest()[:24], rel, stat.st_mtime, stat.st_size,
                                  json.dumps(meta, ensure_ascii=False), int(bool(manifest.get('favorite')))))
                    g.db.commit()
                    restored.append(item_id)
                except (OSError, ValueError, KeyError, TypeError) as error:
                    failed.append({'id': item_id, 'error': str(error)})
        return web.json_response({'restored': restored, 'failed': failed})

    async def trash_empty(request):
        if (await request.json()).get('destination') != 'windows-recycle-bin':
            raise ValueError('請確認移到 Windows 資源回收筒')
        async with g.scan_lock:
            root = g.data_dir / 'trash'
            if not root.exists():
                return web.json_response({'moved': 0})
            resolved = root.resolve()
            if root.is_symlink() or root.is_junction() or resolved.parent != g.data_dir.resolve():
                raise ValueError('VOID 回收區位置無效')
            paths = []
            for folder in root.iterdir():
                if len(folder.name) != 32 or any(c not in '0123456789abcdef' for c in folder.name):
                    raise ValueError('回收區含未知資料，已停止清空')
                if not folder.is_dir() or folder.is_symlink() or folder.is_junction() or folder.resolve().parent != resolved:
                    raise ValueError('回收項目位置無效，已停止清空')
                if any(path.is_symlink() or path.is_junction() or not path.resolve().is_relative_to(resolved) for path in folder.rglob('*')):
                    raise ValueError('回收項目含連結，已停止清空')
                paths.append(folder.resolve())
            try:
                await asyncio.to_thread(recycle_windows_paths, paths)
            except OSError as error:
                return web.json_response({'error': str(error), 'moved': sum(not path.exists() for path in paths)}, status=409)
            remaining = [path for path in paths if path.exists()]
            if remaining:
                return web.json_response({'error': '部分資料未移入 Windows 資源回收筒，請重試', 'moved': len(paths)-len(remaining)}, status=409)
            return web.json_response({'moved': len(paths)})

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
        response = web.FileResponse(PANEL_ROOT / 'mobile' / name)
        response.headers['Cache-Control'] = 'no-cache'
        return response

    app.router.add_get('/api/status', status)
    app.router.add_get('/api/catalog', catalog)
    app.router.add_get('/api/resources', resources)
    app.router.add_get('/api/projects', projects)
    app.router.add_post('/api/projects', projects)
    app.router.add_options('/api/projects', projects)
    app.router.add_get('/api/projects/{id}', projects)
    app.router.add_patch('/api/resources', resources)
    app.router.add_options('/api/resources', resources)
    app.router.add_get('/api/rng', rng_catalog)
    app.router.add_get('/api/jobs', jobs)
    app.router.add_post('/api/jobs', jobs)
    app.router.add_get('/api/jobs/{id}', job_record)
    app.router.add_get('/api/jobs/{id}/preview', job_preview)
    app.router.add_post('/api/jobs/{id}/cancel', cancel)
    app.router.add_options('/api/jobs/{id}/cancel', cancel)
    app.router.add_options('/api/jobs', jobs)
    app.router.add_post('/api/upload', upload)
    app.router.add_options('/api/upload', upload)
    app.router.add_get('/upload/{id}', upload_view)
    app.router.add_get('/api/gallery', gallery)
    app.router.add_get('/api/gallery/{id}', gallery_record)
    app.router.add_patch('/api/gallery/{id}', favorite)
    app.router.add_route('*', '/api/import', import_record)
    app.router.add_post('/api/trash', trash)
    app.router.add_get('/api/trash', trash_list)
    app.router.add_post('/api/trash/restore', trash_restore)
    app.router.add_post('/api/trash/empty', trash_empty)
    app.router.add_options('/api/trash/empty', trash_empty)
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
    parser.add_argument('--guest')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.guest and (not args.guest.isascii() or not args.guest.isalnum() or len(args.guest) > 32):
        parser.error('invalid guest identifier')
    data = ROOT / 'void-guest-data' / args.guest if args.guest else None
    web.run_app(create_app(Gateway(data_dir=data, guest=args.guest, keep_awake=not (args.allow_sleep or args.guest))), host='127.0.0.1', port=args.port, access_log=None)
