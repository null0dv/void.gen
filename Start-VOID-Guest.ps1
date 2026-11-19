param([Parameter(Mandatory=$true)][string]$Login, [ValidateRange(1,9)][int]$Slot=1)
$ErrorActionPreference='Stop'
if ($Login -notmatch '^[^\s@]+@[^\s@]+$') { throw '請填寫訪客的 Tailscale 登入 Email。' }
$root=Split-Path -Parent $PSScriptRoot
$tailscale=Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$python=Join-Path $root 'ComfyUI_windows_portable\python_embeded\python.exe'
$state=(& $tailscale status --json | ConvertFrom-Json)
if ($state.BackendState -ne 'Running') { throw 'Tailscale 尚未連線。' }
$hostname=$state.Self.DNSName.TrimEnd('.')
$guest="guest$Slot"
$port=8090+$Slot
$httpsPort=8442+$Slot
$proxy="http://127.0.0.1:$port"
$authority="${hostname}:$httpsPort"
$owner=$state.User.PSObject.Properties[[string]$state.Self.UserID].Value.LoginName
if (!$hostname -or !$owner -or $owner -eq $Login) { throw '請使用不同於主帳號的 Tailscale 登入 Email。' }
$current=Invoke-RestMethod 'http://127.0.0.1:8090/api/status' -TimeoutSec 8
if (!$current.isolatedGuests) { throw '請先重新啟動 VOID 主服務，以啟用圖庫隔離。' }
$serveJson=(& $tailscale serve status --json | Out-String)
if ($LASTEXITCODE -ne 0) { throw '無法檢查 Tailscale Serve 設定。' }
$serve=$serveJson | ConvertFrom-Json
if ($serve.AllowFunnel -and ($serve.AllowFunnel.PSObject.Properties | Where-Object {$_.Value -eq $true})) { throw '目前已啟用 Funnel，請先停用再設定私人訪客。' }
foreach ($entry in $serve.Web.PSObject.Properties) {
    if ($entry.Name -like "*:$httpsPort") {
        foreach ($handler in $entry.Value.Handlers.PSObject.Properties) {
            if ($handler.Name -ne '/' -or $handler.Value.Proxy -ne $proxy) { throw "HTTPS $httpsPort is already in use." }
        }
    }
}
$data=Join-Path $root "void-guest-data\$guest"
$config=Join-Path $data 'remote.json'
$listening=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listening) {
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listening.OwningProcess)
    if ($process.CommandLine -notmatch "void_mobile\.py.*--port $port --guest $guest(?:\s|$)") { throw "Port $port is already in use." }
}
if (Test-Path -LiteralPath $config) {
    $previous=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
    if ($previous.owner -ne $Login) { throw "$guest is already assigned to another account." }
} elseif (Test-Path -LiteralPath $data) {
    throw "$guest has an existing data directory without an owner."
}
New-Item -ItemType Directory -Force -Path $data | Out-Null
@{hostname=$hostname;authority=$authority;owner=$Login;url="https://$authority"} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding utf8
if (!$listening) {
    Start-Process -FilePath $python -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'void_mobile.py') + '"'),'--port',"$port",'--guest',$guest) -RedirectStandardOutput (Join-Path $data 'gateway.log') -RedirectStandardError (Join-Path $data 'gateway-error.log')
    for ($i=0; $i -lt 20; $i++) {
        $listening=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listening) { break }
        Start-Sleep -Milliseconds 500
    }
    if (!$listening) { throw '訪客服務沒有成功啟動。' }
}
& $tailscale serve --bg "--https=$httpsPort" $proxy
if ($LASTEXITCODE -ne 0) { throw '無法啟用訪客網址。' }
Write-Output "https://$authority"
