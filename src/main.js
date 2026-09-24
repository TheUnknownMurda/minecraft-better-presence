// Minecraft Better Presence : Minecraft Bedrock -> Discord Rich Presence.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { MinecraftBridge } from './bridge.js';
import { GameState } from './state.js';
import { buildActivity, menuActivity } from './presence.js';
import { DiscordSink } from './discord.js';
import { setLanguage } from './names.js';
import { createTracer } from './trace.js';
import { findLevel } from './level.js';
import { readHunger } from './hunger.js';
import { recognize } from './screens.js';
import { levelRegion, readLevelText } from './levelocr.js';
import { ScreenReader } from './screen.js';

const PORT = Number(process.env.PORT ?? 19131);
const APP_ID = process.env.DISCORD_APP_ID;
const SHOW_COORDS = process.env.SHOW_COORDS === '1';
const LANG = process.env.PRESENCE_LANG ?? 'en';
const ENCRYPTION = process.env.ENCRYPTION !== '0';

if (!APP_ID) {
  console.error('DISCORD_APP_ID manquant : renseigne-le dans le fichier .env');
  process.exit(1);
}

// En arriere-plan, la sortie part dans logs/presence.log : pas de codes couleur.
const log = (...a) => {
  const line = [`\x1b[90m${new Date().toLocaleString('fr-FR')}\x1b[0m`, ...a].join(' ');
  console.log(process.stdout.isTTY ? line : line.replace(/\x1b\[[0-9;]*m/g, ''));
};

log(`Langue ${LANG} : ${setLanguage(LANG)} traductions du jeu chargees`);

const trace = process.env.TRACE_RLCRAFT === '1' ? createTracer(log) : null;
if (trace) log('Mode trace RLCraft actif : logs/rlcraft-trace.jsonl');

const state = new GameState();
const bridge = new MinecraftBridge({ port: PORT, encryption: ENCRYPTION }).start();
const discord = new DiscordSink(APP_ID).start();

// Diagnostic : chaque nouveau type d'echec de commande est note une fois.
const seenFailures = new Set();
function noteFailure(commandLine, res) {
  if (res.statusCode >= 0) return;
  const why = res.timeout ? 'pas de reponse'
    : res.disconnected ? 'deconnecte'
      : `${res.statusCode} ${String(res.statusMessage ?? '').replace(/\s+/g, ' ').slice(0, 80)}`;
  const key = `${commandLine}|${why}`;
  if (seenFailures.has(key)) return;
  seenFailures.add(key);
  log(`diag : /${commandLine} -> ${why}`);
}

async function pollFast() {
  if (!bridge.connected) return;
  const commands = ['querytarget @s', 'time query daytime', 'time query day', 'weather query',
    'testfor @e[r=24,family=monster]', 'list'];
  const results = await Promise.all(commands.map((c) => bridge.command(c)));
  commands.forEach((c, i) => noteFailure(c, results[i]));
  const [target, time, day, weather, monsters, list] = results;
  const wasInMenu = state.inMenu;
  const wasUnavailable = state.commandsUnavailable;
  state.applyPoll({ target, time, day, weather, monsters, list });
  onMenuChange(wasInMenu);
  if (state.commandsUnavailable && !wasUnavailable) {
    log('\x1b[33mAttention\x1b[0m : ce monde refuse les commandes (connexion rouverte hors d\'un monde avec cheats). '
      + 'Soif, jour, meteo et joueurs sont indisponibles : refais /connect depuis un monde avec cheats.');
  }
}

/** Journalise les passages menu <-> monde ; a l'entree d'un monde, tout relire sans attendre. */
function onMenuChange(wasInMenu) {
  if (wasInMenu === state.inMenu) return;
  if (state.inMenu) {
    log('Menu principal');
    return;
  }
  log('Entree dans un monde');
  pollFast();
  pollSlow();
}

async function pollSlow() {
  if (!bridge.connected || state.inMenu) return;
  const [scores, tags] = await Promise.all([
    bridge.command('scoreboard players list @s'),
    bridge.command('tag @s list'),
  ]);
  state.applyRlcraft(scores, tags);
  trace?.(state);

  const level = await findLevel((cmd) => bridge.command(cmd), state.level);
  if (level !== state.level) log(`Niveau d'XP : ${level ?? 'indisponible'}`);
  state.level = level;
}

let receiving = false;

bridge.on('connected', (from, encrypted, refusal) => {
  state.reset();
  receiving = false;
  log(`\x1b[32mMinecraft connecte\x1b[0m (${from}, ${encrypted ? 'chiffre' : 'en clair'})`);
  // Chiffrement refuse « faute de cheats dans ce monde » : un monde est charge,
  // et il refusera toutes les commandes (connexion rouverte automatiquement
  // hors d'un monde avec cheats). Message du jeu, donc selon sa langue.
  if (/triche|cheat/i.test(refusal ?? '')) {
    state.commandsUnavailable = true;
    log('\x1b[33mAttention\x1b[0m : ce monde refuse les commandes (connexion rouverte hors d\'un monde avec cheats). '
      + 'Soif, jour, meteo et joueurs sont indisponibles : refais /connect depuis un monde avec cheats.');
  }
  pollFast();
  pollSlow();
});
bridge.on('warning', (msg) => log(`\x1b[33mAttention\x1b[0m : ${msg}`));
// Le jeu peut encore tourner : l'affichage retombe alors sur le menu principal,
// ou s'efface (voir la boucle d'affichage).
bridge.on('disconnected', () => log('\x1b[33mMinecraft deconnecte\x1b[0m'));
bridge.on('event', (name, body) => {
  if (!receiving) {
    receiving = true;
    log('Events de jeu recus');
  }
  const wasInMenu = state.inMenu;
  state.applyEvent(name, body);
  onMenuChange(wasInMenu);
});

discord.on('ready', (user) => log(`\x1b[32mDiscord connecte\x1b[0m (${user})`));
discord.on('lost', () => log('\x1b[33mDiscord perdu\x1b[0m, nouvelle tentative dans 15 s'));
const rejections = new Set();
discord.on('rejected', (msg) => {
  if (rejections.has(msg)) return;
  rejections.add(msg);
  log(`\x1b[31mDiscord a refuse la mise a jour\x1b[0m : ${msg}`);
});
discord.on('sent', (a) => {
  log(a ? `\x1b[36m->\x1b[0m ${a.details}  \x1b[90m|\x1b[0m ${a.state}` : '\x1b[36m->\x1b[0m (statut efface)');
});

// Lecture de l'ecran (faim, niveau, pause, inventaire, coffre), seulement quand Minecraft est au
// premier plan ; sinon on garde les dernieres valeurs. Necessite hud.json
// (`npm run calibrate`, puis `npm run calibrate-screens`).
const hud = loadHud();
let screen = null;
let screenBusy = false;
let screenWarned = null;

function loadHud() {
  try {
    const h = JSON.parse(readFileSync(new URL('../hud.json', import.meta.url), 'utf8'));
    // Ancien format : signature du seul menu pause (avant calibrate-screens).
    h.screens ??= h.pause ? { pause: h.pause } : null;
    if (!h.screens) log('Ecrans : pas de calibration, lance `npm run calibrate-screens` pour les afficher');
    return h;
  } catch {
    log('Faim et ecrans : pas de calibration, lance `npm run calibrate` pour les afficher');
    return null;
  }
}

const SCREEN_LOG = {
  pause: 'Menu pause', inventory: 'Inventaire', chest: 'Coffre', trinkets: 'Poche a trinkets', lvlup: 'Menu LVL UP',
};
// Signatures calibrees a part, mais affichees comme un autre ecran.
const SCREEN_AS = { largeChest: 'chest' };

function warnScreenOnce(reason) {
  if (screenWarned === reason) return;
  screenWarned = reason;
  log(`Ecran : ${reason}`);
}

/** Signatures des ecrans qui masquent le HUD, ou des menus dessines par-dessus (HUD visible). */
function signaturesFor(overlay) {
  return Object.fromEntries(Object.entries(hud.screens ?? {}).filter(([, s]) => !!s.overlay === overlay));
}

// Sans WebSocket, seul l'ecran dit si un monde est ouvert : HUD visible, ou
// ecran de jeu reconnu (pause, inventaire...). Il faut deux releves sans cette
// preuve pour conclure au menu : un ecran non appris ne fait que passer.
let worldOnScreen = false;
let noWorldPolls = 0;

function noteWorldOnScreen(seen) {
  if (seen) {
    worldOnScreen = true;
    noWorldPolls = 0;
  } else if (++noWorldPolls >= 2) {
    worldOnScreen = false;
  }
}

async function pollScreen() {
  // Tourne aussi au menu et sans WebSocket : un HUD visible y prouve qu'un monde est ouvert.
  if (!hud || !(gameRunning || bridge.connected) || screenBusy) return;
  screenBusy = true;
  try {
    if (!screen?.alive) screen = new ScreenReader().start();
    const win = await screen.window();
    if (!win.found || !win.fg || win.minimized) return;
    if (win.w !== hud.window.w || win.h !== hud.window.h) {
      warnScreenOnce(`fenetre en ${win.w}x${win.h} au lieu de ${hud.window.w}x${hud.window.h}, relance \`npm run calibrate\``);
      return;
    }
    const grab = (p) => screen.grab(win.x + p.x, win.y + p.y, p.w, p.h);

    const g = hud.hunger;
    // Marge d'une case au-dessus et en dessous pour le tremblement des icones.
    const img = await screen.grab(win.x + g.x, win.y + g.y - g.cell, 9 * g.period + 9 * g.cell, 11 * g.cell);
    const points = readHunger(img, { x: 0, y: g.cell, cell: g.cell, period: g.period });
    if (!bridge.connected || state.inMenu) {
      let seen = points !== null;
      if (!seen && !bridge.connected) seen = (await recognize(signaturesFor(false), grab)) !== null;
      noteWorldOnScreen(seen);
      if (points !== null) state.lastHudAt = Date.now(); // faux menu : applyPoll le corrigera
      return;
    }

    // Barre de faim masquee : un ecran recouvre le HUD (pause, inventaire,
    // coffre, ou un autre non calibre). Visible : en jeu, ou dans un menu
    // dessine par-dessus le jeu (menu LVL UP).
    let shown = await recognize(signaturesFor(points !== null), grab);
    shown = SCREEN_AS[shown] ?? shown;
    if (state.inMenu) return; // le joueur a pu quitter le monde pendant les captures
    // HUD ou ecran de jeu visible : preuve que l'on est en jeu (voir applyPoll).
    noteWorldOnScreen(points !== null || shown !== null);
    if (points !== null || shown) state.lastHudAt = Date.now();
    if (shown !== state.screen) {
      log(shown ? SCREEN_LOG[shown] ?? shown : points === null ? 'Autre ecran (non reconnu)' : 'Retour en jeu');
    }
    state.screen = shown;
    if (points === null) return;
    state.hunger = points;

    // HUD visible : le niveau d'XP y est lisible. Indispensable sans cheats,
    // ou le selecteur @s[lm=N] de level.js est refuse.
    const r = levelRegion(win, g);
    const level = readLevelText(await screen.grab(win.x + r.x, win.y + r.y, r.w, r.h), g.cell);
    if (level === null || state.inMenu) return;
    if (state.level !== null && level !== state.level) {
      warnScreenOnce(`niveau lu a l'ecran (${level}) different de celui des commandes (${state.level})`);
    }
    state.levelScreen = level;
  } catch (e) {
    warnScreenOnce(`capture impossible (${e.message})`);
  } finally {
    screenBusy = false;
  }
}

// Processus du jeu, releve toutes les 5 s. Sans WebSocket (avant le /connect),
// c'est lui qui dit que le jeu tourne. Avec --with-game (raccourci « Minecraft +
// Presence »), la presence vit et meurt avec lui, independamment de la
// connexion (absente avant le /connect, ou coupee par /connect off).
const GAME_EXE = 'Minecraft.Windows.exe';
const GAME_START_TIMEOUT_MS = 3 * 60_000;
const WITH_GAME = process.argv.includes('--with-game');
const launchedAt = Date.now();
let gameRunning = false;
let gameSeen = false;

function isGameRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/NH', '/FO', 'CSV'], { windowsHide: true },
      (err, out) => resolve(!err && out.includes(GAME_EXE)));
  });
}

