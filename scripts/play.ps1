# Cible du raccourci « Minecraft + Presence » : lance la presence (qui
# s'arretera avec le jeu), puis Minecraft Bedrock. Si le jeu tourne deja,
# Windows se contente de le remettre au premier plan.

& (Join-Path $PSScriptRoot 'start-presence.ps1') -WithGame
Start-Process 'shell:AppsFolder\Microsoft.MinecraftUWP_8wekyb3d8bbwe!Game'
