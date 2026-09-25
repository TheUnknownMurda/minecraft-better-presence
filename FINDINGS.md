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

### Écrans ouverts (`src/screens.js`, `npm run calibrate-screens`)

Aucun signal côté jeu. Reconnaissance à l'écran par signature apprise. Le
menu pause RLCraft (capture du 2026-09-23) : voile sombre sur la moitié gauche,
logo « MINECRAFT RLCraft 1.3 », boutons gris « Reprendre le jeu »,
« Paramètres », etc., et l'étiquette « Le jeu est en pause » en haut à droite.

**Menu pause seul (2026-09-23).**
- 1ʳᵉ version : zones les plus riches en pixels clairs. Résultat : trois aplats
  de bouton `#C6C6C6`, le gris commun à l'inventaire et aux coffres.
- Version validée : zones d'au moins 30 % de bouton ou panneau, choisies pour
  leur texte. La calibration a retenu le logo. Validé en jeu sur 4 minutes.

**Pause, inventaire, coffres (2026-09-24).** Chaque écran est ouvert deux fois ;
un pixel de signature doit être stable, identique aux deux ouvertures, gris,
et différent (écart ≥ 45) du jeu et de tous les autres écrans calibrés.
- Signatures posées sur le ciel ou le monde assombri (`#21242B`) autour du
  menu, identiques aux deux ouvertures : pause jamais reconnue, coffre 2 s.
  Correctif : seulement dans les boîtes englobantes des grands aplats
  `#C6C6C6` (panneaux, boutons ; `uiMask`).
- En plein écran, le joueur ne voit pas les consignes du terminal : il a ouvert
  un tonneau, l'écran Trinkets, puis l'inventaire au lieu de la pause.
  Correctifs : bips à chaque étape et contrôles immédiats.
- L'inventaire et le coffre simple ont un panneau de même taille au même
  endroit (boîtes englobantes : recouvrement 1,00). Ressemblance des gris
  pixel par pixel : 1,00 pour deux ouvertures du même écran, 0,69 inventaire /
  coffre, 0,35 au plus pour les autres paires. Seuil retenu : 0,8.
- Les zones retenues tombaient sur l'inventaire du joueur (barre rapide,
  armure, personnage), identique aux deux ouvertures. Correctif : seulement la
  structure, à 4 px au plus d'un pixel `#C6C6C6` (fond, bordures des cases,
  textes). Les objets sont dessinés à l'intérieur des cases, à 5 px au moins
  du fond en 4K.
- `#C6C6C6` (fond) et `#8B8B8B` (intérieur de case) diffèrent de 59 : l'ancien
  seuil de 60 écartait presque tous les pixels qui distinguent l'inventaire du
  coffre (une seule zone chacun). Seuil abaissé à 45, soit plus du double de la
  tolérance de reconnaissance (20) : 3 zones par écran.
- Vérifié hors ligne : une signature de coffre apprise sur un seul coffre
  reconnaît l'autre coffre à 100/100/99 %.
- En direct, une table de craft passait pour l'inventaire (zones à 80, 78 et
  100 %) : seuil par zone relevé de 80 à 90 %. Les vrais écrans restent à
  96-100 %, sauf une zone masquée par la souris ou une infobulle.
- Grand coffre : signature à part, affichée comme un coffre. Tonneau : même
  disposition que le coffre simple, hormis le titre (non vérifié).

**Poche à trinkets et menu LVL UP (2026-09-24).**
- Poche à trinkets : vrai écran (HUD masqué), bannière « TRINKETS » brune et
  panneau « Inventaire » gris. Même méthode ; zones sur « Inventaire », le
  bouton « × » et le bord du panneau.
- Menu LVL UP : le **HUD reste visible**, et les coordonnées passent à y = 250
  (le joueur est déplacé dans le ciel). Pas de panneau gris : colonnes à
  piliers, bannières avec le niveau de chaque compétence, « POWER LEVEL », et
  un texte d'aide en bas à droite. Calibration minutée (bip double, capture
  7 s plus tard), reconnaissance quand la barre de faim est visible.
- 1ʳᵉ signature : les trois zones dans la colonne sélectionnée, sur le niveau
  « 14 », le cadre jaune de sélection et la capacité sélectionnée. Tout cela
  change en naviguant ou en améliorant.
- Version retenue : fond exclu (couleur des bords gauche et droit de chaque
  ligne, le ciel), gris seulement, et seuls comptent les contours à 4 px au
  plus du fond. Les chiffres et la sélection, dessinés dans les bannières, en
  sont exclus. Zones retenues : « change Skill Category », « Crouch/Jump to »,
  « Switch Item to close ».
