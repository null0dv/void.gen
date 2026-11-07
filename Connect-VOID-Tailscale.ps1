$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (!(Test-Path $exe)) {
 $installer=Join-Path $root 'downloads\tailscale-setup.exe'
 if (!(Test-Path $installer)) { throw 'Tailscale installer is missing.' }
 $sig=Get-AuthenticodeSignature $installer
 if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Tailscale') { throw 'Installer signature is invalid.' }
 Write-Host 'Approve the Windows administrator prompt to install Tailscale.'
 Start-Process $installer -Verb RunAs -Wait -ArgumentList @('/quiet','/norestart')
}
if (!(Test-Path $exe)) { throw 'Tailscale installation did not finish.' }
$state=(& $exe status --json | ConvertFrom-Json)
if ($state.BackendState -ne 'Running') {
 Write-Host 'Sign in using the same account you will use on your phone.'
 & $exe login
 if ($LASTEXITCODE -ne 0) { throw 'Please complete Tailscale login, then run this file again.' }
 $state=(& $exe status --json | ConvertFrom-Json)
}
if ($state.BackendState -ne 'Running') { throw 'Tailscale is not connected.' }
$hostName=$state.Self.DNSName.TrimEnd('.')
$owner=$state.User.PSObject.Properties[[string]$state.Self.UserID].Value.LoginName
if (!$owner -or !$hostName) { throw 'Could not identify the Tailscale owner or device DNS name.' }
$existing=(& $exe serve status --json | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing Tailscale Serve configuration.' }
$cfg=$existing | ConvertFrom-Json
if ($cfg.AllowFunnel -and ($cfg.AllowFunnel.PSObject.Properties | Where-Object {$_.Value -eq $true})) { throw 'Funnel is enabled. Disable it before connecting this private app.' }
foreach ($webEntry in $cfg.Web.PSObject.Properties) {
 if ($webEntry.Name -like '*:443') {
  foreach ($handler in $webEntry.Value.Handlers.PSObject.Properties) {
   if ($handler.Name -ne '/' -or $handler.Value.Proxy -ne 'http://127.0.0.1:8090') { throw 'Port 443 already serves another app. Existing settings were preserved.' }
  }
 }
}
New-Item -ItemType Directory -Force (Join-Path $root 'void-data') | Out-Null
@{hostname=$hostName;owner=$owner;url="https://$hostName"} | ConvertTo-Json | Set-Content (Join-Path $root 'void-data\remote.json') -Encoding utf8
& $exe serve --bg --https=443 http://127.0.0.1:8090
if ($LASTEXITCODE -ne 0) { throw 'Complete the HTTPS enablement link shown above, then run this file again.' }
Write-Host "Phone URL: https://$hostName"
Write-Host 'Install Tailscale on your phone, sign in to the same account, and open this URL.'
