"""在 Colab VM 上安裝並啟動 VOID（由本機 colab_cli.py 以 nohup 呼叫）。

步驟與 VOID-Colab.ipynb 相同，但不依賴 Notebook 前端：
安裝 ComfyUI 與節點 → 依模型表下載權重 → 啟動 ComfyUI(8188) 與 void_colab.py(7860) → 印出 VOID_READY。
日誌每行以 [void] 開頭，失敗時印出 FAILED。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.request
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


def log(message):
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


def install(profiles, home):
    if unknown := set(profiles) - SECTIONS.keys() - {'wd14'}:
        raise ValueError(f'未知的 profile：{unknown}')
    if not COMFY.exists():
        log('下載 ComfyUI')
        run('git', 'clone', '-q', '--depth', '1', 'https://github.com/Comfy-Org/ComfyUI.git', COMFY)
    log('安裝 ComfyUI 相依套件')
    pip_install(COMFY / 'requirements.txt')
    run(sys.executable, '-m', 'pip', 'install', '-q', 'aiohttp', 'Pillow')

    plugins = set(profiles) & NODES.keys()
    if set(profiles) & {'klein', 'qwen', 'wan'}:
        plugins.add('gguf')
    for key in sorted(plugins):
        repo, revision = NODES[key]
        target = COMFY / 'custom_nodes' / repo.split('/')[-1]
        log(f'自訂節點 {repo}')
        if not target.exists():
            run('git', 'clone', '-q', f'https://github.com/{repo}.git', target)
        if revision:
            run('git', '-C', target, 'checkout', '-q', '--detach', revision)
        if (target / 'requirements.txt').exists():
            pip_install(target / 'requirements.txt')

    models = home / 'models'
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

    manual = (SOURCE / 'docs/models-v4.md').read_text(encoding='utf-8')
    wanted = {SECTIONS[k] for k in profiles if k in SECTIONS}
    for section in manual.split('\n## ')[1:]:
        if not any(section.startswith(name + ' ') for name in wanted):
            continue
        for name, url, folder in re.findall(r'^\| \[([^\]]+)\]\((https://huggingface\.co/[^)]+)\) \| `([\w/-]+)/` \|$',
                                            section, re.M):
            destination = models / folder / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.is_file() and destination.stat().st_size:
                log(f'已有模型 {folder}/{name}')
                continue
            log(f'下載模型 {folder}/{name}')
            partial = destination.with_name(destination.name + '.part')
            run('curl', '-sS', '--fail', '--location', '--retry', '3', '--continue-at', '-', '--output', partial, url)
            partial.replace(destination)
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


def launch(home):
    state_file = RUNTIME / 'state.json'
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if all(alive(state[k]) for k in ('comfy', 'void')):
            log('服務已在執行，沿用')
            return
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
    """先對 VOID 送 SIGINT，讓它把圖庫資料庫備份到 HOME，再停 ComfyUI。"""
    import signal
    state_file = RUNTIME / 'state.json'
    if not state_file.exists():
        log('沒有執行中的服務')
        return
    state = json.loads(state_file.read_text())
    for key, sig, seconds in (('void', signal.SIGINT, 45), ('comfy', signal.SIGTERM, 30)):
        pid = state[key]
        if alive(pid):
            os.kill(pid, sig)
            for _ in range(seconds):
                if not alive(pid):
                    break
                time.sleep(1)
        log(f'{key} 已停止')
    state_file.unlink()
    log('STOPPED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profiles', default='sdxl')
    parser.add_argument('--home', type=Path, default=Path('/content/drive/MyDrive/VOID-Colab'))
    parser.add_argument('--stop', action='store_true')
    args = parser.parse_args()
    RUNTIME.mkdir(parents=True, exist_ok=True)
    if args.stop:
        return stop()
    try:
        gpu = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'],
                             capture_output=True, text=True).stdout.strip()
        log(f'GPU：{gpu or "（沒有 GPU）"}')
        args.home.mkdir(parents=True, exist_ok=True)
        log(f'資料目錄：{args.home}')
        install([p for p in args.profiles.split(',') if p], args.home)
        launch(args.home)
        log('VOID_READY')
    except Exception:
        traceback.print_exc()
        log('FAILED')
        sys.exit(1)


if __name__ == '__main__':
    main()
