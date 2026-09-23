# Lance Minecraft Better Presence en arriere-plan, sans fenetre.
# Une seule instance : si le port est deja pris, on ne relance rien.
# Journal : logs\presence.log (la session precedente est gardee en .old).
#
#   -WithGame : la presence s'arrete d'elle-meme a la fermeture de Minecraft.

param([switch]$WithGame)

$root = Split-Path -Parent $PSScriptRoot
$port = 19131

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Minecraft Better Presence tourne deja (port $port)."
    exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error "Node.js introuvable dans le PATH."
    exit 1
}

$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$out = Join-Path $logs 'presence.log'
$err = Join-Path $logs 'presence.err.log'
foreach ($f in $out, $err) {
    if (Test-Path $f) { Move-Item $f "$f.old" -Force }
}

$arguments = @('--env-file=.env', 'src/main.js')
if ($WithGame) { $arguments += '--with-game' }

Start-Process -FilePath $node `
    -ArgumentList $arguments `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err

Write-Host "Minecraft Better Presence demarre en arriere-plan. Journal : $out"
