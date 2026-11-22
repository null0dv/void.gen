"""Benchmark SDXL on the Colab VM's ComfyUI (127.0.0.1:8188). Run on the VM: python colab_bench.py [count]"""
import json, sys, time, urllib.request, uuid

URL = 'http://127.0.0.1:8188'


def post(path, data):
    req = urllib.request.Request(URL + path, json.dumps(data).encode(), {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def wait(pid):
    while True:
        h = json.loads(urllib.request.urlopen(f'{URL}/history/{pid}', timeout=30).read())
        if pid in h and h[pid].get('status', {}).get('completed'):
            return h[pid]
        if pid in h and h[pid].get('status', {}).get('status_str') == 'error':
            raise RuntimeError(json.dumps(h[pid]['status'])[:1500])
        time.sleep(0.5)


def graph(seed, size=1024, steps=25):
    return {
        '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'sd_xl_base_1.0.safetensors'}},
        '2': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': 'a cozy cafe interior at golden hour, film photo, detailed'}},
        '3': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': 'blurry, lowres'}},
        '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': size, 'height': size, 'batch_size': 1}},
        '5': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0],
                                                   'seed': seed, 'steps': steps, 'cfg': 7, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1}},
        '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
        '7': {'class_type': 'SaveImage', 'inputs': {'images': ['6', 0], 'filename_prefix': 'bench'}},
    }


import os
# `colab exec -f` runs in a Jupyter kernel (sys.argv is not ours) and the CLI gives up after ~60 s,
# so keep warm-up + timed images under a minute on L4 (about 18 s + 3 x 11 s).
count = int(os.environ.get('BENCH_COUNT', '3'))
client = str(uuid.uuid4())
times = []
for i in range(count + 1):
    t = time.time()
    wait(post('/prompt', {'prompt': graph(1000 + i), 'client_id': client})['prompt_id'])
    dt = time.time() - t
    print(f'BENCH {"warmup" if i == 0 else i} {dt:.1f}s', flush=True)
    if i:
        times.append(dt)
print(f'BENCH_RESULT avg={sum(times) / len(times):.1f}s per 1024x1024 image, 25 steps, euler', flush=True)
