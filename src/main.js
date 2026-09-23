// Minecraft Better Presence : Minecraft Bedrock -> Discord Rich Presence.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { MinecraftBridge } from './bridge.js';
import { GameState } from './state.js';
import { buildActivity } from './presence.js';
import { DiscordSink } from './discord.js';
import { setLanguage } from './names.js';
import { createTracer } from './trace.js';
import { findLevel } from './level.js';
import { readHunger } from './hunger.js';
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
  state.applyPoll({ target, time, day, weather, monsters, list });
  onMenuChange(wasInMenu);
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

bridge.on('connected', (from, encrypted) => {
  state.reset();
  receiving = false;
  log(`\x1b[32mMinecraft connecte\x1b[0m (${from}, ${encrypted ? 'chiffre' : 'en clair'})`);
  pollFast();
  pollSlow();
});
bridge.on('warning', (msg) => log(`\x1b[33mAttention\x1b[0m : ${msg}`));
bridge.on('disconnected', () => {
  log('\x1b[33mMinecraft deconnecte\x1b[0m : presence effacee');
  discord.clear();
});
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
discord.on('sent', (a) => {
  if (a) log(`\x1b[36m->\x1b[0m ${a.details}  \x1b[90m|\x1b[0m ${a.state}`);
});

// Faim : lue a l'ecran (voir hunger.js), seulement quand Minecraft est au
// premier plan ; sinon on garde la derniere valeur. Necessite `npm run calibrate`.
const hud = loadHud();
let screen = null;
let hungerBusy = false;
let hungerWarned = null;

function loadHud() {
  try {
    return JSON.parse(readFileSync(new URL('../hud.json', import.meta.url), 'utf8'));
  } catch {
    log('Faim : pas de calibration, lance `npm run calibrate` pour l\'afficher');
    return null;
  }
}

function warnHungerOnce(reason) {
  if (hungerWarned === reason) return;
  hungerWarned = reason;
  log(`Faim : ${reason}`);
}

async function pollHunger() {
  if (!hud || !bridge.connected || hungerBusy || state.inMenu) return;
  hungerBusy = true;
  try {
    if (!screen?.alive) screen = new ScreenReader().start();
    const win = await screen.window();
    if (!win.found || !win.fg || win.minimized) return;
    if (win.w !== hud.window.w || win.h !== hud.window.h) {
      warnHungerOnce(`fenetre en ${win.w}x${win.h} au lieu de ${hud.window.w}x${hud.window.h}, relance \`npm run calibrate\``);
      return;
    }
    const g = hud.hunger;
    // Marge d'une case au-dessus et en dessous pour le tremblement des icones.
    const img = await screen.grab(win.x + g.x, win.y + g.y - g.cell, 9 * g.period + 9 * g.cell, 11 * g.cell);
    const points = readHunger(img, { x: 0, y: g.cell, cell: g.cell, period: g.period });
    // Le joueur a pu quitter le monde pendant la capture.
    if (points !== null && !state.inMenu) state.hunger = points;
  } catch (e) {
    warnHungerOnce(`capture impossible (${e.message})`);
  } finally {
    hungerBusy = false;
  }
}

// 5 s : c'est aussi ce qui detecte le retour au menu principal.
setInterval(pollFast, 5_000);
setInterval(pollHunger, 5_000);
setInterval(pollSlow, trace ? 2_000 : 30_000);

// Recalcul frequent ; le sink ne pousse vers Discord que ce qui a change.
setInterval(() => {
  if (bridge.connected && (state.inMenu || state.player.dimension !== null)) {
    discord.set(buildActivity(state, { showCoords: SHOW_COORDS }));
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

// --with-game (raccourci « Minecraft + Presence ») : la presence vit et meurt
// avec le processus du jeu, independamment de la connexion WebSocket (qui peut
// etre absente avant le /connect, ou coupee par /connect off).
const GAME_EXE = 'Minecraft.Windows.exe';
const GAME_START_TIMEOUT_MS = 3 * 60_000;

function isGameRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/NH', '/FO', 'CSV'], { windowsHide: true },
      (err, out) => resolve(!err && out.includes(GAME_EXE)));
  });
}

if (process.argv.includes('--with-game')) {
  const launchedAt = Date.now();
  let seen = false;
  setInterval(async () => {
    const running = await isGameRunning();
    if (running && !seen) {
      seen = true;
      log('Minecraft detecte : la presence s\'arretera a la fermeture du jeu');
    } else if (!running && seen) {
      await shutdown('Minecraft ferme : arret de la presence');
    } else if (!running && Date.now() - launchedAt > GAME_START_TIMEOUT_MS) {
      await shutdown('Minecraft n\'a pas demarre en 3 minutes : arret de la presence');
    }
  }, 5_000);
}
