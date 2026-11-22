"""VOID GEN CLOUD (COLAB)：從本機用 Google colab CLI 把 VOID 跑在 Colab GPU 上（參考 shanshiba-workflow-colab 的 cloud/colab_h3.py）。

前置（只做一次，見 .claude/skills/void-gen-cloud）：
    uv tool install --python <現有 python.exe> google-colab-cli
    colab usage                      # 瀏覽器登入，授權碼貼回同一個終端機

日常（Python 一律用 ..\\ComfyUI_windows_portable\\python_embeded\\python.exe -s）：
    colab_cli.py check
    colab_cli.py start --gpu L4,A100,T4 --profiles sdxl   # 依序換機器，每台最多等 2 分鐘
    colab_cli.py open                                     # 轉發到 http://127.0.0.1:7860/，保持 VM 不閒置
    colab_cli.py add klein                                # 加裝引擎：只下載模型，有新節點才重啟
    colab_cli.py fetch                                    # 把新圖拉回本機 ComfyUI output/VOID-Cloud/<日期>
    colab_cli.py stop                                     # 停服務 → 拉回新圖 → 關機（拉圖失敗就不關機）
    colab_cli.py logs

預設不掛 Google Drive（雲端只負責算圖，圖拉回本機）。要掛就 start --drive，會要你在瀏覽器授權一次。
只用標準函式庫。
"""
import argparse
import datetime
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REMOTE_SRC = '/content/void.gen'
SETUP_LOG = '/content/void-setup.log'
DRIVE_HOME = '/content/drive/MyDrive/VOID-Colab'
LOCAL_HOME = '/content/VOID-Colab'
RETRY = ('Connection was lost', 'Timeout waiting for reply', 'Read timed out', 'ConnectionError', 'RemoteDisconnected',
         '503 Server Error', '502 Server Error')
SKIP_DIRS = {'.git', '__pycache__', 'node_modules', '.venv', '_system'}
LOCAL_OUTPUT = ROOT.parent / 'ComfyUI_windows_portable' / 'ComfyUI' / 'output'
BATCH_BYTES = 60 * 2**20   # colab upload/download gets reset above ~90 MB per file
# PRO 根目錄的 VOID 後台正本與它讀的檔案（void.gen 裡的同名檔只是轉接檔）
GATEWAY_FILES = ('void_mobile.py', 'mobile_workflows.py', 'prompt_adapt.py', 'engine-profiles.json',
                 'mobile_motion_graph.json', 'z-image-turbo-api.json')


def colab_bin():
    b = os.environ.get('COLAB_BIN') or shutil.which('colab')
    if not b:   # uv tool 預設裝在 ~/.local/bin，但不一定在 PATH 上
        fallback = Path.home() / '.local' / 'bin' / ('colab.exe' if os.name == 'nt' else 'colab')
        b = str(fallback) if fallback.exists() else None
    if not b:
        sys.exit('找不到 colab 指令：先執行  uv tool install --python <python.exe> google-colab-cli')
    return b


