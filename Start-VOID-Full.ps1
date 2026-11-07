param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'ComfyUI_windows_portable'
$python = Join-Path $backend 'python_embeded\python.exe'
$panel = $PSScriptRoot
if (!(Test-Path $python)) { throw 'ComfyUI Python is missing.' }
function Test-Service($url) {
    try { $null = Invoke-WebRequest $url -TimeoutSec 2 -UseBasicParsing; return $true } catch { return $false }
}
if (!(Test-Service 'http://127.0.0.1:8188/system_stats')) {
    Start-Process -FilePath $python -WorkingDirectory $backend -WindowStyle Hidden -ArgumentList @('-s', 'ComfyUI\main.py', '--windows-standalone-build', '--listen', '127.0.0.1', '--enable-cors-header', 'http://127.0.0.1:8080') -RedirectStandardOutput (Join-Path $root 'comfyui.log') -RedirectStandardError (Join-Path $root 'comfyui-error.log')
}
if (!(Test-Service 'http://127.0.0.1:8080/sd-dashboard.full.html')) {
    Start-Process -FilePath $python -WorkingDirectory $panel -WindowStyle Hidden -ArgumentList @('-m', 'http.server', '8080', '--bind', '127.0.0.1') -RedirectStandardOutput (Join-Path $root 'void-panel.log') -RedirectStandardError (Join-Path $root 'void-panel-error.log')
}
if (!(Test-Service 'http://127.0.0.1:8090/api/status')) {
    Start-Process -FilePath $python -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @(('"'+(Join-Path $PSScriptRoot 'void_mobile.py')+'"')) -RedirectStandardOutput (Join-Path $root 'void-mobile.log') -RedirectStandardError (Join-Path $root 'void-mobile-error.log')
}
Write-Host 'Waiting for ComfyUI...'
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if ((Test-Service 'http://127.0.0.1:8188/system_stats') -and (Test-Service 'http://127.0.0.1:8080/sd-dashboard.full.html') -and (Test-Service 'http://127.0.0.1:8090/api/status')) {
        if (!$NoOpen) { Start-Process 'http://127.0.0.1:8080/sd-dashboard.full.html' }
        exit 0
    }
    Start-Sleep -Seconds 2
}
throw 'Startup timed out. Check comfyui-error.log.'
