# ================================================================
#  SD 生成面板 - ComfyUI 自動安裝腳本
#  安裝後即可使用：https://null0dv.github.io/void.gen/sd-dashboard.html
# ================================================================

$ErrorActionPreference = "Stop"
$InstallDir = "C:\ComfyUI_portable"
$PanelUrl   = "https://null0dv.github.io/void.gen/sd-dashboard.html"

function Write-Step($n, $msg) {
    Write-Host "`n[$n] $msg" -ForegroundColor Cyan
}
function Write-Ok($msg)  { Write-Host "    [OK] $msg"    -ForegroundColor Green  }
function Write-Warn($msg){ Write-Host "    [!]  $msg"    -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "    [X]  $msg"    -ForegroundColor Red    }
function Write-Info($msg){ Write-Host "         $msg"    -ForegroundColor Gray   }

Clear-Host
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "  SD 生成面板 — ComfyUI 自動安裝程式"                             -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  安裝路徑：$InstallDir"
Write-Host "  面板網址：$PanelUrl"
Write-Host ""

# ── 確認繼續 ──────────────────────────────────────────────────
$confirm = Read-Host "開始安裝？(Y/N)"
if ($confirm -notin @("Y","y","yes","YES")) { Write-Host "已取消。"; exit 0 }

# ── 步驟 1：檢查已安裝 ────────────────────────────────────────
Write-Step "1/5" "檢查現有安裝..."
if (Test-Path "$InstallDir\ComfyUI\main.py") {
    Write-Warn "偵測到已安裝的 ComfyUI：$InstallDir"
    $recfg = Read-Host "    跳過下載，只重新設定啟動參數？(Y/N)"
    if ($recfg -in @("Y","y")) { goto Configure }
}

# ── 步驟 2：安裝 7-Zip ────────────────────────────────────────
Write-Step "2/5" "檢查 7-Zip..."
$7z = "C:\Program Files\7-Zip\7z.exe"
if (-not (Test-Path $7z)) {
    Write-Info "安裝 7-Zip（用於解壓縮）..."
    winget install 7zip.7zip --accept-package-agreements --accept-source-agreements --silent | Out-Null
    if (-not (Test-Path $7z)) {
        Write-Err "7-Zip 安裝失敗，請手動安裝：https://7-zip.org"
        exit 1
    }
}
Write-Ok "7-Zip 就緒"

# ── 步驟 3：取得最新 ComfyUI 下載連結 ────────────────────────
Write-Step "3/5" "取得最新 ComfyUI 版本..."
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/comfyanonymous/ComfyUI/releases/latest"
    $version = $release.tag_name
    $asset   = $release.assets | Where-Object {
        $_.name -like "*windows*nvidia*" -or $_.name -like "*windows_portable*"
    } | Select-Object -First 1
} catch {
    Write-Err "無法取得版本資訊（請檢查網路連線）"
    exit 1
}

if (-not $asset) {
    Write-Err "找不到 Windows 版本，請手動下載："
    Write-Info "https://github.com/comfyanonymous/ComfyUI/releases/latest"
    Start-Process "https://github.com/comfyanonymous/ComfyUI/releases/latest"
    exit 1
}

$sizeMB = [math]::Round($asset.size / 1MB)
Write-Ok "找到版本：$version"
Write-Info "檔案：$($asset.name)（約 $sizeMB MB）"

# ── 步驟 4：下載並解壓縮 ─────────────────────────────────────
Write-Step "4/5" "下載 ComfyUI（約 $sizeMB MB，視網速需 2–10 分鐘）..."
$downloadPath = "$env:TEMP\comfyui_portable.7z"

$ProgressPreference = "SilentlyContinue"
try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloadPath -UseBasicParsing
    Write-Ok "下載完成"
} catch {
    Write-Err "下載失敗：$($_.Exception.Message)"
    exit 1
}

Write-Info "解壓縮中（請稍候）..."
if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
}
& $7z x $downloadPath -o"C:\" -y 2>&1 | Out-Null

