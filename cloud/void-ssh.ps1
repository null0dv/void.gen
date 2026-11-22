# Run one shell command on the Colab VM over SSH (works even when the Jupyter kernel is dead). ASCII only.
# Usage: .\void-ssh.ps1 "tail -n 20 /content/void-motion.log"
param([Parameter(Mandatory)][string]$Cmd, [string]$Name = 'void')
$colab = "$env:USERPROFILE\.local\bin\colab.exe"
$key = "$env:USERPROFILE\.ssh\void_colab_ed25519"
$proxy = '"' + $colab + '" ssh -s ' + $Name + ' --proxy-mode -i "' + $key + '"'
ssh -i $key -o "ProxyCommand=$proxy" -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=60 "root@colab-$Name" $Cmd
