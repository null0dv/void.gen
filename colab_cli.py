"""從本機用 Google colab CLI 把 VOID 跑在 Colab GPU 上（參考 shanshiba-workflow-colab 的 cloud/colab_h3.py）。

前置（只做一次）：
    uv tool install google-colab-cli
    （Windows：colab CLI 官方只支援 Linux/macOS，import termios 會壞，需套用
     shanshiba-workflow-colab 的 cloud/colab_cli_windows_patch.py，CLI 更新後要重套）
    colab usage                      # 瀏覽器登入

日常：
    python colab_cli.py check
    python colab_cli.py start --gpu L4 --profiles sdxl     # 開機、掛 Drive、上傳、安裝、啟動
    python colab_cli.py open                               # 轉發到 http://127.0.0.1:7860/ 並保持 VM 不閒置
    python colab_cli.py logs
    python colab_cli.py stop                               # 備份圖庫 → 停服務 → 關機（停止計費）

只用標準函式庫。
"""
import argparse
import io
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REMOTE_SRC = '/content/void.gen'
SETUP_LOG = '/content/void-setup.log'
DRIVE_HOME = '/content/drive/MyDrive/VOID-Colab'
LOCAL_HOME = '/content/VOID-Colab'
RETRY = ('Connection was lost', 'Timeout waiting for reply', 'Read timed out', 'ConnectionError', 'RemoteDisconnected',
         '503 Server Error', 'Service Unavailable', '502 Server Error')
SKIP_DIRS = {'.git', '__pycache__', 'node_modules', '.venv'}


def colab_bin():
    b = os.environ.get('COLAB_BIN') or shutil.which('colab')
    if not b:   # uv tool 預設裝在 ~/.local/bin，但不一定在 PATH 上
        fallback = Path.home() / '.local' / 'bin' / ('colab.exe' if os.name == 'nt' else 'colab')
        b = str(fallback) if fallback.exists() else None
    if not b:
        sys.exit('找不到 colab 指令：先執行  uv tool install google-colab-cli')
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


def upload(name, local, remote, tries=4):
    out = ''
    for k in range(tries):
        out = cx(['upload', '-s', name, local, remote], timeout=1800)
        if 'Uploaded' in out:
            return
        print(f'[colab] 上傳失敗（第 {k + 1} 次），重試：{out.strip()[-160:]}', flush=True)
        time.sleep(10 * (k + 1))
    sys.exit(f'上傳失敗：{local}\n{out[-800:]}')


def read_log(name):
    return vm(name, f'import os\np={SETUP_LOG!r}\nprint(open(p, errors="replace").read() if os.path.exists(p) else "")')


def poll(name, done='VOID_READY', every=30, limit=5400):
    """等 VM 日誌出現完成標記，同時印出新進度；輪詢也讓 VM 不被當成閒置。"""
    seen, t0 = 0, time.time()
    while time.time() - t0 < limit:
        txt = read_log(name)
        lines = [l for l in txt.splitlines() if l.startswith('[void]')]
        for l in lines[seen:]:
            print('   ', l[:300], flush=True)
        seen = max(seen, len(lines))
        if done in txt:
            return
        if '[void] FAILED' in txt:
            print(txt[-4000:])
            sys.exit(f'VM 上安裝失敗（完整記錄在 VM 的 {SETUP_LOG}，可用 logs 查看）')
        time.sleep(every)
    sys.exit(f'等了 {limit // 60} 分鐘還沒完成，用 logs 查看 {SETUP_LOG}')


