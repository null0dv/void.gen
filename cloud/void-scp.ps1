# Copy files from the Colab VM over SSH/scp (works even when `colab exec` cannot connect). ASCII only.
# Usage: .\void-scp.ps1 "/content/VOID-Colab/output/VOID-Motion/*" "C:\dest\folder"
param([Parameter(Mandatory)][string]$Remote, [Parameter(Mandatory)][string]$Dest, [string]$Name = 'void')
$colab = "$env:USERPROFILE\.local\bin\colab.exe"
$key = "$env:USERPROFILE\.ssh\void_colab_ed25519"
$proxy = '"' + $colab + '" ssh -s ' + $Name + ' --proxy-mode -i "' + $key + '"'
New-Item -ItemType Directory -Force $Dest | Out-Null
scp -i $key -o "ProxyCommand=$proxy" -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL "root@colab-${Name}:$Remote" $Dest
if ($LASTEXITCODE -eq 0) { Get-ChildItem $Dest | Select-Object Name, Length | Format-Table -AutoSize; Write-Host 'SCP_OK' } else { Write-Host 'SCP_FAILED' }
