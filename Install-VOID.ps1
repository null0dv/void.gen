# VOID GEN + Pocket one-click installer (Windows, NVIDIA).
# Layout it builds (the folder that holds void.gen):
#   VOID\
#     void.gen\                     this repository
#     ComfyUI_windows_portable\     downloaded here if missing
#     void-data\                    Pocket gallery database (created on first start)
# Usage (from void.gen):  .\Install-VOID.cmd   or
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-VOID.ps1 -Engines sdxl,klein
# Re-running is safe: finished downloads are kept, interrupted ones resume.
# This file is ASCII only so Windows PowerShell 5.1 reads it correctly.
param(
    [string]$Engines = 'sdxl',
    [switch]$SkipModels,
    [switch]$NoShortcut,
    [switch]$NoStart,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$app = $PSScriptRoot
$root = Split-Path -Parent $app
$portable = Join-Path $root 'ComfyUI_windows_portable'
$python = Join-Path $portable 'python_embeded\python.exe'

function Step($n, $text) { Write-Host ''; Write-Host "[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }

Write-Host '================================================================' -ForegroundColor Magenta
Write-Host '  VOID GEN + Pocket installer' -ForegroundColor Magenta
Write-Host '================================================================' -ForegroundColor Magenta
Write-Host "  Install folder : $root"
Write-Host "  Engines        : $Engines   (list them: python tools\void_setup.py --list)"
Write-Host ''

# 1. Machine check
Step '1/6' 'Checking this PC'
if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'Windows 10 or 11 is required.' }
$gpu = $null
try { $gpu = (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null | Select-Object -First 1) } catch { }
if ($gpu) { Ok "NVIDIA GPU: $gpu" } else { Warn 'No NVIDIA GPU found (nvidia-smi). VOID needs an NVIDIA card with 8 GB+ VRAM; 12 GB+ recommended.' }
$drive = Get-PSDrive -Name ($root.Substring(0, 1))
$freeGB = [math]::Round($drive.Free / 1GB)
Ok "Free space on $($drive.Name): $freeGB GB (ComfyUI ~6 GB, SDXL ~7 GB, all engines ~85 GB)"
if ($freeGB -lt 20) { Warn 'Less than 20 GB free. Free up space or install somewhere else.' }
if (-not $Yes) {
    $answer = Read-Host 'Start installing? (Y/N)'
    if ($answer -notmatch '^(y|yes)$') { Write-Host 'Cancelled.'; exit 0 }
}

# 2. ComfyUI Portable
Step '2/6' 'ComfyUI Portable'
if (Test-Path $python) {
    Ok "Found $portable (kept as is)"
} else {
    $release = Invoke-RestMethod 'https://api.github.com/repos/Comfy-Org/ComfyUI/releases/latest' -Headers @{ 'User-Agent' = 'void-installer' }
    $asset = $release.assets | Where-Object { $_.name -eq 'ComfyUI_windows_portable_nvidia.7z' } | Select-Object -First 1
    if (-not $asset) { throw 'Could not find ComfyUI_windows_portable_nvidia.7z in the latest ComfyUI release.' }
    $archive = Join-Path $root $asset.name
    Ok "ComfyUI $($release.tag_name), $([math]::Round($asset.size / 1MB)) MB"
    if (-not (Test-Path $archive) -or (Get-Item $archive).Length -ne $asset.size) {
        Write-Host '    downloading (resumable; 5-20 minutes)...'
        & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $archive $asset.browser_download_url
        if ($LASTEXITCODE -ne 0 -or (Get-Item $archive).Length -ne $asset.size) { throw 'ComfyUI download failed. Run the installer again to resume.' }
    }
    Write-Host '    extracting...'
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    & $tar -xf $archive -C $root
    if (-not (Test-Path $python)) {
        $sevenZip = 'C:\Program Files\7-Zip\7z.exe'
        if (-not (Test-Path $sevenZip)) { throw "Windows tar could not unpack $archive. Install 7-Zip (https://7-zip.org) and run again." }
        & $sevenZip x $archive "-o$root" -y | Out-Null
    }
    if (-not (Test-Path $python)) { throw "Extraction failed. Unpack $archive into $root by hand, then run again." }
    Remove-Item $archive -Force
    Ok "Installed $portable"
}

# 3-5. Python packages, custom nodes, models (verified with SHA-256)
Step '3/6' 'Gateway packages, custom nodes and models'
$setup = @('-s', (Join-Path $app 'tools\void_setup.py'), '--profiles', $Engines, '--root', $root)
if ($SkipModels) { $setup += '--skip-models' }
& $python @setup
if ($LASTEXITCODE -ne 0) { throw 'Setup stopped. Read the message above, then run the installer again (downloads resume).' }

Step '4/6' 'Checking the install'
& $python -s (Join-Path $app 'tools\void_setup.py') --check --profiles $Engines --root $root
if ($LASTEXITCODE -ne 0 -and -not $SkipModels) { throw 'Some files are still missing (see above). Run the installer again.' }
& $python -s -c 'import aiohttp, PIL'
if ($LASTEXITCODE -ne 0) { throw 'The gateway packages (aiohttp, Pillow) do not import.' }
Ok 'gateway packages import'

# 5. Shortcut
Step '5/6' 'Desktop shortcut'
if ($NoShortcut) { Ok 'skipped' } else {
    try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'create-void-full-shortcut.ps1'); Ok 'VOID GEN FULL shortcut on the desktop' }
    catch { Warn "Shortcut not created: $($_.Exception.Message). Start with VOID-GEN-FULL.cmd instead." }
}

# 6. Start
Step '6/6' 'Starting VOID'
if ($NoStart) { Ok 'skipped. Start later with VOID-GEN-FULL.cmd' } else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'Start-VOID-Full.ps1')
    if ($LASTEXITCODE -eq 0) { Ok 'Desktop: http://127.0.0.1:8080/sd-dashboard.full.html   Pocket: http://127.0.0.1:8090/' }
    else { Warn "Startup did not finish. Logs: $root\comfyui-error.log, void-mobile-error.log" }
}
Write-Host ''
Write-Host 'Done. Add engines later with:  .\Install-VOID.cmd -Engines klein,wan' -ForegroundColor Green
Write-Host 'Phone access (Tailscale) and backups: docs\install-plan.md' -ForegroundColor Green
