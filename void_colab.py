"""Run the owner workspace behind Colab's authenticated notebook port proxy."""
import argparse
import asyncio
import mimetypes
import re
import shutil
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientSession, WSMsgType, web

# Since 2026-11-22 the gateway's real copy lives one folder up (PRO root); void.gen/void_mobile.py is only a stub
# that runs it as a script, so import the root copy directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import void_mobile  # noqa: E402
from void_mobile import Gateway, create_app  # noqa: E402

PANEL_ROOT = getattr(void_mobile, 'PANEL_ROOT', Path(__file__).resolve().parent)


def backup_database(source, destination):
    temporary = destination.with_suffix('.tmp')
    with closing(sqlite3.connect(source)) as current, closing(sqlite3.connect(temporary)) as snapshot:
        current.backup(snapshot)
    temporary.replace(destination)


def browser_source(text):
    def rewrite(match):
        url = urlsplit(match[2])
        prefix = '/comfy' if url.port == 8188 else ''
        return f"(location.origin+{(prefix + url.path)!r})"

    return re.sub(r"""(['"])(http://(?:127\.0\.0\.1|localhost):(?:8188|8090)(?:/[^'"\s]*)?)\1""",
                  rewrite, text)


async def relay_socket(request, session, target):
    async with session.ws_connect(target) as upstream:
        socket = web.WebSocketResponse()
        await socket.prepare(request)

        async def pump(source, destination):
            async for message in source:
                if message.type == WSMsgType.TEXT:
                    await destination.send_str(message.data)
                elif message.type == WSMsgType.BINARY:
                    await destination.send_bytes(message.data)

        tasks = [asyncio.create_task(pump(socket, upstream)), asyncio.create_task(pump(upstream, socket))]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await socket.close()
        return socket


def proxy_app(gateway_port, comfy_port):
    async def serve(request):
        path = request.path
        origin = request.headers.get('Origin')
        if origin and urlsplit(origin).netloc != request.host and request.headers.get('Sec-Fetch-Site') != 'same-origin':
            raise web.HTTPForbidden()
        if request.headers.get('Sec-Fetch-Site') == 'cross-site' and (path.startswith(('/api/', '/comfy/')) or request.method != 'GET'):
            raise web.HTTPForbidden()
        mobile_assets = {'/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg'}
        if path == '/mobile/' or path in mobile_assets or path.startswith(('/api/', '/media/', '/thumb/', '/video/', '/upload/')):
            upstream_path = '/' if path == '/mobile/' else request.rel_url.raw_path_qs
            port = gateway_port
        elif path.startswith('/comfy/'):
            upstream_path = request.rel_url.raw_path_qs[len('/comfy'):]
            port = comfy_port
        else:
            relative = path.lstrip('/') or 'sd-dashboard.full.html'
            file = (PANEL_ROOT / relative).resolve()
            if (not file.is_relative_to(PANEL_ROOT) or any(part.startswith('.') for part in Path(relative).parts)
                    or file.suffix not in {'.html', '.js', '.css', '.json', '.png', '.svg', '.ico', '.jpg', '.webp'}
                    or not file.is_file() or request.method != 'GET'):
                raise web.HTTPNotFound()
            if relative in {'sw.js', 'js/void-pwa.js'}:
                return web.Response(text='', content_type='application/javascript')
            if file.suffix in {'.js', '.html'}:
                return web.Response(text=browser_source(file.read_text(encoding='utf-8-sig')),
                                    content_type=mimetypes.guess_type(file.name)[0], headers={'Cache-Control': 'no-store'})
            return web.FileResponse(file)

        target = f'http://127.0.0.1:{port}{upstream_path}'
        session = request.app['client']
        if request.headers.get('Upgrade', '').lower() == 'websocket':
            return await relay_socket(request, session, target)
        headers = {key: request.headers[key] for key in ('Content-Type', 'Range') if key in request.headers}
        if origin and port == gateway_port:
            headers['Origin'] = 'http://127.0.0.1:8080' if path == '/api/jobs' else f'http://127.0.0.1:{port}'
        async with session.request(request.method, target, headers=headers,
                                   data=request.content if request.can_read_body else None,
                                   allow_redirects=False) as response:
            outgoing = {key: response.headers[key] for key in
                        ('Content-Type', 'Content-Range', 'Content-Disposition', 'Accept-Ranges') if key in response.headers}
            outgoing['Cache-Control'] = 'no-store'
            if path == '/app.js':
                script = (await response.text()).replace("navigator.serviceWorker.register('/sw.js').catch(()=>{});", "void 0;")
                return web.Response(text=script, status=response.status, headers=outgoing)
            stream = web.StreamResponse(status=response.status, headers=outgoing)
            await stream.prepare(request)
            async for chunk in response.content.iter_chunked(65536):
                await stream.write(chunk)
            return stream

    async def client_context(app):
        async with ClientSession() as session:
            app['client'] = session
            yield

    app = web.Application()
    app.cleanup_ctx.append(client_context)
    app.router.add_route('*', '/{path:.*}', serve)
    return app


async def run(args):
    drive = args.drive.resolve()
    drive.mkdir(parents=True, exist_ok=True)
    data = args.runtime.resolve()
    data.mkdir(parents=True, exist_ok=True)
    database, snapshot = data / 'mobile.sqlite3', drive / 'library.sqlite3'
    if snapshot.is_file() and not database.exists():
        shutil.copyfile(snapshot, database)
    (drive / 'trash').mkdir(exist_ok=True)
    trash = data / 'trash'
    if not trash.exists():
        trash.symlink_to(drive / 'trash', target_is_directory=True)
    gateway = Gateway(data_dir=data, output=drive / 'output', input_dir=args.comfy / 'input',
                      comfy='http://127.0.0.1:8188', keep_awake=False)

    async def snapshots():
        while True:
            await asyncio.sleep(15)
            try:
                await asyncio.to_thread(backup_database, database, snapshot)
            except (OSError, sqlite3.Error) as error:
                print(f'Drive backup failed: {error}', flush=True)

    runners = [web.AppRunner(create_app(gateway)), web.AppRunner(proxy_app(8090, 8188))]
    for runner, port in zip(runners, (8090, args.port)):
        await runner.setup()
        await web.TCPSite(runner, '127.0.0.1', port).start()
    task = asyncio.create_task(snapshots())
    try:
        await asyncio.Event().wait()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        for runner in reversed(runners):
            await runner.cleanup()
        backup_database(database, snapshot)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--drive', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--comfy', type=Path, required=True)
    parser.add_argument('--port', type=int, default=7860)
    try:
        asyncio.run(run(parser.parse_args()))
    except KeyboardInterrupt:
        pass
