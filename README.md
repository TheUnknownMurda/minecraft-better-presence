# Minecraft Better Presence

Rich Presence Discord détaillée pour **Minecraft Bedrock Edition** sur
Windows. Au lieu d'un simple « Joue à Minecraft », ton profil Discord montre
ce que tu fais vraiment :

```
⚔️ Defeated: Knight
💧 8/10 · 🍗 7.5/10 · ⭐ Lv 16840 · Day 30 · 🌙 Night · 👹 2 hostiles nearby
```

Conçu et testé sur **RLCraft 1.3** (HoneyFrost), mais fonctionne aussi en
vanilla. Les détails techniques et toutes les validations faites en jeu sont
dans [FINDINGS.md](FINDINGS.md).

## Ce qui s'affiche

- **Ligne 1, l'activité déduite** : combat (*Defeated: Knight*), chasse
  (*Hunting: Boar*), minage, construction, craft, cuisson, nage, monture,
  exploration, inactivité, mort avec sa cause (*Drowned*).
- **Ligne 2** : soif (RLCraft), faim, niveau d'XP, jour, jour ou nuit, météo
  et monstres proches.
- **Grande image** : la dimension (Overworld, Nether, End). Au survol : le lieu
  et les stats de la session (blocs, kills, morts).
- **Petite image** : l'activité. Au survol, sur RLCraft : compétences, set
  d'armure et titre de tueur de dragons.
- **Chronomètre** de session, et taille du groupe dès qu'un ami est connecté.
- **États particuliers** : « 🏠 Main Menu » au menu principal, « ⏸️ Game Paused »
  dans le menu pause.

Les noms viennent du fichier de langue officiel du jeu installé, et sont
affichés en anglais ou en français au choix.

## Comment ça marche

Bedrock n'accepte pas de mods. La presence s'appuie donc sur trois sources,
toutes extérieures au jeu :

1. **Le WebSocket de Minecraft** (`/connect`) : des events (blocs, kills, morts,
   déplacements…) et des commandes de **lecture** (heure, météo, scoreboards de
   RLCraft…). La connexion est chiffrée, et une liste blanche empêche toute
   commande qui modifierait le jeu.
2. **L'écran** : la faim et le menu pause, qu'aucune commande ne donne, sont
   lus sur le HUD, uniquement dans de petites zones et sans rien enregistrer.
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

5. **Faim et pause** (facultatif) : en jeu, lance `npm run calibrate`, puis
   `npm run calibrate-pause`, et laisse-toi guider. Voir
   [Lecture de l'écran](#lecture-de-lécran-faim-et-pause).

## Utilisation au quotidien

1. Lance le jeu avec le raccourci **« Minecraft + Presence »**. La presence
   démarre en arrière-plan, sans fenêtre.
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
| `npm run calibrate-pause` | Apprend à reconnaître le menu pause (après `calibrate`). |
| `npm run probe` / `npm run rpc` | Outils de diagnostic, voir [plus bas](#outils-de-diagnostic). |

En arrière-plan, le journal est dans `logs/presence.log`, et la session
précédente dans `presence.log.old`.

## Réglages (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `DISCORD_APP_ID` | — | Application Discord (obligatoire) |
| `PRESENCE_LANG` | `en` | Langue affichée : `en` ou `fr` |
| `SHOW_COORDS` | `0` | `1` pour afficher les coordonnées au survol |
| `PORT` | `19131` | Port du serveur WebSocket |
| `ENCRYPTION` | `1` | `0` pour une connexion en clair (débogage) |
| `TRACE_RLCRAFT` | `0` | `1` pour enregistrer les scoreboards et tags RLCraft dans `logs/rlcraft-trace.jsonl` (calibrage) |

## Lecture de l'écran (faim et pause)

La presence ne regarde que de petites zones de la fenêtre Minecraft, et
seulement quand le jeu est au premier plan. Le reste du temps, elle garde les
dernières valeurs. Aucune capture n'est enregistrée. Les calibrations sont
stockées dans `hud.json`, propre à ton écran et exclu du dépôt.

**Faim.** La presence compte les cuisses de poulet de la barre de faim,
demi-cuisses comprises. Une lecture douteuse n'est jamais affichée : contour
non reconnu, ou couleurs inattendues (menu ouvert, effet de faim qui verdit les
cuisses). La valeur précédente est alors conservée. `npm run calibrate` laisse
30 secondes pour revenir en jeu, HUD visible.

**Menu pause.** Le jeu ne le signale pas, et en multijoueur rien ne se fige.
`npm run calibrate-pause` apprend donc sa signature : il attend que tu sois en
jeu, puis que tu ouvres le menu pause (souris immobile), puis que tu le
refermes. Trois petites zones riches en texte (chez RLCraft, le logo
« RLCraft 1.3 ») sont ensuite vérifiées toutes les 3 secondes. Il en faut 2
sur 3, ce qui tolère un bouton survolé par la souris.

**À recalibrer** si tu changes de résolution, d'échelle d'interface ou de
pack de textures, ou pour la pause, si le menu pause de ton monde a un autre
logo. La presence signale un changement de taille de fenêtre dans son journal.

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

- **Dans un monde sans cheats**, le jeu refuse les sélecteurs avancés
  (`@e`, `@s[lm=…]`) : **pas de niveau d'XP ni de monstres proches**. Tout le
  reste fonctionne.
- `/connect` est à retaper à chaque lancement du jeu, depuis un monde avec cheats.
- Le fonctionnement sans cheats repose sur une faille : le jeu ne vérifie les
  cheats qu'au moment du `/connect`. Mojang peut la corriger. On perdrait alors
  les commandes dans ces mondes, probablement pas les events.
- Faim et pause ne sont lues que lorsque Minecraft est au premier plan.
- Non disponibles sans behavior pack, qui désactiverait les succès : points de
  vie exacts, biome, effets actifs. La température RLCraft est mesurée mais
  pas affichée (échelle non calibrée).

## Architecture

```
bridge.js (WebSocket chiffré) ──events──> state.js ──> presence.js ──> discord.js
      ^         liste blanche                 ^               |
      └──── commandes de lecture ─────────────┤        names.js + i18n.js
                                              │        + data/rlcraft.json
screen.js (captures) ──> hunger.js, pause.js ─┘
```

| Module | Rôle |
|---|---|
| `main.js` | Orchestration : relevés périodiques, menu principal, lien avec le processus du jeu. |
| `bridge.js` | Serveur WebSocket : chiffrement, abonnements, commandes filtrées par liste blanche. |
| `state.js` | État normalisé, déduction de l'activité, stats RLCraft, menu et pause. |
| `presence.js` | Construction de l'activité Discord. |
| `discord.js` | Envoi dédoublonné, au plus une mise à jour toutes les 5 s, reconnexion. |
| `names.js`, `i18n.js` | Noms du jeu et de RLCraft, textes en anglais et en français. |
| `level.js` | Niveau d'XP par dichotomie sur `@s[lm=N]`. |
| `screen.js` | Captures de zones de la fenêtre Minecraft (PowerShell + GDI). |
| `hunger.js`, `pause.js` | Lecture de la barre de faim, reconnaissance du menu pause. |
| `calibrate-hunger.js`, `calibrate-pause.js` | Calibrations correspondantes. |
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
