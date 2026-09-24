# Résultats de la sonde WebSocket

Session du 2026-09-23, Minecraft Bedrock **1.26.51** (paquet `MinecraftUWP`,
données sous `%APPDATA%\Minecraft Bedrock\`), monde vanilla « Mon monde - Copier ».
Journal brut : `logs/session-2026-09-23T07-40-44-397Z.jsonl`.

## Prérequis côté client

Deux options dans `options.txt` (`minecraftpe/`), réglables dans les Paramètres :

| Clé | Valeur requise | Symptôme si mauvaise |
|---|---|---|
| `websockets_enabled` | `1` | « Requête du serveur WebSocket rejetée » |
| `websocket_encryption` | `0` ou `1` : chiffrement implémenté | — |

### Chiffrement (validé en jeu le 2026-09-23, avec `websocket_encryption:1`)

Protocole de Code Connection, relevé dans `Sandertv/mcwss` (`encryption.go`,
`protocol/command/enable_encryption.go`) :

1. Le client propose le sous-protocole `com.microsoft.minecraft.wsencrypt` :
   le serveur doit l'accepter.
2. Le serveur envoie, en clair, `enableencryption "<clé>" "<sel>"` : clé
   publique ECDH P-384 au format DER SPKI, sel de 16 octets, tous deux en
   base64 **sans padding**.
3. Le client répond, en clair, `{"publicKey": "<sa clé DER SPKI en base64>"}`.
4. Clé AES-256 = SHA-256(sel ‖ secret partagé), IV = ses 16 premiers octets.
   AES-CFB8, un flux continu par sens, jamais réinitialisé entre les messages.
5. Tout le reste est chiffré, et envoyé dans des trames **texte** qui ne sont
   pas de l'UTF-8 valide : désactiver la validation UTF-8 (`skipUTF8Validation`).

Piège : `mcwss` retire les zéros de tête du secret partagé (`big.Int.Bytes()`),
alors que Node garde ses 48 octets. Les deux conventions ne diffèrent qu'une
fois sur 256. Chaque connexion utilise une nouvelle clé, donc un `/connect`
suffit à contourner ce cas.

Plus : cheats actifs sur le monde, permission niveau 2. `/connect <IP LAN>:19131`
fonctionne sans exemption loopback.

**La connexion est liée au client, pas au monde.** Ouverte dans « Mon monde -
Copier », elle a survécu à la sortie vers le menu puis au chargement de la copie
RLCraft : un seul socket, les events ont continué.

### Test « monde sans cheats » (concluant)

Protocole : `/connect` dans la copie RLCraft (cheats ON), sauvegarder et
quitter, créer « Test sans cheat » (cheats OFF), y jouer, sauvegarder et quitter.

- La connexion **reste ouverte** dans le monde sans cheats, et même au menu.
- Les **events arrivent** : 50 reçus (`PlayerTravelled`, `PlayerTransform`,
  `BlockBroken`, `ItemAcquired`, `ItemDropped`).
- Les **commandes sont exécutées** : `querytarget`, `time query`, `list` et
  `tag @s list` ont répondu depuis ce monde (spawn 0.5/119.6, heure 809).
  Le client ne vérifie les cheats qu'au moment du `/connect`.
- `level.dat` réécrit à la fermeture, après ces commandes :
  `cheatsEnabled=0`, `commandsEnabled=0`, `hasBeenLoadedInCreative=0`.

`hasBeenLoadedInCreative` passe à 1 dès qu'on active les cheats, même en
survie : c'est vraisemblablement le marqueur permanent des succès désactivés.
Qu'il reste à 0 est un bon indice, pas une preuve : seul un succès Xbox obtenu
pendant la connexion le serait. Mojang peut aussi combler cette faille à tout
moment.

**Conséquence de sécurité :** n'importe quelle commande passerait par ce canal.
`bridge.js` n'accepte donc qu'une liste blanche de lectures d'état.

**Nuance (2026-09-23, monde RLCraft original sans cheats) :** les commandes
simples passent (`querytarget @s`, `time query`, `weather query`, `list`,
`scoreboard players list @s`), mais pas l'**expansion de sélecteurs** :
`testfor @e[...]` et `testfor @s[lm=N]` échouent avec
`<insufficient permissions for selector expansion>`. Les monstres proches sont
donc indisponibles sans cheats ; le niveau d'XP y est lu à l'écran (voir plus bas).

### Menu pause (`src/pause.js`, `npm run calibrate-pause`)

Aucun signal côté jeu. Reconnaissance à l'écran par signature apprise :
pixels stables entre deux captures en pause et absents en jeu. Le menu pause
RLCraft (capture du 2026-09-23) : voile sombre sur la moitié gauche, logo
« MINECRAFT RLCraft 1.3 », boutons gris « Reprendre le jeu », « Paramètres »,
etc., et l'étiquette « Le jeu est en pause » en haut à droite.

- 1ʳᵉ version : zones les plus riches en pixels clairs. Résultat : trois aplats
  de bouton `#C6C6C6`, le gris commun à l'inventaire et aux coffres.
- Version retenue : zones composées d'au moins 30 % de bouton ou panneau, et
  choisies pour leur texte (pixels foncés encadrés par du clair sur leur
  ligne), avec 40 points de texte et 40 de fond par zone. Sur ce menu, la
  calibration a retenu le logo. Un panneau gris sans ce texte plafonne à 50 %.
- Validé en jeu sur 4 minutes (inventaire, coffre, LVL UP, chat, pause) : les
  pauses sont reconnues avec des zones à 81-100 %, les autres écrans ne dépassent
  pas 56 % sur plus d'une zone, et Discord a affiché « ⏸️ Game Paused » à chaque
  pause, puis la reprise.

### Niveau d'XP lu à l'écran (`src/levelocr.js`)

Sans cheats, `@s[lm=N]` est refusé. Le niveau est affiché en vert `#7FFF00`
(ombre `#204000`), centré au-dessus de la barre d'XP, à la hauteur de la barre
de faim, dans la police pixel de Minecraft : chiffres de 5×7 pixels espacés de
1, agrandis au même facteur que les icônes du HUD (×5 en 4K).

- La police n'est pas lisible dans l'installation (`font/` ne contient que
  `minecraft-ten.ttf` et des `.fontdata`) : modèles relevés de mémoire. Le « 5 »
  a été vérifié pixel à pixel sur le HUD. Distance minimale entre deux modèles :
  3 pixels sur 35 (le 3 et le 8). Un chiffre à plus de 3 pixels de tout modèle,
  ou à égalité entre deux, fait rejeter la lecture.
- Lectures en jeu dans le monde RLCraft sans cheats : 5 (vérifié pixel à
  pixel), puis 6. Chaque monde a
  son propre joueur (17035 dans la copie avec cheats au même moment).
- Quand la commande et l'écran donnent tous deux un niveau (monde avec
  cheats), un désaccord est noté dans le journal.

