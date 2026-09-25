# Minecraft Better Presence

Rich Presence Discord détaillée pour **Minecraft Bedrock Edition** sur
Windows. Au lieu d'un simple « Joue à Minecraft », ton profil Discord montre
ce que tu fais vraiment :

```
⚔️ Defeated: Knight
👥 2/8 · 💧 8/10 · 🍗 7.5/10 · ⭐ Lv 16840 · Day 30 · 🌙 Night · 👹 2 hostiles nearby
```

Conçu et testé sur **RLCraft 1.3** (HoneyFrost), mais fonctionne aussi en
vanilla. Les détails techniques et toutes les validations faites en jeu sont
dans [FINDINGS.md](FINDINGS.md).

## Ce qui s'affiche

- **Ligne 1, l'activité déduite** : combat (*Defeated: Knight*), chasse
  (*Hunting: Boar*), minage, construction, craft, cuisson, nage, monture,
  exploration, inactivité, mort avec sa cause (*Drowned*).
- **Ligne 2** : nombre de joueurs dans la partie (`👥 1/8`), soif (RLCraft),
  faim, niveau d'XP, jour, jour ou nuit, météo et monstres proches (sans
  cheats, « ⚔️ Taking damage » à la place, quand tu perds de la vie).
- **Grande image** : la dimension (Overworld, Nether, End), ou l'image de ton
  choix pour une partie RLCraft (`RLCRAFT_IMAGE`). Au survol : le lieu et les
  stats de la session (blocs, kills, morts).
- **Petite image** : l'activité. Au survol, sur RLCraft : compétences, set
  d'armure et titre de tueur de dragons.
