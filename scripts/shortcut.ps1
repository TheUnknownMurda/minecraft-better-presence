# Cree (ou supprime avec -Remove) le raccourci « Minecraft + Presence » sur le
# bureau et dans le menu Demarrer. Depuis le menu Demarrer, il peut etre
# epingle a la barre des taches.

param([switch]$Remove)

$name = 'Minecraft + Presence.lnk'
$links = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) $name),
    (Join-Path ([Environment]::GetFolderPath('Programs')) $name)
)

if ($Remove) {
    foreach ($link in $links) {
        if (Test-Path $link) { Remove-Item $link; Write-Host "Supprime : $link" }
    }
    exit 0
}

$root = Split-Path -Parent $PSScriptRoot

# Icone copiee dans le projet : le chemin du paquet change a chaque mise a jour.
$icon = Join-Path $root 'assets\minecraft.ico'
$package = Get-AppxPackage Microsoft.MinecraftUWP
if ($package) {
    New-Item -ItemType Directory -Force (Split-Path $icon) | Out-Null
    Copy-Item (Join-Path $package.InstallLocation 'minecraftIcon.ico') $icon -Force -ErrorAction SilentlyContinue
}

$shell = New-Object -ComObject WScript.Shell
foreach ($link in $links) {
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'play.ps1')`""
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 7  # minimise : evite le flash de la console
    $shortcut.Description = 'Lance Minecraft Bedrock avec la Rich Presence Discord'
    if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
    $shortcut.Save()
    Write-Host "Cree : $link"
}