### Nombre de joueurs

`list` donne `currentPlayerCount` et `maxPlayerCount`, y compris sans cheats.
Le champ `party` de Discord les affiche en « (1 of 8) », mais toujours **en fin**
du champ `state`, précédé d'une icône de groupe (constaté sur le profil). Pour
les avoir en tête de ligne, la presence les écrit elle-même (`👥 1/8`) et
n'utilise plus ce champ.

### Menu principal

Aucun event ne signale la sortie d'un monde (`WorldUnloaded` ne remonte
jamais). En revanche, au menu, **toutes** les commandes échouent avec
`-2147483648 « Commande inconnue : <commande> »`, y compris `list` et
`time query`, qui réussissent toujours dans un monde (avec ou sans cheats, et
même mort). Règle : `querytarget`, `time` et `list` en échec dans le même
relevé signifient le menu. Le premier event reçu, ou une commande qui réussit,
signifie l'entrée dans un monde. Validé en jeu : menu affiché 4 s après la
détection, puis nouveau monde affiché 1 s après l'entrée.

## Format des messages (1.26)

Les champs sont **directement dans `body`, en camelCase**. L'ancien format
`body.properties.PascalCase` des tutoriels n'existe plus. `header.version` vaut
`17104896`. Chaque event embarque un bloc `player` complet : `name`, `dimension`,
`position`, `yRot`.

## Events