# 尋找解壓出來的資料夾並重新命名
$extracted = Get-ChildItem "C:\" -Directory | Where-Object {
    $_.Name -like "ComfyUI*portable*" -and $_.FullName -ne $InstallDir
} | Select-Object -First 1

if ($extracted) {
    Rename-Item $extracted.FullName $InstallDir -Force
}

if (-not (Test-Path "$InstallDir\ComfyUI\main.py")) {
    Write-Err "解壓縮失敗，請手動解壓縮到 $InstallDir"
    exit 1
}
Write-Ok "解壓縮完成：$InstallDir"

# ── 步驟 5：設定啟動腳本 ─────────────────────────────────────
:Configure
Write-Step "5/5" "設定 ComfyUI 啟動參數..."

$batContent = "@echo off`r`ncd /d `"%~dp0`"`r`necho ================================================`r`necho  ComfyUI 後端啟動中，請勿關閉此視窗`r`necho  面板網址：$PanelUrl`r`necho ================================================`r`necho.`r`npython_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --lowvram --enable-cors-header *`r`npause`r`n"
Set-Content -Path "$InstallDir\run_sd_panel.bat" -Value $batContent -Encoding ascii

# 建立桌面捷徑
try {
    $WshShell  = New-Object -ComObject WScript.Shell
    $Shortcut  = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\ComfyUI 後端.lnk")
    $Shortcut.TargetPath     = "$InstallDir\run_sd_panel.bat"
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description    = "啟動 SD 生成面板後端"
    $Shortcut.Save()
    Write-Ok "桌面捷徑已建立：ComfyUI 後端"
} catch {
    Write-Warn "桌面捷徑建立失敗，請直接執行：$InstallDir\run_sd_panel.bat"
}

# 清理暫存
Remove-Item $downloadPath -ErrorAction SilentlyContinue

# ── 完成畫面 ──────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  安裝完成！"                                                      -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  接下來需要手動完成 2 個步驟：" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ① 下載 AI 模型（至少一個）：" -ForegroundColor Yellow
Write-Host "     檔案放到：$InstallDir\ComfyUI\models\checkpoints\" -ForegroundColor White
Write-Host ""
Write-Host "     推薦（7GB）：Stable Diffusion XL Base 1.0" -ForegroundColor Gray
Write-Host "     https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0" -ForegroundColor Gray
Write-Host "     → 點 Files → 下載 sd_xl_base_1.0.safetensors" -ForegroundColor Gray
Write-Host ""
Write-Host "     輕量（2GB）：DreamShaper XL" -ForegroundColor Gray
Write-Host "     https://civitai.com/models/112902" -ForegroundColor Gray
Write-Host ""
Write-Host "  ② 解除 Chrome 瀏覽器限制（只需做一次）：" -ForegroundColor Yellow
Write-Host "     開啟面板網址後 → 網址列🔒 → 網站設定 → 不安全的內容 → 允許" -ForegroundColor White
Write-Host ""
Write-Host "  完成上述步驟後的使用流程：" -ForegroundColor Cyan
Write-Host "     1. 雙擊桌面「ComfyUI 後端」" -ForegroundColor White
Write-Host "     2. 等出現 http://127.0.0.1:8188 字樣" -ForegroundColor White
Write-Host "     3. 開啟 $PanelUrl" -ForegroundColor White
Write-Host "     4. 點「🔌 檢查連線」→ 綠色即可使用" -ForegroundColor White
Write-Host ""

# 開啟模型下載頁面
$openLinks = Read-Host "是否開啟模型下載頁面？(Y/N)"
if ($openLinks -in @("Y","y")) {
    Start-Process "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/tree/main"
    Start-Sleep -Milliseconds 500
    Start-Process $PanelUrl
}

Write-Host ""
Write-Host "  安裝完成。按 Enter 關閉..." -ForegroundColor Gray
Read-Host | Out-Null