- **Chronomètre** de session.
- **États particuliers** : « 🏠 Main Menu » au menu principal (avec « RL Craft
  1.3 » en deuxième ligne quand on sort d'une partie RLCraft), et les écrans
  ouverts : « ⏸️ Game Paused », « 🎒 In Inventory », « 📦 In a Chest » (coffre
  simple ou grand coffre) et, sur RLCraft, « 💍 In the Trinket Pouch » et
  « 📈 In the LVL UP Menu ». Au menu principal, l'écran ouvert : « 🌍 Choosing
  a World », « 🏰 Browsing Realms », « 🌐 Browsing Servers », « ⚙️ In
  Settings », « 🛒 In the Marketplace », « 👕 In the Dressing Room ».

Les noms viennent du fichier de langue officiel du jeu installé, et sont
affichés en anglais ou en français au choix.

## Comment ça marche

Bedrock n'accepte pas de mods. La presence s'appuie donc sur trois sources,
toutes extérieures au jeu :

1. **Le WebSocket de Minecraft** (`/connect`) : des events (blocs, kills, morts,
   déplacements…) et des commandes de **lecture** (heure, météo, scoreboards de
   RLCraft…). La connexion est chiffrée, et une liste blanche empêche toute
   commande qui modifierait le jeu.
2. **L'écran** : la faim, l'écran ouvert (pause, inventaire, coffre…) et, sans
   cheats, le niveau d'XP, qu'aucune commande ne donne, sont lus à l'écran,
   uniquement dans de petites zones et sans rien enregistrer.
3. **Discord**, par son interface locale (IPC) : la presence s'y met à jour
   au plus toutes les 5 secondes, et seulement quand quelque chose change.

## Installation

Prérequis : Windows, [Node.js](https://nodejs.org) 22.9 ou plus récent,
Discord **desktop** (la version web ne suffit pas) et Minecraft Bedrock.

1. **Dépendances** :

   ```bash
   npm install
   ```

2. **Application Discord** : crée-la sur le
   [portail développeur](https://discord.com/developers/applications). Son nom
   est ce qui s'affiche après « Joue à ». Copie `.env.example` en `.env` et
   renseigne son **Application ID** dans `DISCORD_APP_ID`.

3. **Minecraft** : dans *Paramètres*, active **« Activer les WebSockets »**.
   « Exiger des WebSockets chiffrés » peut rester activé.

4. **Raccourci** : `npm run shortcut` crée **« Minecraft + Presence »** sur le
   bureau et dans le menu Démarrer, d'où tu peux l'épingler à la barre des tâches.

5. **Faim et écrans** (facultatif) : en jeu, lance `npm run calibrate`, puis
   `npm run calibrate-screens` ; depuis l'écran titre, `npm run
   calibrate-menus`. Laisse-toi guider. Voir
   [Lecture de l'écran](#lecture-de-lécran-faim-et-écrans).

## Utilisation au quotidien

1. Lance le jeu avec le raccourci **« Minecraft + Presence »**. La presence
   démarre en arrière-plan, sans fenêtre, et affiche « 🏠 Main Menu » dès que
   le jeu tourne, avant tout `/connect`.
2. Ouvre un monde **avec cheats**, qui ne sert qu'à ça, et tape
   `/connect <ton-IP-LAN>:19131`. Ton IP locale est donnée par `ipconfig`
   (ligne *Adresse IPv4*). Passer par l'IP locale plutôt que `localhost`
   évite une restriction de Windows sur les applications du Store.
3. Sauvegarde et quitte, puis joue dans ton vrai monde, **même sans cheats** :
   la connexion survit aux changements de monde, et les succès de ce monde ne
   sont pas touchés (voir [FINDINGS.md](FINDINGS.md)).
4. Ferme le jeu : la presence efface ton statut et s'arrête d'elle-même.

Si tu lances Minecraft autrement (application Xbox, tuile d'origine), la
presence ne démarre pas. Utilise alors `npm run bg`, puis `npm run stop`.

## Commandes

| Commande | Effet |
|---|---|
| `npm run play` | Ce que fait le raccourci : presence liée au jeu, puis lancement de Minecraft. |
| `npm start` | Presence au premier plan, avec le journal dans le terminal. |
| `npm run bg` / `npm run stop` | Presence en arrière-plan sans lien avec le jeu / arrêt. |
| `npm run shortcut` / `shortcut:remove` | Crée ou supprime les raccourcis. |
| `npm run calibrate` | Repère la barre de faim à l'écran. |
| `npm run calibrate-screens` | Apprend à reconnaître les écrans de jeu (après `calibrate`). `-- trinkets lvlup` : seulement ceux-là. |
| `npm run calibrate-menus` | Apprend à reconnaître les écrans du menu principal, depuis l'écran titre. `-- menuSettings` : seulement celui-là. |
| `npm run probe` / `npm run rpc` | Outils de diagnostic, voir [plus bas](#outils-de-diagnostic). |

En arrière-plan, le journal est dans `logs/presence.log`, et la session
précédente dans `presence.log.old`.

## Réglages (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `DISCORD_APP_ID` | — | Application Discord (obligatoire) |
| `PRESENCE_LANG` | `en` | Langue affichée : `en` ou `fr` |
| `RLCRAFT_IMAGE` | — | URL https d'une grande image pour une partie RLCraft et le menu qui la suit (sinon : la dimension en jeu, un bloc d'herbe au menu) |
| `SHOW_COORDS` | `0` | `1` pour afficher les coordonnées au survol |
| `PORT` | `19131` | Port du serveur WebSocket |
| `ENCRYPTION` | `1` | `0` pour une connexion en clair (débogage) |
| `TRACE_RLCRAFT` | `0` | `1` pour enregistrer les scoreboards et tags RLCraft dans `logs/rlcraft-trace.jsonl` (calibrage) |

## Lecture de l'écran (faim et écrans)

La presence ne regarde que de petites zones de la fenêtre Minecraft, et
seulement quand le jeu est au premier plan. Le reste du temps, elle garde les
dernières valeurs. Aucune capture n'est enregistrée. Les calibrations sont
stockées dans `hud.json`, propre à ton écran et exclu du dépôt.

**Faim.** La presence compte les cuisses de poulet de la barre de faim,
demi-cuisses comprises. Une lecture douteuse n'est jamais affichée : contour
non reconnu, ou couleurs inattendues (menu ouvert, effet de faim qui verdit les
cuisses). La valeur précédente est alors conservée. `npm run calibrate` laisse
30 secondes pour revenir en jeu, HUD visible.

**Dégâts.** Sans cheats, le jeu refuse de compter les monstres proches. La
presence compte alors le rouge de tes cœurs, au-dessus de la barre d'objets, à
l'opposé de la faim : aucune calibration de plus. Si la vie baisse sur deux
relevés de suite (environ 3 secondes), « ⚔️ Taking damage » s'affiche pendant
20 secondes. Un clignotement ou un fondu d'un seul relevé est ignoré. Le poison
ou le wither colorent les cœurs : ils comptent aussi comme des dégâts.

**Niveau d'XP.** Dans un monde sans cheats, la commande qui donne le niveau
est refusée : la presence lit alors le nombre vert affiché au-dessus de la
barre d'XP, chiffre par chiffre, dans la police du jeu. Aucune calibration de
plus : elle réutilise celle de la faim. Un chiffre ambigu fait rejeter la
lecture plutôt qu'afficher un mauvais niveau.

**Écrans ouverts.** Le jeu ne signale ni le menu pause, ni l'inventaire, ni les
coffres, et en multijoueur rien ne se fige. `npm run calibrate-screens` apprend
donc leur signature, dans l'ordre : menu pause, inventaire, coffre simple,
grand coffre, poche à trinkets et menu LVL UP. Chaque écran s'ouvre **deux
fois de suite** (deux coffres au contenu différent), souris hors des cases et
des boutons. En plein écran, le terminal n'est pas visible : chaque étape se
signale par un bip.

| Bip | Signification |
|---|---|
| aigu | capture faite : ferme l'écran |
| double | ouvre maintenant le menu LVL UP (7 secondes) |
| grave | mauvais écran ou fermé trop tôt : recommence l'écran en cours |
| trois notes montantes | terminé |

Une signature ne retient que ce qui ne change pas en jouant : titres, bordures
des cases et fond des panneaux, jamais le contenu des cases. Le menu LVL UP
laisse le HUD visible : il est reconnu à son texte d'aide (« Left/Right to
change Skill Category »…), pas à tes niveaux ni à la sélection. Chaque écran a
trois zones, vérifiées toutes les 3 secondes ; il en faut deux à 90 %, ce qui
tolère une infobulle ou un bouton survolé. Un écran non appris (table de
craft, four…) affiche l'activité normale.

`npm run calibrate-screens -- trinkets lvlup` n'apprend que les écrans nommés
et garde les autres.

**Menu principal.** `npm run calibrate-menus` apprend, depuis l'écran titre,
les onglets Mondes, Realms et Serveurs de Jouer, les Paramètres, le Marché et
le Vestiaire : chacun deux fois, ouvert au bip double, souris en bas de
l'écran. Jouer se rouvre sur le dernier onglet utilisé : clique le bon. Ces
écrans sont reconnus à leur en-tête (titre, onglet souligné), jamais à leur
contenu : tes mondes, les serveurs en vedette ou les offres du Marché changent.
Aucun écran reconnu : « 🏠 Main Menu ».

**À recalibrer** si tu changes de résolution, d'échelle d'interface ou de
pack de textures, ou si un écran n'est plus reconnu (par exemple l'inventaire
avec le livre de recettes ouvert, s'il était fermé à la calibration). La
presence signale un changement de taille de fenêtre dans son journal.

## Noms RLCraft

Les packs Marketplace de RLCraft sont chiffrés. Ses noms viennent donc de
[data/rlcraft.json](data/rlcraft.json) : pour chaque identifiant, le nom
anglais, le nom français, et `"passive": true` pour les animaux, afin qu'un
kill s'affiche en *Hunting* plutôt qu'en *Defeated*. Pour ajouter un nom,
édite ce fichier puis relance la presence.

Les identifiants rencontrés sans nom sont notés dans `logs/unknown-ids.txt`,
avec leur nature (mob ou objet/bloc). Un identifiant ajouté au JSON disparaît
de cette liste au lancement suivant.

## Limites connues

- **Dans un monde sans cheats**, le jeu refuse les sélecteurs avancés (`@e`,
  `@s[lm=…]`) : **pas de monstres proches** (« ⚔️ Taking damage » les remplace),
  et le niveau d'XP n'y est connu que par la lecture de l'écran, donc quand
  Minecraft est au premier plan.
- `/connect` est à retaper à chaque lancement du jeu, depuis un monde avec cheats.
  Entre l'ouverture d'un monde et le `/connect`, la presence n'affiche rien :
  sans connexion, elle sait seulement qu'un monde est ouvert (HUD visible), pas
  ce qui s'y passe. Sans calibration de l'écran, elle ne le sait pas non plus
  et garde « Main Menu » jusqu'au `/connect`.
- Le fonctionnement sans cheats repose sur une faille : le jeu ne vérifie les
  cheats qu'au moment du `/connect`. Mojang peut la corriger. On perdrait alors
  les commandes dans ces mondes, probablement pas les events.
- Faim, écrans ouverts et niveau lu à l'écran ne sont mis à jour que lorsque
  Minecraft est au premier plan.
- Non disponibles sans behavior pack, qui désactiverait les succès : points de
  vie exacts, biome, effets actifs. La température RLCraft est mesurée mais
  pas affichée (échelle non calibrée).

## Architecture

```
bridge.js (WebSocket chiffré) ──events──> state.js ──> presence.js ──> discord.js
      ^         liste blanche                 ^               |
      └──── commandes de lecture ─────────────┤        names.js + i18n.js
                                              │        + data/rlcraft.json
screen.js (captures) ──> hunger.js, hearts.js, screens.js, levelocr.js ─┘
```

| Module | Rôle |
|---|---|
| `main.js` | Orchestration : relevés périodiques, menu principal, lien avec le processus du jeu. |
| `bridge.js` | Serveur WebSocket : chiffrement, abonnements, commandes filtrées par liste blanche. |
| `state.js` | État normalisé, déduction de l'activité, stats RLCraft, menu principal et écrans. |
| `presence.js` | Construction de l'activité Discord. |
| `discord.js` | Envoi dédoublonné, au plus une mise à jour toutes les 5 s, reconnexion. |
| `names.js`, `i18n.js` | Noms du jeu et de RLCraft, textes en anglais et en français. |
| `level.js` | Niveau d'XP par dichotomie sur `@s[lm=N]` (mondes avec cheats). |
| `levelocr.js` | Niveau d'XP lu à l'écran (mondes sans cheats). |
| `hearts.js` | Dégâts subis, lus sur les cœurs (mondes sans cheats). |
| `screen.js` | Captures de zones de la fenêtre Minecraft (PowerShell + GDI). |
| `hunger.js`, `screens.js` | Lecture de la barre de faim, reconnaissance des écrans ouverts. |
| `calibrate-hunger.js`, `calibrate-screens.js` | Calibrations correspondantes. |
| `trace.js` | Mode trace des scoreboards RLCraft. |

## Outils de diagnostic

- **`npm run probe`** : sonde WebSocket qui s'abonne à tous les events connus,
  teste des commandes de lecture et journalise tout dans `logs/`. Elle ne gère
  pas le chiffrement : désactive temporairement « Exiger des WebSockets
  chiffrés » pour l'utiliser. Si tu tiens à `localhost` plutôt qu'à l'IP
  locale, `scripts/setup-loopback.ps1`, lancé en administrateur, lève la
  restriction de Windows.
- **`npm run rpc`** : fait défiler des états factices sur Discord, pour
  vérifier l'application Discord sans lancer le jeu.
- **`TRACE_RLCRAFT=1`** : enregistre chaque changement des scoreboards et tags
  RLCraft, avec le contexte de jeu (c'est ainsi que la soif a été calibrée).

## Pourquoi cette approche

| Source | Marche où | Richesse | Friction |
|---|---|---|---|
| Détection Discord native | Windows | « Joue à Minecraft » | aucune |
| **WebSocket `/connect`** (retenu) | Solo et mondes privés | events + commandes | un monde avec cheats pour se connecter |
| Proxy `bedrock-protocol` | Serveurs, Realms | tout ce que le client voit | auth Xbox, zone grise |
| Behavior pack (Script API) | Mondes modifiables | PV, faim, biome | désactive les succès |
| Xbox Live Presence | Toutes plateformes | titre seulement | latence d'environ 1 min |
| Lecture mémoire | Windows | tout | casse à chaque mise à jour |

`/connect` exige les cheats, et activer les cheats désactive définitivement
les succès d'un monde. D'où la procédure : se connecter depuis un monde avec
cheats, puis jouer dans le vrai monde, dont les succès restent intacts.

## Licence

Code sous licence [MIT](LICENSE).

Projet non officiel, sans lien avec Mojang Studios, Microsoft, Discord ni
Honeyfrost. Minecraft est une marque de Mojang Studios. Aucun fichier du jeu
n'est distribué : les noms sont lus dans l'installation locale du joueur, et
les images sont des liens vers le [Minecraft Wiki](https://minecraft.wiki).