| Event | Reçu | Champs utiles |
|---|---|---|
| `PlayerTransform` | ✅ ~5 Hz | `player.position`, `player.dimension`, `yRot` |
| `PlayerTravelled` | ✅ | `travelMethod`, `metersTravelled`, `isUnderwater` · `newBiome` **toujours 0 (mort)** |
| `BlockBroken` / `BlockPlaced` | ✅ | `block`, `tool`, `placedUnderWater` |
| `MobKilled` | ✅ | `victim.type`, `weapon`, `isMonster`, armure du joueur (`armorHead`…) |
| `PlayerDied` | ✅ | `cause` (enum), `killer.type` (enum), `inRaid` |
| `ItemCrafted` / `ItemSmelted` | ✅ | `item`, `count`, `fuelSource`, `usedCraftingTable` |
| `ItemUsed` / `ItemInteracted` | ✅ | `item`, `useMethod` / `method` |
| `ItemAcquired` / `ItemDropped` | ✅ | `item`, `count`, `acquisitionMethodId` |
| `EndOfDay` | ✅ | (vide) |
| `PlayerMessage` | ✅ | `type`, `sender`, `message` |
| `PlayerTeleported` | ✅ | `cause`, `itemType`, `metersTravelled` |
| `MobInteracted` | ✅ | `interactionType` · `mob.type` vaut 0 : inexploitable |
| `ScreenChanged` | ❌ | détection menus/inventaire impossible |
| `ItemEquipped` | ❌ | objet en main déduit du dernier outil/arme utilisé |
| `PortalUsed` | ❌ | remplacé par le changement de `player.dimension` |

### `travelMethod` observés

| Valeur | Interprétation | Indice |
|---|---|---|
| 0 | marche | le plus courant au sol |
| 1 | nage | 50/62 avec `isUnderwater=true` |
| 2 | saut / chute | |
| 5 | ? | 70 occurrences, uniquement dans le Nether |
| 6 | monture / véhicule | après `ItemUsed oak_boat` |
| 7 | accroupi | |
| 8 | sprint | |

### Enums à calibrer

- `PlayerDied.cause = 9` confirmé **noyade** par le joueur. Cohérent avec
  l'enum `ActorDamageCause` de Bedrock : 0 override, 1 contact, 2 attaque
  d'entité, 3 projectile, 4 suffocation, 5 chute, 6 feu, 7 brûlure, 8 lave,
  9 noyade, 10 explosion de bloc, 11 explosion d'entité, 12 vide… Les valeurs
  autres que 9 restent à confirmer en jeu.
- `killer = {type: 1, id: 1}` pour une noyade : valeur par défaut sans tueur.

## Commandes de lecture d'état

| Commande | Résultat | Donne |
|---|---|---|
| `querytarget @s` | ✅ | position, dimension (0/1/2), rotation, uniqueId |
| `time query daytime` | ✅ | heure → jour/nuit |
| `time query day` | ✅ | nombre de jours |
| `weather query` | ✅ | clair / pluie / orage |
| `testfor @s[m=survival]` | ✅ | mode de jeu, par élimination |
| `testfor @e[r=32,type=!player,type=!item]` | ✅ | **mobs à proximité** (noms localisés) |
| `list` | ✅ | joueurs connectés / max |
| `locate biome <x>` | ❌ | refuse tout identifiant via WebSocket |
| `execute if biome` | ❌ | n'existe pas sur Bedrock |

**Niveau d'XP** : aucune commande ne le lit, mais `testfor @s[lm=N]` réussit
si le niveau est ≥ N. Une dichotomie sur [0, 24791] le retrouve en 15 requêtes,
puis 2 par relevé tant qu'il ne change pas (`src/level.js`). Validé en jeu :
16840, identique au HUD.

Les messages de réponse sont **localisés** (français ici) : il faut parser
`details` (JSON) quand il existe, jamais `statusMessage`.

## Non accessible sans behavior pack

Points de vie, faim, biome, effets actifs. Un behavior pack personnel
désactive **définitivement** les succès du monde (seuls les add-ons du
Marketplace y échappent).

### Faim : lue à l'écran (`src/hunger.js`, `src/screen.js`)

- Capture GDI (`CopyFromScreen`) de la fenêtre `Bedrock` : fonctionne en
  plein écran 4K, en environ 40 ms. La fenêtre est lue en pixels physiques
  (DPI per-monitor v2).
