# Arrete l'instance d'arriere-plan de Minecraft Better Presence.
# Discord efface la presence de lui-meme quand la connexion IPC se ferme.

$port = 19131
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) {
    Write-Host "Minecraft Better Presence ne tourne pas."
    exit 0
}

$proc = Get-Process -Id $conn.OwningProcess
if ($proc.ProcessName -ne 'node') {
    Write-Error "Le port $port est occupe par '$($proc.ProcessName)', pas par la presence : rien n'est arrete."
    exit 1
}

Stop-Process -Id $proc.Id
Write-Host "Minecraft Better Presence arrete (processus $($proc.Id))."
