"""Create a versioned local snapshot of the native VOID data and output."""
import argparse
from contextlib import closing
import datetime
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def copy_tree(archive, root, prefix, pattern='*'):
    root = root.resolve()
    for path in sorted(root.rglob(pattern)):
        if not path.is_symlink() and path.is_file() and path.resolve().is_relative_to(root):
            archive.write(path, prefix + '/' + path.relative_to(root).as_posix())


def main():
    parser = argparse.ArgumentParser(description='備份 VOID FULL 原生版的任務、資料庫、作品、回收區與上傳素材。')
    parser.add_argument('--destination', type=Path, default=ROOT / 'void-backups')
    args = parser.parse_args()
    data = ROOT / 'void-data'
    comfy = ROOT / 'ComfyUI_windows_portable' / 'ComfyUI'
    db = data / 'mobile.sqlite3'
    if not db.is_file():
        parser.error('找不到 VOID FULL 資料庫')
    dest = args.destination.resolve()
    if any(dest.is_relative_to(base.resolve()) for base in (data, comfy / 'input', comfy / 'output')):
        parser.error('請選擇作品與資料資料夾以外的位置')
    dest.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc)
    final = dest / ('VOID-FULL-data-v1-' + stamp.strftime('%Y%m%dT%H%M%S%fZ') + '.zip')
    with tempfile.TemporaryDirectory(dir=dest, prefix='.void-backup-') as temp:
        temp = Path(temp)
        snapshot = temp / 'mobile.sqlite3'
        with closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)) as source:
            if source.execute("SELECT 1 FROM jobs WHERE state IN ('queued','running','submitting') LIMIT 1").fetchone():
                parser.error('請等共用任務完成後再備份')
            with closing(sqlite3.connect(snapshot)) as target:
                source.backup(target)
                if target.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise RuntimeError('資料庫備份無法通過完整性檢查')
        package = temp / 'snapshot.zip'
        with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_STORED) as archive:
            archive.write(snapshot, 'void-data/mobile.sqlite3')
            with closing(sqlite3.connect(snapshot)) as target:
                for (filename,) in target.execute('SELECT DISTINCT filename FROM uploads'):
                    candidate = (comfy / 'input' / filename).resolve()
                    if candidate.parent == (comfy / 'input').resolve() and candidate.is_file():
                        archive.write(candidate, 'comfy/input/' + candidate.name)
            copy_tree(archive, comfy / 'output', 'comfy/output')
            copy_tree(archive, data / 'trash', 'void-data/trash')
            archive.writestr('backup.json', json.dumps({
                'format': 'void-full-native-data', 'version': 1, 'createdAt': stamp.isoformat(),
                'contents': ['sqlite', 'output', 'uploaded assets', 'trash'],
            }, indent=2))
        with zipfile.ZipFile(package) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('壓縮檔無法通過完整性檢查')
        os.replace(package, final)
    print(final)


if __name__ == '__main__':
    main()
