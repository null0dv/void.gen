"""VOID GEN + Pocket local setup: custom nodes and verified model downloads for ComfyUI Portable.

Run with ComfyUI Portable's own Python (Install-VOID.ps1 does this for you):

    ..\\ComfyUI_windows_portable\\python_embeded\\python.exe -s tools\\void_setup.py --profiles sdxl,klein
    ... --list              show what each engine needs and how big it is
    ... --check             report what is installed / missing, download nothing
    ... --skip-models       nodes and Python packages only

The model list comes only from docs/models-v4.md; models.lock.json gives each URL's size and SHA-256.
Downloads resume after an interruption and are verified before they are put in place.
"""
import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from colab_vm import ROW, sha256  # noqa: E402  (one model-table parser for local and cloud)

SECTIONS = {'sdxl': 'SDXL', 'klein': 'FLUX.2', 'qwen': 'Qwen', 'moss': 'MOSS', 'wan': 'Wan',
            'florence': 'Florence-2', 'moody': 'Moody Moss'}
LABELS = {'sdxl': 'SDXL text/image to image (baseline)', 'klein': 'FLUX.2 Klein 9B editing',
          'qwen': 'Qwen Image 2.1', 'moss': 'MOSS Image', 'wan': 'Wan 2.2 image to video',
          'florence': 'Florence-2 image to text', 'moody': 'Moody Moss text encoder (main weight is manual)'}
# repo, pinned revision ('' = default branch). GGUF covers Klein, Qwen and Wan.
NODES = {
    'ComfyUI-GGUF': ('leejet/ComfyUI-GGUF', '', {'klein', 'qwen', 'wan'}),
    'Comfyui-Moss-Image-T8': ('T8mars/Comfyui-Moss-Image-T8', 'c045ac07e48b202d8f9df76992b8446c0cea663b', {'moss', 'moody'}),
    'ComfyUI-Florence2': ('kijai/ComfyUI-Florence2', '9ece3de914214c5f581d725167bc9d0eeb0d1120', {'florence'}),
}
UA = {'User-Agent': 'void-setup/1.0'}


def say(message):
    print(f'[void] {message}', flush=True)


def comfy_root(root):
    comfy = root / 'ComfyUI_windows_portable' / 'ComfyUI'
    if not (comfy / 'main.py').is_file():
        sys.exit(f'ComfyUI Portable not found at {comfy.parent}. Run Install-VOID.ps1 first.')
    return comfy


def model_list(profiles):
    doc = (APP / 'docs/models-v4.md').read_text(encoding='utf-8')
    lock = json.loads((APP / 'models.lock.json').read_text(encoding='utf-8'))['files']
    items = []
    for key in profiles:
        for section in doc.split('\n## ')[1:]:
            if section.startswith(SECTIONS[key] + ' '):
                for name, url, folder in ROW.findall(section):
                    items.append((key, name, url, folder.rstrip('/'), lock.get(url, {})))
    return items


def pip(python, *args):
    subprocess.run([python, '-s', '-m', 'pip', 'install', '--disable-pip-version-check', '-q', *args], check=True)


def install_requirements(python, requirements):
    # Never let a node's requirements replace the CUDA torch that ships with ComfyUI Portable.
    lines = [line for line in requirements.read_text(encoding='utf-8', errors='replace').splitlines()
             if not line.strip().lower().startswith(('torch', 'torchvision', 'torchaudio'))]
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8') as handle:
        handle.write('\n'.join(lines))
    try:
        pip(python, '-r', handle.name)
    finally:
        Path(handle.name).unlink(missing_ok=True)


def install_nodes(comfy, profiles, python):
    for folder, (repo, revision, needed_by) in NODES.items():
        if not needed_by & set(profiles):
            continue
        target = comfy / 'custom_nodes' / folder
        if target.is_dir() and any(target.iterdir()):
            say(f'node {folder}: already installed')
            continue
        url = f'https://codeload.github.com/{repo}/zip/{revision or "HEAD"}'
        say(f'node {folder}: downloading {repo}' + (f' @ {revision[:8]}' if revision else ''))
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as response:
            archive = zipfile.ZipFile(io.BytesIO(response.read()))
        top = archive.namelist()[0].split('/')[0]
        with tempfile.TemporaryDirectory(dir=comfy / 'custom_nodes') as temp:
            archive.extractall(temp)
            shutil.move(str(Path(temp) / top), target)
        if (target / 'requirements.txt').is_file():
            say(f'node {folder}: installing its Python packages')
            install_requirements(python, target / 'requirements.txt')


