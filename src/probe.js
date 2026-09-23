// Sonde WebSocket Minecraft Bedrock.
// But : determiner empiriquement quels events remontent encore sur ta version
// + avec l'addon RLCraft, et quelles commandes de lecture d'etat repondent.
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import http from 'node:http';
import readline from 'node:readline';
import { ALL_EVENTS, PRESENCE_RELEVANT, NOISY } from './events.js';

const PORT = Number(process.env.PORT ?? 19131);

// Batterie de commandes testees automatiquement a la connexion : chacune
// repond a une question precise sur ce qu'on pourra afficher.
const PROBE_COMMANDS = [
  ['querytarget @s',              'position exacte + dimension + rotation'],
  ['time query daytime',          'heure du monde -> jour/nuit'],
  ['testfor @s[m=creative]',      'detection gamemode (creatif)'],
  ['testfor @s[m=survival]',      'detection gamemode (survie)'],
  ['list',                        'joueurs connectes'],
  ['scoreboard objectives list',  'pont scoreboard pour vie/faim/XP'],
  ['locate biome plains',         'detection du biome courant'],
];

mkdirSync('logs', { recursive: true });
const logPath = `logs/session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
const logFile = createWriteStream(logPath, { flags: 'a' });

const stats = {
  events: new Map(),      // eventName -> { count, lastBody }
  commands: new Map(),    // commandLine -> { ok, body }
};
let verbose = false;
let sockets = 0;

const ts = () => new Date().toLocaleTimeString('fr-FR');
const log = (...a) => console.log(`\x1b[90m${ts()}\x1b[0m`, ...a);

/** 172.16-31.x heberge presque toujours WSL / Hyper-V / Docker, pas le vrai LAN. */
const isVirtual = (ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  // Les adresses vraisemblablement reelles d'abord.
  return out.sort((a, b) => Number(isVirtual(a)) - Number(isVirtual(b)));
}

function send(ws, purpose, body, messageType = 'commandRequest') {
  const requestId = randomUUID();
  ws.send(JSON.stringify({
    header: { version: 1, requestId, messageType, messagePurpose: purpose },
    body,
  }));
  return requestId;
}

/** Envoie une commande ; la promesse se resout avec le body de la reponse. */
function runCommand(ws, commandLine, note, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const id = send(ws, 'commandRequest', {
      origin: { type: 'player' },
      commandLine,
      version: 1,
    });
    const timer = setTimeout(() => {
      ws.pending.delete(id);
      resolve({ timeout: true });
    }, timeoutMs);
    ws.pending.set(id, { commandLine, note, sentAt: Date.now(), resolve, timer });
  });
}

/** "minecraft:dirt" a partir d'un objet item/bloc du protocole, "-" si main vide. */
const itemName = (x) => (typeof x === 'string' ? x
  : x?.id ? `${x.namespace ? `${x.namespace}:` : ''}${x.id}` : '-');

/**
 * Condense un body d'event en une ligne lisible.
 * Format 1.26 : champs directement dans body, en camelCase (plus de body.properties).
 */
function summarize(eventName, b = {}) {
  switch (eventName) {
    case 'BlockBroken':
    case 'BlockPlaced':     return `${itemName(b.block)} outil=${itemName(b.tool)}`;
    case 'MobKilled':       return `${b.victim?.type} arme=${itemName(b.weapon)} monstre=${b.isMonster}`;
    case 'PlayerDied':      return `cause=${b.cause} tueur=${JSON.stringify(b.killer)}`;
    case 'PlayerTravelled': return `methode=${b.travelMethod} ${b.metersTravelled?.toFixed(1)}m eau=${b.isUnderwater}`;
    case 'PlayerTransform': {
      const p = b.player?.position;
      return p ? `dim=${b.player.dimension} ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)}` : '';
    }
    case 'PlayerMessage':   return `${b.type} <${b.sender}> ${b.message}`;
    case 'ItemCrafted':
    case 'ItemSmelted':
    case 'ItemUsed':
    case 'ItemDropped':
    case 'ItemAcquired':
    case 'ItemInteracted':  return `${itemName(b.item)} x${b.count ?? 1}`;
    default:                return JSON.stringify(b).slice(0, 160);
  }
}

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

console.log('\n\x1b[1m  Minecraft Better Presence -- sonde WebSocket\x1b[0m');
console.log(`  Journal complet : ${logPath}\n`);
console.log('  Dans Minecraft, tape une de ces commandes :\n');
for (const ip of lanAddresses()) {
  const hint = isVirtual(ip)
    ? 'probablement une interface virtuelle (WSL/Hyper-V/Docker)'
    : "<- a essayer en premier, pas besoin d'admin";
  console.log(`    \x1b[36m/connect ${ip}:${PORT}\x1b[0m   \x1b[90m${hint}\x1b[0m`);
}
console.log(`    \x1b[36m/connect localhost:${PORT}\x1b[0m   \x1b[90m(necessite l'exemption loopback)\x1b[0m`);
console.log('\n  Console : .summary  .verbose  .probe  .quit');
console.log('  Tout autre texte est envoye au jeu comme commande.\n');

wss.on('connection', (ws, req) => {
  ws.id = ++sockets;
  ws.pending = new Map();
  const from = req.socket.remoteAddress?.replace('::ffff:', '') ?? '?';

  console.log(`\n\x1b[32m  [OK] Minecraft connecte\x1b[0m (socket #${ws.id}, depuis ${from})`);
  console.log('    \x1b[90mL\'adresse source repond a la question "qui heberge" :');
  console.log('    127.0.0.1 = ta machine, autre IP = la machine de ton ami\x1b[0m\n');

  for (const ev of ALL_EVENTS) send(ws, 'subscribe', { eventName: ev });
  log(`Abonnement a ${ALL_EVENTS.length} events envoye.`);

  setTimeout(() => {
    log('Lancement de la batterie de commandes...\n');
    PROBE_COMMANDS.forEach(([cmd, note], i) => {
      setTimeout(() => runCommand(ws, cmd, note), i * 400);
    });
  }, 1000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    logFile.write(JSON.stringify({ at: Date.now(), socket: ws.id, msg }) + '\n');

    const purpose = msg.header?.messagePurpose;

    if (purpose === 'event') {
      const name = msg.body?.eventName ?? msg.header?.eventName ?? '?';
      const entry = stats.events.get(name) ?? { count: 0 };
      entry.count++;
      entry.lastBody = msg.body;
      stats.events.set(name, entry);

      if (verbose || !NOISY.has(name)) {
        const tag = PRESENCE_RELEVANT.has(name) ? '\x1b[33m*\x1b[0m' : ' ';
        log(`${tag} \x1b[1m${name}\x1b[0m  \x1b[90m${summarize(name, msg.body)}\x1b[0m`);
      }
      return;
    }

    if (purpose === 'commandResponse') {
      const pend = ws.pending.get(msg.header.requestId);
      ws.pending.delete(msg.header.requestId);
      if (pend) {
        clearTimeout(pend.timer);
        pend.resolve(msg.body);
      }
      const line = pend?.commandLine ?? '(inconnue)';
      const code = msg.body?.statusCode ?? 0;
      const ok = code >= 0;
      stats.commands.set(line, { ok, body: msg.body });

      const mark = ok ? '\x1b[32mOK\x1b[0m' : '\x1b[31mKO\x1b[0m';
      log(`${mark} /${line}${pend?.note ? `  \x1b[90m(${pend.note})\x1b[0m` : ''}`);
      const detail = msg.body?.details ?? msg.body?.statusMessage;
      if (detail) {
        const text = String(detail).slice(0, 600).replace(/\n/g, '\n       ');
        console.log(`       \x1b[36m${text}\x1b[0m`);
      }
      return;
    }

    if (purpose === 'error') {
      log(`\x1b[31mERREUR\x1b[0m ${msg.body?.statusMessage ?? JSON.stringify(msg.body)}`);
      return;
    }

    if (verbose) log(`  <${purpose}> ${JSON.stringify(msg.body).slice(0, 200)}`);
  });

  ws.on('close', () => console.log(`\n\x1b[33m  Minecraft deconnecte (socket #${ws.id})\x1b[0m\n`));
  ws.on('error', (e) => log(`\x1b[31mErreur socket:\x1b[0m ${e.message}`));
});

function printSummary() {
  console.log('\n\x1b[1m  --- Events recus ------------------------------\x1b[0m');
  const rows = [...stats.events.entries()].sort((a, b) => b[1].count - a[1].count);
  if (!rows.length) console.log('  (aucun)');
  for (const [name, { count }] of rows) {
    const tag = PRESENCE_RELEVANT.has(name) ? '\x1b[33m utile\x1b[0m' : '      ';
    console.log(`  ${String(count).padStart(5)} x${tag} ${name}`);
  }

  console.log('\n\x1b[1m  --- Commandes testees -------------------------\x1b[0m');
  if (!stats.commands.size) console.log('  (aucune)');
  for (const [line, { ok }] of stats.commands) {
    console.log(`  ${ok ? '\x1b[32mOK\x1b[0m' : '\x1b[31mKO\x1b[0m'}  /${line}`);
  }

  const silent = ALL_EVENTS.filter((e) => !stats.events.has(e) && PRESENCE_RELEVANT.has(e));
  if (silent.length) {
    console.log('\n\x1b[90m  Events utiles jamais vus (retires par Mojang, ou action pas encore faite) :\x1b[0m');
    console.log(`  \x1b[90m${silent.join(', ')}\x1b[0m`);
  }
  console.log(`\n  Journal complet : ${logPath}\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  if (t === '.summary') return printSummary();
  if (t === '.verbose') { verbose = !verbose; return log(`Mode verbeux : ${verbose ? 'ON' : 'OFF'}`); }
  if (t === '.quit') { printSummary(); process.exit(0); }
  if (t === '.probe') {
    for (const ws of wss.clients) {
      PROBE_COMMANDS.forEach(([c, n], i) => setTimeout(() => runCommand(ws, c, n), i * 400));
    }
    return;
  }
  const cmd = t.startsWith('/') ? t.slice(1) : t;
  if (!wss.clients.size) return log('\x1b[31mAucun client Minecraft connecte.\x1b[0m');
  for (const ws of wss.clients) runCommand(ws, cmd, 'manuelle');
});

process.on('SIGINT', () => { printSummary(); process.exit(0); });

// Canal de controle local : permet de piloter la sonde depuis un autre
// terminal (ou un script) pendant qu'elle tourne en arriere-plan.
//   POST /cmd    body = ligne de commande Minecraft -> reponse JSON du jeu
//   GET  /stats  -> compteurs d'events et resultats des commandes
const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 19140);
http.createServer(async (req, res) => {
  const reply = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };

  if (req.method === 'GET' && req.url === '/stats') {
    return reply(200, {
      clients: wss.clients.size,
      events: Object.fromEntries([...stats.events].map(([k, v]) => [k, v.count])),
      commands: Object.fromEntries([...stats.commands].map(([k, v]) => [k, v.ok])),
    });
  }

  if (req.method === 'POST' && req.url === '/cmd') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const cmd = body.trim().replace(/^\//, '');
    const [ws] = wss.clients;
    if (!ws) return reply(409, { error: 'aucun client Minecraft connecte' });
    return reply(200, { command: cmd, response: await runCommand(ws, cmd, 'controle') });
  }

  reply(404, { error: 'routes : GET /stats, POST /cmd' });
}).listen(CONTROL_PORT, '127.0.0.1');
