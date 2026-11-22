"""Write models.lock.json: size and SHA-256 for every HuggingFace download listed in docs/models-v4.md.

    ..\\ComfyUI_windows_portable\\python_embeded\\python.exe -s tools\\build_models_lock.py

docs/models-v4.md stays the only list of models (what, where, which engine). The lock file only adds what the doc does not
hold: the expected size and hash of each URL, so installers (colab_vm.py) can verify downloads. Re-run after editing the doc.

HuggingFace answers a HEAD on /resolve/ with a redirect whose X-Linked-Size / X-Linked-Etag headers are the file's size and
SHA-256 for LFS files; small non-LFS files (json configs) get "sha256": null and are checked by size only.
"""
import http.client
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs' / 'models-v4.md'
OUT = ROOT / 'models.lock.json'
URL = re.compile(r'\]\((https://huggingface\.co/[^)\s]+/resolve/[^)\s]+)\)')


def head(url, hops=6):
    for _ in range(hops):
        u = urlsplit(url)
        conn = http.client.HTTPSConnection(u.netloc, timeout=30)
        conn.request('HEAD', u.path + ('?' + u.query if u.query else ''), headers={'User-Agent': 'void-models/1.0'})
        r = conn.getresponse()
        h = {k.lower(): v for k, v in r.getheaders()}
        conn.close()
        if 'x-linked-size' in h:
            etag = h.get('x-linked-etag', '').strip('"')
            return {'size': int(h['x-linked-size']), 'sha256': etag if re.fullmatch(r'[0-9a-f]{64}', etag) else None}
        if r.status in (301, 302, 303, 307, 308) and 'location' in h:
            loc = h['location']
            url = loc if loc.startswith('http') else f'{u.scheme}://{u.netloc}{loc}'
            continue
        if r.status == 200:
            return {'size': int(h['content-length']) if h.get('content-length') else None, 'sha256': None}
        raise RuntimeError(f'HTTP {r.status}')
    raise RuntimeError('too many redirects')


def main():
    old = json.loads(OUT.read_text(encoding='utf-8')).get('files', {}) if OUT.exists() else {}
    files, failed = {}, 0
    for url in dict.fromkeys(URL.findall(DOC.read_text(encoding='utf-8'))):
        if old.get(url, {}).get('size'):
            files[url] = old[url]
            continue
        try:
            files[url] = head(url)
        except Exception as e:  # keep going: a missing entry only means that file is not verified
            failed += 1
            print(f'  ! {url.rsplit("/", 1)[-1]}: {e}', file=sys.stderr)
            continue
        info = files[url]
        print(f"  {url.rsplit('/', 1)[-1][:60]:60} {info['size'] or '?':>12}  {(info['sha256'] or '-')[:12]}")
    OUT.write_text(json.dumps({'version': 1, 'source': 'docs/models-v4.md', 'files': files}, indent=1) + '\n', encoding='utf-8')
    print(f'wrote {OUT.name}: {len(files)} files, {failed} failed')


if __name__ == '__main__':
    main()
