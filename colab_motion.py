"""Run VOID's Wan 2.2 image-to-video graph for a batch of images on the Colab VM (started by colab_cli.py motion).

    python colab_motion.py /content/motion-in/jobs.json --home /content/VOID-Colab

jobs.json: [{"image": "a.png", "prompt": "...", "seconds": 10, "size": "square"}]; images sit next to jobs.json.
Same graph and settings as the gateway's motion_workflow (mobile_motion_graph.json, MOTION_SIZES, 16 fps).
Log lines start with [void]; ends with MOTION_DONE (or FAILED).
"""
import argparse
import json
import secrets
import shutil
import sys
import time
import traceback
import urllib.request
from pathlib import Path

COMFY_URL = 'http://127.0.0.1:8188'
COMFY_INPUT = Path('/content/ComfyUI/input')
GRAPH = Path(__file__).resolve().parents[1] / 'mobile_motion_graph.json'   # gateway copy in the PRO root, if uploaded
if not GRAPH.is_file():
    GRAPH = Path(__file__).resolve().with_name('mobile_motion_graph.json')
SIZES = {'landscape': (640, 384), 'portrait': (384, 640), 'square': (512, 512)}   # = void_mobile.MOTION_SIZES


def log(message):
    print(f'[void] {message}', flush=True)


def post(path, data):
    req = urllib.request.Request(COMFY_URL + path, json.dumps(data).encode(), {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def wait(prompt_id):
    while True:
        history = json.loads(urllib.request.urlopen(f'{COMFY_URL}/history/{prompt_id}', timeout=60).read())
        status = history.get(prompt_id, {}).get('status', {})
        if status.get('completed'):
            return history[prompt_id]
        if status.get('status_str') == 'error':
            raise RuntimeError(json.dumps(status)[:1500])
        time.sleep(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('jobs', type=Path)
    ap.add_argument('--home', type=Path, default=Path('/content/VOID-Colab'))
    a = ap.parse_args()
    try:
        jobs = json.loads(a.jobs.read_text(encoding='utf-8'))
        base = json.loads(GRAPH.read_text(encoding='utf-8'))
        COMFY_INPUT.mkdir(parents=True, exist_ok=True)
        for i, job in enumerate(jobs, 1):
            name = f'void-motion-cloud-{i:02d}{Path(job["image"]).suffix.lower()}'
            shutil.copyfile(a.jobs.parent / job['image'], COMFY_INPUT / name)
            width, height = SIZES[job.get('size', 'portrait')]
            seconds = int(job.get('seconds', 5))
            seed = secrets.randbits(32)
            graph = json.loads(json.dumps(base))
            graph['2']['inputs']['text'] = job['prompt']
            graph['5']['inputs']['image'] = name
            graph['6']['inputs'].update(width=width, height=height, length=seconds * 16 + 1)
            for node in ('30', '31'):
                graph[node]['inputs']['noise_seed'] = seed
            graph['34']['inputs']['filename_prefix'] = f'VOID-Motion/cloud-{Path(job["image"]).stem}'
            log(f'MOTION {i}/{len(jobs)} 開始：{job["image"]} {width}x{height} {seconds}s seed {seed}')
            t0 = time.time()
            result = wait(post('/prompt', {'prompt': graph})['prompt_id'])
            files = [f"{v.get('subfolder', '')}/{v['filename']}" for out in result.get('outputs', {}).values()
                     for key in ('images', 'videos', 'gifs') for v in out.get(key, []) if isinstance(v, dict) and 'filename' in v]
            log(f'MOTION {i}/{len(jobs)} 完成 {time.time() - t0:.0f} 秒 → {", ".join(files) or "（沒有輸出檔）"}')
        log('MOTION_DONE')
    except Exception:
        traceback.print_exc()
        log('FAILED')
        sys.exit(1)


if __name__ == '__main__':
    main()