- Hors ligne, les 6 signatures sur 14 captures (dont 2 en jeu) : chaque écran
  n'est reconnu que par la sienne. Meilleure zone isolée d'un autre écran :
  80 %, sous le seuil, et il en faut deux.
- Validé en jeu (monde sans cheats) : Discord a affiché « 📈 In the LVL UP
  Menu » et « 💍 In the Trinket Pouch ».

### Dégâts lus sur les cœurs (`src/hearts.js`, 2026-09-25)

Sans cheats, `testfor @e[r=24,family=monster]` est refusé
(`<insufficient permissions for selector expansion>`) : pas de monstres
proches. Aucune autre source trouvée : l'event `EntitySpawned` ne se déclenche
que pour les actions du joueur (22 fois, toujours `type: player`), et aucun tag
ni score RLCraft n'indique un combat. À la place, la presence signale les
dégâts subis, lus sur les cœurs.

- Position : miroir de la barre de faim par rapport au centre de l'écran.
  Capture du 2026-09-25 en 4K : 14 cœurs (10 en bas, 4 au-dessus), barre
  d'armure grise au-dessus, cadran RLCraft rond juste à droite.
- La texture des cœurs n'a que deux rouges, `#FF1313` (9 100 px) et
  `#BB1313` (2 450 px), soit 825 px par cœur plein en 4K. Un premier critère
  « rouge dominant » comptait aussi l'anneau orange du cadran (`#E5853E`,
  483 px).
- Pendant le fondu du HUD (jeu qui revient au premier plan), les cœurs
  s'assombrissent (`#DE1111`, `#A41111`) : les couleurs exactes ne sont plus
  comptées. Critère retenu : la teinte (vert = bleu, 7 à 10 % du rouge), qui
  donne 11 550 px sur les 8 captures, fondu compris.
- Test réel (chutes) : 14 → 13,5 → 12 cœurs en deux relevés, puis
  régénération. La 1ʳᵉ logique attendait deux relevés égaux : en combat, où la
  vie baisse à chaque relevé, elle n'aurait jamais rien signalé. Version
  retenue : deux relevés de suite sous la dernière valeur stable, même
  différents. Dégâts signalés au 2ᵉ relevé bas ; un relevé bas isolé
  (clignotement, fondu, écran qui se ferme) est ignoré.

### Écrans du menu principal (`npm run calibrate-menus`, 2026-09-25)

Jouer (onglets Mondes, Realms, Serveurs), Paramètres, Marché et Vestiaire. Pas
de panneau `#C6C6C6`, et le décor animé de l'écran titre reste visible autour.

- Premiers essais : écran titre capturé alors qu'il n'y avait rien d'ouvert, et
  Jouer rouvert sur le dernier onglet utilisé (Realms au lieu de Mondes).
  Contrôle retenu : la barre de titre claire en haut de l'écran (part claire
  des 5 % du haut : 0,98 sur Jouer, 0,74 sur le Marché, 0,07 sur l'écran titre).
- Ressemblance de deux captures sur la bande centrale du haut (sans les bords,
  où le décor bouge) : 0,996 pour le même onglet, 0,69 à 0,70 entre onglets.
- Les trois onglets de Jouer ne diffèrent que par l'onglet sélectionné : son
  libellé descend d'une dizaine de pixels et un trait le souligne. Ce trait
  horizontal n'a presque pas de contours horizontaux : pour les menus, les
  voisins verticaux comptent aussi, et les zones sont de 128 × 32 px.
- Le compteur « Mondes (N) » change pendant le chargement de la liste (5, 6
  puis 7 sur les captures) : il rendait « distinctif » le libellé non
  sélectionné, et Realms passait pour Serveurs. Correctif : un pixel doit
  différer des deux ouvertures de chaque autre écran, et la calibration laisse
  12 s à la liste pour se charger.
- Paramètres : sous la barre de titre, le texte dépend de la catégorie ouverte
  (« Tout le monde a sa place… » pour Accessibilité). Hauteur retenue : 13 % de
  l'écran pour Jouer (titre et onglets), 6 % ailleurs (barre de titre seule).
  Le titre du Marché et du Vestiaire est collé à gauche : la bande couvre toute
  la largeur.
- Zones retenues : libellé et trait de l'onglet pour Jouer, « PARAMÈTRES »,
  « Ma bibliothèque » et la recherche du Marché, « Vestiaire » et son bouton
  « + ». Une zone de Mondes contient le compteur : elle peut manquer, les deux
  autres suffisent.
- Validé en direct (3 min) : chaque écran reconnu à 100/100/100 (Mondes une fois
  à 81/100/100, le compteur), écran titre jamais reconnu, aucune signature de
  jeu déclenchée au menu.

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
