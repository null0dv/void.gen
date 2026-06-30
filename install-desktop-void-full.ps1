$Root = 'C:\Users\User\Desktop\VS'
$Desk = [Environment]::GetFolderPath('Desktop')
$Cmd  = Join-Path $Root 'VOID-GEN-FULL.cmd'
$Lnk  = Join-Path $Desk 'VOID.GEN FULL.lnk'
$Ico  = Join-Path $Root 'icon-192.png'

if (-not (Test-Path $Cmd)) { Write-Error "Missing $Cmd"; exit 1 }

foreach ($name in @('VOID GEN FULL.bat', 'VOID GEN FULL.lnk', 'VOID.GEN FULL.bat')) {
    $p = Join-Path $Desk $name
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Force }
}

$Wsh = New-Object -ComObject WScript.Shell
$S   = $Wsh.CreateShortcut($Lnk)
$S.TargetPath = $Cmd
$S.WorkingDirectory = $Root
$S.WindowStyle = 1
$S.Description = 'VOID.GEN Full V3 — http://localhost:8080/sd-dashboard.full.html'
if (Test-Path $Ico) { $S.IconLocation = "$Ico,0" }
$S.Save()

Write-Host "Desktop shortcut: $Lnk"
Write-Host "Target: $Cmd"