def cx(args, inp=None, timeout=900, tries=4, check=True):
    """呼叫 colab CLI；遇到 CLI 的暫時性連線錯誤會重試。"""
    out = ''
    for k in range(tries):
        try:
            r = subprocess.run([colab_bin(), *map(str, args)], input=inp if inp is not None else '',
                               capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=timeout,
                               env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
            out = r.stdout + r.stderr
        except subprocess.TimeoutExpired:
            out = 'Timeout waiting for reply (local timeout)'
        if 'Enter the authorization code' in out:
            sys.exit('colab CLI 尚未登入：先在終端機執行  colab usage  並貼上授權碼')
        if 'termios' in out:
            sys.exit('colab CLI 在 Windows 上壞掉（termios）：先套用 shanshiba-workflow-colab 的 '
                     'cloud/colab_cli_windows_patch.py')
        if not any(m in out for m in RETRY):
            break
        time.sleep(5 * (k + 1))
    if check and 'Session not found' in out:
        sys.exit('Colab 機器已經不在了（閒置約 20 分鐘會被收回）。重新執行 start。')
    return out


def vm(name, code, timeout=300):
    """在 VM 上執行 Python，回傳輸出。"""
    return cx(['exec', '-s', name], inp=code, timeout=timeout)


def vm_sh(name, cmd, timeout=300):
    return vm(name, f'import subprocess\nr = subprocess.run({cmd!r}, shell=True, capture_output=True, text=True)\n'
                    f'print(r.stdout[-6000:] + r.stderr[-3000:])', timeout)


def alive(name):
    return f'[{name}]' in cx(['sessions'], check=False)


def balance():
    m = re.search(r'Current balance:\s*([\d.]+)', cx(['usage'], check=False))
    return float(m.group(1)) if m else None


def transfer(kind, name, src, dst, tries=5):
    out = ''
    for k in range(tries):
        out = cx([kind, '-s', name, src, dst], timeout=1800)
        if ('Uploaded' if kind == 'upload' else 'Downloaded') in out:
            return
        print(f'[colab] {kind} 失敗（第 {k + 1} 次），重試：{out.strip()[-160:]}', flush=True)
        time.sleep(10 * (k + 1))
    sys.exit(f'{kind} 失敗：{src}\n{out[-800:]}')


def read_log(name, logfile=SETUP_LOG):
    return vm(name, f'import os\np={logfile!r}\nprint(open(p, errors="replace").read() if os.path.exists(p) else "")')


def poll(name, done, every=20, limit=5400, logfile=SETUP_LOG):
    """等 VM 日誌出現完成標記，同時印出新進度；輪詢也讓 VM 不被當成閒置。
    colab exec 約 60 秒沒回應就放棄，所以超過一分鐘的事一律 nohup 背景跑、再用這裡輪詢日誌。"""
    seen, t0 = 0, time.time()
    while time.time() - t0 < limit:
        txt = read_log(name, logfile)
        lines = [l for l in txt.splitlines() if l.startswith('[void]')]
        for l in lines[seen:]:
            print('   ', l[:300], flush=True)
        seen = max(seen, len(lines))
        if done in txt:
            return round(time.time() - t0)
        if '[void] FAILED' in txt:
            print(txt[-4000:])
            sys.exit(f'VM 上失敗了（完整記錄在 VM 的 {SETUP_LOG}，可用 logs 查看）')
        time.sleep(every)
    sys.exit(f'等了 {limit // 60} 分鐘還沒完成，用 logs 查看 {SETUP_LOG}')


def bundle():
    """打包成 zip 暫存檔，解開到 VM 的 /content：void.gen/ 整包，加上 PRO 根目錄的 VOID 後台
    （2026-11-22 起 void_mobile.py／mobile_workflows.py 正本在根目錄，void.gen 裡只剩轉接檔）。不含作品、資料庫、大檔。"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in ROOT.rglob('*'):
            relative = path.relative_to(ROOT)
            if any(part in SKIP_DIRS for part in relative.parts) or not path.is_file():
                continue
            if path.suffix in {'.zip', '.sqlite3', '.log'} or path.stat().st_size > 20 * 2**20:
                continue
            archive.write(path, f'{ROOT.name}/{relative.as_posix()}')
        for name in GATEWAY_FILES:
            if (ROOT.parent / name).is_file():
                archive.write(ROOT.parent / name, name)
    target = Path(tempfile.gettempdir()) / 'void-colab-src.zip'
    target.write_bytes(buffer.getvalue())
    return target


def new_session(name, gpus, wait):
    """依序嘗試每種 GPU；每台最多等 wait 秒，不重試（G4 沒貨時 CLI 會卡很久）。"""
    for gpu in gpus:
        print(f'[colab] 嘗試 {gpu}（最多 {wait} 秒）…', flush=True)
        out = cx(['new', '-s', name, '--gpu', gpu], timeout=wait, tries=1, check=False)
        if alive(name):
            return gpu
        reason = 'Service Unavailable' if 'Service Unavailable' in out else out.strip().splitlines()[-1][:160] if out.strip() else '?'
        print(f'[colab] {gpu} 開不了：{reason}', flush=True)
        cx(['stop', '-s', name], check=False, tries=1)   # 清掉可能半開的 session，避免默默計費
    sys.exit(f'{", ".join(gpus)} 都開不了，稍後再試或換 --gpu')


def cmd_check(args):
    print(cx(['version'], check=False).strip())
    b = balance()
    print(f'運算單元餘額：{b if b is not None else "（讀不到，請先執行 colab usage 登入）"}')
    print(f'Session [{args.name}]：{"執行中（正在計費）" if alive(args.name) else "沒有"}')
    print('ssh：', shutil.which('ssh') or '找不到（open 需要 OpenSSH 用戶端）')
    print('本機 output：', LOCAL_OUTPUT if LOCAL_OUTPUT.exists() else f'{LOCAL_OUTPUT}（不存在，fetch 會改存 void-colab-output）')


def cmd_start(args):
    t0 = time.time()
    if alive(args.name):
        print(f'[colab] 沿用已存在的 session [{args.name}]')
    else:
        b = balance()
        print(f'[colab] 餘額 {b} 單元')
        gpu = new_session(args.name, [g.strip() for g in args.gpu.split(',') if g.strip()], args.wait)
        print(f'[colab] 開到 {gpu}', flush=True)

    home = LOCAL_HOME
    if args.drive:
        check = 'import os\nprint("MOUNTED" if os.path.isdir("/content/drive/MyDrive") else "")'
        if 'MOUNTED' not in vm(args.name, check):
            print('[colab] 掛載 Google Drive：複製畫面上的網址到瀏覽器按「允許」，回到這裡按 Enter')
            subprocess.run([colab_bin(), 'drivemount', '-s', args.name])
        if 'MOUNTED' not in vm(args.name, check):
            sys.exit('Drive 沒有掛上。可重試，或不加 --drive（圖用 fetch / stop 拉回本機）')
        home = DRIVE_HOME
    print(f'[colab] 雲端資料目錄：{home}')

    archive = bundle()
    print(f'[colab] 上傳原始碼 {archive.stat().st_size / 2**20:.1f} MB')
    transfer('upload', args.name, archive, '/content/void-src.zip')
    vm_sh(args.name, f'rm -rf {REMOTE_SRC} && cd /content && unzip -q -o /content/void-src.zip')

    print(f'[colab] 背景安裝與啟動（引擎：{args.profiles}；模型下載與套件安裝同時進行）')
    vm_sh(args.name, f'cd {REMOTE_SRC} && nohup python -u colab_vm.py --profiles {args.profiles} --home "{home}" '
                     f'> {SETUP_LOG} 2>&1 &')
    poll(args.name, 'VOID_READY')
    print(f'\n[colab] VOID 已在 Colab 啟動（共 {round(time.time() - t0)} 秒）。接著執行：colab_cli.py open')


def cmd_add(args):
    if not alive(args.name):
        sys.exit(f'沒有 session [{args.name}]，先執行 start')
    state = vm(args.name, 'import json,os\np="/content/void-runtime/state.json"\n'
                          'print(json.load(open(p)).get("home","") if os.path.exists(p) else "")').strip()
    home = state.splitlines()[-1] if state else LOCAL_HOME
    print(f'[colab] 加裝引擎 {args.engines}（{home}）')
    vm_sh(args.name, f'cd {REMOTE_SRC} && nohup python -u colab_vm.py --add {args.engines} --home "{home}" '
                     f'> {SETUP_LOG} 2>&1 &')
    poll(args.name, 'VOID_ADDED')
    print('[colab] 完成。在 VOID 按「更新模型」或 CHECK 就能用，不必重新整理連線。')


def cmd_motion(args):
    """Upload images + jobs.json, run VOID's Wan image-to-video graph on the VM in the background, then fetch."""
    if not alive(args.name):
        sys.exit(f'沒有 session [{args.name}]，先執行 start --profiles wan（或 add wan）')
    jobs_file = Path(args.jobs).resolve()
    jobs = json.loads(jobs_file.read_text(encoding='utf-8'))
    remote = '/content/motion-in'
    vm(args.name, f'import shutil, os\nshutil.rmtree({remote!r}, ignore_errors=True)\nos.makedirs({remote!r})')
    staged = []
    for job in jobs:
        image = (jobs_file.parent / job['image']).resolve()
        if image.stat().st_size > BATCH_BYTES:
            sys.exit(f'{image.name} 超過 60MB，先縮小再上傳')
        transfer('upload', args.name, image, f'{remote}/{image.name}')
        staged.append({**job, 'image': image.name})
    local_jobs = Path(tempfile.gettempdir()) / 'void-motion-jobs.json'
    local_jobs.write_text(json.dumps(staged, ensure_ascii=False), encoding='utf-8')
    transfer('upload', args.name, local_jobs, f'{remote}/jobs.json')
    state = vm(args.name, 'import json,os\np="/content/void-runtime/state.json"\n'
                          'print(json.load(open(p)).get("home","") if os.path.exists(p) else "")').strip()
    home = state.splitlines()[-1] if state else LOCAL_HOME
    log_file = '/content/void-motion.log'
    print(f'[colab] 背景生成 {len(jobs)} 支影片（Wan 2.2，VOID 同款工作流）')
    vm_sh(args.name, f'cd {REMOTE_SRC} && nohup python -u colab_motion.py {remote}/jobs.json --home "{home}" > {log_file} 2>&1 &')
    poll(args.name, 'MOTION_DONE', every=30, limit=4 * 3600, logfile=log_file)
    cmd_fetch(args)


FETCH_CODE = r'''
import json, os, zipfile
state = "/content/void-runtime/state.json"
home = json.load(open(state)).get("home") if os.path.exists(state) else {home!r}
out_dir = os.path.join(home, "output")
seen_file = "/content/void-runtime/fetched.txt"
seen = set(open(seen_file).read().split("\n")) if os.path.exists(seen_file) else set()
files = []
for root, _, names in os.walk(out_dir):
    for n in names:
        p = os.path.join(root, n)
        rel = os.path.relpath(p, out_dir)
        if rel not in seen and not n.endswith((".part", ".tmp")):
            files.append((rel, p, os.path.getsize(p)))
batches, cur, size = [], [], 0
for rel, p, s in sorted(files):
    if cur and size + s > {limit}:
        batches.append(cur); cur, size = [], 0
    cur.append((rel, p)); size += s
if cur: batches.append(cur)
names = []
for i, batch in enumerate(batches):
    z = f"/content/void-fetch-{{i:03d}}.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_STORED) as f:
        for rel, p in batch: f.write(p, rel)
    names.append(z)
print("FETCH " + json.dumps({{"count": len(files), "zips": names, "rels": [r for r, _, _ in files]}}))
'''


def cmd_fetch(args, quiet=False):
    """Pull new output files from the VM in ≤60 MB zips into the local output folder. Returns the number of files."""
    out = vm(args.name, FETCH_CODE.format(home=LOCAL_HOME, limit=BATCH_BYTES), timeout=600)
    m = re.search(r'^FETCH (\{.*\})$', out, re.M)
    if not m:
        sys.exit(f'讀不到雲端作品清單：\n{out[-800:]}')
    info = json.loads(m.group(1))
    if not info['count']:
        print('[colab] 雲端沒有新的作品')
        return 0
    base = Path(args.dest) if args.dest else (LOCAL_OUTPUT if LOCAL_OUTPUT.exists() else ROOT.parent / 'void-colab-output')
    dest = base / 'VOID-Cloud' / datetime.date.today().isoformat()
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for i, remote in enumerate(info['zips']):
            local = Path(tmp) / Path(remote).name
            print(f'[colab] 下載第 {i + 1}/{len(info["zips"])} 包', flush=True)
            transfer('download', args.name, remote, local)
            with zipfile.ZipFile(local) as z:
                z.extractall(dest)
    rels = '\n'.join(info['rels'])
    vm(args.name, f'open("/content/void-runtime/fetched.txt", "a").write({rels!r} + "\\n")\n'
                  f'import glob, os\n[os.remove(p) for p in glob.glob("/content/void-fetch-*.zip")]')
    print(f'[colab] 拉回 {info["count"]} 個檔案 → {dest}')
    return info['count']


def cmd_open(args):
    ssh = shutil.which('ssh')
    if not ssh:
        sys.exit('找不到 ssh。Windows 可在「設定 → 系統 → 選用功能」加入 OpenSSH 用戶端。')
    if not alive(args.name):
        sys.exit(f'沒有 session [{args.name}]，先執行 start')
    key = Path.home() / '.ssh' / 'void_colab_ed25519'
    if not key.exists():
        key.parent.mkdir(exist_ok=True)
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True)
    proxy = f'"{colab_bin()}" ssh -s {args.name} --proxy-mode -i "{key}"'
    command = [ssh, '-N', '-L', f'{args.port}:127.0.0.1:7860', '-i', str(key),
               '-o', f'ProxyCommand={proxy}', '-o', 'StrictHostKeyChecking=no',
               '-o', f'UserKnownHostsFile={"NUL" if os.name == "nt" else "/dev/null"}',
               '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', f'root@colab-{args.name}']
    tunnel = subprocess.Popen(command)
    time.sleep(8)
    if tunnel.poll() is not None:
        print('\nSSH 轉發沒有建立。備用方式：執行  colab url -s', args.name, '--open  ，在開啟的 Notebook 新增一格執行：\n'
              "  from google.colab.output import eval_js; print(eval_js('google.colab.kernel.proxyPort(7860)'))\n"
              '用印出的網址開啟 VOID（手機介面在網址後加 /mobile/）。')
        sys.exit(1)
    print(f'\n桌面版：http://127.0.0.1:{args.port}/\n手機介面：http://127.0.0.1:{args.port}/mobile/\n'
          '按 Ctrl+C 結束轉發（VM 仍會計費，用完請執行 stop）。')
    try:
        while tunnel.poll() is None:
            for _ in range(args.ping // 5):
                if tunnel.poll() is not None:
                    break
                time.sleep(5)
            vm(args.name, 'print(1)', timeout=120)   # 讓 VM 不被判定閒置
    except KeyboardInterrupt:
        pass
    finally:
        if tunnel.poll() is None:
            tunnel.terminate()


def cmd_logs(args):
    print(read_log(args.name)[-6000:])
    print(vm_sh(args.name, 'tail -n 40 /content/void-runtime/comfy.log; echo ----; tail -n 40 /content/void-runtime/void.log'))


def cmd_stop(args):
    if not alive(args.name):
        print(f'沒有 session [{args.name}]')
        return
    if not args.no_fetch:   # 先拉圖（要用 state.json 找資料目錄），再停服務
        try:
            cmd_fetch(args)
        except SystemExit as error:
            if not args.force:
                sys.exit(f'{error}\n拉回作品失敗，VM 沒有關（還在計費）。修好後重跑 stop，或 stop --force 直接關機（雲端作品會消失）。')
    # 停服務最多要 75 秒（VOID 備份圖庫），超過 colab exec 的 60 秒上限，所以背景跑再輪詢
    stop_log = '/content/void-stop.log'
    vm_sh(args.name, f'cd {REMOTE_SRC} && nohup python -u colab_vm.py --stop > {stop_log} 2>&1 &')
    poll(args.name, 'STOPPED', every=5, limit=240, logfile=stop_log)
    if not args.keep:
        print(cx(['stop', '-s', args.name], check=False).strip())
        print(f'[colab] VM 已關閉，停止計費。餘額 {balance()} 單元')


def main():
    parser = argparse.ArgumentParser(description='在 Colab GPU 上執行 VOID')
    parser.add_argument('--name', default='void', help='colab session 名稱')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('check')
    p = sub.add_parser('start')
    p.add_argument('--gpu', default='L4,A100,T4', help='依序嘗試的 GPU，逗號分隔（T4 | L4 | A100 | G4）')
    p.add_argument('--wait', type=int, default=120, help='每種 GPU 最多等幾秒')
    p.add_argument('--profiles', default='sdxl', help='逗號分隔：sdxl,klein,qwen,moss,wan,florence,wd14')
    p.add_argument('--drive', action='store_true', help='掛 Google Drive（要在瀏覽器授權一次）')
    p = sub.add_parser('add')
    p.add_argument('engines', help='逗號分隔，例如 klein 或 qwen,florence')
    p = sub.add_parser('open')
    p.add_argument('--port', type=int, default=7860, help='本機埠號')
    p.add_argument('--ping', type=int, default=300, help='每幾秒戳一次 VM 防閒置')
    p = sub.add_parser('fetch')
    p.add_argument('--dest', help='存放位置（預設本機 ComfyUI output，圖會出現在本機 VOID 圖庫）')
    p = sub.add_parser('motion', help='批次圖轉影片（Wan 2.2）：jobs.json 列出圖片、動作描述、秒數、比例')
    p.add_argument('jobs', help='[{"image": "a.png", "prompt": "...", "seconds": 10, "size": "square|portrait|landscape"}]')
    p.add_argument('--dest', help='同 fetch --dest')
    sub.add_parser('logs')
    p = sub.add_parser('stop')
    p.add_argument('--keep', action='store_true', help='只停服務、拉圖，不關 VM')
    p.add_argument('--no-fetch', action='store_true', help='不拉回作品')
    p.add_argument('--force', action='store_true', help='拉圖失敗也照樣關機')
    p.add_argument('--dest', help='同 fetch --dest')
    args = parser.parse_args()
    {'check': cmd_check, 'start': cmd_start, 'add': cmd_add, 'open': cmd_open, 'fetch': cmd_fetch,
     'motion': cmd_motion, 'logs': cmd_logs, 'stop': cmd_stop}[args.command](args)


if __name__ == '__main__':
    main()
