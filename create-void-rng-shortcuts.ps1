$Root = 'C:\Users\User\Desktop\VS'
$Rng  = Join-Path $Root 'void-rng'
$Desk = [Environment]::GetFolderPath('Desktop')
$Ico  = Join-Path $Root 'icon-rng.ico'
if (-not (Test-Path -LiteralPath $Ico)) { $Ico = Join-Path $Root 'icon-192.png' }
$Wsh  = New-Object -ComObject WScript.Shell

function New-DeskShortcut {
    param(
        [string]$Name,
        [string]$Target,
        [string]$WorkDir,
        [string]$Desc
    )
    if (-not (Test-Path -LiteralPath $Target)) {
        Write-Error "Missing target: $Target"
        return
    }
    $Lnk = Join-Path $Desk $Name
    $S = $Wsh.CreateShortcut($Lnk)
    $S.TargetPath = $Target
    $S.WorkingDirectory = $WorkDir
    $S.WindowStyle = 1
    $S.Description = $Desc
    if (Test-Path -LiteralPath $Ico) { $S.IconLocation = "$Ico,0" }
    $S.Save()
    Write-Host "OK: $Lnk"
    Write-Host "  -> $($S.TargetPath)"
}

New-DeskShortcut -Name 'VOID.RNG.lnk' `
    -Target (Join-Path $Rng 'VOID-RNG.cmd') `
    -WorkDir $Rng `
    -Desc 'VOID.RNG V3 — http://127.0.0.1:8787/'

Write-Host 'Done.'