#!/usr/bin/env python3
"""Quick health check for VOID.RNG standalone server."""
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8787"
PATHS = [
    "/health",
    "/",
    "/css/app.css",
    "/js/app.js",
    "/js/data-loader.js",
    "/js/apply-latest-data.js",
    "/js/rng-engine.js",
    "/js/search.js",
    "/js/translate.js",
    "/data/manifest.json",
    "/data/char-sections.json",
    "/data/char-banks.json",
    "/data/prompt-search-rules.json",
]


def main() -> int:
    ok = True
    try:
        with urllib.request.urlopen(BASE + "/health", timeout=2) as resp:
            if resp.status != 200:
                print("WARN: /health returned", resp.status)
    except Exception as e:
        print("FAIL server not running at", BASE)
        print("  ", e)
        print("  → 請先雙擊 VOID-RNG.cmd，等視窗出現 Press Ctrl+C to stop 後再執行本檢查。")
        return 1
    for path in PATHS:
        url = BASE + path
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                n = len(resp.read())
                print(f"OK  {path}  ({resp.status}, {n} bytes)")
        except Exception as e:
            ok = False
            print(f"FAIL {path}  {e}")
    for rel in ("index.html", "grok-proxy.py", "VOID-RNG.cmd"):
        p = ROOT / rel
        print(("OK  " if p.is_file() else "MISSING ") + rel)
        ok = ok and p.is_file()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())