async function watchGame() {
  const running = await isGameRunning();
  if (running && !gameRunning) {
    gameSeen = true;
    // Nouvelle partie de jeu : menu principal, chronometre depuis le lancement.
    // Une connexion deja rouverte (presence relancee, jeu ouvert) garde son etat.
    if (!bridge.connected) state.reset();
    state.sessionStart = Date.now();
    log(WITH_GAME ? 'Minecraft detecte : la presence s\'arretera a la fermeture du jeu' : 'Minecraft detecte');
  } else if (!running && gameRunning) {
    if (WITH_GAME) await shutdown('Minecraft ferme : arret de la presence');
    log('Minecraft ferme');
    worldOnScreen = false;
    noWorldPolls = 0;
  } else if (WITH_GAME && !gameSeen && Date.now() - launchedAt > GAME_START_TIMEOUT_MS) {
    await shutdown('Minecraft n\'a pas demarre en 3 minutes : arret de la presence');
  }
  gameRunning = running;
}

watchGame();
setInterval(watchGame, 5_000);
// 5 s : c'est aussi ce qui detecte le retour au menu principal.
setInterval(pollFast, 5_000);
setInterval(pollScreen, 3_000);
setInterval(pollSlow, trace ? 2_000 : 30_000);

// Recalcul frequent ; le sink ne pousse vers Discord que ce qui a change.
setInterval(() => {
  if (bridge.connected) {
    if (state.inMenu || state.player.dimension !== null) discord.set(buildActivity(state, { showCoords: SHOW_COORDS }));
  } else if (gameRunning && !worldOnScreen) {
    // Jeu lance, pas (encore) de /connect : le menu principal.
    discord.set(menuActivity(state));
  } else {
    // Jeu ferme, ou un monde a l'ecran sans /connect : rien de sur a afficher.
    discord.clear();
  }
}, 2_000);

log(`En attente de Minecraft : /connect <ton-IP-LAN>:${PORT}`);

async function shutdown(reason) {
  log(reason);
  screen?.stop();
  await discord.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('Arret demande'));
