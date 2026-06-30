#!/usr/bin/env python3
"""VOID.RNG local server + Grok API proxy.

Run:  python grok-proxy.py
Open: http://127.0.0.1:8787/

Do NOT open the HTML via file:// — browsers block fetch and you get "Failed to fetch".
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import json
import mimetypes
import os
import threading
import time
import urllib.request
import urllib.error
import webbrowser

HOST = "127.0.0.1"
PORT = 8787
XAI_URL = "https://api.x.ai/v1/chat/completions"
ROOT = Path(__file__).resolve().parent
HTML_FILE = ROOT / "index.html"


class ReuseHTTPServer(HTTPServer):
    allow_reuse_address = True


class GrokProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/health":
            body = json.dumps({
                "ok": True,
                "service": "void-rng",
                "version": "V3",
                "target": XAI_URL,
                "app": str(HTML_FILE.relative_to(ROOT)).replace("\\", "/"),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return

        if path in ("/", "/index.html"):
            return self._serve_file(HTML_FILE)

        file_path = (ROOT / path.lstrip("/")).resolve()
        try:
            file_path.relative_to(ROOT)
        except ValueError:
            self.send_error(404)
            return
        if file_path.is_file():
            return self._serve_file(file_path)

        self.send_error(404)

    def _serve_file(self, file_path: Path):
        if not file_path.is_file():
            self.send_error(404, "File not found")
            return
        data = file_path.read_bytes()
        ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/chat":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._json_error(400, "Invalid JSON body")
            return

        api_key = (payload.get("api_key") or self.headers.get("Authorization", "").replace("Bearer ", "")).strip()
        api_key = "".join(api_key.split())
        if not api_key:
            self._json_error(401, "Missing api_key")
            return

        model = payload.get("model", "grok-3-mini")
        messages = payload.get("messages")
        if not messages:
            self._json_error(400, "Missing messages")
            return

        xai_body = json.dumps({
            "model": model,
            "messages": messages,
            "temperature": payload.get("temperature", 0.7),
            "stream": False,
        }).encode("utf-8")

        req = urllib.request.Request(
            XAI_URL,
            data=xai_body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            self._json_error(e.code, err_body or str(e))
        except Exception as e:
            self._json_error(502, str(e))

    def _json_error(self, code, message):
        body = json.dumps({"error": {"message": message}}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(body)


def _open_browser_when_ready(url: str) -> None:
    health = url.rstrip("/") + "/health"
    for _ in range(80):
        try:
            with urllib.request.urlopen(health, timeout=0.5) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.1)
    else:
        return
    try:
        webbrowser.open(url)
    except Exception:
        pass


def _already_running(url: str) -> bool:
    health = url.rstrip("/") + "/health"
    try:
        with urllib.request.urlopen(health, timeout=0.4) as resp:
            return resp.status == 200
    except Exception:
        return False


def main():
    if not HTML_FILE.is_file():
        print(f"WARNING: {HTML_FILE.name} not found in {ROOT}")

    url = f"http://{HOST}:{PORT}/"
    open_url = (os.environ.get("VOID_OPEN_URL") or url).strip()
    if _already_running(url):
        print(f"VOID.RNG 已在運行：{url}")
        print("若畫面異常，請先關閉舊視窗再重開。")
        try:
            webbrowser.open(open_url)
        except Exception:
            pass
        return
    try:
        server = ReuseHTTPServer((HOST, PORT), GrokProxyHandler)
    except OSError as e:
        if getattr(e, "winerror", None) == 10048 or e.errno in (48, 98):
            print(f"ERROR: Port {PORT} 已被占用。")
            print("  請關閉其他 VOID.RNG 視窗，或工作管理員結束 python/grok-proxy 後重試。")
        else:
            print(f"ERROR: 無法啟動伺服器 — {e}")
        raise SystemExit(1) from e
    print("VOID.RNG V3 — server + Grok proxy")
    print(f"  App:    {url}")
    print(f"  Health: {url}health")
    print(f"  Grok:   POST {url}chat")
    print(f"  xAI:    {XAI_URL}")
    print("\nPress Ctrl+C to stop.\n")

    threading.Thread(target=_open_browser_when_ready, args=(open_url,), daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()