def bundle():
    """把 void.gen 打包成 zip（記憶體內），寫到暫存檔。"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in ROOT.rglob('*'):
            relative = path.relative_to(ROOT)
            if any(part in SKIP_DIRS for part in relative.parts) or not path.is_file():
                continue
            if path.suffix in {'.zip', '.sqlite3', '.log'} or path.stat().st_size > 20 * 2**20:
                continue
            archive.write(path, relative.as_posix())
    target = Path(os.environ.get('TEMP', '/tmp')) / 'void-colab-src.zip'
    target.write_bytes(buffer.getvalue())
    return target


def cmd_check(args):
    print(cx(['version'], check=False).strip())
    usage = cx(['usage'], check=False)
    m = re.search(r'Current balance:\s*([\d.]+)', usage)
    print(f'運算單元餘額：{m.group(1) if m else "（讀不到，請先執行 colab usage 登入）"}')
    print(f'Session [{args.name}]：{"執行中" if alive(args.name) else "沒有"}')
    print('ssh：', shutil.which('ssh') or '找不到（open 需要 OpenSSH 用戶端）')


def cmd_start(args):
    if alive(args.name):
        print(f'[colab] 沿用已存在的 session [{args.name}]')
    else:
        print(f'[colab] 建立 session [{args.name}]，GPU {args.gpu}')
        out = cx(['new', '-s', args.name, '--gpu', args.gpu], timeout=900)
        if not alive(args.name):
            sys.exit(f'建立 session 失敗：\n{out[-1500:]}')

    home = LOCAL_HOME
    if not args.no_drive:
        if 'MOUNTED' not in vm(args.name, 'import os\nprint("MOUNTED" if os.path.isdir("/content/drive/MyDrive") else "")'):
            print('[colab] 掛載 Google Drive（依畫面指示在瀏覽器授權）')
            subprocess.run([colab_bin(), 'drivemount', '-s', args.name])
        if 'MOUNTED' not in vm(args.name, 'import os\nprint("MOUNTED" if os.path.isdir("/content/drive/MyDrive") else "")'):
            sys.exit('Drive 沒有掛上。可重試，或加 --no-drive（模型與作品只存在這台 VM，關機即消失）')
        home = DRIVE_HOME
    print(f'[colab] 資料目錄：{home}')

    archive = bundle()
    print(f'[colab] 上傳原始碼 {archive.stat().st_size / 2**20:.1f} MB')
    upload(args.name, archive, '/content/void-src.zip')
    vm_sh(args.name, f'rm -rf {REMOTE_SRC} && mkdir -p {REMOTE_SRC} && cd {REMOTE_SRC} && unzip -q -o /content/void-src.zip')

    print(f'[colab] 背景安裝與啟動（profiles：{args.profiles}）')
    vm_sh(args.name, f'cd {REMOTE_SRC} && nohup python -u colab_vm.py --profiles {args.profiles} --home "{home}" '
                     f'> {SETUP_LOG} 2>&1 &')
    poll(args.name)
    print('\n[colab] VOID 已在 Colab 啟動。接著執行：python colab_cli.py open')


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
    if alive(args.name):
        print(vm_sh(args.name, f'cd {REMOTE_SRC} && python colab_vm.py --stop', timeout=180).strip())
        if not args.keep:
            print(cx(['stop', '-s', args.name], check=False).strip())
            print('[colab] VM 已關閉，停止計費。')
    else:
        print(f'沒有 session [{args.name}]')


def main():
    parser = argparse.ArgumentParser(description='在 Colab GPU 上執行 VOID')
    parser.add_argument('--name', default='void', help='colab session 名稱')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('check')
    p = sub.add_parser('start')
    p.add_argument('--gpu', default='L4', help='T4 | L4 | A100 | G4（依帳號配額）')
    p.add_argument('--profiles', default='sdxl', help='逗號分隔：sdxl,klein,qwen,moss,wan,florence,wd14')
    p.add_argument('--no-drive', action='store_true', help='不掛 Drive，資料只存在 VM')
    p = sub.add_parser('open')
    p.add_argument('--port', type=int, default=7860, help='本機埠號')
    p.add_argument('--ping', type=int, default=300, help='每幾秒戳一次 VM 防閒置')
    sub.add_parser('logs')
    p = sub.add_parser('stop')
    p.add_argument('--keep', action='store_true', help='只停服務，不關 VM')
    args = parser.parse_args()
    {'check': cmd_check, 'start': cmd_start, 'open': cmd_open, 'logs': cmd_logs, 'stop': cmd_stop}[args.command](args)


if __name__ == '__main__':
    main()
