# Minecraft Better Presence

Rich Presence Discord détaillée pour **Minecraft Bedrock Edition**.

Statut : **v0.1 fonctionnelle**, testée en direct sur RLCraft 1.3 (HoneyFrost).
Les résultats détaillés de l'exploration sont dans [FINDINGS.md](FINDINGS.md).

## Utilisation

Prérequis dans Minecraft : **Paramètres → Activer les WebSockets : ON**.
« Exiger des WebSockets chiffrés » peut rester **ON** : la connexion est
chiffrée (ECDH P-384 + AES-256-CFB8).

```bash
npm install
npm start          # au premier plan, journal dans le terminal
```

### Raccourci « Minecraft + Presence »

`npm run shortcut` crée ce raccourci sur le bureau et dans le menu Démarrer
(épinglable à la barre des tâches). Il lance la presence en arrière-plan, puis
le jeu. La presence **s'arrête d'elle-même à la fermeture de Minecraft**, en
effaçant ton statut Discord. Si le jeu ne démarre pas dans les 3 minutes, elle
abandonne. Rien ne tourne quand tu ne joues pas.

Si tu lances Minecraft autrement (application Xbox, tuile d'origine), la
presence ne démarre pas.

| Commande | Effet |
|---|---|
| `npm run play` | Ce que fait le raccourci : presence liée au jeu, puis lancement de Minecraft. |
| `npm run shortcut` / `shortcut:remove` | Crée ou supprime les raccourcis. |
| `npm run bg` | Presence en arrière-plan, **sans** lien avec le jeu (tourne jusqu'à `npm run stop`). |
| `npm run stop` | Arrête l'instance d'arrière-plan. |

En arrière-plan, le journal est dans `logs/presence.log`, et la session
précédente dans `presence.log.old`. La presence n'accepte que les connexions
venant de ce PC.

À chaque lancement du jeu :

1. Ouvre un monde **avec cheats**, qui ne sert qu'à ça, et tape
   `/connect <ton-IP-LAN>:19131`.
2. Sauvegarde et quitte, puis joue dans ton vrai monde, **même sans cheats**.
   La connexion survit aux changements de monde tant que le jeu reste ouvert,
   et les flags de succès du vrai monde ne sont pas touchés (voir
   [FINDINGS.md](FINDINGS.md)).

La presence n'envoie au jeu que des commandes de lecture, filtrées par une
liste blanche dans `bridge.js`.

Réglages dans `.env` :

| Variable | Défaut | Rôle |
|---|---|---|
| `DISCORD_APP_ID` | — | Application Discord (obligatoire) |
| `PRESENCE_LANG` | `en` | Langue affichée : `en` ou `fr` |
| `SHOW_COORDS` | `0` | `1` pour afficher les coordonnées au survol |
| `PORT` | `19131` | Port du serveur WebSocket |
| `ENCRYPTION` | `1` | `0` pour une connexion en clair (débogage) |
| `TRACE_RLCRAFT` | `0` | `1` pour enregistrer chaque changement des scoreboards et tags RLCraft dans `logs/rlcraft-trace.jsonl` (calibrage) |

La sonde `npm run probe` ne gère pas le chiffrement : pour l'utiliser, désactive
temporairement « Exiger des WebSockets chiffrés ».

### Ce qui s'affiche

- **Ligne 1, l'activité déduite** : combat, chasse, minage, construction,
  craft, cuisson, nage, monture, exploration, inactivité, mort (avec sa cause).
- **Ligne 2** : soif sur RLCraft (`💧 8/10`), faim (`🍗 7.5/10`), niveau
  d'XP (`⭐ Lv 16840`), jour, jour ou nuit, météo, monstres proches.

### Faim : lecture à l'écran

Bedrock n'a aucune commande pour lire la faim, et RLCraft ne la stocke pas.
La presence **lit donc la barre de faim sur ton écran**, toutes les 5 secondes,
en capturant uniquement la petite zone des cuisses de poulet, et seulement
quand Minecraft est au premier plan. Le reste du temps, elle garde la dernière
valeur. Aucune capture n'est enregistrée.

Une calibration est nécessaire, **une fois**, puis à chaque changement de
résolution ou d'échelle d'interface : en jeu, HUD visible, lance
`npm run calibrate`, qui laisse 30 secondes pour revenir dans Minecraft. La
position trouvée est enregistrée dans `hud.json`. Sans calibration, la faim
n'est simplement pas affichée.

Une lecture douteuse n'est jamais affichée : contour non reconnu, ou couleurs
inattendues (menu pause, inventaire, effet de faim qui verdit les cuisses).
La valeur précédente est alors conservée.
- **Grande image** : la dimension. Au survol : lieu et stats de la session.
- **Petite image** : l'activité. Au survol : niveau d'XP, puis, sur RLCraft,
  compétences, set d'armure et titre de tueur de dragons.
- **Chronomètre** de session, et taille du groupe dès que ton ami est connecté.

Les noms vanilla viennent du fichier de langue officiel du jeu installé. Ceux
de RLCraft, dont les packs sont chiffrés, viennent de
[data/rlcraft.json](data/rlcraft.json) : pour chaque identifiant, le nom
anglais, le nom français et `"passive": true` pour les animaux, afin qu'un
kill s'affiche en *Hunting* plutôt qu'en *Defeated*. Pour ajouter un nom, il
suffit d'éditer ce fichier puis de relancer la presence.

Les identifiants rencontrés sans nom sont notés dans `logs/unknown-ids.txt`,
avec leur nature (mob ou objet/bloc). Un identifiant ajouté au JSON disparaît
de cette liste au lancement suivant.

## Le problème

Bedrock n'accepte pas de mods : impossible de lire l'état du jeu depuis
l'intérieur comme le font les mods Java. Il faut l'extraire de l'extérieur, et
chaque méthode disponible couvre un scénario de jeu différent.

| Source | Marche où | Richesse | Friction |
|---|---|---|---|
| Détection Discord native | Windows | « Joue à Minecraft » | aucune |
| **WebSocket `/connect`** | Solo + mondes dont tu es op | events + commandes | cheats requis |
| **Proxy `bedrock-protocol`** | Serveurs / Realms | tout ce que le client voit | auth Xbox, zone grise |
| Behavior pack (Script API) | Mondes modifiables | PV, faim, XP, biome | pas de réseau, besoin d'un pont |
| Xbox Live Presence | Toutes plateformes | titre seulement | latence ~1 min |
| Lecture mémoire | Windows | tout | casse à chaque MAJ |

### La contrainte principale

`/connect` (alias `/wsserver`) exige les **cheats activés** (permission niveau 2),
et activer les cheats désactive définitivement les succès du monde. Sur un monde
avec addon comme RLCraft, les succès sont déjà désactivés par les
expérimentations : la contrainte est alors sans conséquence.

## Cible de ce projet

Partie en ligne à deux, monde privé (ni serveur public ni Realm), addon
**RLCraft 1.3 (HoneyFrost)**. Donc : route WebSocket, éventuellement complétée
par un behavior pack compagnon pour les données que les commandes ne donnent
pas (PV, faim, XP).

## Installation

```bash
npm install
```

## Sonde 1 — WebSocket

Découvre ce que ta version de Minecraft accepte réellement d'exposer.

```bash
npm run probe
```

La sonde affiche les commandes `/connect` à taper dans le jeu. **Essaie
l'adresse LAN en premier** (`/connect 192.168.x.x:19131`) : elle contourne la
restriction loopback d'UWP sans nécessiter de droits administrateur. Si
seulement `localhost` t'intéresse, lance `scripts/setup-loopback.ps1` en
administrateur.

Une fois connectée, la sonde :

- s'abonne aux ~90 events connus et compte ceux qui arrivent vraiment ;
- teste une batterie de commandes de lecture d'état (`querytarget`,
  `time query`, détection du gamemode, `locate biome`...) ;
- journalise tout en JSONL dans `logs/` pour analyse ultérieure ;
- accepte des commandes au clavier, envoyées au jeu (`.summary`, `.verbose`,
  `.probe`, `.quit`, ou n'importe quelle commande Minecraft).

Joue une dizaine de minutes en variant les actions — miner, poser, tuer un mob,
craft, ouvrir l'inventaire, changer de dimension, mourir — puis `.summary`.

**Ce que la sonde répond au passage :** l'adresse IP source de la connexion
indique si le WebSocket part de ta machine (`127.0.0.1`) ou de celle de l'hôte.
C'est le point non documenté qui détermine si la solution fonctionne quand ce
n'est pas toi qui héberges.

## Sonde 2 — Discord

Valide le côté Discord sans dépendre du jeu.

1. Crée une application sur le [portail développeur](https://discord.com/developers/applications).
   Son **nom** est ce qui s'affiche après « Joue à ».
2. Onglet *Rich Presence > Art Assets* : uploade les images (`overworld`,
   `nether`, `end`, `pickaxe`, `sword`, `elytra`...).
3. Lance avec l'App ID :

```bash
$env:DISCORD_APP_ID="ton-app-id"; npm run rpc
```

Des états factices défilent toutes les 12 secondes (sous la limite Discord
d'environ 5 mises à jour par 20 s). Le client Discord **desktop** doit tourner —
la version web n'expose pas le named pipe utilisé par l'IPC.

## Architecture

```
bridge.js (WebSocket) ──events──> state.js (GameState) ──> presence.js ──> discord.js
        ^                               ^                        |
        └── polling de commandes ───────┘                  names.js + i18n.js
```

- `bridge.js` : serveur WebSocket, abonnements, commandes avec réponse.
- `state.js` : état normalisé, déduction de l'activité, parsing des stats RLCraft.
- `presence.js` : construction de l'activité Discord.
- `discord.js` : envoi dédoublonné, limité à une mise à jour toutes les 5 s, reconnexion.
- `probe.js`, `rpc-test.js` : outils de diagnostic de la phase d'exploration.
