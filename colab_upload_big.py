"""Upload a large file to a Colab VM in chunks (single `colab upload` calls above ~90 MB get reset).

    python colab_upload_big.py <local file> <remote path> [--name void] [--chunk-mb 20]

Each chunk is uploaded with retries, joined on the VM, and checked by SHA-256.
"""
import argparse
import hashlib
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from colab_cli import cx, vm  # noqa: E402  (same retry wrapper as the rest of the tooling)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('local', type=Path)
    p.add_argument('remote')
    p.add_argument('--name', default='void')
    p.add_argument('--chunk-mb', type=int, default=20)
    a = p.parse_args()
    data_hash = hashlib.sha256()
    size = a.local.stat().st_size
    chunk = a.chunk_mb * 2**20
    parts = []
    remote_dir = '/content/_upload_parts'
    vm(a.name, f'import os, shutil\nshutil.rmtree({remote_dir!r}, ignore_errors=True)\nos.makedirs({remote_dir!r})')
    with a.local.open('rb') as f, tempfile.TemporaryDirectory() as tmp:
        index = 0
        while True:
            block = f.read(chunk)
            if not block:
                break
            data_hash.update(block)
            part = Path(tmp) / f'part{index:04d}'
            part.write_bytes(block)
            remote = f'{remote_dir}/part{index:04d}'
            for attempt in range(6):
                out = cx(['upload', '-s', a.name, part, remote], timeout=900)
                if 'Uploaded' in out:
                    break
                print(f'  chunk {index} retry {attempt + 1}: {out.strip()[-120:]}', flush=True)
            else:
                sys.exit(f'chunk {index} failed')
            parts.append(remote)
            part.unlink()
            index += 1
            print(f'  {min(index * chunk, size) / 2**20:.0f} / {size / 2**20:.0f} MB', flush=True)
    expected = data_hash.hexdigest()
    out = vm(a.name, f"""import hashlib, os, shutil
dst = {a.remote!r}
os.makedirs(os.path.dirname(dst), exist_ok=True)
h = hashlib.sha256()
with open(dst + '.part', 'wb') as out:
    for p in {parts!r}:
        b = open(p, 'rb').read(); h.update(b); out.write(b)
ok = h.hexdigest() == {expected!r}
if ok: os.replace(dst + '.part', dst)
shutil.rmtree({remote_dir!r}, ignore_errors=True)
print('JOIN_OK' if ok else 'JOIN_BAD ' + h.hexdigest())""", timeout=600)
    print(out.strip())
    if 'JOIN_OK' not in out:
        sys.exit('hash mismatch')
    print(f'uploaded {a.local.name} -> {a.remote} (sha256 {expected[:12]}...)')


if __name__ == '__main__':
    main()
