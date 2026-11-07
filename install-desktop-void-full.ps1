$Root = $PSScriptRoot
$Desk = [Environment]::GetFolderPath('Desktop')
$Cmd  = Join-Path $Root 'VOID-GEN-FULL.cmd'
$Lnk  = Join-Path $Desk 'VOID FULL V4.lnk'
$Ico  = Join-Path $Root 'icon-full.ico'
if (-not (Test-Path -LiteralPath $Ico)) { $Ico = Join-Path $Root 'icon-gen.ico' }
if (-not (Test-Path -LiteralPath $Ico)) { $Ico = Join-Path $Root 'icon-192.png' }

if (-not (Test-Path $Cmd)) { Write-Error "Missing $Cmd"; exit 1 }

$Wsh = New-Object -ComObject WScript.Shell
$S   = $Wsh.CreateShortcut($Lnk)
$S.TargetPath = $Cmd
$S.WorkingDirectory = $Root
$S.WindowStyle = 1
$S.Description = 'VOID FULL V4 — TXT/IMG2IMG/IMG2TXT — localhost:8080'
if (Test-Path $Ico) { $S.IconLocation = "$Ico,0" }
$S.Save()

Write-Host "Desktop shortcut: $Lnk"
Write-Host "Target: $Cmd"