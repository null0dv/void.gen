param([switch]$SmokeTest, [string]$ComfyRoot = (Join-Path $PSScriptRoot '../ComfyUI_windows_portable'))
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$ComfyRoot = (Resolve-Path -LiteralPath $ComfyRoot).Path
$python = Join-Path $ComfyRoot 'python_embeded/python.exe'
$origin = 'http://127.0.0.1:8081'
function Start-ServiceProcess($name, $dir, $arguments) {
    Start-Process -FilePath $python -WorkingDirectory $dir -WindowStyle Hidden -ArgumentList $arguments -PassThru -RedirectStandardOutput "$root/$name.log" -RedirectStandardError "$root/$name-error.log"
}
function Test-Endpoint($url) {
    try { $null = Invoke-WebRequest $url -TimeoutSec 2 -UseBasicParsing; return $true } catch { return $false }
}
foreach ($port in 8081,8091,8190) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop the previous instance before starting."
    }
}
New-Item -ItemType Directory -Force "$root/input","$root/output","$root/user","$root/temp" | Out-Null
$processes = @()
try {
    $processes += Start-ServiceProcess 'comfy' $ComfyRoot @('-s','ComfyUI/main.py','--disable-auto-launch','--disable-assets','--database-url','sqlite:///:memory:','--listen','127.0.0.1','--port','8190','--enable-cors-header',$origin,'--lowvram','--fp8_e4m3fn-unet','--preview-method','taesd','--input-directory',('"'+"$root/input"+'"'),'--output-directory',('"'+"$root/output"+'"'),'--user-directory',('"'+"$root/user"+'"'),'--temp-directory',('"'+"$root/temp"+'"'),'--disable-all-custom-nodes','--whitelist-custom-nodes','ComfyUI-WD14-Tagger')
    $processes += Start-ServiceProcess 'gallery' $root @('gallery.py')
    $processes += Start-ServiceProcess 'panel' $root @('-m','http.server','8081','--bind','127.0.0.1')
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($processes | Where-Object HasExited) { throw 'A service exited. Check the logs.' }
        if ((Test-Endpoint "$origin/sd-dashboard.full.html") -and (Test-Endpoint 'http://127.0.0.1:8091/api/status') -and (Test-Endpoint 'http://127.0.0.1:8190/system_stats')) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (!$ready) { throw 'Startup timed out. Check the logs.' }
    if ($SmokeTest) { Write-Host "Panel, gallery and ComfyUI ready"; return }
    Start-Process "$origin/sd-dashboard.full.html"
    Read-Host 'Press Enter to stop VOID 3050 Anime'
} finally {
    $processes | Where-Object { !$_.HasExited } | Stop-Process
}
