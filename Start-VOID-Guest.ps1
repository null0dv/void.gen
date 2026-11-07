param([Parameter(Mandatory=$true)][string]$Login)
$ErrorActionPreference='Stop'
if ($Login -notmatch '^[^\s@]+@[^\s@]+$') { throw '請填寫訪客的 Tailscale 登入 Email。' }
$root=Split-Path -Parent $PSScriptRoot
$tailscale=Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$python=Join-Path $root 'ComfyUI_windows_portable\python_embeded\python.exe'
$state=(& $tailscale status --json | ConvertFrom-Json)
if ($state.BackendState -ne 'Running') { throw 'Tailscale 尚未連線。' }
$hostname=$state.Self.DNSName.TrimEnd('.')
$authority=$hostname+':8443'
$owner=$state.User.PSObject.Properties[[string]$state.Self.UserID].Value.LoginName
if (!$hostname -or !$owner -or $owner -eq $Login) { throw '請使用不同於主帳號的 Tailscale 登入 Email。' }
$current=Invoke-RestMethod 'http://127.0.0.1:8090/api/status' -TimeoutSec 8
if (!$current.isolatedGuests) { throw '請先重新啟動 VOID 主服務，以啟用圖庫隔離。' }
$serveJson=(& $tailscale serve status --json | Out-String)
if ($LASTEXITCODE -ne 0) { throw '無法檢查 Tailscale Serve 設定。' }
$serve=$serveJson | ConvertFrom-Json
if ($serve.AllowFunnel -and ($serve.AllowFunnel.PSObject.Properties | Where-Object {$_.Value -eq $true})) { throw '目前已啟用 Funnel，請先停用再設定私人訪客。' }
foreach ($entry in $serve.Web.PSObject.Properties) {
    if ($entry.Name -like '*:8443') {
        foreach ($handler in $entry.Value.Handlers.PSObject.Properties) {
            if ($handler.Name -ne '/' -or $handler.Value.Proxy -ne 'http://127.0.0.1:8091') { throw '8443 已有其他服務。' }
        }
    }
}
$data=Join-Path $root 'void-guest-data\guest1'
$config=Join-Path $data 'remote.json'
$listening=Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listening) {
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listening.OwningProcess)
    if ($process.CommandLine -notmatch 'void_mobile\.py.*--port 8091 --guest guest1') { throw '8091 已有其他服務。' }
}
if (Test-Path -LiteralPath $config) {
    $previous=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
    if ($previous.owner -ne $Login) { throw 'guest1 已綁定另一個帳號。不能讓新帳號繼承其圖庫。' }
}
New-Item -ItemType Directory -Force -Path $data | Out-Null
@{hostname=$hostname;authority=$authority;owner=$Login;url="https://$authority"} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding utf8
if (!$listening) {
    Start-Process -FilePath $python -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'void_mobile.py') + '"'),'--port','8091','--guest','guest1') -RedirectStandardOutput (Join-Path $data 'gateway.log') -RedirectStandardError (Join-Path $data 'gateway-error.log')
    for ($i=0; $i -lt 20; $i++) {
        $listening=Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listening) { break }
        Start-Sleep -Milliseconds 500
    }
    if (!$listening) { throw '訪客服務沒有成功啟動。' }
}
& $tailscale serve --bg --https=8443 http://127.0.0.1:8091
if ($LASTEXITCODE -ne 0) { throw '無法啟用訪客網址。' }
Write-Output "https://$authority"
