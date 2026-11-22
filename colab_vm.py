"""在 Colab VM 上安裝並啟動 VOID（由本機 colab_cli.py 以 nohup 呼叫）。

    python colab_vm.py --profiles sdxl,klein --home /content/VOID-Colab   # 開機安裝並啟動
    python colab_vm.py --add qwen --home ...                             # 加裝引擎：只下載模型，有新節點才重啟
    python colab_vm.py --stop                                            # 停服務（VOID 先備份圖庫）

模型清單只來自 docs/models-v4.md；models.lock.json 提供每個網址的大小與 SHA-256，下載完逐一驗證。
模型下載與 pip 安裝同時進行。日誌每行以 [void] 開頭；成功印 VOID_READY（或 VOID_ADDED），失敗印 FAILED。
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
COMFY = Path('/content/ComfyUI')
RUNTIME = Path('/content/void-runtime')
SECTIONS = {'sdxl': 'SDXL', 'klein': 'FLUX.2', 'qwen': 'Qwen', 'moss': 'MOSS', 'wan': 'Wan', 'florence': 'Florence-2'}
NODES = {
    'gguf': ('leejet/ComfyUI-GGUF', ''),
    'moss': ('T8mars/Comfyui-Moss-Image-T8', 'c045ac07e48b202d8f9df76992b8446c0cea663b'),
    'florence': ('kijai/ComfyUI-Florence2', '9ece3de914214c5f581d725167bc9d0eeb0d1120'),
    'wd14': ('pythongosssss/ComfyUI-WD14-Tagger', ''),
}
FOLDERS = ('checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'loras', 'LLM', 'upscale_models')
PORTS = {'void': 7860, 'comfy': 8188}
ROW = re.compile(r'^\| \[([^\]]+)\]\((https://huggingface\.co/[^)]+)\) \| `([\w./-]+?)/?` \|$', re.M)
_print = threading.Lock()


def log(message):
    with _print:
        print(f'[void] {message}', flush=True)


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def pip_install(requirements):
    # Colab 已內建 CUDA 版 torch，略過 torch 行避免重裝成別的版本
    lines = [l for l in Path(requirements).read_text().splitlines()
             if not re.match(r'\s*(torch|torchvision|torchaudio)\b', l)]
    filtered = RUNTIME / ('req-' + Path(requirements).parent.name + '.txt')
    filtered.write_text('\n'.join(lines))
    run(sys.executable, '-m', 'pip', 'install', '-q', '-r', filtered)


def wanted_nodes(profiles):
    nodes = {'gguf'} | (set(profiles) & NODES.keys())   # GGUF 很小，一律裝，之後加 Klein/Qwen/Wan 不必重啟
    return sorted(nodes)


def install_nodes(profiles):
    """Install ComfyUI and custom nodes; return the node keys that were newly cloned."""
    if not COMFY.exists():
        log('下載 ComfyUI')
        run('git', 'clone', '-q', '--depth', '1', 'https://github.com/Comfy-Org/ComfyUI.git', COMFY)
        log('安裝 ComfyUI 相依套件')
        pip_install(COMFY / 'requirements.txt')
        run(sys.executable, '-m', 'pip', 'install', '-q', 'aiohttp', 'Pillow')
    added = []
    for key in wanted_nodes(profiles):
        repo, revision = NODES[key]
        target = COMFY / 'custom_nodes' / repo.split('/')[-1]
        if target.exists():
            continue
        log(f'自訂節點 {repo}')
        run('git', 'clone', '-q', f'https://github.com/{repo}.git', target)
        if revision:
            run('git', '-C', target, 'checkout', '-q', '--detach', revision)
        if (target / 'requirements.txt').exists():
            pip_install(target / 'requirements.txt')
        added.append(key)
    return added


def link_model_folders(models):
    """Point ComfyUI's model folders at HOME/models (run after ComfyUI is cloned)."""
    for folder in FOLDERS:
        (models / folder).mkdir(parents=True, exist_ok=True)
        local = COMFY / 'models' / folder
        if local.exists() and not local.is_symlink():
            for entry in local.iterdir():
                if not (models / folder / entry.name).exists():
                    shutil.move(str(entry), models / folder / entry.name)
            shutil.rmtree(local)
        if not local.is_symlink():
            local.symlink_to(models / folder, target_is_directory=True)


def model_list(profiles):
    doc = (SOURCE / 'docs/models-v4.md').read_text(encoding='utf-8')
    lock_path = SOURCE / 'models.lock.json'
    lock = json.loads(lock_path.read_text(encoding='utf-8'))['files'] if lock_path.exists() else {}
    wanted = {SECTIONS[k] for k in profiles if k in SECTIONS}
    items = []
    for section in doc.split('\n## ')[1:]:
        if any(section.startswith(name + ' ') for name in wanted):
            for name, url, folder in ROW.findall(section):
                items.append((name, url, folder.rstrip('/'), lock.get(url, {})))
    return items


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(16 * 2**20), b''):
            h.update(block)
    return h.hexdigest()


