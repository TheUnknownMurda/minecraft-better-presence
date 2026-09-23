# Autorise Minecraft Bedrock (application UWP, donc sandboxee) a ouvrir une
# connexion vers 127.0.0.1. Sans cela, /connect localhost echoue en silence.
#
# A n'executer QUE si /connect <ton-IP-LAN> ne fonctionne pas : passer par
# l'adresse LAN contourne entierement la restriction, sans droits admin.
#
# Lancement : clic droit > Executer avec PowerShell (en administrateur)

$packages = @(
    @{ Name = 'Minecraft Bedrock';  Id = 'Microsoft.MinecraftUWP_8wekyb3d8bbwe' },
    @{ Name = 'Minecraft Preview';  Id = 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe' }
)

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Ce script doit etre lance en administrateur." -ForegroundColor Red
    exit 1
}

foreach ($pkg in $packages) {
    Write-Host "Exemption loopback pour $($pkg.Name)..." -NoNewline
    $out = & CheckNetIsolation.exe LoopbackExempt -a "-n=$($pkg.Id)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " OK" -ForegroundColor Green
    } else {
        # Un paquet non installe (ex. Preview) fait echouer la commande : normal.
        Write-Host " ignore ($out)" -ForegroundColor DarkGray
    }
}

Write-Host "`nExemptions actuellement actives :" -ForegroundColor Cyan
& CheckNetIsolation.exe LoopbackExempt -s | Select-String -Pattern 'minecraft' -SimpleMatch
Write-Host "`nTermine. Redemarre Minecraft avant de retester /connect." -ForegroundColor Cyan