- Une cuisse fait 9×9 pixels de texture, agrandis ×5 en 4K avec l'échelle
  d'interface du joueur, et espacés de 8 pixels (une colonne partagée).
  Contour noir identique pleine ou vide ; intérieur : viande (`#D42A2A`,
  `#B21818`, `#DFB18F`, `#B88458`, `#9D6D43`, `#613C1B`, `#7B512D`) ou vide
  (`#282828`). Les pixels sont nets, sans lissage.
- Le niveau d'XP (`#7FFF00`, ombre `#204000`) recouvre la première cuisse :
  ces pixels sont ignorés. Une cuisse pleine sous le texte reste lisible.
- Tremblement quand la saturation est nulle : un décalage de ±1 pixel de
  texture est recherché pour chaque cuisse.
- Validé en jeu : calibration automatique à la position exacte relevée à la
  main ; lectures 8/20 (capture), 17/20, puis une descente régulière
  (8.5 → 8 → 7.5, repas → 10 → 9 → 8.5 → 8 cuisses). Le joueur a confirmé
  que l'affichage Discord correspond à son HUD, demi-cuisses comprises.
- **Menus** (inventaire, pause, LVL UP, coffre, chat) : l'écran assombri
  laisse le contour noir intact mais rend l'intérieur des cuisses noir. La
  première version ignorait ces pixels et lisait **0/20** (bug observé sur
  Discord). Un intérieur de cuisse n'étant jamais noir, les cases noires ou de
  couleur inconnue comptent désormais comme suspectes : au-delà de 20 %, la
  lecture est rejetée et la valeur précédente conservée. Enregistrement réel
  de 4 min : 16 images qui donnaient 0/20 sont rejetées, aucune lecture
  valide à 0, et Discord n'a plus jamais affiché 0/10.

## Monde RLCraft (« RLCraft Édition Bedrock »)

- Template **Marketplace** (Honeyfrost & Amman Works), packs **chiffrés** :
  impossible de lire la liste des entités à l'avance.
- Script API stable (`@minecraft/server 1.15.0`) : aucune expérimentation requise.
- `level.dat` : `commandsEnabled=0`, `hasBeenLoadedInCreative=0` →
  **succès encore actifs**. Activer les cheats les désactiverait définitivement.
- `isFromLockedTemplate=0` : le monde peut être copié et les cheats activés
  sur la copie. C'est la voie choisie pour tester sans risque.
### Stats de survie (mode trace `TRACE_RLCRAFT=1`, 2026-09-23)

La partie est ouverte en multijoueur, donc **le jeu ne se met pas en pause**
quand on change de fenêtre : un relevé du HUD date à quelques secondes près.

**Soif (`thirst`)**, calibrée et affichée :

| HUD | Valeur |
|---|---|
| 6 gouttes | 23116 |
| 7 gouttes | 25804 |
| 8 gouttes | 29072 |
| 10 gouttes | 37986 |

- Une gorgée ajoute **+6000**. La troisième, bue à 34908, a été plafonnée à
  ~38000 : c'est le maximum.
- Gouttes = `round(thirst / 3800)`. L'échelle 40000 avec arrondi supérieur
  colle aussi aux quatre relevés, mais pas au plafond observé.
- Baisse d'environ 38/s en se déplaçant (médiane), jusqu'à 54/s.

**Température (`thermometer`)**, mesurée mais **non affichée** (calibrage
abandonné) :

- ≈ 6000 le jour : cercle neutre. Descend à la tombée de la nuit, jusqu'à se
  stabiliser à 3600 en pleine nuit.
- 3482 : **cadre givré** (froid). Seuil d'apparition du givre et état
  « chaud » non mesurés.
- Remonte près d'une source de chaleur (+50 / 2 s environ), rechute sous la pluie.
- `temperature` est resté à 0 : probablement un état d'extrême (hypothermie,
  coup de chaleur).

**Tags d'environnement** posés par l'addon : `near_heatsource`,
`its_raining`, `its_nighttime` / `its_daytime`, `water`, `heat_immune`,
`ocean_sword_user` (épée élémentaire en mode océan). Blessures localisées,
très brèves (2 à 6 s) : `larm_hurt`, `lleg_hurt`.

**Objet `hfrlc:system_level`** : l'objet « LVL UP » qui ouvre le menu des
niveaux (vu sur le HUD).