def fetch(models, name, url, folder, expect):
    destination = models / folder / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = expect.get('size')
    if destination.is_file() and destination.stat().st_size and (not size or destination.stat().st_size == size):
        log(f'已有模型 {folder}/{name}')
        return
    log(f'下載模型 {folder}/{name}' + (f'（{size / 2**30:.1f} GB）' if size else ''))
    partial = destination.with_name(destination.name + '.part')
    run('curl', '-sS', '--fail', '--location', '--retry', '5', '--retry-delay', '5', '--continue-at', '-',
        '--output', partial, url)
    if size and partial.stat().st_size != size:
        partial.unlink()
        raise RuntimeError(f'{name} 大小不符：{partial.stat().st_size} ≠ {size}')
    if expect.get('sha256') and sha256(partial) != expect['sha256']:
        partial.unlink()
        raise RuntimeError(f'{name} SHA-256 不符，已刪除，請重跑')
    partial.replace(destination)
    log(f'完成 {folder}/{name}' + ('（已驗證）' if expect.get('sha256') else ''))


def download_models(models, profiles):
    items = model_list(profiles)
    with ThreadPoolExecutor(max_workers=3) as pool:   # 3 條平行，避免 HuggingFace 429
        for future in [pool.submit(fetch, models, *item) for item in items]:
            future.result()
    log('模型準備完成')


def start(name, cwd, *args):
    logfile = (RUNTIME / f'{name}.log').open('ab')
    return subprocess.Popen([sys.executable, '-u', *map(str, args)], cwd=cwd, stdout=logfile,
                            stderr=subprocess.STDOUT, start_new_session=True)


def wait_http(process, url, name, seconds=300):
    for _ in range(seconds):
        if process.poll() is not None:
            break
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(1)
    print((RUNTIME / f'{name}.log').read_text(errors='replace')[-6000:], flush=True)
    raise RuntimeError(f'{name} 沒有啟動：{url}')


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def port_busy(port):
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=2)
        return True
    except urllib.error.HTTPError:
        return True
    except OSError:
        return False


def launch(home):
    state_file = RUNTIME / 'state.json'
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if all(alive(state[k]) for k in PORTS):
            log('服務已在執行，沿用')
            return
    if any(port_busy(p) for p in PORTS.values()):
        log('連接埠被舊程序占用，先停掉')
        stop()
    output = home / 'output'
    output.mkdir(parents=True, exist_ok=True)
    log('啟動 ComfyUI :8188')
    comfy = start('comfy', COMFY, 'main.py', '--listen', '127.0.0.1', '--port', '8188',
                  '--disable-auto-launch', '--output-directory', output)
    wait_http(comfy, 'http://127.0.0.1:8188/system_stats', 'comfy')
    log('啟動 VOID :7860')
    void = start('void', SOURCE, 'void_colab.py', '--drive', home, '--runtime', RUNTIME, '--comfy', COMFY)
    wait_http(void, 'http://127.0.0.1:7860/api/status', 'void')
    state_file.write_text(json.dumps({'comfy': comfy.pid, 'void': void.pid, 'home': str(home)}))


def stop():
    """先對 VOID 送 SIGINT，讓它把圖庫資料庫備份到 HOME，再停 ComfyUI。狀態檔不見時改用連接埠找程序。"""
    state_file = RUNTIME / 'state.json'
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    for key, sig, seconds in (('void', signal.SIGINT, 45), ('comfy', signal.SIGTERM, 30)):
        pid = state.get(key)
        if pid and alive(pid):
            os.kill(pid, sig)
            for _ in range(seconds):
                if not alive(pid):
                    break
                time.sleep(1)
        if port_busy(PORTS[key]):
            subprocess.run(['fuser', '-k', '-INT' if key == 'void' else '-TERM', f'{PORTS[key]}/tcp'],
                           capture_output=True)
            for _ in range(seconds):
                if not port_busy(PORTS[key]):
                    break
                time.sleep(1)
            subprocess.run(['fuser', '-k', f'{PORTS[key]}/tcp'], capture_output=True)
        log(f'{key} 已停止')
    state_file.unlink(missing_ok=True)
    log('STOPPED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profiles', default='sdxl')
    parser.add_argument('--add', help='加裝引擎（逗號分隔），不重裝其他東西')
    parser.add_argument('--home', type=Path, default=Path('/content/VOID-Colab'))
    parser.add_argument('--stop', action='store_true')
    args = parser.parse_args()
    RUNTIME.mkdir(parents=True, exist_ok=True)
    if args.stop:
        return stop()
    profiles = [p for p in (args.add or args.profiles).split(',') if p]
    try:
        if unknown := set(profiles) - SECTIONS.keys() - {'wd14'}:
            raise ValueError(f'未知的引擎：{unknown}')
        models = args.home / 'models'
        models.mkdir(parents=True, exist_ok=True)
        if not args.add:
            gpu = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'],
                                 capture_output=True, text=True).stdout.strip()
            log(f'GPU：{gpu or "（沒有 GPU）"}')
            log(f'資料目錄：{args.home}')
        # 模型下載和套件安裝同時跑：下載吃網路，安裝吃 CPU
        box = {}
        downloader = threading.Thread(target=lambda: box.update(error=_capture(download_models, models, profiles)))
        downloader.start()
        added = install_nodes(profiles)
        downloader.join()
        if box.get('error'):
            raise box['error']
        link_model_folders(models)
        if args.add:
            if added:
                log(f'新裝了節點 {", ".join(added)}，重啟服務')
                stop()
                launch(args.home)
            log('VOID_ADDED')
        else:
            launch(args.home)
            log('VOID_READY')
    except Exception:
        traceback.print_exc()
        log('FAILED')
        sys.exit(1)


def _capture(fn, *args):
    try:
        fn(*args)
    except Exception as error:  # re-raised in the main thread
        traceback.print_exc()
        return error


if __name__ == '__main__':
    main()