def download(models, key, name, url, folder, expect):
    destination = models / folder / name
    size = expect.get('size')
    if destination.is_file() and (not size or destination.stat().st_size == size):
        say(f'{key}: have {folder}/{name}')
        return 'have'
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + '.part')
    label = f'{folder}/{name}' + (f' ({size / 2**30:.2f} GB)' if size else '')
    for attempt in range(1, 6):
        done = partial.stat().st_size if partial.exists() else 0
        if size and done >= size:
            break
        say(f'{key}: downloading {label}' + (f', resuming at {done / 2**30:.2f} GB' if done else ''))
        request = urllib.request.Request(url, headers={**UA, **({'Range': f'bytes={done}-'} if done else {})})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                if done and response.status != 206:
                    done = 0  # server ignored the range: start over
                with open(partial, 'ab' if done else 'wb') as out:
                    last = time.time()
                    while block := response.read(8 * 2**20):
                        out.write(block)
                        done += len(block)
                        if size and time.time() - last > 15:
                            say(f'{key}: {name} {done * 100 // size}%')
                            last = time.time()
            break
        except OSError as error:
            say(f'{key}: {name} interrupted ({error}); retry {attempt}/5')
            time.sleep(5 * attempt)
    else:
        raise RuntimeError(f'{name}: download failed five times; run the installer again to resume')
    if size and partial.stat().st_size != size:
        raise RuntimeError(f'{name}: size {partial.stat().st_size} != {size}; run again to resume')
    if expect.get('sha256'):
        say(f'{key}: verifying {name}')
        if sha256(partial) != expect['sha256']:
            partial.unlink()
            raise RuntimeError(f'{name}: SHA-256 mismatch, file deleted; run again')
    partial.replace(destination)
    say(f'{key}: done {folder}/{name}' + (' (verified)' if expect.get('sha256') else ''))
    return 'new'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--profiles', default='sdxl', help='comma list: ' + ','.join(SECTIONS) + ' or all')
    parser.add_argument('--root', type=Path, default=APP.parent, help='folder that holds ComfyUI_windows_portable')
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--skip-models', action='store_true')
    args = parser.parse_args()
    profiles = list(SECTIONS) if args.profiles.strip() == 'all' else [p.strip() for p in args.profiles.split(',') if p.strip()]
    unknown = [p for p in profiles if p not in SECTIONS]
    if unknown:
        parser.error('unknown engine: ' + ', '.join(unknown))

    if args.list:
        for key in SECTIONS:
            items = model_list([key])
            total = sum(item[4].get('size', 0) for item in items)
            print(f'{key:9} {total / 2**30:5.1f} GB  {len(items)} files  {LABELS[key]}')
        return

    comfy = comfy_root(args.root.resolve())
    models = comfy / 'models'
    if args.check:
        missing = 0
        for key, name, url, folder, expect in model_list(profiles):
            path = models / folder / name
            ok = path.is_file() and (not expect.get('size') or path.stat().st_size == expect['size'])
            missing += not ok
            print(f'{"OK " if ok else "-- "} {key:9} {folder}/{name}')
        for folder, (_, _, needed_by) in NODES.items():
            if needed_by & set(profiles):
                ok = (comfy / 'custom_nodes' / folder).is_dir()
                missing += not ok
                print(f'{"OK " if ok else "-- "} node      {folder}')
        print('all present' if not missing else f'{missing} missing')
        sys.exit(1 if missing else 0)

    python = sys.executable
    say('Python packages for the VOID gateway (aiohttp, Pillow)')
    pip(python, 'aiohttp', 'Pillow')
    install_nodes(comfy, profiles, python)
    if args.skip_models:
        say('models skipped')
    else:
        items = model_list(profiles)
        total = sum(item[4].get('size', 0) for item in items if not (models / item[3] / item[1]).is_file())
        say(f'models: {len(items)} files, about {total / 2**30:.1f} GB to download')
        with ThreadPoolExecutor(max_workers=2) as pool:
            for future in [pool.submit(download, models, *item) for item in items]:
                future.result()
    say('VOID_SETUP_DONE')


if __name__ == '__main__':
    main()
